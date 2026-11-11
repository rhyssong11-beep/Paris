/**
 * Full-screen 3D viewer for a single landmark (Three.js). Loaded on demand, so the map itself
 * stays light. Shows the landmark's GLB model when one is present under public/models/, and a
 * procedural stand-in otherwise.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import type { ViewerEntry } from './viewer-registry';
import { buildWalkGrid, WalkMode } from './viewer-walk';
import { findSplat } from './viewer-splat';
import { disposeObject } from './viewer-resources';
import { QUALITY, ViewerQuality } from './viewer-quality';
import { buildCity } from './viewer-city';
import { buildStreets } from './viewer-streets';
import { applyLouvreTextures, buildLouvreNightLights, buildLouvreSurroundings } from './viewer-louvre';
import { buildArcNightLights, buildArcSurroundings } from './viewer-arc';
import { applyNotreDameTextures, buildNotreDameNightLights, buildNotreDameSurroundings } from './viewer-notredame';

const SPARKLES = 2600;
const GOLD = new THREE.Color('#ffb347');

export interface ViewerOptions extends ViewerEntry {
  name: string;
  night: boolean;
  onClose?: () => void;
}

let closeCurrent: (() => void) | null = null;

export async function openViewer(opts: ViewerOptions) {
  closeCurrent?.();

  // ------------------------------------------------------------------ DOM
  const root = document.createElement('div');
  root.id = 'viewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', `${opts.name} 3D 보기`);
  root.innerHTML = `
    <canvas></canvas>
    <div class="v-vignette"></div>
    <div class="v-title"><h2></h2><p></p></div>
    <div class="v-bar">
      <button data-act="day">☀ 낮</button>
      <button data-act="night">☾ 밤</button>
      <button data-act="twinkle" aria-pressed="false">반짝임 보기</button>
      <button data-act="spin" aria-pressed="true">자동 회전</button>
      <button data-act="street" aria-pressed="false">거리 보기</button>
      <button data-act="walk" aria-pressed="false">걸어서 보기</button>
      <button data-act="traffic" aria-label="사람·차량 이동" aria-pressed="true">주변 이동</button>
      <label class="v-quality">화질 <select aria-label="3D 화질"><option value="auto">자동</option><option value="high">높음</option><option value="medium">균형</option><option value="low">절약</option></select></label>
    </div>
    <button class="v-close" aria-label="닫기">✕</button>
    <div class="v-cross" hidden></div>
    <div class="v-hint">드래그: 회전 · 휠/핀치: 확대 · 오른쪽 드래그: 이동</div>
    <div class="v-note"></div>
    <div class="v-loading">모델을 불러오는 중…</div>`;
  root.querySelector('h2')!.textContent = opts.name;
  root.querySelector('p')!.textContent = opts.subtitle;
  document.body.append(root);
  const previousFocus = document.activeElement as HTMLElement | null;
  const controller = new AbortController();
  const cleanup: (() => void)[] = [];
  let closed = false;
  const own = (dispose: () => void) => {
    if (closed) dispose();
    else cleanup.push(dispose);
  };
  const release = () => {
    for (const dispose of cleanup.splice(0).reverse()) {
      try { dispose(); } catch (err) { console.warn('viewer cleanup', err); }
    }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    release();
    if (closeCurrent === close) closeCurrent = null;
    const debug = window as Window & { viewer3d?: { close: () => void } };
    if (debug.viewer3d?.close === close) delete debug.viewer3d;
    root.remove();
    previousFocus?.focus();
    opts.onClose?.();
  };
  closeCurrent = close;
  /** `leave` is set once the 3D scene exists: it leaves walk mode if it is on and says whether it was. */
  const walkHook = { leave: (): boolean => false };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); if (!walkHook.leave()) close(); }
    if (e.key === 'Tab') {
      const items = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled)')]
        .filter((item) => item.getClientRects().length > 0);
      const first = items[0];
      const last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  own(() => window.removeEventListener('keydown', onKey, true));
  root.querySelector<HTMLButtonElement>('.v-close')!.addEventListener('click', close);
  root.querySelector<HTMLButtonElement>('.v-close')!.focus();
  root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('.v-bar button, .v-bar select').forEach((b) => b.disabled = true);
  try {
    await buildViewer(opts, root, controller.signal, own, close, walkHook);
    if (!closed) root.querySelectorAll<HTMLButtonElement | HTMLSelectElement>('.v-bar button, .v-bar select').forEach((b) => b.disabled = false);
  } catch (err) {
    if (closed) return;
    release();
    // Keep an operable close button even on devices without WebGL.
    window.addEventListener('keydown', onKey, true);
    own(() => window.removeEventListener('keydown', onKey, true));
    const message = root.querySelector('.v-loading') ?? root.appendChild(Object.assign(document.createElement('div'), { className: 'v-loading' }));
    message.textContent = '3D 보기를 불러오지 못했습니다. 닫고 다시 시도해 주세요.';
    console.error('viewer initialization', err);
  }
}

