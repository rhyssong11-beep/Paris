import * as THREE from 'three';

/**
 * The city around the monument: blocks of cream stone buildings with zinc roofs on a street grid,
 * the Seine with a bridge on the tower's axis, and the long lawn of the Champ de Mars. It is only a
 * backdrop (it fades into the haze), but it gives the tower a place to stand and a sense of scale.
 */
export function buildCity(H: number) {
  const group = new THREE.Group();
  const rand = (() => {
    let a = 20260711;
    return () => ((a = (Math.imul(a, 1664525) + 1013904223) >>> 0) / 4294967296);
  })();
  const CELL = 86;
  const R_OUT = H * 6;
  const RIVER: [number, number] = [205, 350];
  const PARK_HALF = 100;
  const walls: THREE.Matrix4[] = [], roofs: THREE.Matrix4[] = [];
  const tints: THREE.Color[] = [];
  const q = new THREE.Quaternion();
  for (let gx = -R_OUT; gx <= R_OUT; gx += CELL) {
    for (let gz = -R_OUT; gz <= R_OUT; gz += CELL) {
      if (Math.hypot(gx, gz) < 175 || Math.hypot(gx, gz) > R_OUT) continue;
      if (gz > RIVER[0] - 48 && gz < RIVER[1] + 48) continue;
      if (Math.abs(gx) < PARK_HALF + 28 && gz < 0 && gz > -800) continue;
      // Reserve street and pavement corridors instead of letting buildings intersect the traffic.
      if (Math.abs(Math.abs(gx) - 170) < 52 && gz > -860 && gz < 205) continue;
      if (Math.abs(gz + 810) < 48 && Math.abs(gx) < 710) continue;
      // Two broad diagonal avenues break up the residential block pattern.
      if (Math.abs(gx + gz * 0.46 - 165) < 28 || Math.abs(gx - gz * 0.3 + 220) < 24) continue;
      if (rand() < 0.08) continue;
      const height = 17 + rand() * 13;
      const blockWidth = 56 + rand() * 12;
      const blockDepth = 48 + rand() * 17;
      // Three wings form a small courtyard instead of a single repeated solid box.
      const pieces = [[0, -blockDepth * 0.32, blockWidth, blockDepth * 0.36],
        [-blockWidth * 0.34, blockDepth * 0.1, blockWidth * 0.32, blockDepth * 0.52],
        [blockWidth * 0.34, blockDepth * 0.1, blockWidth * 0.32, blockDepth * 0.52]];
      for (const [dx, dz, w, d] of pieces) {
        const h = height + (rand() - 0.5) * 2;
        const roofH = 3.2 + rand() * 2;
        walls.push(new THREE.Matrix4().compose(new THREE.Vector3(gx + dx, h / 2, gz + dz), q, new THREE.Vector3(w, h, d)));
        roofs.push(new THREE.Matrix4().compose(new THREE.Vector3(gx + dx, h + roofH / 2, gz + dz), q, new THREE.Vector3(w + 0.5, roofH, d + 0.5)));
        tints.push(new THREE.Color().setHSL(0.09 + rand() * 0.025, 0.12 + rand() * 0.12, 0.75 + rand() * 0.16));
      }
    }
  }
  const facade = document.createElement('canvas');
  const lit = document.createElement('canvas');
  facade.width = lit.width = 128; facade.height = lit.height = 128;
  const fg = facade.getContext('2d')!, lg = lit.getContext('2d')!;
  fg.fillStyle = '#e6e0d5'; fg.fillRect(0, 0, 128, 128);
  lg.fillStyle = '#000'; lg.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 5; row++) {
    const y = 7 + row * 24;
    fg.fillStyle = '#b2a99a'; fg.fillRect(0, y + 18, 128, 2);
    for (let col = 0; col < 8; col++) {
      const x = 4 + col * 16;
      fg.fillStyle = '#f8f3e8'; fg.fillRect(x - 1, y - 1, 10, 16);
      fg.fillStyle = '#56616a'; fg.fillRect(x, y, 8, 14);
      fg.fillStyle = '#a4a9a5'; fg.fillRect(x + 3, y, 1, 14); fg.fillRect(x, y + 7, 8, 1);
      if (rand() < 0.28) { lg.fillStyle = '#ffd09a'; lg.fillRect(x, y, 8, 14); }
    }
  }
  const facadeMap = new THREE.CanvasTexture(facade), lightMap = new THREE.CanvasTexture(lit);
  facadeMap.colorSpace = lightMap.colorSpace = THREE.SRGBColorSpace;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xf0e9dc, map: facadeMap, emissiveMap: lightMap, roughness: 0.92 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x697985, roughness: 0.72, metalness: 0.12 });
  const wallMesh = new THREE.InstancedMesh(box, wallMat, walls.length);
  const mansard = new THREE.CylinderGeometry(0.5, Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
  const roofMesh = new THREE.InstancedMesh(mansard, roofMat, roofs.length);
  walls.forEach((m, i) => { wallMesh.setMatrixAt(i, m); wallMesh.setColorAt(i, tints[i]); roofMesh.setMatrixAt(i, roofs[i]); });
  group.add(wallMesh, roofMesh);

  const flat = (w: number, d: number, x: number, z: number, y: number, mat: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z); mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  // Depth offsets keep thin ground overlays stable at city-scale viewing distances.
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x557a81, roughness: 0.32, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  flat(R_OUT * 2.2, RIVER[1] - RIVER[0], 0, (RIVER[0] + RIVER[1]) / 2, 0.02, waterMat);
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x718153, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const pathMat = new THREE.MeshStandardMaterial({ color: 0xb0a28a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xa39d8f, roughness: 0.9 });
  // Long Champ de Mars lawns, paths and tree avenues; the detailed local gardens live in the GLB.
  for (const sign of [-1, 1]) {
    flat(70, 570, sign * 52, -455, 0.015, lawnMat);
    flat(8, 600, sign * 94, -455, 0.03, pathMat);
    flat(R_OUT * 2, 9, 0, RIVER[sign === -1 ? 0 : 1] + sign * 10, 0.06, pathMat);
  }
  flat(18, 600, 0, -455, 0.03, pathMat);
  for (const z of [-210, -340, -475, -620, -745]) flat(200, 5, 0, z, 0.04, pathMat);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(37, 1, RIVER[1] - RIVER[0] + 8), stoneMat);
  bridge.position.set(0, 0.5, (RIVER[0] + RIVER[1]) / 2); group.add(bridge);
  // Shallow approaches meet the promenade routes continuously at the bridge deck.
  for (const [z0, y0, z1, y1] of [[182, 0.3, 201, 1], [354, 1, 374, 0.3]]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-18.5, y0, z0, -18.5, y1, z1, 18.5, y1, z1, 18.5, y0, z0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
    group.add(new THREE.Mesh(geometry, stoneMat));
  }
  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  const treePositions: [number, number][] = [];
  for (let z = -175; z >= -745; z -= 18) for (const sign of [-1, 1]) treePositions.push([sign * 110, z]);
  const crowns = new THREE.InstancedMesh(crownGeometry, new THREE.MeshStandardMaterial({ color: 0x425c35, roughness: 1 }), treePositions.length);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.7, 8, 5), new THREE.MeshStandardMaterial({ color: 0x605044, roughness: 1 }), treePositions.length);
  treePositions.forEach(([x, z], i) => {
    const r = 3.5 + rand() * 1.5;
    crowns.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3(x, 11, z), q, new THREE.Vector3(r, r * 1.2, r)));
    trunks.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 4, z));
  });
  group.add(crowns, trunks);
  return {
    group,
    setNight(night: boolean) {
      wallMat.color.set(night ? 0x32394a : 0xf0e9dc);
      wallMat.emissive.set(night ? 0xffe0b4 : 0x000000);
      wallMat.emissiveIntensity = night ? 0.3 : 0;
      roofMat.color.set(night ? 0x182030 : 0x697985);
      waterMat.color.set(night ? 0x101e30 : 0x557a81);
      lawnMat.color.set(night ? 0x17251f : 0x718153);
      pathMat.color.set(night ? 0x33343d : 0xb0a28a);
      stoneMat.color.set(night ? 0x373a44 : 0xa39d8f);
    },
  };
}
