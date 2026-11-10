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
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler.js';
import type { ViewerEntry } from './viewer-registry';

const SPARKLES = 2600;
const GOLD = new THREE.Color('#ffb347');

export interface ViewerOptions extends ViewerEntry {
  name: string;
  night: boolean;
}

let closeCurrent: (() => void) | null = null;

export async function openViewer(opts: ViewerOptions) {
  closeCurrent?.();
  const base = import.meta.env.BASE_URL;

  // ------------------------------------------------------------------ DOM
  const root = document.createElement('div');
  root.id = 'viewer';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', `${opts.name} 3D 보기`);
  root.innerHTML = `
    <canvas></canvas>
    <div class="v-title"><h2></h2><p></p></div>
    <div class="v-bar">
      <button data-act="day">☀ 낮</button>
      <button data-act="night">☾ 밤</button>
      <button data-act="spin" aria-pressed="true">자동 회전</button>
    </div>
    <button class="v-close" aria-label="닫기">✕</button>
    <div class="v-hint">드래그: 회전 · 휠/핀치: 확대 · 오른쪽 드래그: 이동</div>
    <div class="v-note"></div>
    <div class="v-loading">모델을 불러오는 중…</div>`;
  root.querySelector('h2')!.textContent = opts.name;
  root.querySelector('p')!.textContent = opts.subtitle;
  document.body.append(root);
  const canvas = root.querySelector('canvas')!;
  const note = root.querySelector<HTMLElement>('.v-note')!;

  // ------------------------------------------------------------------ scene
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;

  const H = opts.height;
  const camera = new THREE.PerspectiveCamera(38, 1, 1, H * 40);
  camera.position.set(H * 1.25, H * 0.5, H * 1.25);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, H * 0.42, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.7;
  controls.minDistance = H * 0.25;
  controls.maxDistance = H * 4;
  controls.maxPolarAngle = Math.PI * 0.497; // stay above the ground

  const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a4436, 1);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3);
  sun.position.set(-H * 0.9, H * 1.5, H * 0.7);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -H * 0.9;
  sc.right = sc.top = H * 0.9;
  sc.near = 1;
  sc.far = H * 4;
  sun.shadow.bias = -0.0004;
  scene.add(hemi, sun);

  // Ground: a soft-edged disc so the horizon fades into the sky.
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x6f7f5f, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(H * 12, 96), groundMat);
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

  // Stars (night only).
  const starGeo = new THREE.BufferGeometry();
  {
    const p = new Float32Array(1500 * 3);
    for (let i = 0; i < 1500; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.asin(0.08 + Math.random() * 0.92);
      const r = H * 14;
      p.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r, Math.sin(a) * Math.cos(e) * r], i * 3);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  }
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.8 }));
  scene.add(stars);

  // Post-processing: bloom makes the night lighting glow.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ------------------------------------------------------------------ model
  let usingFallback = false;
  let model: THREE.Object3D;
  try {
    model = await loadGlb(`${base}${opts.modelUrl}`, `${base}draco/`, H);
  } catch {
    usingFallback = true;
    model = buildEiffel(H);
  }
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  scene.add(model);
  note.textContent = usingFallback ? '임시 모델 (코드로 생성) — public/models/에 GLB 파일을 넣으면 교체됩니다' : (opts.credit ?? '');
  root.querySelector('.v-loading')!.remove();

  // Remember each material's daytime look so night mode can be undone.
  const mats = new Map<THREE.MeshStandardMaterial, { emissive: THREE.Color; intensity: number }>();
  model.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
      const std = mat as THREE.MeshStandardMaterial;
      if (std.emissive && !mats.has(std)) mats.set(std, { emissive: std.emissive.clone(), intensity: std.emissiveIntensity });
    }
  });

  // Sparkle lights scattered over the structure (the tower's hourly twinkle).
  const sparkle = makeSparkles(model);
  scene.add(sparkle.points);

  // Rotating beacon at the summit.
  const beacon = new THREE.Group();
  beacon.position.y = H * 0.985;
  for (const dir of [1, -1]) {
    const len = H * 2.6;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(H * 0.035, len, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xcfe4ff, transparent: true, opacity: 0.045, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    cone.rotation.z = (dir * Math.PI) / 2; // apex at the tower, widening outwards
    cone.position.x = (dir * len) / 2;
    beacon.add(cone);
  }
  scene.add(beacon);

  // ------------------------------------------------------------------ day / night
  let night = opts.night;
  const applyMode = () => {
    const sky = night ? ['#02040b', '#0b1530', '#1d2444'] : ['#3f86d9', '#9cc8f2', '#e9eef2'];
    scene.background = gradientTexture(sky);
    scene.fog = new THREE.Fog(night ? 0x141b36 : 0xdfe8ee, H * 4, H * 13);
    scene.environmentIntensity = night ? 0.12 : 0.9;
    hemi.intensity = night ? 0.14 : 1.1;
    hemi.color.set(night ? 0x5a6cb0 : 0xcfe6ff);
    sun.intensity = night ? 0.25 : 3.2;
    sun.color.set(night ? 0x9db4ff : 0xfff1dc);
    groundMat.color.set(night ? 0x1a2030 : 0x6f7f5f);
    (plaza.material as THREE.MeshStandardMaterial).color.set(night ? 0x3a3a44 : 0xb9b3a6);
    renderer.toneMappingExposure = night ? 1.15 : 1;
    bloom.enabled = night;
    stars.visible = sparkle.points.visible = beacon.visible = night;
    for (const [m, day] of mats) {
      if (night) {
        m.emissive.copy(GOLD);
        m.emissiveIntensity = 0.85;
      } else {
        m.emissive.copy(day.emissive);
        m.emissiveIntensity = day.intensity;
      }
    }
    root.querySelector('[data-act=day]')!.setAttribute('aria-pressed', String(!night));
    root.querySelector('[data-act=night]')!.setAttribute('aria-pressed', String(night));
  };
  applyMode();

  // ------------------------------------------------------------------ loop & lifecycle
  const resize = () => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // Pull back on tall narrow screens so the whole landmark fits.
    camera.fov = w < h ? 52 : 38;
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener('resize', resize);

  let raf = 0;
  let closed = false;
  const clock = new THREE.Clock();
  const frame = () => {
    if (closed) return;
    const dt = clock.getDelta();
    controls.update();
    if (night) {
      sparkle.update(clock.elapsedTime);
      beacon.rotation.y += dt * 0.5;
    }
    composer.render();
    raf = requestAnimationFrame(frame);
  };
  frame();

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    e.stopPropagation();
  };
  function close() {
    if (closed) return;
    closed = true;
    closeCurrent = null;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKey, true);
    controls.dispose();
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
    envMap.dispose();
    pmrem.dispose();
    composer.dispose();
    renderer.dispose();
    root.remove();
  }
  closeCurrent = close;
  window.addEventListener('keydown', onKey, true);
  root.querySelector('.v-close')!.addEventListener('click', close);
  root.querySelector('.v-bar')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.act === 'spin') {
      controls.autoRotate = !controls.autoRotate;
      b.setAttribute('aria-pressed', String(controls.autoRotate));
    } else {
      night = b.dataset.act === 'night';
      applyMode();
    }
  });
  // Expose for debugging / automated checks.
  Object.assign(window, { viewer3d: { scene, camera, controls, usingFallback, close } });
}

