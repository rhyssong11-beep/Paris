import * as THREE from 'three';

/** Dispose shared scene resources once, including instance buffers and shadow targets. */
export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const mat of Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : []) {
      materials.add(mat);
      for (const value of Object.values(mat)) if (value instanceof THREE.Texture) textures.add(value);
    }
    if (o instanceof THREE.InstancedMesh) o.dispose();
    if (o instanceof THREE.DirectionalLight || o instanceof THREE.PointLight || o instanceof THREE.SpotLight) o.shadow.dispose();
  });
  if (root instanceof THREE.Scene && root.background instanceof THREE.Texture) textures.add(root.background);
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}
