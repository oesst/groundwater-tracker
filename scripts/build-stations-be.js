// Build data/be.stations.json from the Wasserportal Berlin groundwater overview.
//   node scripts/build-stations-be.js
//
// The overview lists every GW station; this extracts station numbers + names, and
// coordinates where present. Confirm the coordinate columns/CRS on first run
// (Berlin typically ETRS89/UTM33 -> reproject to WGS84 if needed).

import { writeFile } from 'node:fs/promises';
import { getText } from '../lib/http.js';

const OVERVIEW = 'https://wasserportal.berlin.de/start.php?anzeige=tabelle_gw&messanzeige=ms_gw_berlin';
const OUT = new URL('../data/be.stations.json', import.meta.url);

const html = await getText(OVERVIEW, { timeout: 30000, retries: 2 });

// Station detail links look like station.php?...station=<ID>...&thema=gws
const ids = new Set();
for (const m of html.matchAll(/station=(\d+)[^"']*thema=gws/g)) ids.add(m[1]);

// TODO: parse the same table rows for name + coordinates (columns vary; inspect
// the overview HTML once and map them here). Until then names/coords are blank.
const stations = [...ids].map((id) => ({ id, name: `GWM ${id}`, lat: null, lon: null }));

await writeFile(OUT, JSON.stringify({ _note: 'auto-built; add coordinates', stations }, null, 1) + '\n');
console.log(`be.stations.json: ${stations.length} station ids (coordinates still TODO)`);
