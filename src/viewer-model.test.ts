import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { expect, it } from 'vitest';
import { disposeObject } from './viewer-resources';
import { buildWalkGrid } from './viewer-walk';
import { Walker } from './walk-world';

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

it('decodes the shipped Arc de Triomphe model: 50 m arch, open vaults, Eternal Flame, Étoile wedges, and walkable rooftop stair', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../public/models/arc.glb', import.meta.url)));
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer, '');
  try {
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene);
    expect(bounds.max.x - bounds.min.x).toBeGreaterThan(500); // Full Place Charles de Gaulle & outer Haussmann ring
    expect(bounds.max.y).toBeGreaterThan(50);
    expect(bounds.max.y).toBeLessThan(55);

    for (const name of ['Arc_Stone', 'Arc_Stone_Trim', 'Arc_Stone_Sculpture', 'Arc_Gilt', 'Eternal_Flame_Glow', 'Palace_Stone', 'Plaza_Stone', 'Plaza_Cobble']) {
      expect(scene.getObjectByName(name), name).toBeTruthy();
    }

    // Horizontal rays at head height (y = 2.5 m) through the Grand Central Vault (along Z at x = 4 m)
    // and through the Transverse Vaults (along X at z = 0 m) must pass unobstructed.
    const grandRay = new THREE.Raycaster(new THREE.Vector3(4, 2.5, 25), new THREE.Vector3(0, 0, -1), 0, 50);
    expect(grandRay.intersectObject(scene, true)).toHaveLength(0);
    const transRay = new THREE.Raycaster(new THREE.Vector3(-30, 2.5, 0), new THREE.Vector3(1, 0, 0), 0, 60);
    expect(transRay.intersectObject(scene, true)).toHaveLength(0);

    // Walkability: build the WalkGrid and verify walking under the arch AND climbing the interior staircase to the 49.5 m rooftop terrace.
    const grid = buildWalkGrid([scene], 120);
    const w = new Walker(grid);

    // 1. Walk straight through the Grand Central Vault beside the Tomb of the Unknown Soldier
    w.place(4.2, 20, 0); // looking North (-Z)
    for (let t = 0; t < 5; t += 1 / 60) w.step({ forward: 1, right: 0, run: false }, 1 / 60);
    expect(w.z).toBeLessThan(-15);
    expect(w.y).toBeCloseTo(0.3, 1);

    // 2. Enter the East-South Pier stairwell doorway (x = 10.2, z = 4.5) and climb all 16 switchback flights to the rooftop terrace (y = 49.5 m)
    w.place(10.2, 4.4, Math.PI); // looking South (+Z) into the stairwell entrance
    for (let t = 0; t < 0.4; t += 1 / 60) w.step({ forward: 1, right: 0, run: false }, 1 / 60);
    for (let f = 0; f < 16; f++) {
      const goEast = f % 2 === 0;
      // Face East (-PI/2) in North lane (z ~ 6.3) or West (+PI/2) in South lane (z ~ 8.9)
      w.yaw = goEast ? -Math.PI / 2 : Math.PI / 2;
      for (let t = 0; t < 1.35; t += 1 / 60) w.step({ forward: 1, right: 0, run: false }, 1 / 60);
      if (f < 15) {
        // Turn on landing to the opposite lane
        w.yaw = goEast ? Math.PI : 0;
        for (let t = 0; t < 0.45; t += 1 / 60) w.step({ forward: 1, right: 0, run: false }, 1 / 60);
      }
    }
    expect(w.y).toBeGreaterThan(48.5);
    expect(w.y).toBeLessThanOrEqual(49.6);

    // 3. Step out from the top stair landing onto the panoramic rooftop terrace and walk to the centre of the roof (x ~ 0, y = 49.5 m)
    w.yaw = Math.PI / 2; // face West (-X)
    for (let t = 0; t < 1.5; t += 1 / 60) w.step({ forward: 1, right: 0, run: false }, 1 / 60);
    expect(w.x).toBeLessThan(2);
    expect(w.y).toBeCloseTo(49.5, 1);
  } finally { disposeObject(scene); }
});

