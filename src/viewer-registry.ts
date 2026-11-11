/** Landmarks that open in the 3D viewer when clicked, keyed by the names used in the city data. */
export interface ViewerEntry {
  /** GLB file under public/, tried first; the built-in procedural model is the fallback */
  modelUrl: string;
  /** real-world height in metres; loaded models are scaled to it (unless `site.metric`) */
  height: number;
  /** what surrounds the landmark and how the viewer behaves there; defaults to the Eiffel Tower's site */
  site?: ViewerSite;
  subtitle: string;
  /** attribution for the model file, shown in the viewer (required for CC BY models) */
  credit?: string;
  /**
   * Photoreal Gaussian-splat capture, tried before the GLB. `path` has no extension: the viewer
   * looks for .spz, .sog, .ksplat, .splat and .ply in that order.
   */
  splat?: SplatConfig;
}

/** Everything about the viewer that differs from one landmark to the next. */
export interface ViewerSite {
  kind: 'louvre' | 'arc' | 'notredame';
  /** the model is already in metres around the origin: use it as it is instead of fitting it to `height` */
  metric: true;
  /** size of the scene in metres, which sets camera range, fog and shadow distances (the Eiffel Tower uses its height) */
  span: number;
  /** opening view */
  camera: { position: [number, number, number]; target: [number, number, number] };
  /** centre and half-size of the area that receives sharp shadows and ambient occlusion */
  detail: { x: number; z: number; half: number };
  /** where "걸어서 보기" starts, what it faces, and how far from the origin you may go */
  walk: { x: number; z: number; lookAt: [number, number, number]; radius: number };
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
  'Musée du Louvre': {
    modelUrl: 'models/louvre.glb',
    height: 52,
    subtitle: '궁전 12–19세기 · 유리 피라미드 1989 · I. M. 페이',
    site: {
      kind: 'louvre',
      metric: true,
      span: 330,
      camera: { position: [-250, 150, 235], target: [-20, 10, 0] },
      detail: { x: -60, z: 0, half: 330 },
      walk: { x: -100, z: 0, lookAt: [0, 12, 0], radius: 620 },
    },
  },
  'Arc de Triomphe': {
    modelUrl: 'models/arc.glb',
    height: 50,
    subtitle: '1806–1836 · 높이 50 m · 장 샬그랭 · 샤를 드골(에투알) 광장',
    site: {
      kind: 'arc',
      metric: true,
      span: 280,
      camera: { position: [58, 38, 112], target: [0, 21, 0] },
      detail: { x: 0, z: 0, half: 270 },
      walk: { x: 0, z: 34, lookAt: [0, 18, 0], radius: 520 },
    },
  },
  'Notre-Dame': {
    modelUrl: 'models/notredame.glb',
    height: 96,
    subtitle: '1163–1345 · 쌍탑 69 m · 첨탑 96 m · 2024년 복원 재개관',
    credit: '모델·텍스처: Higgsfield 3D Jutsu / GPT Image로 제작',
    site: {
      kind: 'notredame',
      metric: true,
      span: 280,
      camera: { position: [-178, 74, 128], target: [-6, 30, 0] },
      detail: { x: 0, z: 0, half: 230 },
      walk: { x: -112, z: 0, lookAt: [-64, 30, 0], radius: 520 },
    },
  },
};
