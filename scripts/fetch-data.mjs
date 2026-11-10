// Downloads the raw open-data extracts the simulation is built from into data/raw/.
// Usage: node scripts/fetch-data.mjs [--force]
//
// Sources:
//   opendata.paris.fr             (Ville de Paris, ODbL)
//   data.iledefrance-mobilites.fr (Île-de-France Mobilités, Licence Ouverte v2.0 / ODbL)
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { get } from './http.mjs';

const PARIS = 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets';
const IDFM = 'https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets';
const metro = encodeURIComponent('mode="METRO"');

const sources = {
  arrondissements: `${PARIS}/arrondissements/exports/geojson`,
  roads: `${PARIS}/troncon_voie/exports/geojson`,
  streets: `${PARIS}/voie/exports/geojson?select=n_sq_vo,c_desi,l_longmin,length`,
  water: `${PARIS}/plan-de-voirie-voies-deau/exports/geojson`,
  green: `${PARIS}/espaces_verts/exports/geojson?select=nom_ev,type_ev,categorie,poly_area,geom`,
  metroLines: `${IDFM}/traces-du-reseau-ferre-idf/exports/geojson?where=${metro}`,
  metroStations: `${IDFM}/emplacement-des-gares-idf/exports/geojson?where=${metro}`,
};

const out = new URL('../data/raw/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const force = process.argv.includes('--force');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

for (const [name, url] of Object.entries(sources)) {
  if (only.length && !only.includes(name)) continue;
  const file = `${out}${name}.geojson`;
  if (!force && existsSync(file) && statSync(file).size > 1000) {
    console.log(`${name}: cached`);
    continue;
  }
  const body = get(url);
  JSON.parse(body); // fail loudly on truncated downloads
  writeFileSync(file, body);
  console.log(`${name}: ${(body.length / 1e6).toFixed(2)} MB`);
}
