/**
 * First-person "walk around" mode for the landmark viewer: W/A/S/D to move, mouse to look.
 * The movement rules live in walk-world.ts; this file feeds them the scene's geometry and
 * connects them to the keyboard, the mouse and the camera.
 */
import * as THREE from 'three';
import { EYE_HEIGHT, WalkGrid, Walker } from './walk-world';

const WALK_FOV = 68;
const WALK_NEAR = 0.25;
const LOOK_SPEED = 0.0022; // radians per pixel of mouse travel
const ENTER_SECONDS = 0.9;
const KEYS: Record<string, [forward: number, right: number]> = {
  KeyW: [1, 0], ArrowUp: [1, 0],
  KeyS: [-1, 0], ArrowDown: [-1, 0],
  KeyA: [0, -1], ArrowLeft: [0, -1],
  KeyD: [0, 1], ArrowRight: [0, 1],
};

/** Sample every visible mesh under `roots` into a walk grid covering ±extent metres. */
export function buildWalkGrid(roots: THREE.Object3D[], extent: number): WalkGrid {
  const grid = new WalkGrid(extent);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const box = new THREE.Box3();
  const m = new THREE.Matrix4();
  const visit = (o: THREE.Object3D) => {
    if (!o.visible) return;
    const mesh = o as THREE.Mesh;
    // Leaves are overhead and soft; skipping them saves most of the sampling work.
    if (mesh.isMesh && !/Foliage/i.test(`${o.name} ${(mesh.material as THREE.Material)?.name ?? ''}`)) {
      const geo = mesh.geometry;
      const inst = o as THREE.InstancedMesh;
      if (inst.isInstancedMesh) {
        // Many copies of a simple shape (buildings, trunks): their outlines are enough.
        if (!geo.boundingBox) geo.computeBoundingBox();
        for (let i = 0; i < inst.count; i++) {
          inst.getMatrixAt(i, m);
          box.copy(geo.boundingBox!).applyMatrix4(m.premultiply(inst.matrixWorld));
          if (box.min.x > extent || box.max.x < -extent || box.min.z > extent || box.max.z < -extent) continue;
          grid.addBoxOutline(box.min.x, box.min.z, box.max.x, box.max.z, box.min.y, box.max.y);
        }
      } else {
        const pos = geo.getAttribute('position');
        const index = geo.getIndex();
        const count = index ? index.count : pos.count;
        const at = (i: number, out: THREE.Vector3) => out.fromBufferAttribute(pos, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
        for (let i = 0; i + 2 < count; i += 3) {
          at(i, a);
          at(i + 1, b);
          at(i + 2, c);
          grid.addTriangle(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        }
      }
    }
    for (const child of o.children) visit(child);
  };
  for (const root of roots) {
    root.updateWorldMatrix(true, true);
    visit(root);
  }
  return grid;
}

export interface WalkOptions {
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** built on first use: sampling the scene takes a moment */
  grid: () => WalkGrid;
  /** places that are off limits whatever the geometry says */
  allowed: (x: number, z: number) => boolean;
  /** where to start, and which point to face */
  start: { x: number; z: number; lookAt: [number, number, number] };
  /** called when the mode ends on its own (Esc released the mouse) */
  onExit: () => void;
  /** called when the mouse is captured or released, to update on-screen hints */
  onLock: (locked: boolean) => void;
}

export class WalkMode {
  active = false;
  walker: Walker | undefined;
  private keys = new Set<string>();
  private locked = false;
  private dragging = false;
  private eyeY = 0;
  private enter: { t: number; fromPos: THREE.Vector3; fromQuat: THREE.Quaternion } | undefined;
  private saved = { fov: 0, near: 0 };
  private off: (() => void)[] = [];
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private quat = new THREE.Quaternion();

  constructor(private o: WalkOptions) {}

  start() {
    if (this.active) return;
    const { camera, canvas, start } = this.o;
    this.walker ??= new Walker(this.o.grid(), this.o.allowed);
    const w = this.walker;
    const [lx, ly, lz] = start.lookAt;
    w.place(start.x, start.z, Math.atan2(-(lx - start.x), -(lz - start.z)));
    w.pitch = Math.atan2(ly - (w.y + EYE_HEIGHT), Math.hypot(lx - start.x, lz - start.z));
    w.look(0, 0); // clamp
    this.eyeY = w.y + EYE_HEIGHT;
    this.saved = { fov: camera.fov, near: camera.near };
    this.enter = { t: 0, fromPos: camera.position.clone(), fromQuat: camera.quaternion.clone() };
    this.active = true;
    this.keys.clear();

    const on = <K extends keyof DocumentEventMap>(target: EventTarget, type: K | string, fn: (e: any) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn, opts);
      this.off.push(() => target.removeEventListener(type, fn, opts));
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      // Physical key positions, so it works whatever the keyboard language is (한/영 included).
      if (KEYS[e.code] || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        this.keys.add(e.code);
        e.preventDefault();
      }
    }, { capture: true });
    on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.code), { capture: true });
    on(window, 'blur', () => this.keys.clear());
    on(document, 'visibilitychange', () => this.keys.clear());
    // Mouse look: captured pointer when the browser allows it, otherwise hold-and-drag.
    on(canvas, 'click', () => {
      if (!this.locked) Promise.resolve(canvas.requestPointerLock?.()).catch(() => {});
    });
    on(document, 'pointerlockchange', () => {
      const now = document.pointerLockElement === canvas;
      const was = this.locked;
      this.locked = now;
      this.o.onLock(now);
      if (was && !now && this.active) this.o.onExit(); // Esc
    });
    on(canvas, 'pointerdown', () => (this.dragging = true));
    on(window, 'pointerup', () => (this.dragging = false));
    on(document, 'mousemove', (e: MouseEvent) => {
      if (!this.enter && (this.locked || this.dragging)) this.walker!.look(-e.movementX * LOOK_SPEED, -e.movementY * LOOK_SPEED);
    });
    canvas.tabIndex = -1;
    canvas.focus({ preventScroll: true });
    this.o.onLock(false);
  }

  /** Leave walk mode and hand the camera's lens settings back. Does not move the camera. */
  stop() {
    if (!this.active) return;
    this.active = false;
    for (const off of this.off.splice(0)) off();
    this.keys.clear();
    this.dragging = false;
    const wasLocked = this.locked;
    this.locked = false;
    if (wasLocked && document.pointerLockElement === this.o.canvas) document.exitPointerLock();
    const { camera } = this.o;
    camera.fov = this.saved.fov;
    camera.near = this.saved.near;
    camera.updateProjectionMatrix();
  }

  update(dt: number) {
    if (!this.active) return;
    const { camera } = this.o;
    const w = this.walker!;
    if (!this.enter) {
      let forward = 0;
      let right = 0;
      for (const code of this.keys) {
        const k = KEYS[code];
        if (k) {
          forward += k[0];
          right += k[1];
        }
      }
      w.step({ forward: Math.sign(forward), right: Math.sign(right), run: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') }, Math.min(dt, 0.1));
    }
    // The eyes follow the ground smoothly, so kerbs feel like steps rather than jolts.
    const targetY = w.y + EYE_HEIGHT;
    this.eyeY += (targetY - this.eyeY) * Math.min(1, dt * 12);
    this.euler.set(w.pitch, w.yaw, 0);
    this.quat.setFromEuler(this.euler);

    let fov = WALK_FOV;
    let near = WALK_NEAR;
    if (this.enter) {
      // Glide down from wherever the camera was into the walker's eyes.
      this.enter.t = Math.min(1, this.enter.t + dt / ENTER_SECONDS);
      const t = this.enter.t;
      const ease = t * t * (3 - 2 * t);
      camera.position.set(
        THREE.MathUtils.lerp(this.enter.fromPos.x, w.x, ease),
        THREE.MathUtils.lerp(this.enter.fromPos.y, this.eyeY, ease),
        THREE.MathUtils.lerp(this.enter.fromPos.z, w.z, ease),
      );
      camera.quaternion.slerpQuaternions(this.enter.fromQuat, this.quat, ease);
      fov = THREE.MathUtils.lerp(this.saved.fov, WALK_FOV, ease);
      near = THREE.MathUtils.lerp(this.saved.near, WALK_NEAR, ease);
      if (t === 1) this.enter = undefined;
    } else {
      camera.position.set(w.x, this.eyeY, w.z);
      camera.quaternion.copy(this.quat);
    }
    if (camera.fov !== fov || camera.near !== near) {
      camera.fov = fov;
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }
}
