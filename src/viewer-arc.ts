/**
 * Surrounding Paris cityscape, 12 radiating avenue extensions, distant axial vistas
 * (Champs-Élysées toward Concorde, Grande-Armée toward La Défense, Eiffel Tower silhouette),
 * animated Eternal Flame, and night-time architectural floodlighting for the Arc de Triomphe viewer.
 *
 * The GLB model (`public/models/arc.glb`) covers Place Charles de Gaulle, the 12 Hôtels des Maréchaux
 * wedges, Rue de Tilsitt/Presbourg, and the inner Haussmann blocks out to r ≈ 262 m.
 * This module extends the 12-pointed star of avenues and Haussmannian quarters out to the horizon (~1.15 km).
 */

import * as THREE from 'three';

/** The 12 radiating avenues matching `scripts/build-arc-glb.mjs` (angle 0 = +Z Champs-Élysées). */
const AVENUES = [
  { angle: (0 * Math.PI) / 6, halfWidth: 35.0, main: true }, // Avenue des Champs-Élysées (+Z)
  { angle: (1 * Math.PI) / 6, halfWidth: 16.5 }, // Avenue Marceau
  { angle: (2 * Math.PI) / 6, halfWidth: 16.5 }, // Avenue d'Iéna
  { angle: (3 * Math.PI) / 6, halfWidth: 18.5 }, // Avenue Kléber (+X)
  { angle: (4 * Math.PI) / 6, halfWidth: 17.0 }, // Avenue Victor-Hugo
  { angle: (5 * Math.PI) / 6, halfWidth: 42.0, park: true }, // Avenue Foch
  { angle: (6 * Math.PI) / 6, halfWidth: 35.0, main: true }, // Avenue de la Grande-Armée (-Z)
  { angle: (7 * Math.PI) / 6, halfWidth: 16.0 }, // Avenue Carnot
  { angle: (8 * Math.PI) / 6, halfWidth: 16.5 }, // Avenue Mac-Mahon
  { angle: (9 * Math.PI) / 6, halfWidth: 18.5 }, // Avenue de Wagram (-X)
  { angle: (10 * Math.PI) / 6, halfWidth: 17.5 }, // Avenue Hoche
  { angle: (11 * Math.PI) / 6, halfWidth: 17.5 }, // Avenue de Friedland
];

/**
 * Procedural Haussmann façade texture (limestone walls, cornice bands, French windows, and night window glow).
 */
function makeFacadeMaps(): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const W = 256, H = 256;
  const day = document.createElement('canvas');
  day.width = W;
  day.height = H;
  const d = day.getContext('2d')!;

  const night = document.createElement('canvas');
  night.width = W;
  night.height = H;
  const n = night.getContext('2d')!;

  d.fillStyle = '#d8ccb4';
  d.fillRect(0, 0, W, H);
  n.fillStyle = '#000000';
  n.fillRect(0, 0, W, H);

  // Ground-floor arcade & shopfront band
  d.fillStyle = '#bfb198';
  d.fillRect(0, H - 44, W, 44);
  d.fillStyle = '#ece2cc';
  d.fillRect(0, H - 47, W, 4);
  d.fillRect(0, 32, W, 5);
  d.fillRect(0, 8, W, 4);

  // Continuous wrought-iron balcony rails (2nd and 5th floor Haussmann signature)
  d.fillStyle = '#2d3136';
  d.fillRect(0, H - 90, W, 4);
  d.fillRect(0, 36, W, 4);

  let s = 1836;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };

  const cols = 8;
  const floors = [
    { y: 14, h: 16 },
    { y: 42, h: 30 },
    { y: 84, h: 32 },
    { y: 128, h: 34 },
    { y: 172, h: 36 },
    { y: H - 36, h: 28 },
  ];
  const cw = W / cols;
  for (let fi = 0; fi < floors.length; fi++) {
    const { y, h } = floors[fi];
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.24;
      const w = cw * 0.52;
      d.fillStyle = '#ede3ce';
      d.fillRect(x - 2, y - 2, w + 4, h + 4);
      d.fillStyle = '#28323c';
      d.fillRect(x, y, w, h);
      d.fillStyle = '#c8bca4';
      d.fillRect(x + w * 0.47, y, w * 0.06, h);
      if (rnd() < (fi === floors.length - 1 ? 0.55 : 0.36)) {
        n.fillStyle = rnd() < 0.5 ? '#ffe2a2' : '#ffbe6b';
        n.fillRect(x + 1, y + 1, w - 2, h - 2);
      }
    }
  }

  const wrap = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: wrap(day, true), emissiveMap: wrap(night, false) };
}

