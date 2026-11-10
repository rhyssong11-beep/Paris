import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { expect, it } from 'vitest';
import { disposeObject } from './viewer-resources';

it('decodes the shipped compressed model with an open first-floor centre and intact deck', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../public/models/eiffel.glb', import.meta.url)));
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer, '');
  try {
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene);
    expect(bounds.max.y).toBeCloseTo(330, 0);
    expect(bounds.min.y).toBeGreaterThan(-0.5); // The lowest beams extend slightly into their footings.
    // A vertical ray through the centre must pass through the void, while one beside it hits the deck.
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 70, 0), new THREE.Vector3(0, -1, 0), 0, 20);
    expect(ray.intersectObject(scene, true)).toHaveLength(0);
    ray.ray.origin.x = 34;
    const deck = ray.intersectObject(scene, true);
    expect(deck.length).toBeGreaterThan(0);
    expect(deck[0].point.y).toBeGreaterThan(56);
    expect(deck[0].point.y).toBeLessThan(66);
  } finally { disposeObject(scene); }
});
