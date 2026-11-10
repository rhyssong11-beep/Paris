/**
 * Photoreal mode of the landmark viewer: renders a 3D Gaussian splat capture (a scene reconstructed
 * from real photographs) with Spark. Splats carry their own baked-in lighting, so there is no
 * day/night switch, ground plane or bloom here: just the capture and an orbiting camera.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark';
import type { SplatConfig } from './viewer-registry';

export interface SplatViewer {
  controls: OrbitControls;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  splats: number;
  resize(w: number, h: number): void;
  dispose(): void;
}

export async function openSplatViewer(canvas: HTMLCanvasElement, url: string, height: number, cfg: SplatConfig): Promise<SplatViewer> {
  // Spark sorts and blends splats itself; MSAA only costs performance.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(cfg.background ?? '#0b0e14');
  const spark = new SparkRenderer({ renderer });
  scene.add(spark);

  const mesh = new SplatMesh({ url });
  await mesh.initialized;

  // Most captures use the computer-vision convention (y pointing down); the default flips them upright.
  const [rx, ry, rz] = cfg.rotation ?? [180, 0, 0];
  mesh.rotation.set(THREE.MathUtils.degToRad(rx), THREE.MathUtils.degToRad(ry), THREE.MathUtils.degToRad(rz));

  // Stand the capture on the ground at the origin. Bounds use percentiles of the solid splats so
  // stray floaters and far background don't throw the framing off.
  let total = 0;
  mesh.forEachSplat(() => void total++);
  if (!total) throw new Error('splat file has no splats');
  const step = Math.max(1, Math.floor(total / 150000));
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const rot = new THREE.Matrix4().makeRotationFromEuler(mesh.rotation);
  const v = new THREE.Vector3();
  mesh.forEachSplat((i, center, _scales, _quat, opacity) => {
    if (i % step || opacity < 0.3) return;
    v.copy(center).applyMatrix4(rot);
    xs.push(v.x);
    ys.push(v.y);
    zs.push(v.z);
  });
  const range = (a: number[], lo: number, hi: number): [number, number] => {
    a.sort((p, q) => p - q);
    return [a[Math.floor((a.length - 1) * lo)], a[Math.floor((a.length - 1) * hi)]];
  };
  const [x0, x1] = range(xs, 0.05, 0.95);
  const [y0, y1] = range(ys, 0.02, 0.995);
  const [z0, z1] = range(zs, 0.05, 0.95);
  const s = cfg.scale ?? height / Math.max(1e-6, y1 - y0);
  const [ox, oy, oz] = cfg.offset ?? [0, 0, 0];
  mesh.scale.setScalar(s);
  mesh.position.set((-(x0 + x1) / 2) * s + ox, -y0 * s + oy, (-(z0 + z1) / 2) * s + oz);
  scene.add(mesh);

  const camera = new THREE.PerspectiveCamera(38, 1, height * 0.005, height * 60);
  camera.position.set(height * 1.45, height * 0.55, height * 1.45);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, height * 0.42, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.7;
  controls.minDistance = height * 0.1;
  controls.maxDistance = height * 5;
  controls.maxPolarAngle = Math.PI * 0.52;

  let raf = 0;
  let disposed = false;
  const frame = () => {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  frame();

  return {
    controls,
    camera,
    scene,
    splats: total,
    resize(w, h) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w < h ? 52 : 38;
      camera.updateProjectionMatrix();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      controls.dispose();
      mesh.dispose();
      renderer.dispose();
    },
  };
}
