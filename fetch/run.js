// Daily pipeline entrypoint (run by GitHub Actions).
//   node fetch/run.js
// Reads previous data/latest.json + data/reference-stats.json, runs every
// adapter, normalises, computes per-station percentile, merges keep-last-good,
// and writes data/latest.json.

import { readFile, writeFile } from 'node:fs/promises';
import { ADAPTERS } from '../adapters/index.js';
import { normalizeStation, mergeKeepLastGood } from '../lib/normalize.js';

const DATA = new URL('../data/', import.meta.url);

async function readJSON(name, fallback) {
  try { return JSON.parse(await readFile(new URL(name, DATA), 'utf8')); }
  catch { return fallback; }
}

async function main() {
  const refStats = await readJSON('reference-stats.json', {});
  const prev = await readJSON('latest.json', null);

  const runResults = [];
  for (const adapter of ADAPTERS) {
    const started = Date.now();
    try {
      const raw = await adapter.fetch();
      const rows = (raw || []).map((r) => normalizeStation(r, adapter.id, refStats));
      runResults.push({ adapter, ok: true, rows, error: null });
      console.log(`✓ ${adapter.id.padEnd(6)} ${rows.length} stations (${Date.now() - started}ms)`);
    } catch (e) {
      runResults.push({ adapter, ok: false, rows: [], error: String(e && e.message || e) });
      console.log(`✗ ${adapter.id.padEnd(6)} ${e && e.message || e}`);
    }
  }

  const snapshot = mergeKeepLastGood(prev, runResults);
  await writeFile(new URL('latest.json', DATA), JSON.stringify(snapshot, null, 1) + '\n');

  const total = snapshot.stations.length;
  const ok = snapshot.sources.filter((s) => s.status === 'ok').length;
  console.log(`\nlatest.json written — ${total} stations, ${ok}/${snapshot.sources.length} sources ok`);
}

main().catch((e) => { console.error(e); process.exit(1); });