async function buildViewer(opts: ViewerOptions, root: HTMLElement, signal: AbortSignal, own: (dispose: () => void) => void, close: () => void, walkHook: { leave: () => boolean }) {
  const base = import.meta.env.BASE_URL;
  let canvas = root.querySelector('canvas')!;
  const note = root.querySelector<HTMLElement>('.v-note')!;

  // ------------------------------------------------------------------ photoreal splat capture, if one is present
  const splatUrl = opts.splat ? await findSplat(`${base}${opts.splat.path}`, signal) : null;
  signal.throwIfAborted();
  if (splatUrl) {
    let disposeSplat: (() => void) | undefined;
    try {
      const { openSplatViewer } = await import('./viewer-splat-run');
      signal.throwIfAborted();
      const sv = await openSplatViewer(canvas, splatUrl, opts.height, opts.splat!, signal);
      disposeSplat = () => sv.dispose();
      own(() => sv.dispose());
      signal.throwIfAborted();
      root.classList.add('splat');
      note.textContent = opts.credit ?? '';
      const quality = new ViewerQuality(root.querySelector('select')!, () => resize());
      sv.observeFrames((dt) => quality.sample(dt));
      const resize = () => {
        quality.resize();
        sv.resize(root.clientWidth, root.clientHeight, QUALITY[quality.level].pixelRatio);
      };
      resize();
      window.addEventListener('resize', resize);
      own(() => window.removeEventListener('resize', resize));
      const spin = root.querySelector<HTMLElement>('[data-act=spin]')!;
      spin.addEventListener('click', () => {
        sv.controls.autoRotate = !sv.controls.autoRotate;
        spin.setAttribute('aria-pressed', String(sv.controls.autoRotate));
      });
      root.querySelector('.v-loading')!.remove();
      Object.assign(window, { viewer3d: { scene: sv.scene, camera: sv.camera, controls: sv.controls, mode: 'splat', splats: sv.splats, usingFallback: false, close } });
      return;
    } catch (err) {
      disposeSplat?.();
      signal.throwIfAborted();
      // Unreadable capture: fall back to the mesh model on a fresh canvas (this one's GL context is spent).
      console.warn('splat capture could not be shown, falling back to the 3D model', err);
      root.classList.remove('splat');
      const fresh = document.createElement('canvas');
      canvas.replaceWith(fresh);
      canvas = fresh;
    }
  }

  // ------------------------------------------------------------------ scene
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  own(() => { renderer.dispose(); renderer.forceContextLoss(); });
  const quality = new ViewerQuality(root.querySelector('select')!, () => resize());
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[quality.level].pixelRatio));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  own(() => disposeObject(scene));
  const pmrem = new THREE.PMREMGenerator(renderer);
  own(() => pmrem.dispose());
  const room = new RoomEnvironment();
  const nightTarget = pmrem.fromScene(room, 0.04);
  room.dispose();
  own(() => nightTarget.dispose());
  const envMap = nightTarget.texture;
  // Daytime reflections come from the same sky and ground the viewer shows, so the iron picks up
  // warm light from the horizon and cool light from above instead of a white studio.
  const DAY_SKY = ['#2c69bd', '#86b7e6', '#f1e2c9'];
  const dayEnv = (() => {
    const env = new THREE.Scene();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.MeshBasicMaterial({
        map: gradientTexture([DAY_SKY[0], DAY_SKY[0], DAY_SKY[1], DAY_SKY[2], '#8a8577', '#6f6a5e'], [0, 0.34, 0.47, 0.5, 0.6, 1]),
        side: THREE.BackSide,
      }),
    );
    env.add(dome);
    const target = pmrem.fromScene(env, 0.02);
    disposeObject(env);
    own(() => target.dispose());
    return target.texture;
  })();
  scene.environment = envMap;

  // `site` is set for landmarks other than the Eiffel Tower, whose setting is the default below.
  const site = opts.site;
  const H = site?.span ?? opts.height;
  if (site) root.classList.add(`site-${site.kind}`);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, H * 40);
  camera.position.set(H * 1.38, H * 0.66, H * 1.38);
  const controls = new OrbitControls(camera, canvas);
  own(() => controls.dispose());
  controls.target.set(0, H * 0.42, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.7;
  controls.minDistance = site ? 25 : H * 0.25;
  if (site) {
    camera.position.set(...site.camera.position);
    controls.target.set(...site.camera.target);
  }
  controls.maxDistance = H * 4;
  controls.maxPolarAngle = Math.PI * 0.497; // stay above the ground

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a4436, 1);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3);
  // A fairly low afternoon sun: long shadows and strong modelling on the ironwork.
  sun.position.set(-H * 1.1, H * 1.0, H * 0.75);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.normalBias = 0.6;
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -(site?.detail.half ?? H * 0.9);
  sc.right = sc.top = site?.detail.half ?? H * 0.9;
  if (site) {
    // Aim the sun's shadow area at the middle of the site rather than at the origin.
    sun.position.x += site.detail.x;
    sun.position.z += site.detail.z;
    sun.target.position.set(site.detail.x, 0, site.detail.z);
  }
  sc.near = 1;
  sc.far = H * 4;
  sun.shadow.bias = -0.0004;
  scene.add(hemi, sun, sun.target);

  // Ground: a soft-edged disc so the horizon fades into the sky.
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x8a8577, roughness: 1, metalness: 0 });
  // The Louvre's ground leaves a hole under the main pyramid, where the paving opens onto the hall below.
  const ground = new THREE.Mesh(site?.kind === 'louvre' ? new THREE.RingGeometry(24.5, H * 12, 96) : new THREE.CircleGeometry(H * 12, 96), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(H * 0.62, 96),
    new THREE.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.95, metalness: 0 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.05;
  plaza.receiveShadow = true;
  scene.add(ground, plaza);
  const city = site?.kind === 'arc'
    ? buildArcSurroundings(H)
    : site?.kind === 'notredame'
      ? buildNotreDameSurroundings(H)
      : site
        ? buildLouvreSurroundings(H)
        : buildCity(H);
  scene.add(city.group);
  const streets = buildStreets();
  scene.add(streets.group);
  if (site) {
    // The animated pedestrians and traffic follow routes laid out for the Eiffel Tower's streets.
    streets.group.visible = false;
    streets.setPaused(true);
  }
  root.querySelector('[data-act=traffic]')!.setAttribute('aria-pressed', String(!streets.paused));

  // Stars (night only).
  const starGeo = new THREE.BufferGeometry();
  {
    const p = new Float32Array(320 * 3);
    for (let i = 0; i < 320; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.asin(0.08 + Math.random() * 0.92);
      const r = H * 14;
      p.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  }
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xc6d4ea, size: 1, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.28 }));
  scene.add(stars);

  // Post-processing: bloom makes the night lighting glow.
  // Multisampled so the thin ironwork stays crisp through the post-processing chain.
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType }));
  own(() => {
    for (const pass of composer.passes) pass.dispose();
    composer.dispose();
  });
  composer.addPass(new RenderPass(scene, camera));
  // Ambient occlusion: darkens the places light struggles to reach (between girders, under the
  // platforms, where trees and kerbs meet the ground), which is what gives the model depth.
  const ao = new GTAOPass(scene, camera, 1, 1);
  ao.setSceneClipBox(site
    ? new THREE.Box3(new THREE.Vector3(site.detail.x - site.detail.half, -1, site.detail.z - site.detail.half), new THREE.Vector3(site.detail.x + site.detail.half, 80, site.detail.z + site.detail.half))
    : new THREE.Box3(new THREE.Vector3(-H * 0.7, -1, -H * 0.8), new THREE.Vector3(H * 0.7, H * 1.05, H * 0.8)));
  ao.blendIntensity = 0.65;
  ao.updateGtaoMaterial({ radius: 3, distanceExponent: 1.3, thickness: 2.5, scale: 1.25, samples: 12, screenSpaceRadius: false });
  ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 8 });
  composer.addPass(ao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.3, 1.05);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ------------------------------------------------------------------ model
  let usingFallback = false;
  let model: THREE.Object3D;
  try {
    model = await loadGlb(`${base}${opts.modelUrl}`, `${base}draco/`, site?.metric ? null : H, signal);
  } catch (err) {
    signal.throwIfAborted();
    if (site) throw err; // only the Eiffel Tower has a built-in stand-in model
    usingFallback = true;
    model = buildEiffel(H);
  }
  if (signal.aborted) { disposeObject(model); signal.throwIfAborted(); }
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = !/Pyramid_Glass/.test(o.name); // sunlight reaches the hall under the pyramid
      o.receiveShadow = true;
    }
  });
  scene.add(model);
  plaza.visible = usingFallback;
  applyGroundTextures(model, renderer.capabilities.getMaxAnisotropy());
  if (site?.kind === 'louvre') applyLouvreTextures(model, `${base}models/louvre/`, renderer.capabilities.getMaxAnisotropy(), own);
  if (site?.kind === 'notredame') applyNotreDameTextures(model, `${base}models/notredame/`, renderer.capabilities.getMaxAnisotropy(), own);
  note.textContent = usingFallback ? '간략 모델 · 상세 모델을 불러오지 못했습니다.' : (opts.credit ?? '');
  root.querySelector('.v-loading')!.remove();

  // Light the surfaces from within, keeping the unlit sides of the ironwork dark.
  const nightLights = new THREE.Group();
  if (site?.kind === 'arc') nightLights.add(buildArcNightLights(H));
  else if (site?.kind === 'notredame') nightLights.add(buildNotreDameNightLights());
  else if (site) nightLights.add(buildLouvreNightLights());
  for (const [y, width, targetY, targetWidth, intensity] of site ? [] : [
    [7, 43, 80, 24, 56000],
    [119, 14, 250, 4, 85000],
  ]) {
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const light = new THREE.SpotLight(0xffbf70, intensity, H, 0.46, 0.65, 2);
      light.position.set(sx * width, y, sz * width);
      light.target.position.set(sx * targetWidth, targetY, sz * targetWidth);
      nightLights.add(light, light.target);
    }
  }
  scene.add(nightLights);

  // Remember each material's daytime look and classify its night lighting role.
  type NightRole = 'tower' | 'stone' | 'window' | 'glow' | 'ground';
  const WARM_WINDOW = new THREE.Color('#ffe299');
  const mats = new Map<THREE.MeshStandardMaterial, { emissive: THREE.Color; intensity: number; opacity: number; role: NightRole }>();
  model.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      const std = mat as THREE.MeshStandardMaterial;
      if (!std.emissive || mats.has(std)) continue;
      const tag = `${o.name} ${std.name}`;
      let role: NightRole = 'tower';
      if (/GlassFloor/i.test(tag)) role = 'ground';
      else if (/Glass/i.test(tag)) role = 'window';
      else if (/Glow/i.test(tag)) role = 'glow';
      else if (/(Plaza|Park|Foliage|Trunk|Water|Lawn|Curb)/i.test(tag)) role = 'ground';
      else if (/Stone/i.test(tag)) role = 'stone';
      mats.set(std, { emissive: std.emissive.clone(), intensity: std.emissiveIntensity, opacity: std.opacity, role });
    }
  });

  // Sparkle lights scattered over the iron tower structure only (the tower's hourly twinkle).
  const sparkle = makeSparkles(model);
  scene.add(sparkle.points);

  // Rotating beacon at the summit.
  const beacon = new THREE.Group();
  beacon.position.y = H * 0.915;
  const beamMaterial = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xcfe4ff) } },
    vertexShader: `varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main() { vUv = uv; vNormal = normalMatrix * normal;
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = -mv.xyz;
        gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 color; varying vec2 vUv; varying vec3 vNormal; varying vec3 vView;
      void main() { float edge = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float fade = smoothstep(0.0, 0.7, vUv.y) * vUv.y;
        gl_FragColor = vec4(color, edge * fade * 0.018); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  for (const dir of [1, -1]) {
    const len = H * 3.4; // long enough that the far end is lost in the haze
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(H * 0.03, len, 24, 1, true),
      beamMaterial,
    );
    cone.rotation.z = (dir * Math.PI) / 2; // apex at the tower, widening outwards
    cone.position.x = (dir * len) / 2;
    beacon.add(cone);
  }
  scene.add(beacon);

  // ------------------------------------------------------------------ day / night
  let night = opts.night;
  let twinkleUntil = 0;
  const twinkleButton = root.querySelector<HTMLButtonElement>('[data-act=twinkle]')!;
  const applyMode = () => {
    const sky = night ? ['#050b18', '#101b30', '#333343'] : DAY_SKY;
    if (scene.background instanceof THREE.Texture) scene.background.dispose();
    const background = gradientTexture([sky[0], sky[0], sky[1], sky[2], sky[2]], [0, 0.34, 0.47, 0.5, 1]);
    // Match fog to the sky at zero elevation, even when the camera tilts or changes aspect ratio.
    background.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = background;
    scene.fog = new THREE.Fog(sky[sky.length - 1], H * 2.3, H * 6.3);
    scene.environment = night ? envMap : dayEnv;
    scene.environmentIntensity = night ? 0.18 : 0.6;
    hemi.intensity = night ? 0.12 : 0.4;
    hemi.color.set(night ? 0x5a6cb0 : 0xbcd6f5);
    hemi.groundColor.set(night ? 0x20202a : 0x6b6252);
    sun.intensity = night ? 0.04 : 2.7;
    sun.color.set(night ? 0x9db4ff : 0xffe3bd);
    groundMat.color.set(night ? 0x1a2030 : 0x8a8577);
    city.setNight(night);
    streets.setNight(night);
    (plaza.material as THREE.MeshStandardMaterial).color.set(night ? 0x3a3a44 : 0xb9b3a6);
    renderer.toneMappingExposure = night ? 1.05 : 0.9;
    bloom.enabled = night && QUALITY[quality.level].bloom;
    ao.enabled = !night && QUALITY[quality.level].aoScale > 0;
    stars.visible = nightLights.visible = night;
    beacon.visible = night && !site; // the summit beacon and the twinkle belong to the Eiffel Tower
    sparkle.points.visible = night && twinkleUntil > 0;
    twinkleButton.hidden = !night || !!site;
    if (!night) { twinkleUntil = 0; twinkleButton.setAttribute('aria-pressed', 'false'); }
    for (const [m, day] of mats) {
      if (night) {
        if (day.role === 'glow') {
          m.emissive.copy(WARM_WINDOW);
          m.emissiveIntensity = 1.0;
        } else if (day.role === 'window') {
          m.emissive.copy(WARM_WINDOW);
          m.emissiveIntensity = 0.22;
          m.opacity = 0.7;
        } else if (day.role === 'tower') {
          m.emissive.copy(GOLD);
          m.emissiveIntensity = 0.018;
        } else if (day.role === 'stone') {
          m.emissive.copy(GOLD);
          m.emissiveIntensity = 0.012;
        } else {
          m.emissive.setRGB(0, 0, 0);
          m.emissiveIntensity = 0;
        }
      } else {
        m.emissive.copy(day.emissive);
        m.emissiveIntensity = day.intensity;
        m.opacity = day.opacity;
      }
    }
    root.querySelector('[data-act=day]')!.setAttribute('aria-pressed', String(!night));
    root.querySelector('[data-act=night]')!.setAttribute('aria-pressed', String(night));
  };
  applyMode();

  // ------------------------------------------------------------------ loop & lifecycle
  const resize = () => {
    quality.resize();
    const profile = QUALITY[quality.level];
    streets.setQuality(quality.level);
    const w = root.clientWidth;
    const h = root.clientHeight;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, profile.pixelRatio);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    for (const target of [composer.renderTarget1, composer.renderTarget2]) {
      if (target.samples !== profile.samples) { target.dispose(); target.samples = profile.samples; }
    }
    composer.setSize(w, h);
    if (profile.aoScale) ao.setSize(Math.round(w * pixelRatio * profile.aoScale), Math.round(h * pixelRatio * profile.aoScale));
    if (sun.shadow.mapSize.x !== profile.shadow) {
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.shadow.mapSize.setScalar(profile.shadow);
    }
    applyMode();
    camera.aspect = w / h;
    // Pull back on tall narrow screens so the whole landmark fits.
    camera.fov = w < h ? 52 : 38;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);
  own(() => window.removeEventListener('resize', resize));

  let raf = 0;
  const timer = new THREE.Timer();
  timer.connect(document);
  own(() => timer.dispose());
  const fineMeshes: THREE.Object3D[] = [];
  model.traverse((o) => { if (/FineIron/.test(o.name)) fineMeshes.push(o); });
  let streetView = false;
  const overview = { position: camera.position.clone(), target: controls.target.clone(), spin: controls.autoRotate };
  let flight: { start: number; from: THREE.Vector3; to: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3 } | undefined;
  own(() => cancelAnimationFrame(raf));

  // ------------------------------------------------------------------ walking around on foot
  const HINT_ORBIT = root.querySelector('.v-hint')!.textContent!;
  const walkButton = root.querySelector<HTMLButtonElement>('[data-act=walk]')!;
  const WALK_RADIUS = site?.walk.radius ?? 540;
  const walk = new WalkMode({
    camera,
    canvas,
    grid: () => buildWalkGrid([model, city.group], WALK_RADIUS + 20),
    allowed: (x, z) => {
      if (Math.hypot(x, z) > WALK_RADIUS) return false; // the edge of the detailed scene
      if ('allowed' in city && typeof city.allowed === 'function') return city.allowed(x, z);
      if (!('river' in city)) return true;
      const { z0, z1, bridgeHalfWidth } = city.river;
      return z < z0 || z > z1 || Math.abs(x) < bridgeHalfWidth - 1; // the Seine, except on the bridge
    },
    start: site ? site.walk : { x: 0, z: 128, lookAt: [0, H * 0.3, 0] },
    onExit: () => leaveWalk(),
    onLock: (locked) => {
      root.querySelector('.v-hint')!.textContent = locked
        ? 'W A S D: 이동 · 마우스: 시야 · Shift: 달리기 · Space: 점프 · Esc: 나가기'
        : 'W A S D: 이동 · 화면을 클릭하면 마우스로 둘러볼 수 있습니다 · Shift: 달리기 · Space: 점프 · Esc: 나가기';
    },
  });
  own(() => walk.stop());
  const enterWalk = () => {
    if (walk.active) return;
    if (!streetView && !flight) {
      overview.position.copy(camera.position); overview.target.copy(controls.target); overview.spin = controls.autoRotate;
    }
    streetView = false;
    flight = undefined;
    root.querySelector('[data-act=street]')!.setAttribute('aria-pressed', 'false');
    controls.autoRotate = false;
    controls.enabled = false;
    root.querySelector('[data-act=spin]')!.setAttribute('aria-pressed', 'false');
    walk.start();
    walkButton.setAttribute('aria-pressed', 'true');
    root.classList.add('walking');
    root.querySelector<HTMLElement>('.v-cross')!.hidden = false;
  };
  const leaveWalk = () => {
    if (!walk.active) return false;
    walk.stop();
    resize(); // restores the orbit view's field of view for this screen shape
    controls.enabled = true;
    walkButton.setAttribute('aria-pressed', 'false');
    root.classList.remove('walking');
    root.querySelector<HTMLElement>('.v-cross')!.hidden = true;
    root.querySelector('.v-hint')!.textContent = HINT_ORBIT;
    // Fly back up to where the orbit view was left.
    const ahead = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(30).add(camera.position);
    flight = { start: timer.getElapsed(), from: camera.position.clone(), fromTarget: ahead,
      to: overview.position.clone(), toTarget: overview.target.clone() };
    return true;
  };
  walkHook.leave = leaveWalk;

  const frame = () => {
    if (signal.aborted) return;
    timer.update();
    const dt = timer.getDelta();
    const elapsed = timer.getElapsed();
    if (flight) {
      const t = Math.min(1, (elapsed - flight.start) / 0.85);
      const ease = t * t * (3 - 2 * t);
      camera.position.lerpVectors(flight.from, flight.to, ease);
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, ease);
      if (t === 1) {
        flight = undefined;
        if (!streetView) controls.autoRotate = overview.spin;
        root.querySelector('[data-act=spin]')!.setAttribute('aria-pressed', String(controls.autoRotate));
      }
    }
    if (walk.active) walk.update(dt);
    else controls.update(dt);
    quality.sample(dt);
    streets.update(dt);
    if ('update' in city && typeof city.update === 'function') city.update(elapsed);
    const showFine = quality.level !== 'low' && (walk.active || camera.position.distanceTo(controls.target) < H * 2.7);
    for (const mesh of fineMeshes) mesh.visible = showFine;
    if (night) {
      sparkle.points.visible = elapsed < twinkleUntil;
      if (sparkle.points.visible) sparkle.update(elapsed);
      else twinkleButton.setAttribute('aria-pressed', 'false');
      beacon.rotation.y += dt * 0.5;
    }
    if (!document.hidden) composer.render();
    raf = requestAnimationFrame(frame);
  };
  frame();

  root.querySelector('.v-bar')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.act === 'walk') {
      if (walk.active) leaveWalk();
      else enterWalk();
      return;
    }
    // The other camera modes take over from walking.
    if (b.dataset.act === 'spin' || b.dataset.act === 'street') leaveWalk();
    if (b.dataset.act === 'spin') {
      controls.autoRotate = !controls.autoRotate;
      b.setAttribute('aria-pressed', String(controls.autoRotate));
    } else if (b.dataset.act === 'traffic') {
      streets.setPaused(!streets.paused);
      b.setAttribute('aria-pressed', String(!streets.paused));
    } else if (b.dataset.act === 'street') {
      streetView = !streetView;
      if (streetView) {
        overview.position.copy(camera.position); overview.target.copy(controls.target); overview.spin = controls.autoRotate;
      }
      controls.autoRotate = false;
      root.querySelector('[data-act=spin]')!.setAttribute('aria-pressed', 'false');
      const streetPos = site?.kind === 'arc' ? new THREE.Vector3(0, 4.5, 58) : new THREE.Vector3(85, 42, 240);
      const streetTarget = site?.kind === 'arc' ? new THREE.Vector3(0, 18, 0) : new THREE.Vector3(0, 2, 163);
      flight = { start: timer.getElapsed(), from: camera.position.clone(), fromTarget: controls.target.clone(),
        to: streetView ? streetPos : overview.position.clone(),
        toTarget: streetView ? streetTarget : overview.target.clone() };
      b.setAttribute('aria-pressed', String(streetView));
    } else if (b.dataset.act === 'twinkle') {
      const elapsed = timer.getElapsed();
      twinkleUntil = elapsed < twinkleUntil ? 0 : elapsed + 30;
      b.setAttribute('aria-pressed', String(twinkleUntil > 0));
    } else if (b.dataset.act === 'day' || b.dataset.act === 'night') {
      night = b.dataset.act === 'night';
      applyMode();
    }
  });
  // Expose for debugging / automated checks.
  Object.assign(window, { viewer3d: { scene, camera, controls, usingFallback, quality, traffic: streets, walk, close } });
}

// ---------------------------------------------------------------------- helpers

function gradientTexture(stops: string[], positions = stops.map((_, i) => i / (stops.length - 1))) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach((s, i) => grad.addColorStop(positions[i], s));
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Load a GLB, stand it on the ground at the origin and scale it to `height` metres. */
/** `height` scales and centres the model to that many metres tall; null keeps a model that is already in metres about the origin. */
async function loadGlb(url: string, dracoPath: string, height: number | null, signal: AbortSignal): Promise<THREE.Object3D> {
  // Check first so a missing file fails fast (dev servers answer unknown paths with index.html).
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
  if (!response.ok || (response.headers.get('content-type') ?? '').includes('text/html')) throw new Error('no model file');
  const bytes = await response.arrayBuffer();
  const draco = new DRACOLoader().setDecoderPath(dracoPath);
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  let gltf;
  try { gltf = await loader.parseAsync(bytes, url.slice(0, url.lastIndexOf('/') + 1)); }
  finally { draco.dispose(); }
  const obj = gltf.scene;
  if (signal.aborted) { disposeObject(obj); signal.throwIfAborted(); }
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.y > 0)) { disposeObject(obj); throw new Error('empty model'); }
  const wrap = new THREE.Group();
  if (height === null) {
    wrap.add(obj);
    return wrap;
  }
  const s = height / size.y;
  // The generated file includes asymmetric garden approaches. Anchor the tower, rather than the
  // bounds of the whole site, so its plaza remains aligned with local streets and walking paths.
  const tower = obj.getObjectByName('Tower_Iron');
  const c = (tower ? new THREE.Box3().setFromObject(tower) : box).getCenter(new THREE.Vector3());
  obj.scale.multiplyScalar(s);
  obj.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  wrap.add(obj);
  return wrap;
}

function makeSparkles(model: THREE.Object3D) {
  const allMeshes: THREE.Mesh[] = [];
  const towerMeshes: THREE.Mesh[] = [];
  model.updateWorldMatrix(true, true);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry.getAttribute('position')?.count > 2 && !(m as THREE.InstancedMesh).isInstancedMesh) {
      allMeshes.push(m);
      const tag = `${m.name} ${(m.material as THREE.Material)?.name ?? ''}`;
      if (!/(Plaza|Park|Foliage|Trunk|Water|Lawn|Curb|Stone|Glass|Glow)/i.test(tag)) {
        towerMeshes.push(m);
      }
    }
  });
  const meshes = towerMeshes.length ? towerMeshes : allMeshes;
  const pos = new Float32Array(SPARKLES * 3);
  const col = new Float32Array(SPARKLES * 3);
  const v = new THREE.Vector3();
  const inst = new THREE.Matrix4();
  // Share the sparkles between meshes in proportion to their size.
  const weights = meshes.map((m) => {
    m.geometry.computeBoundingSphere();
    return (m.geometry.boundingSphere!.radius * m.getWorldScale(v).x) ** 2 + 1e-6;
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let n = 0;
  meshes.forEach((m, i) => {
    const count = i === meshes.length - 1 ? SPARKLES - n : Math.min(SPARKLES - n, Math.round((weights[i] / total) * SPARKLES));
    if (count <= 0) return;
    const sampler = new MeshSurfaceSampler(m).build();
    for (let k = 0; k < count; k++, n++) {
      sampler.sample(v);
      v.applyMatrix4(m.matrixWorld);
      pos.set([v.x, v.y, v.z], n * 3);
    }
  });
  // Instanced beams (the procedural tower): sample instance positions with a little jitter.
  model.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh) return;
    for (let k = 0; k < SPARKLES && (n < SPARKLES || meshes.length === 0); k++) {
      const slot = meshes.length === 0 ? k : n++;
      if (slot >= SPARKLES) break;
      im.getMatrixAt(Math.floor(Math.random() * im.count), inst);
      v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).applyMatrix4(inst).applyMatrix4(im.matrixWorld);
      pos.set([v.x, v.y, v.z], slot * 3);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const colAttr = new THREE.BufferAttribute(col, 3);
  geo.setAttribute('color', colAttr);
  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size: 3.2, sizeAttenuation: false, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }),
  );
  points.name = 'Tower_Sparkles';
  const phase = Float32Array.from({ length: SPARKLES }, () => Math.random() * 100);
  const rate = Float32Array.from({ length: SPARKLES }, () => 5 + Math.random() * 9);
  return {
    points,
    update(t: number) {
      for (let i = 0; i < SPARKLES; i++) {
        // Short bright flashes: only the top of each sine wave lights up.
        const s = Math.sin(t * rate[i] + phase[i]);
        const b = s > 0.93 ? (s - 0.93) / 0.07 : 0;
        col[i * 3] = col[i * 3 + 1] = b * 3;
        col[i * 3 + 2] = b * 2.6;
      }
      colAttr.needsUpdate = true;
    },
  };
}

/**
 * Paving and grass detail for the model's ground surfaces. The model file carries no texture
 * coordinates, so they are derived here from each vertex's position on the ground plane, and the
 * textures themselves are drawn procedurally. They only modulate the materials' own colours.
 */
function applyGroundTextures(model: THREE.Object3D, anisotropy: number) {
  model.updateWorldMatrix(true, true);
  const rand = (() => {
    let a = 99;
    return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
  })();
  const canvasTexture = (size: number, draw: (g: CanvasRenderingContext2D) => void, srgb: boolean) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d')!);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  // Stone setts in a running bond: 16 x 8 stones per tile, each a slightly different shade.
  const COLS = 8;
  const ROWS = 16;
  const stones: { x: number; y: number; tone: number }[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = -1; c < COLS; c++) stones.push({ x: c + (r % 2) * 0.5, y: r, tone: rand() });
  const drawPaving = (height: boolean) => (g: CanvasRenderingContext2D) => {
    const S = g.canvas.width;
    const w = S / COLS;
    const h = S / ROWS;
    g.fillStyle = height ? '#3a3a3a' : '#8f8a80'; // joints
    g.fillRect(0, 0, S, S);
    for (const st of stones) {
      const v = height ? 200 + st.tone * 55 : 205 + st.tone * 50;
      g.fillStyle = height ? `rgb(${v},${v},${v})` : `rgb(${v},${v - 3 - st.tone * 6},${v - 10 - st.tone * 10})`;
      g.beginPath();
      g.roundRect(st.x * w + 1.5, st.y * h + 1.5, w - 3, h - 3, 2.5);
      g.fill();
    }
    if (!height) {
      // Weathering: faint darker and lighter patches across the stones.
      for (let i = 0; i < 260; i++) {
        g.fillStyle = rand() < 0.5 ? 'rgba(60,50,40,0.05)' : 'rgba(255,250,240,0.05)';
        g.beginPath();
        g.arc(rand() * S, rand() * S, 6 + rand() * 30, 0, Math.PI * 2);
        g.fill();
      }
    }
  };
  const paving = canvasTexture(512, drawPaving(false), true);
  const pavingBump = canvasTexture(512, drawPaving(true), false);
  const PAVING_TILE = 9; // metres covered by one texture tile

  // Lawn: mottled greens with soft mowing stripes.
  const lawn = canvasTexture(
    256,
    (g) => {
      const S = g.canvas.width;
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#f2f6e6' : '#d2dcc0';
        g.fillRect((i * S) / 8, 0, S / 8, S);
      }
      for (let i = 0; i < 2600; i++) {
        const v = 170 + rand() * 85;
        g.fillStyle = `rgba(${v},${v + 8},${v - 30},0.22)`;
        g.fillRect(rand() * S, rand() * S, 1 + rand() * 3, 1 + rand() * 4);
      }
    },
    true,
  );
  const LAWN_TILE = 24;

  // Painted metal has fine surface variation rather than a polished bronze finish.
  const paintBump = canvasTexture(64, (g) => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const v = 118 + rand() * 20;
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  }, false);
  let painted = false;

  const done = new Set<THREE.Material>();
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (!mesh.isMesh || Array.isArray(mat)) return;
    const isPaving = /Plaza_(Stone|Cobble)/i.test(mat.name);
    const isLawn = /Park_Lawn/i.test(mat.name);
    const isIron = /Tower_(Iron|DarkIron|FineIron)/i.test(mat.name);
    if (!isPaving && !isLawn && !isIron) return;
    const tile = isIron ? 0.65 : isPaving ? PAVING_TILE : LAWN_TILE;
    const pos = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    const world = new THREE.Vector3();
    const worldNormal = new THREE.Vector3();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const uv = new Float32Array(pos.count * 2);
    const color = isIron ? new Float32Array(pos.count * 3) : null;
    for (let i = 0; i < pos.count; i++) {
      world.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      if (normal) worldNormal.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize();
      const side = isIron && normal && Math.abs(worldNormal.y) < 0.75;
      uv[i * 2] = (side && Math.abs(worldNormal.x) > 0.7 ? world.z : world.x) / tile;
      uv[i * 2 + 1] = (side ? world.y : world.z) / tile;
      if (color) {
        const shade = 0.86 + 0.14 * Math.min(1, Math.max(0, world.y / 280));
        color.set([shade, shade, shade], i * 3);
      }
    }
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (color) mesh.geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
    if (done.has(mat)) return;
    done.add(mat);
    if (isIron) {
      mat.bumpMap = paintBump;
      mat.bumpScale = 0.022;
      mat.vertexColors = true;
      painted = true;
    } else mat.map = isPaving ? paving : lawn;
    if (isPaving) {
      mat.bumpMap = pavingBump;
      mat.bumpScale = 0.6;
    }
    mat.needsUpdate = true;
  });
  if (!painted) paintBump.dispose();
  if (![...done].some((m) => /Plaza_Stone/i.test(m.name))) { paving.dispose(); pavingBump.dispose(); }
  if (![...done].some((m) => /Park_Lawn/i.test(m.name))) lawn.dispose();
}

/**
 * Procedural lattice tower used until a real model file is supplied: four curved legs that merge
 * into one shaft, cross-braced on every side, with the three platforms, arches and antenna.
 */
function buildEiffel(height: number): THREE.Object3D {
  const k = height / 330;
  const group = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ name: 'Tower_Iron', color: 0x7a5c44, roughness: 0.72, metalness: 0.15 });
  const beams: THREE.Matrix4[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const beam = (a: THREE.Vector3, b: THREE.Vector3, thick: number) => {
    const dir = b.clone().sub(a);
    const len = dir.length();
    q.setFromUnitVectors(up, dir.normalize());
    beams.push(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(thick, len, thick)));
  };

  // Tower profile: half-width of the whole structure, and of a single leg, at height y (metres at k = 1).
  const outer = (y: number) => 4.2 + 58.3 * Math.exp(-y / 62) * (1 - y / 520);
  const legHalf = (y: number) => Math.max(0, 12.5 * (1 - y / 126));
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x * k, y * k, z * k);

  /** Cross-braced square tube between two heights; (cx, cz) is its centre and h its half-width at each end. */
  const tube = (y0: number, y1: number, c0: [number, number], h0: number, c1: [number, number], h1: number, thick: number) => {
    const ring = (y: number, c: [number, number], h: number) =>
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => P(c[0] + sx * h, y, c[1] + sz * h));
    const a = ring(y0, c0, h0);
    const b = ring(y1, c1, h1);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      beam(a[i], b[i], thick * 1.5); // corner post
      beam(b[i], b[j], thick); // ring
      beam(a[i], b[j], thick * 0.7); // X bracing
      beam(a[j], b[i], thick * 0.7);
    }
  };

  // Legs: four separate lattice tubes up to the second platform.
  const legLevels = [0, 9, 19, 29, 39, 48, 57, 66, 76, 86, 96, 106, 115];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    for (let i = 0; i + 1 < legLevels.length; i++) {
      const y0 = legLevels[i];
      const y1 = legLevels[i + 1];
      const c = (y: number): [number, number] => [sx * (outer(y) - legHalf(y)), sz * (outer(y) - legHalf(y))];
      tube(y0, y1, c(y0), legHalf(y0), c(y1), legHalf(y1), 1.1 * k);
    }
  }
  // Shaft: one tapering lattice tube from the second platform to the top.
  for (let y = 115; y < 276; ) {
    const step = Math.max(6.5, (outer(y) * 2) * 0.9);
    const y1 = Math.min(276, y + step);
    tube(y, y1, [0, 0], outer(y), [0, 0], outer(y1), 0.8 * k);
    y = y1;
  }
  // Decorative arches between the legs, under the first platform.
  for (let side = 0; side < 4; side++) {
    const rot = (side * Math.PI) / 2;
    const span = outer(40) - 2 * legHalf(40) + 9;
    let prev: THREE.Vector3 | null = null;
    for (let i = 0; i <= 18; i++) {
      const a = (i / 18) * Math.PI;
      const p = P(Math.cos(a) * span, 14 + Math.sin(a) * 38, outer(35) - 1).applyAxisAngle(up, rot);
      if (prev) {
        beam(prev, p, 1.4 * k);
        if (i % 2 === 0) beam(p, P(Math.cos(a) * span, 55, outer(52)).applyAxisAngle(up, rot), 0.5 * k);
      }
      prev = p;
    }
  }

  const box = new THREE.BoxGeometry(1, 1, 1);
  const lattice = new THREE.InstancedMesh(box, iron, beams.length);
  beams.forEach((m, i) => lattice.setMatrixAt(i, m));
  lattice.instanceMatrix.needsUpdate = true;
  group.add(lattice);

  // Platforms, summit cabin and antenna.
  const solid = (w: number, h: number, y: number, mat: THREE.Material = iron) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w * k, h * k, w * k), mat);
    m.position.y = (y + h / 2) * k;
    group.add(m);
  };
  const deck = new THREE.MeshStandardMaterial({ color: 0x5f4836, roughness: 0.72, metalness: 0.15 });
  const ring = (size: number, opening: number, y: number, thickness: number) => {
    const strip = (size - opening) / 2;
    for (const sign of [-1, 1]) {
      for (const [w, d, x, z] of [[size, strip, 0, sign * (opening + strip) / 2], [strip, opening, sign * (opening + strip) / 2, 0]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w * k, thickness * k, d * k), deck);
        m.position.set(x * k, y * k, z * k);
        group.add(m);
      }
    }
  };
  ring(76, 32, 57.63, 2.4);
  ring(44, 9, 115.73, 2.1);
  ring(18, 3, 276.13, 1.4);
  solid(8, 9, 278);
  solid(4.5, 5, 287);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * k, 1.1 * k, 38 * k, 10), iron);
  mast.position.y = (292 + 19) * k;
  group.add(mast);
  // Leg footings.
  const stone = new THREE.MeshStandardMaterial({ name: 'Tower_Stone', color: 0xa79f90, roughness: 0.95, metalness: 0 });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(30 * k, 3 * k, 30 * k), stone);
    f.position.set(sx * (outer(0) - legHalf(0)) * k, 1.5 * k, sz * (outer(0) - legHalf(0)) * k);
    group.add(f);
  }
  return group;
}
