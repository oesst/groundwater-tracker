// Build data/reference-stats.json — the per-station 1991–2020 baseline used to
// turn today's metre value into a comparable percentile.
//
// Recommended source: GEMS-GER (nationwide German groundwater series 1991–2022),
// the dataset BGR links from the GRUVO download page. Download it once, point
// SERIES_DIR at it, and map each series to the station id your adapters emit.
//
//   node scripts/build-reference-stats.js
//
// This script is intentionally a template: the exact GEMS-GER file layout is up
// to you to map (station id column + value column). The maths (quantiles11) is
// done for you and matches what the pipeline expects.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { quantiles11 } from '../lib/percentile.js';

const SERIES_DIR = process.env.SERIES_DIR || new URL('../reference-src/', import.meta.url);
const OUT = new URL('../data/reference-stats.json', import.meta.url);
const REF_FROM = 1991, REF_TO = 2020;

// EDIT THIS to match your series files. Expected: return
//   { id, values:[{year, value}] } for one station file.
async function parseSeriesFile(path, name) {
  const txt = await readFile(path, 'utf8');
  // Example for CSV "date;value" with German decimals — adjust to your data:
  const values = [];
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/(\d{4})[-.](\d{2})[-.](\d{2})\D+(-?\d+[.,]\d+)/);
    if (!m) continue;
    const year = +m[1];
    if (year < REF_FROM || year > REF_TO) continue;
    values.push({ year, value: parseFloat(m[4].replace(',', '.')) });
  }
  const id = name.replace(/\.[^.]+$/, ''); // TODO: map filename -> your station id
  return { id, values };
}

async function main() {
  let files = [];
  try { files = await readdir(SERIES_DIR); }
  catch { console.error(`No reference series in ${SERIES_DIR}. See header for setup.`); process.exit(1); }

  const out = {};
  for (const f of files) {
    const { id, values } = await parseSeriesFile(new URL(f, SERIES_DIR), f);
    const q = quantiles11(values.map((v) => v.value));
    if (q) out[id] = { q };
  }
  await writeFile(OUT, JSON.stringify(out, null, 0) + '\n');
  console.log(`reference-stats.json: ${Object.keys(out).length} stations`);
}
main();
