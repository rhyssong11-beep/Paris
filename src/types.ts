/** Shape of public/data/paris.json (produced by scripts/build-data.mjs).
 *  All coordinates are metres east/north of the city centre (Notre-Dame). */
export interface CityData {
  attribution: string[];
  bounds: [number, number, number, number];
  arrondissements: { n: number; name: string; cx: number; cy: number; ring: number[] }[];
  water: number[][];
  green: { name: string; ring: number[] }[];
  roads: {
    /** flat x,y pairs */
    nodes: number[];
    /** [a, b, cls, ...intermediate x,y pairs]; cls 0 = major, 1 = minor */
    edges: number[][];
  };
  metro: {
    stations: { name: string; x: number; y: number }[];
    lines: {
      ref: string;
      color: string;
      /** one entry per direction / branch */
      routes: { stops: number[]; path: number[]; at: number[] }[];
    }[];
  };
  pois: { name: string; x: number; y: number }[];
}

export interface Place {
  x: number;
  y: number;
  /** nearest road-graph node */
  node: number;
}