/** Checks whether a world point (x, z) lies inside any of the 12 radiating avenue corridors. */
function inAvenueCorridor(x: number, z: number, margin = 10): boolean {
  const r = Math.hypot(x, z);
  if (r < 258) return true;
  for (const av of AVENUES) {
    const dx = Math.sin(av.angle);
    const dz = Math.cos(av.angle);
    const along = x * dx + z * dz;
    if (along < 0) continue;
    const perp = Math.abs(x * dz - z * dx);
    if (perp < av.halfWidth + margin) return true;
  }
  return false;
}

export function buildArcSurroundings(H: number) {
  const s = H / 280; // 1 for metric scale (site.span = 280 m)
  const group = new THREE.Group();
  group.name = 'arc-surroundings';

  let seed = 20260729;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };

  // ---------------------------------------------------------------------------
  // 1. Animated Eternal Flame (Flamme éternelle) at the Tomb of the Unknown Soldier
  // ---------------------------------------------------------------------------
  const flameGroup = new THREE.Group();
  flameGroup.position.set(0, 0.92 * s, 1.35 * s);
  group.add(flameGroup);

  const outerFlameMat = new THREE.MeshBasicMaterial({
    color: 0xff5a14,
    transparent: true,
    opacity: 0.88,
  });
  const midFlameMat = new THREE.MeshBasicMaterial({
    color: 0xffaa22,
    transparent: true,
    opacity: 0.92,
  });
  const coreFlameMat = new THREE.MeshBasicMaterial({
    color: 0xfff3cc,
  });

  const coneGeo = new THREE.ConeGeometry(0.26 * s, 0.95 * s, 10);
  coneGeo.translate(0, 0.45 * s, 0);

  const tongues: { mesh: THREE.Mesh; phase: number; baseScale: [number, number, number]; tilt: number }[] = [];
  const tongueConfigs = [
    { mat: outerFlameMat, sx: 1.0, sy: 1.15, sz: 1.0, ox: 0, oz: 0, tilt: 0.06 },
    { mat: midFlameMat, sx: 0.72, sy: 0.95, sz: 0.72, ox: 0.04, oz: -0.03, tilt: 0.09 },
    { mat: midFlameMat, sx: 0.65, sy: 0.88, sz: 0.65, ox: -0.05, oz: 0.04, tilt: 0.11 },
    { mat: coreFlameMat, sx: 0.42, sy: 0.65, sz: 0.42, ox: 0, oz: 0, tilt: 0.04 },
  ];
  for (let i = 0; i < tongueConfigs.length; i++) {
    const cfg = tongueConfigs[i];
    const m = new THREE.Mesh(coneGeo, cfg.mat);
    m.position.set(cfg.ox * s, 0, cfg.oz * s);
    m.scale.set(cfg.sx, cfg.sy, cfg.sz);
    flameGroup.add(m);
    tongues.push({
      mesh: m,
      phase: i * 1.7,
      baseScale: [cfg.sx, cfg.sy, cfg.sz],
      tilt: cfg.tilt,
    });
  }

  // Warm Eternal Flame point light casting a gentle golden-amber glow on the Tomb & soldiers' reliefs
  const flameLight = new THREE.PointLight(0xff8c2a, 18, 16 * s, 1.6);
  flameLight.position.set(0, 1.45 * s, 1.35 * s);
  group.add(flameLight);

  // ---------------------------------------------------------------------------
  // 2. Outer 12 Radiating Avenues (r = 258 .. 1150 m) & Boulevard Trees / Streetlamps
  // ---------------------------------------------------------------------------
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x454442, roughness: 0.92 });
  const sidewalkMat = new THREE.MeshStandardMaterial({ color: 0xa69d8c, roughness: 0.90 });
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x3b6329, roughness: 0.98 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: 0x385728, roughness: 0.90 });
  const lampGlobeMat = new THREE.MeshStandardMaterial({
    color: 0xfff1cf,
    roughness: 0.25,
    emissive: new THREE.Color(0xffcf78),
    emissiveIntensity: 0.0,
  });

  const EXT_R0 = 258 * s;
  const EXT_R1 = 1140 * s;
  const EXT_LEN = EXT_R1 - EXT_R0;
  const EXT_MID = (EXT_R0 + EXT_R1) / 2;

  const treeMatrices: THREE.Matrix4[] = [];
  const treeColors: THREE.Color[] = [];
  const lampMatrices: THREE.Matrix4[] = [];
  const dummy = new THREE.Object3D();

  for (const av of AVENUES) {
    const a = av.angle;
    const dx = Math.sin(a), dz = Math.cos(a);
    const px = Math.cos(a), pz = -Math.sin(a);
    const hw = av.halfWidth * s;

    // Avenue roadway strip
    const roadGeo = new THREE.PlaneGeometry(hw * 1.4, EXT_LEN);
    roadGeo.rotateX(-Math.PI / 2);
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.rotation.y = a;
    roadMesh.position.set(dx * EXT_MID, 0.04 * s, dz * EXT_MID);
    roadMesh.receiveShadow = true;
    group.add(roadMesh);

    // Flanking sidewalks (or green lawns for Avenue Foch)
    for (const side of [-1, 1]) {
      const swW = hw * 0.34;
      const swOffset = side * (hw * 0.83);
      const swGeo = new THREE.PlaneGeometry(swW, EXT_LEN);
      swGeo.rotateX(-Math.PI / 2);
      const swMesh = new THREE.Mesh(swGeo, av.park ? lawnMat : sidewalkMat);
      swMesh.rotation.y = a;
      swMesh.position.set(dx * EXT_MID + px * swOffset, 0.16 * s, dz * EXT_MID + pz * swOffset);
      swMesh.receiveShadow = true;
      group.add(swMesh);

      // Trees & streetlamp globes along the avenue extension
      for (let r = 272; r < 1060; r += 24) {
        const treeOff = side * (av.halfWidth - 4.8) * s;
        const tx = dx * r * s + px * treeOff;
        const tz = dz * r * s + pz * treeOff;
        const sc = (0.85 + rnd() * 0.35) * s;
        dummy.position.set(tx, 6.2 * sc, tz);
        dummy.scale.set(4.2 * sc, 5.2 * sc, 4.2 * sc);
        dummy.rotation.set(0, rnd() * 6.28, 0);
        dummy.updateMatrix();
        treeMatrices.push(dummy.matrix.clone());
        treeColors.push(new THREE.Color().setHSL(0.26 + (rnd() - 0.5) * 0.04, 0.42, 0.24 + (rnd() - 0.5) * 0.06));

        if (r < 920 && r % 48 === 8) {
          const lampOff = side * (av.halfWidth - 8.0) * s;
          dummy.position.set(dx * r * s + px * lampOff, 5.6 * s, dz * r * s + pz * lampOff);
          dummy.scale.set(0.32 * s, 0.38 * s, 0.32 * s);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          lampMatrices.push(dummy.matrix.clone());
        }
      }
    }
  }

  // Instanced avenue trees
  const treeGeo = new THREE.IcosahedronGeometry(1, 1);
  const treeInst = new THREE.InstancedMesh(treeGeo, canopyMat, treeMatrices.length);
  treeInst.castShadow = true;
  treeInst.receiveShadow = true;
  treeMatrices.forEach((m, i) => {
    treeInst.setMatrixAt(i, m);
    treeInst.setColorAt(i, treeColors[i]);
  });
  treeInst.instanceMatrix.needsUpdate = true;
  if (treeInst.instanceColor) treeInst.instanceColor.needsUpdate = true;
  group.add(treeInst);

  // Instanced avenue streetlamp globes
  const lampGeo = new THREE.SphereGeometry(1, 8, 6);
  const lampInst = new THREE.InstancedMesh(lampGeo, lampGlobeMat, lampMatrices.length);
  lampMatrices.forEach((m, i) => lampInst.setMatrixAt(i, m));
  lampInst.instanceMatrix.needsUpdate = true;
  group.add(lampInst);

  // ---------------------------------------------------------------------------
  // 3. Outer Haussmannian City Blocks (r = 278 .. 1080 m between the 12 avenues)
  // ---------------------------------------------------------------------------
  const { map: facadeMap, emissiveMap } = makeFacadeMaps();
  facadeMap.repeat.set(2, 1);
  emissiveMap.repeat.set(2, 1);
  const wallMat = new THREE.MeshStandardMaterial({
    map: facadeMap,
    emissiveMap,
    emissive: new THREE.Color(0xffb86c),
    emissiveIntensity: 0,
    roughness: 0.85,
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3b414b, roughness: 0.68, metalness: 0.1 });

  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  wallGeo.translate(0, 0.5, 0);
  const roofGeo = new THREE.ConeGeometry(0.76, 1, 4);
  roofGeo.rotateY(Math.PI / 4);
  roofGeo.translate(0, 0.5, 0);

  const wallMatrices: THREE.Matrix4[] = [];
  const wallColors: THREE.Color[] = [];
  const roofMatrices: THREE.Matrix4[] = [];

  for (let r = 286; r <= 1060; r += 44) {
    const circumference = 2 * Math.PI * r;
    const steps = Math.floor(circumference / 38);
    for (let i = 0; i < steps; i++) {
      const a = ((i + (rnd() - 0.5) * 0.25) / steps) * Math.PI * 2;
      const bx = Math.sin(a) * r;
      const bz = Math.cos(a) * r;
      if (inAvenueCorridor(bx, bz, 22)) continue;

      const w = (24 + rnd() * 16) * s;
      const d = (22 + rnd() * 14) * s;
      const h = (19.5 + rnd() * 6.5) * s;
      const rh = (4.5 + rnd() * 2.5) * s;

      dummy.position.set(bx * s, 0, bz * s);
      dummy.rotation.set(0, a + (rnd() - 0.5) * 0.12, 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      wallMatrices.push(dummy.matrix.clone());
      wallColors.push(new THREE.Color().setHSL(0.1 + (rnd() - 0.5) * 0.02, 0.24, 0.88 + (rnd() - 0.5) * 0.1));

      dummy.position.set(bx * s, h, bz * s);
      dummy.scale.set(w * 0.96, rh, d * 0.96);
      dummy.updateMatrix();
      roofMatrices.push(dummy.matrix.clone());
    }
  }

  const walls = new THREE.InstancedMesh(wallGeo, wallMat, wallMatrices.length);
  const roofs = new THREE.InstancedMesh(roofGeo, roofMat, roofMatrices.length);
  walls.castShadow = true;
  walls.receiveShadow = true;
  roofs.castShadow = true;
  for (let i = 0; i < wallMatrices.length; i++) {
    walls.setMatrixAt(i, wallMatrices[i]);
    walls.setColorAt(i, wallColors[i]);
    roofs.setMatrixAt(i, roofMatrices[i]);
  }
  walls.instanceMatrix.needsUpdate = true;
  if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  roofs.instanceMatrix.needsUpdate = true;
  group.add(walls, roofs);

  // ---------------------------------------------------------------------------
  // 4. Distant Axial Vistas (Concorde Obelisk at +Z, La Défense Grande Arche at -Z, Eiffel Silhouette)
  // ---------------------------------------------------------------------------
  const vistaMat = new THREE.MeshStandardMaterial({ color: 0xc8bca6, roughness: 0.75 });
  const giltVistaMat = new THREE.MeshStandardMaterial({
    color: 0xe6be5a,
    metalness: 0.85,
    roughness: 0.25,
    emissive: new THREE.Color(0xffcc55),
    emissiveIntensity: 0.15,
  });

  // +Z Axis (Champs-Élysées -> Place de la Concorde Luxor Obelisk at z = +980 m)
  const obeliskShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.6 * s, 1.3 * s, 28 * s, 4), vistaMat);
  obeliskShaft.position.set(0, 14 * s, 980 * s);
  obeliskShaft.rotation.y = Math.PI / 4;
  const obeliskTip = new THREE.Mesh(new THREE.ConeGeometry(0.85 * s, 3.2 * s, 4), giltVistaMat);
  obeliskTip.position.set(0, 29.6 * s, 980 * s);
  obeliskTip.rotation.y = Math.PI / 4;
  group.add(obeliskShaft, obeliskTip);

  // -Z Axis (Avenue de la Grande-Armée -> Grande Arche de La Défense silhouette at z = -1080 m)
  const archeSize = 86 * s;
  const archeThick = 16 * s;
  const archeDepth = 34 * s;
  const archeGroup = new THREE.Group();
  archeGroup.position.set(0, 0, -1080 * s);
  archeGroup.rotation.y = 0.11; // Real-world 6.3° slight turn of the Grande Arche relative to the axis
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(archeThick, archeSize, archeDepth), vistaMat);
  leftLeg.position.set(-(archeSize - archeThick) / 2, archeSize / 2, 0);
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(archeThick, archeSize, archeDepth), vistaMat);
  rightLeg.position.set((archeSize - archeThick) / 2, archeSize / 2, 0);
  const topBeam = new THREE.Mesh(new THREE.BoxGeometry(archeSize, archeThick, archeDepth), vistaMat);
  topBeam.position.set(0, archeSize - archeThick / 2, 0);
  archeGroup.add(leftLeg, rightLeg, topBeam);
  group.add(archeGroup);

  // Distant Eiffel Tower silhouette visible from the rooftop terrace along the Avenue Kléber / Iéna direction
  const eiffelGroup = new THREE.Group();
  const eiffelAngle = (2.45 * Math.PI) / 6; // SSE-SW direction toward Champ de Mars
  const eiffelDist = 920 * s;
  eiffelGroup.position.set(Math.sin(eiffelAngle) * eiffelDist, 0, Math.cos(eiffelAngle) * eiffelDist);
  const eiffelMat = new THREE.MeshStandardMaterial({
    color: 0x6e553e,
    roughness: 0.6,
    metalness: 0.45,
    emissive: new THREE.Color(0xffb44c),
    emissiveIntensity: 0,
  });
  const eBase = new THREE.Mesh(new THREE.CylinderGeometry(14 * s, 32 * s, 55 * s, 4), eiffelMat);
  eBase.position.y = 27.5 * s;
  eBase.rotation.y = Math.PI / 4;
  const eMid = new THREE.Mesh(new THREE.CylinderGeometry(7 * s, 14 * s, 60 * s, 4), eiffelMat);
  eMid.position.y = 85 * s;
  eMid.rotation.y = Math.PI / 4;
  const eTop = new THREE.Mesh(new THREE.CylinderGeometry(1.8 * s, 7 * s, 70 * s, 4), eiffelMat);
  eTop.position.y = 150 * s;
  eTop.rotation.y = Math.PI / 4;
  const eSpire = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * s, 1.2 * s, 28 * s, 6), giltVistaMat);
  eSpire.position.y = 199 * s;
  eiffelGroup.add(eBase, eMid, eTop, eSpire);
  group.add(eiffelGroup);

  return {
    group,
    allowed: () => true,
    setNight(night: boolean) {
      wallMat.emissiveIntensity = night ? 0.85 : 0;
      lampGlobeMat.emissiveIntensity = night ? 1.4 : 0;
      eiffelMat.emissiveIntensity = night ? 0.55 : 0;
      giltVistaMat.emissiveIntensity = night ? 0.8 : 0.15;
      flameLight.intensity = night ? 32 : 16;
    },
    update(t: number) {
      // Animate the Eternal Flame tongues & flickering amber light
      for (const tg of tongues) {
        const wave = Math.sin(t * 7.5 + tg.phase) * 0.12 + Math.cos(t * 13.2 - tg.phase * 1.3) * 0.07;
        const stretch = 1 + Math.sin(t * 9.8 + tg.phase * 0.8) * 0.14;
        tg.mesh.scale.set(
          tg.baseScale[0] * (1 - wave * 0.35),
          tg.baseScale[1] * stretch,
          tg.baseScale[2] * (1 + wave * 0.35)
        );
        tg.mesh.rotation.z = Math.sin(t * 6.4 + tg.phase) * tg.tilt;
        tg.mesh.rotation.x = Math.cos(t * 5.7 + tg.phase * 1.2) * tg.tilt;
      }
      const flicker = 1 + Math.sin(t * 11.3) * 0.14 + Math.cos(t * 19.7) * 0.08;
      flameLight.intensity = (wallMat.emissiveIntensity > 0 ? 30 : 15) * flicker;
    },
  };
}

