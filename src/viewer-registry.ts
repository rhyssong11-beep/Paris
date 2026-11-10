/** Landmarks that open in the 3D viewer when clicked, keyed by the names used in the city data. */
export interface ViewerEntry {
  /** GLB file under public/, tried first; the built-in procedural model is the fallback */
  modelUrl: string;
  /** real-world height in metres; loaded models are scaled to it */
  height: number;
  subtitle: string;
  /** attribution for the model file, shown in the viewer (required for CC BY models) */
  credit?: string;
  /**
   * Photoreal Gaussian-splat capture, tried before the GLB. `path` has no extension: the viewer
   * looks for .spz, .sog, .ksplat, .splat and .ply in that order.
   */
  splat?: SplatConfig;
}

export interface SplatConfig {
  path: string;
  /** degrees about x, y, z to stand the capture upright; default [180, 0, 0] (y-down captures) */
  rotation?: [number, number, number];
  /** metres per capture unit; default fits the capture's height to `height` */
  scale?: number;
  /** metres to nudge the capture after it is centred on the ground */
  offset?: [number, number, number];
  /** CSS colour behind the capture */
  background?: string;
}

export const VIEWABLE: Record<string, ViewerEntry> = {
  'Tour Eiffel': {
    modelUrl: 'models/eiffel.glb',
    splat: { path: 'models/eiffel' },
    height: 330,
    subtitle: '1889 · 높이 330 m · 귀스타브 에펠',
  },
};
