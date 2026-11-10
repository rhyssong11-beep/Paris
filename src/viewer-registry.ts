/** Landmarks that open in the 3D viewer when clicked, keyed by the names used in the city data. */
export interface ViewerEntry {
  /** GLB file under public/, tried first; the built-in procedural model is the fallback */
  modelUrl: string;
  /** real-world height in metres; loaded models are scaled to it */
  height: number;
  subtitle: string;
  /** attribution for the model file, shown in the viewer (required for CC BY models) */
  credit?: string;
}

export const VIEWABLE: Record<string, ViewerEntry> = {
  'Tour Eiffel': {
    modelUrl: 'models/eiffel.glb',
    height: 330,
    subtitle: '1889 · 높이 330 m · 귀스타브 에펠',
  },
};