/**
 * Night-time golden architectural floodlighting for the Arc de Triomphe:
 *   - 4 pier uplights illuminating Rude's La Marseillaise & the other 3 monumental sculptures
 *   - Vault uplights inside the Grand Central Vault & both Transverse Vaults illuminating the coffered roses
 *   - Attic cornice wash lights illuminating the 30 circular shields
 */
export function buildArcNightLights(H = 280): THREE.Group {
  const s = H / 280;
  const group = new THREE.Group();
  group.name = 'arc-night-lights';
  group.visible = false;

  const spot = (
    x: number,
    y: number,
    z: number,
    tx: number,
    ty: number,
    tz: number,
    intensity: number,
    distance: number,
    angle = 0.65,
    color = 0xffd28a
  ) => {
    const l = new THREE.SpotLight(color, intensity, distance * s, angle, 0.55, 1.35);
    l.position.set(x * s, y * s, z * s);
    l.target.position.set(tx * s, ty * s, tz * s);
    group.add(l, l.target);
  };

  // 1. Uplights on the 4 Monumental High-Relief Sculptural Groups (+Z Champs-Élysées & -Z Grande-Armée)
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const px = sx * 14.85;
      spot(px, 0.8, sz * 22, px, 14.5, sz * 11.1, 130, 55, 0.62, 0xffd694);
      // Upper wash onto the 6 bas-reliefs, Great Frieze & 30 Attic Shields
      spot(px, 1.0, sz * 32, px, 38.0, sz * 11.1, 110, 75, 0.55, 0xffcf82);
    }
  }

  // 2. East & West flank floodlights (washing the transverse facades & attic shields)
  for (const sx of [-1, 1]) {
    spot(sx * 34, 1.0, 0, sx * 22.4, 28.0, 0, 95, 65, 0.65, 0xffcf82);
  }

  // 3. Interior Vault Golden Wash (illuminating the sculpted ceiling roses of the Grand & Transverse Vaults)
  spot(-6.5, 4.0, 0, 0, 29.0, 0, 90, 42, 0.85, 0xffd896);
  spot(6.5, 4.0, 0, 0, 29.0, 0, 90, 42, 0.85, 0xffd896);

  // Warm ambient point lights inside the Grand Vault and Transverse Vaults
  const grandVaultGlow = new THREE.PointLight(0xffcf80, 42, 34 * s, 1.4);
  grandVaultGlow.position.set(0, 18 * s, 0);
  group.add(grandVaultGlow);

  for (const sx of [-1, 1]) {
    const transGlow = new THREE.PointLight(0xffcb78, 24, 20 * s, 1.5);
    transGlow.position.set(sx * 14.8 * s, 12 * s, 0);
    group.add(transGlow);
  }

  return group;
}
