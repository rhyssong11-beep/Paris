import * as THREE from 'three';
import type { QualityLevel } from './viewer-quality';
import { CROSSINGS, signalAt, sampleStreet, StreetMotion, type StreetActor } from './street-motion';

const CAPACITY = { pedestrians: 160, cars: 32 };
const DENSITY = { low: [56, 12], medium: [112, 24], high: [160, 32] } as const;

/** Pavements, crossings and a modest local crowd, all sharing a small set of instanced meshes. */
export function buildStreets() {
  const group = new THREE.Group();
  group.name = 'Neighborhood_Streets';
  const simulation = new StreetMotion();
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let night = false;
  let level: QualityLevel | undefined;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.SphereGeometry(1, 7, 5);
  const q = new THREE.Quaternion();
  const yaw = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const axle = new THREE.Vector3(1, 0, 0);
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const tempColor = new THREE.Color();

  const material = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
  const asphalt = material(0x4c5052);
  const sidewalk = material(0xb7b0a1);
  const marking = material(0xe7e2cf, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3 });
  const metal = material(0x343d40, { metalness: 0.25, roughness: 0.65 });
  const staticParts: { geometry: THREE.BufferGeometry; mat: THREE.Material; transforms: THREE.Matrix4[]; name: string }[] = [];
  const batch = (name: string, geometry: THREE.BufferGeometry, mat: THREE.Material) => {
    const part = { name, geometry, mat, transforms: [] as THREE.Matrix4[] };
    staticParts.push(part);
    return (x: number, y: number, z: number, w: number, h: number, d: number, angle = 0) => {
      part.transforms.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(up, angle), new THREE.Vector3(w, h, d)));
    };
  };
  const paving = batch('Street_Pavements', box, sidewalk);
  const road = batch('Street_Carriageways', box, asphalt);
  const paint = batch('Street_Markings', box, marking);
  const posts = batch('Street_Furniture', box, metal);
  const street = (x: number, z: number, length: number, angle: number) => {
    for (const sign of [-1, 1]) paving(x + Math.sin(angle) * sign * 12, 0.1, z + Math.cos(angle) * sign * 12, length, 0.2, 8, angle);
    road(x, 0.115, z, length, 0.09, 16, angle);
    for (let at = -length / 2 + 8; at < length / 2 - 5; at += 10) {
      const px = x + Math.cos(angle) * at, pz = z - Math.sin(angle) * at;
      if (CROSSINGS.some((c) => Math.hypot(c.x - px, c.z - pz) < 14)) continue;
      if (Math.abs(Math.abs(px) - 170) < 22 && (Math.abs(pz - 170) < 22 || Math.abs(pz + 810) < 22)) continue;
      paint(px, 0.166, pz, 3.5, 0.015, 0.16, angle);
    }
  };
  street(0, 170, 1320, 0);
  street(0, -810, 1320, 0);
  for (const sign of [-1, 1]) street(sign * 170, -320, 980, Math.PI / 2);

  // Links follow the existing garden paths and keep pedestrians off lawns and ponds.
  for (const sign of [-1, 1]) {
    paving(sign * 155, 0.1, -320, 8, 0.2, 980);
    paving(sign * 185, 0.1, -320, 8, 0.2, 980);
    paving(sign * 194.5, 0.1, -130, 14, 0.2, 115);
    for (const z of [-80, 75]) paving(sign * 113.5, 0.13, z, 83, 0.18, 4.5);
  }
  paving(0, 0.1, 152, 1320, 0.2, 8);
  paving(0, 0.1, 188, 1320, 0.2, 8);
  paving(0, 0.12, 114, 20, 0.18, 76);
  paving(0, 0.1, 394, 28, 0.2, 60);

  for (const crossing of CROSSINGS) {
    const horizontal = crossing.axis === 'x';
    for (let i = 0; i < 8; i++) {
      const offset = -3.6 + i * 1.03;
      paint(crossing.x + (horizontal ? offset : 0), 0.18, crossing.z + (horizontal ? 0 : offset), horizontal ? 0.55 : 16, 0.02, horizontal ? 16 : 0.55);
    }
    for (const sign of [-1, 1]) {
      paint(crossing.x + (horizontal ? sign * 8.8 : -sign * 4), 0.18, crossing.z + (horizontal ? sign * 4 : sign * 8.8), horizontal ? 0.3 : 7, 0.02, horizontal ? 7 : 0.3);
    }
  }

  // Shared lamp poles and soft pools replace expensive per-lamp point lights.
  const lamps: [number, number][] = [];
  for (let x = -390; x <= 390; x += 52) lamps.push([x, 188]);
  for (const sign of [-1, 1]) for (let z = -765; z < 150; z += 65) lamps.push([sign * 185, z]);
  for (const [x, z] of lamps) {
    posts(x, 3.25, z, 0.14, 6.2, 0.14);
    posts(x + 0.6, 6.3, z, 1.4, 0.12, 0.15);
  }

  for (const part of staticParts) {
    const mesh = new THREE.InstancedMesh(part.geometry, part.mat, part.transforms.length);
    mesh.name = part.name;
    part.transforms.forEach((transform, i) => mesh.setMatrixAt(i, transform));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const instanced = (name: string, geometry: THREE.BufferGeometry, mat: THREE.Material, capacity: number) => {
    const mesh = new THREE.InstancedMesh(geometry, mat, capacity);
    mesh.name = name;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Dynamic actors can travel beyond their initial aggregate bounds.
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  };

  const shirts = material(0xffffff);
  const skin = material(0xffffff, { roughness: 0.95 });
  const trousers = material(0x313a48);
  const bodies = instanced('Pedestrian_Bodies', box, shirts, CAPACITY.pedestrians);
  const heads = instanced('Pedestrian_Heads', sphere, skin, CAPACITY.pedestrians);
  const arms = instanced('Pedestrian_Arms', box, shirts, CAPACITY.pedestrians * 2);
  const legs = instanced('Pedestrian_Legs', box, trousers, CAPACITY.pedestrians * 2);
  const hair = instanced('Pedestrian_Hair', sphere, material(0x38302a), CAPACITY.pedestrians);
  const carPaint = material(0xffffff, { metalness: 0.25, roughness: 0.35 });
  const carBodies = instanced('Vehicle_Bodies', box, carPaint, CAPACITY.cars);
  const windows = instanced('Vehicle_Windows', box, material(0x354f5b, { roughness: 0.22, metalness: 0.2 }), CAPACITY.cars);
  const roofs = instanced('Vehicle_Roofs', box, carPaint, CAPACITY.cars);
  const wheels = instanced('Vehicle_Wheels', new THREE.CylinderGeometry(0.31, 0.31, 0.18, 10).rotateZ(Math.PI / 2), material(0x222529), CAPACITY.cars * 4);
  const frontMat = material(0xffefc8, { emissive: 0xffdf9a, emissiveIntensity: 2.4, toneMapped: false });
  const rearMat = material(0xf13625, { emissive: 0xff1a08, emissiveIntensity: 1.6, toneMapped: false });
  const headlights = instanced('Vehicle_Headlights', box, frontMat, CAPACITY.cars * 2);
  const taillights = instanced('Vehicle_Taillights', box, rearMat, CAPACITY.cars * 2);
  const lampMat = material(0xffe8b2, { emissive: 0xffd07a, emissiveIntensity: 2, toneMapped: false });
  const bulbs = instanced('Street_Lamps', sphere, lampMat, lamps.length);
  lamps.forEach(([x, z], i) => {
    matrix.compose(position.set(x + 1.25, 6.22, z), q.identity(), scale.set(0.24, 0.13, 0.2));
    bulbs.setMatrixAt(i, matrix);
  });

  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 64;
  const ctx = glowCanvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,224,156,0.24)');
  gradient.addColorStop(0.45, 'rgba(255,224,156,0.12)');
  gradient.addColorStop(1, 'rgba(255,224,156,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const glowMap = new THREE.CanvasTexture(glowCanvas);
  glowMap.colorSpace = THREE.SRGBColorSpace;
  const glowMaterial = new THREE.MeshBasicMaterial({ map: glowMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -4 });
  const glowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const pools = instanced('Street_LightPools', glowGeometry, glowMaterial, lamps.length);
  lamps.forEach(([x, z], i) => {
    matrix.compose(position.set(x + 1.2, 0.24, z), q.identity(), scale.set(18, 1, 18));
    pools.setMatrixAt(i, matrix);
  });
  const beams = instanced('Vehicle_LightPools', glowGeometry, glowMaterial, CAPACITY.cars);

  const signals: { vehicle: THREE.Mesh[]; walk: THREE.Mesh; crossing: typeof CROSSINGS[number] }[] = [];
  for (const crossing of CROSSINGS) {
    for (const sign of [-1, 1]) {
      const x = crossing.x + (crossing.axis === 'x' ? sign * 7 : sign * 11);
      const z = crossing.z + (crossing.axis === 'x' ? sign * 11 : sign * 7);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 4.2, 0.12), metal);
      post.position.set(x, 2.3, z);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 1.5, 0.36), metal);
      head.position.set(x, 4.2, z);
      const vehicle: THREE.Mesh[] = [];
      [0xe94132, 0xf0b73e, 0x51bf84].forEach((color, i) => {
        const light = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), material(color, { emissive: color, emissiveIntensity: 0 }));
        light.position.set(x, 4.65 - i * 0.45, z + sign * 0.21);
        vehicle.push(light);
        group.add(light);
      });
      const walk = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.45, 0.24), material(0xffffff));
      walk.position.set(x, 2.55, z - sign * 0.24);
      signals.push({ vehicle, walk, crossing });
      group.add(post, head, walk);
    }
  }

  const bodyPalette = ['#345e86', '#a34837', '#e0bf68', '#55785b', '#c8ced0', '#705a84', '#3d414c'];
  const skinPalette = ['#e1b68f', '#b9815b', '#76513c', '#efc6a4'];
  const carPalette = ['#b6b9ba', '#e4ddcb', '#344b62', '#8d3d35', '#34383e', '#617d75', '#b99851'];
  const dynamic = [bodies, heads, arms, legs, hair, carBodies, windows, roofs, wheels, headlights, taillights, beams];
  let posedActor: StreetActor | undefined;
  let posedDistance = -1;
  let pose = { x: 0, y: 0, z: 0, heading: 0 };
  const place = (mesh: THREE.InstancedMesh, i: number, actor: StreetActor, x: number, y: number, z: number, w: number, h: number, d: number, rotation = q) => {
    if (actor !== posedActor || actor.distance !== posedDistance) {
      pose = sampleStreet(actor.route, actor.distance); posedActor = actor; posedDistance = actor.distance;
    }
    const sin = Math.sin(pose.heading), cos = Math.cos(pose.heading);
    position.set(pose.x + x * cos + z * sin, pose.y + y, pose.z - x * sin + z * cos);
    yaw.setFromAxisAngle(up, pose.heading);
    matrix.compose(position, yaw.multiply(rotation), scale.set(w, h, d));
    mesh.setMatrixAt(i, matrix);
  };

  const renderActors = () => {
    simulation.pedestrians.forEach((actor, i) => {
      const stature = 0.94 + (actor.id % 7) * 0.02;
      const stride = actor.waiting || paused ? 0 : Math.sin(actor.travelled * 5.3) * 0.46;
      const offset = ((actor.id * 17) % 11 - 5) * 0.075;
      q.identity();
      place(bodies, i, actor, offset, 1.12 * stature, 0, 0.42 * stature, 0.58 * stature, 0.27, q);
      place(heads, i, actor, offset, 1.64 * stature, 0, 0.17 * stature, 0.21 * stature, 0.17 * stature, q);
      place(hair, i, actor, offset, 1.73 * stature, -0.025, 0.175 * stature, 0.14 * stature, 0.17 * stature, q);
      for (const sign of [-1, 1]) {
        q.setFromAxisAngle(axle, sign * stride);
        place(arms, i * 2 + (sign > 0 ? 1 : 0), actor, offset + sign * 0.28, 1.07 - 0.03 * Math.cos(stride), -Math.sin(sign * stride) * 0.18, 0.11, 0.58, 0.13, q);
        q.setFromAxisAngle(axle, -sign * stride);
        place(legs, i * 2 + (sign > 0 ? 1 : 0), actor, offset + sign * 0.11, 0.42, Math.sin(sign * stride) * 0.19, 0.15, 0.78, 0.18, q);
      }
      tempColor.set(bodyPalette[actor.id % bodyPalette.length]);
      bodies.setColorAt(i, tempColor);
      arms.setColorAt(i * 2, tempColor); arms.setColorAt(i * 2 + 1, tempColor);
      heads.setColorAt(i, tempColor.set(skinPalette[actor.id % skinPalette.length]));
    });
    simulation.cars.forEach((actor, i) => {
      const tall = actor.id % 7 === 0;
      q.identity();
      place(carBodies, i, actor, 0, 0.52, 0, 1.82, 0.66, actor.length, q);
      place(windows, i, actor, 0, tall ? 1.13 : 1.03, -0.13, 1.51, tall ? 0.85 : 0.62, actor.length * 0.55, q);
      place(roofs, i, actor, 0, tall ? 1.58 : 1.37, -0.13, 1.55, 0.08, actor.length * 0.49, q);
      tempColor.set(carPalette[actor.id % carPalette.length]);
      carBodies.setColorAt(i, tempColor); roofs.setColorAt(i, tempColor);
      for (const [j, sx, sz] of [[0, -1, -1], [1, 1, -1], [2, -1, 1], [3, 1, 1]]) {
        spin.setFromAxisAngle(axle, actor.travelled / 0.31);
        place(wheels, i * 4 + j, actor, sx * 0.88, 0.12, sz * actor.length * 0.31, 1, 1, 1, spin);
      }
      q.identity();
      for (const sign of [-1, 1]) {
        const index = i * 2 + (sign > 0 ? 1 : 0);
        place(headlights, index, actor, sign * 0.59, 0.56, actor.length / 2 + 0.015, 0.32, 0.17, 0.045, q);
        place(taillights, index, actor, sign * 0.62, 0.59, -actor.length / 2 - 0.015, 0.26, 0.17, 0.045, q);
      }
      place(beams, i, actor, 0, -0.1, actor.length / 2 + 3.6, 5.2, 1, 10, q);
    });
    bodies.count = heads.count = hair.count = simulation.pedestrians.length;
    arms.count = legs.count = simulation.pedestrians.length * 2;
    carBodies.count = windows.count = roofs.count = beams.count = simulation.cars.length;
    wheels.count = simulation.cars.length * 4;
    headlights.count = taillights.count = simulation.cars.length * 2;
    for (const mesh of dynamic) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const signal of signals) {
      const state = signalAt(simulation.time, signal.crossing);
      signal.vehicle.forEach((light, i) => {
        const active = i === (state.vehicle === 'green' ? 2 : state.vehicle === 'amber' ? 1 : 0);
        (light.material as THREE.MeshStandardMaterial).emissiveIntensity = active ? 2.5 : 0;
      });
      const mat = signal.walk.material as THREE.MeshStandardMaterial;
      mat.color.set(state.walk ? 0x52d892 : 0xed543e);
      mat.emissive.copy(mat.color); mat.emissiveIntensity = 1.4;
    }
  };

  renderActors();
  return {
    group, simulation,
    get paused() { return paused; },
    setPaused(value: boolean) { paused = value; renderActors(); },
    setQuality(value: QualityLevel) {
      if (value === level) return;
      level = value;
      const [pedestrians, cars] = DENSITY[value];
      simulation.setDensity(pedestrians, cars);
      bodies.castShadow = heads.castShadow = carBodies.castShadow = value === 'high';
      renderActors();
    },
    setNight(value: boolean) {
      night = value;
      asphalt.color.set(night ? 0x242a31 : 0x4c5052);
      sidewalk.color.set(night ? 0x777469 : 0xb7b0a1);
      marking.color.set(night ? 0xb5b9ad : 0xe7e2cf);
      lampMat.emissiveIntensity = night ? 2 : 0;
      frontMat.emissiveIntensity = night ? 2.4 : 0;
      rearMat.emissiveIntensity = night ? 1.6 : 0;
      pools.visible = beams.visible = night;
    },
    update(dt: number) { if (!paused && dt > 0) { simulation.update(dt); renderActors(); } },
  };
}
