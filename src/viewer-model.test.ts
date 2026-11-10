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

it('decodes the shipped Louvre model: pyramid at the origin, open courtyard, palace around it', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../public/models/louvre.glb', import.meta.url)));
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer, '');
  try {
    scene.updateMatrixWorld(true);
    // Authored in metres: the viewer uses it without rescaling, so the real dimensions must hold.
    const glass = scene.getObjectByName('Pyramid_Glass')!;
    const pyramid = new THREE.Box3().setFromObject(glass);
    expect(pyramid.max.y - pyramid.min.y).toBeCloseTo(21.6, 0); // the main pyramid's height
    const bounds = new THREE.Box3().setFromObject(scene);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(700); // Pavillon de Flore to the Colonnade
    expect(bounds.max.y).toBeGreaterThan(45);
    expect(bounds.max.y).toBeLessThan(60);
    const hitY = (x: number, z: number) => {
      const hits = new THREE.Raycaster(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0)).intersectObject(scene, true);
      return hits.length ? hits[0].point.y : null;
    };
    expect(hitY(0, 0)).toBeGreaterThan(21); // the apex
    expect(hitY(-80, 0)).toBeLessThan(1); // open paving west of the pyramid
    expect(hitY(-40, -75)).toBeGreaterThan(23); // the Richelieu wing's roof
    expect(hitY(-262, 0)).toBeGreaterThan(14); // the Carrousel arch
    expect(hitY(198, 40)).toBeLessThan(1); // inside the Cour Carrée
    for (const name of ['Louvre_Stone', 'Louvre_Roof_Slate', 'Palace_Window_Glass', 'Pyramid_Steel', 'Pyramid_Glow', 'Basin_Water', 'Plaza_Stone', 'Park_Lawn']) {
      expect(scene.getObjectByName(name), name).toBeTruthy();
    }
  } finally { disposeObject(scene); }
});
