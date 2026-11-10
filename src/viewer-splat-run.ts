/** Photographic splats have baked lighting; the capture owns the whole scene. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { SplatConfig } from './viewer-registry';

export interface SplatViewer {
  controls: OrbitControls;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  splats: number;
  resize(w: number, h: number, pixelRatio: number): void;
  observeFrames(observer: (dt: number) => void): void;
  dispose(): void;
}

export async function openSplatViewer(canvas: HTMLCanvasElement, url: string, height: number, cfg: SplatConfig, signal: AbortSignal): Promise<SplatViewer> {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
  if (!response.ok) throw new Error(`splat HTTP ${response.status}`);
  const fileBytes = await response.arrayBuffer();
  signal.throwIfAborted();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(cfg.background ?? '#0b0e14');
  let spark: SparkRenderer | undefined;
  let mesh: SplatMesh | undefined;
  let controls: OrbitControls | undefined;
  let timer: THREE.Timer | undefined;
  let raf = 0;
  let disposed = false;
  let observe: ((dt: number) => void) | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    signal.removeEventListener('abort', dispose);
    timer?.dispose();
    controls?.dispose();
    if (mesh) {
      const pending = mesh;
      // Keep the decoder's source reachable until it settles, then release its late-created buffers.
      if (pending.isInitialized) pending.dispose();
      else void pending.initialized.then(() => pending.dispose(), () => pending.dispose());
    }
    spark?.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    spark = new SparkRenderer({ renderer });
    scene.add(spark);
    mesh = new SplatMesh({ fileBytes, fileName: url });
    await mesh.initialized;
    signal.throwIfAborted();
    const [rx, ry, rz] = cfg.rotation ?? [180, 0, 0];
    mesh.rotation.set(...[rx, ry, rz].map(THREE.MathUtils.degToRad) as [number, number, number]);
    let total = 0;
    mesh.forEachSplat(() => void total++);
    if (!total) throw new Error('splat file has no splats');
    const step = Math.max(1, Math.ceil(total / 150000));
    const rot = new THREE.Matrix4().makeRotationFromEuler(mesh.rotation);
    const v = new THREE.Vector3();
    const collect = (minOpacity: number) => {
      const xs: number[] = [], ys: number[] = [], zs: number[] = [];
      mesh!.forEachSplat((i, center, _scales, _quat, opacity) => {
        if (i % step || opacity < minOpacity) return;
        v.copy(center).applyMatrix4(rot);
        if (![v.x, v.y, v.z].every(Number.isFinite)) return;
        xs.push(v.x); ys.push(v.y); zs.push(v.z);
      });
      return [xs, ys, zs];
    };
    let [xs, ys, zs] = collect(0.3);
    if (!xs.length) [xs, ys, zs] = collect(0);
    if (!xs.length) throw new Error('splat capture has no finite bounds');
    const range = (a: number[], lo: number, hi: number) => {
      a.sort((p, q) => p - q);
      return [a[Math.floor((a.length - 1) * lo)], a[Math.floor((a.length - 1) * hi)]];
    };
    const [x0, x1] = range(xs, 0.05, 0.95);
    const [y0, y1] = range(ys, 0.02, 0.995);
    const [z0, z1] = range(zs, 0.05, 0.95);
    const scale = cfg.scale ?? height / Math.max(1e-6, y1 - y0);
    const [ox, oy, oz] = cfg.offset ?? [0, 0, 0];
    mesh.scale.setScalar(scale);
    mesh.position.set(-(x0 + x1) * scale / 2 + ox, -y0 * scale + oy, -(z0 + z1) * scale / 2 + oz);
    scene.add(mesh);
    const camera = new THREE.PerspectiveCamera(38, 1, height * 0.005, height * 60);
    camera.position.set(height * 1.45, height * 0.55, height * 1.45);
    controls = new OrbitControls(camera, canvas);
    controls.target.set(0, height * 0.42, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.7;
    controls.minDistance = height * 0.1;
    controls.maxDistance = height * 5;
    controls.maxPolarAngle = Math.PI * 0.52;
    timer = new THREE.Timer();
    timer.connect(document);
    const frame = () => {
      if (disposed) return;
      timer!.update();
      const dt = timer!.getDelta();
      controls!.update(dt);
      observe?.(dt);
      if (!document.hidden) renderer.render(scene, camera);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return {
      controls, camera, scene, splats: total,
      resize(w, h, pixelRatio) {
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatio));
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.fov = w < h ? 52 : 38;
        camera.updateProjectionMatrix();
      },
      observeFrames(observer) { observe = observer; },
      dispose,
    };
  } catch (err) { dispose(); throw err; }
}
