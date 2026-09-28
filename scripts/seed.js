// Build a renderable seed snapshot WITHOUT network, so GitHub Pages shows
// something on day one (before the first Actions run). Everything here is
// clearly flagged status:'seed' / source 'demo'; the first real pipeline run
// replaces it (the 'demo' source has no adapter, so it is dropped automatically).
//
//   npm run seed   ->   writes data/latest.json and data/reference-stats.json

import { readFile, writeFile } from 'node:fs/promises';
import { percentileFromQuantiles, classFromPercentile } from '../lib/percentile.js';

const DATA = new URL('../data/', import.meta.url);
const rng = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ h >>> 15, 1 | h); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

// national placeholder cities [name, state, lon, lat]
const CITIES = [
  ['Husum','Schleswig-Holstein',9.05,54.48],['Kiel','Schleswig-Holstein',10.13,54.32],
  ['Hamburg','Hamburg',10.0,53.55],['Hannover','Niedersachsen',9.73,52.37],['Oldenburg','Niedersachsen',8.21,53.14],
  ['Emden','Niedersachsen',7.21,53.36],['Bremen','Bremen',8.81,53.08],['Rostock','Mecklenburg-Vorpommern',12.14,54.09],
  ['Schwerin','Mecklenburg-Vorpommern',11.42,53.63],['Potsdam','Brandenburg',13.06,52.40],['Cottbus','Brandenburg',14.33,51.76],
  ['Berlin','Berlin',13.40,52.52],['Magdeburg','Sachsen-Anhalt',11.63,52.13],['Halle','Sachsen-Anhalt',11.97,51.48],
  ['Dresden','Sachsen',13.74,51.05],['Leipzig','Sachsen',12.37,51.34],['Görlitz','Sachsen',14.99,51.15],
  ['Erfurt','Thüringen',11.03,50.98],['Jena','Thüringen',11.59,50.93],['Frankfurt a.M.','Hessen',8.68,50.11],
  ['Kassel','Hessen',9.50,51.31],['Köln','Nordrhein-Westfalen',6.96,50.94],['Düsseldorf','Nordrhein-Westfalen',6.77,51.23],
  ['Münster','Nordrhein-Westfalen',7.63,51.96],['Aachen','Nordrhein-Westfalen',6.08,50.78],['Mainz','Rheinland-Pfalz',8.27,49.99],
  ['Trier','Rheinland-Pfalz',6.64,49.75],['Saarbrücken','Saarland',6.99,49.23],['Stuttgart','Baden-Württemberg',9.18,48.78],
  ['Karlsruhe','Baden-Württemberg',8.40,49.01],['Freiburg','Baden-Württemberg',7.85,47.99],['Ulm','Baden-Württemberg',9.98,48.40],
  ['München','Bayern',11.58,48.14],['Nürnberg','Bayern',11.08,49.45],['Würzburg','Bayern',9.93,49.79],['Passau','Bayern',13.43,48.57],
];

function synth(id, baseNhn) {
  const r = rng(id);
  const range = 1.2 + r() * 3.5;                 // metres of natural range
  const q = Array.from({ length: 11 }, (_, k) => +(baseNhn - range + (2 * range) * (k / 10)).toFixed(2));
  const nhn = +(baseNhn - range + 2 * range * r()).toFixed(2);
  const flur = +(1 + r() * 20).toFixed(2);
  const pct = percentileFromQuantiles(nhn, q);
  const daysAgo = Math.floor(r() * 6);
  return { q, nhn, flur, pct, cls: classFromPercentile(pct), measured_at: iso(daysAgo) };
}
const iso = (d) => new Date(Date.now() - d * 864e5).toISOString();

const refStats = {};
const stations = [];

// demo national placeholders
for (const [name, state, lon, lat] of CITIES) {
  const id = 'demo-' + name.toLowerCase().replace(/[^a-z]/g, '');
  const baseNhn = lat < 48.6 ? 400 : lat < 49.6 ? 260 : lat < 51.5 ? 140 : 40;
  const s = synth(id, baseNhn);
  refStats[id] = { q: s.q };
  stations.push({ id, name, state, lat, lon, nhn: s.nhn, flur: s.flur, pct: s.pct, cls: s.cls, measured_at: s.measured_at, source: 'demo' });
}

// real Bavaria seed wells (synthetic current values, flagged seed)
const by = JSON.parse(await readFile(new URL('by.stations.json', DATA), 'utf8')).stations;
for (const st of by) {
  const baseNhn = st.lat < 48.6 ? 480 : 350;
  const s = synth(st.id, baseNhn);
  refStats[st.id] = { q: s.q };
  stations.push({ id: st.id, name: st.name, state: 'Bayern', lat: st.lat, lon: st.lon, nhn: s.nhn, flur: s.flur, pct: s.pct, cls: s.cls, measured_at: s.measured_at, source: 'by' });
}

const now = new Date().toISOString();
const snapshot = {
  generated_at: now, schema: 1, seed: true,
  sources: [
    { id: 'demo', name: 'Demo-Platzhalter (kein echter Dienst)', kind: 'state', cadence: '—', attribution: 'synthetisch', license: '—', status: 'seed', count: CITIES.length, error: null, fetched_at: now },
    { id: 'by', name: 'Bayern — GKD / LfU (Seed)', kind: 'state', cadence: 'täglich', attribution: 'LfU Bayern', license: 'DL-DE BY 2.0', status: 'seed', count: by.length, error: null, fetched_at: now },
  ],
  stations,
};

await writeFile(new URL('latest.json', DATA), JSON.stringify(snapshot, null, 1) + '\n');
await writeFile(new URL('reference-stats.json', DATA), JSON.stringify(refStats, null, 0) + '\n');
console.log(`seed: ${stations.length} stations, ${Object.keys(refStats).length} reference entries`);