it('decodes the shipped Notre-Dame model: 69 m towers, 96 m spire, textured parts, and a west front you can walk up to', async () => {
  const bytes = new Uint8Array(readFileSync(new URL('../public/models/notredame.glb', import.meta.url)));
  const { scene } = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer, '');
  try {
    scene.updateMatrixWorld(true);
    // Authored in metres in Higgsfield 3D Jutsu: +x is the apse, the west front stands at x = -64.
    const bounds = new THREE.Box3().setFromObject(scene);
    expect(bounds.max.y).toBeCloseTo(96, 0); // the rooster on the flèche
    expect(bounds.min.y).toBeGreaterThan(-0.1);
    expect(bounds.max.x).toBeGreaterThan(68); // gargoyles on the buttresses round the chevet
    expect(bounds.max.x).toBeLessThan(71);
    const hitY = (x: number, z: number) => {
      const hits = new THREE.Raycaster(new THREE.Vector3(x, 200, z), new THREE.Vector3(0, -1, 0)).intersectObject(scene, true);
      return hits.length ? hits[0].point.y : null;
    };
    expect(hitY(-56.5, 9)).toBeGreaterThan(65); // a tower terrace...
    expect(hitY(-56.5, 9)).toBeLessThan(70);
    expect(hitY(-56.5, 0)).toBeLessThan(33); // ...and the gap between the towers
    expect(hitY(-20, 0)).toBeGreaterThan(43); // the ridge of the nave roof
    expect(hitY(-20, 17)).toBeLessThan(12); // chapel roofs under the flying buttresses
    expect(hitY(-100, 20)).toBeNull(); // open parvis
    expect(hitY(-63.5, 13.9)).toBeGreaterThan(40); // 128 m from the west front...
    expect(hitY(63.5, 0)).toBeGreaterThan(9); // ...to the easternmost chapel of the chevet
    expect(hitY(15, 23)).toBeGreaterThan(30); // the south transept gable, 48 m across from the north one
    expect(hitY(15, -23)).toBeGreaterThan(30);

    for (const name of ['Stone', 'Stone_Trim', 'Stone_Sculpture', 'Roof_Lead', 'Spire_Lead', 'Copper_Verdigris', 'Portal_Tympanum_Stone', 'Portal_Door_Wood',
      'Vitrail_Glow_RoseWest', 'Vitrail_Glow_RoseNorth', 'Vitrail_Glow_RoseSouth', 'Vitrail_Glow_Lancet']) {
      const mesh = scene.getObjectByName(`NotreDame_${name}`) as THREE.Mesh;
      expect(mesh, name).toBeTruthy();
      expect(mesh.geometry.getAttribute('uv'), `${name} uv`).toBeTruthy(); // the viewer maps its image textures onto these
    }
    // The west rose is a 9.7 m disc centred 25 m up the front, mapped to the whole picture.
    const rose = scene.getObjectByName('NotreDame_Vitrail_Glow_RoseWest') as THREE.Mesh;
    const disc = new THREE.Box3().setFromObject(rose);
    expect(disc.max.y - disc.min.y).toBeCloseTo(9.7, 0);
    expect((disc.max.y + disc.min.y) / 2).toBeCloseTo(25, 0);
    const uv = rose.geometry.getAttribute('uv');
    const us = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    const vs = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect(Math.min(...us)).toBeCloseTo(0, 2);
    expect(Math.max(...us)).toBeCloseTo(1, 2);
    expect(Math.min(...vs)).toBeCloseTo(0, 2);
    expect(Math.max(...vs)).toBeCloseTo(1, 2);

    // Walk east across the parvis into the central portal: the doors stop you inside its deep recess.
    const grid = buildWalkGrid([scene], 120);
    const w = new Walker(grid);
    w.place(-90, 1.6, -Math.PI / 2);
    for (let t = 0; t < 6; t += 1 / 60) w.step({ forward: 1, right: 0, run: false }, 1 / 60);
    expect(w.x).toBeGreaterThan(-66);
    expect(w.x).toBeLessThan(-61.5);
  } finally { disposeObject(scene); }
});