// ---------------------------------------------------------------------- helpers

function gradientTexture(stops: string[]) {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  stops.forEach((s, i) => grad.addColorStop(i / (stops.length - 1), s));
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Load a GLB, stand it on the ground at the origin and scale it to `height` metres. */
async function loadGlb(url: string, dracoPath: string, height: number): Promise<THREE.Object3D> {
  // Check first so a missing file fails fast (dev servers answer unknown paths with index.html).
  const head = await fetch(url, { method: 'HEAD' });
  if (!head.ok || (head.headers.get('content-type') ?? '').includes('text/html')) throw new Error('no model file');
  const draco = new DRACOLoader().setDecoderPath(dracoPath);
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  draco.dispose();
  const obj = gltf.scene;
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (!(size.y > 0)) throw new Error('empty model');
  const wrap = new THREE.Group();
  const s = height / size.y;
  obj.scale.multiplyScalar(s);
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x * s, -box.min.y * s, -c.z * s);
  wrap.add(obj);
  return wrap;
}

function makeSparkles(model: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  model.updateWorldMatrix(true, true);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry.getAttribute('position')?.count > 2 && !(m as THREE.InstancedMesh).isInstancedMesh) meshes.push(m);
  });
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
 * Procedural lattice tower used until a real model file is supplied: four curved legs that merge
 * into one shaft, cross-braced on every side, with the three platforms, arches and antenna.
 */
function buildEiffel(height: number): THREE.Object3D {
  const k = height / 330;
  const group = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x7a5c44, roughness: 0.55, metalness: 0.65 });
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
  const deck = new THREE.MeshStandardMaterial({ color: 0x5f4836, roughness: 0.7, metalness: 0.5 });
  solid(outer(57) * 2 + 8, 5, 55, deck);
  solid(outer(57) * 2 + 4, 2.2, 60.5);
  solid(outer(115) * 2 + 6, 4.5, 113, deck);
  solid(outer(115) * 2 + 3, 2, 117.5);
  solid(outer(276) * 2 + 5, 4, 274, deck);
  solid(8, 9, 278);
  solid(4.5, 5, 287);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * k, 1.1 * k, 38 * k, 10), iron);
  mast.position.y = (292 + 19) * k;
  group.add(mast);
  // Leg footings.
  const stone = new THREE.MeshStandardMaterial({ color: 0xa79f90, roughness: 0.95, metalness: 0 });
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(30 * k, 3 * k, 30 * k), stone);
    f.position.set(sx * (outer(0) - legHalf(0)) * k, 1.5 * k, sz * (outer(0) - legHalf(0)) * k);
    group.add(f);
  }
  return group;
}
