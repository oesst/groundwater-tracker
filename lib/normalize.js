// Normalisation of raw adapter output + keep-last-good merge across runs.

import { percentileFromQuantiles, classFromPercentile } from './percentile.js';

// A raw station from an adapter should look like:
//   { id, name, state, lat, lon, nhn?, flur?, measured_at?, extra? }
// This turns it into the canonical schema the site consumes.
export function normalizeStation(raw, sourceId, refStats) {
  const ref = refStats && refStats[raw.id];
  const pct = ref ? percentileFromQuantiles(raw.nhn, ref.q) : null;
  return {
    id: raw.id,
    name: raw.name,
    state: raw.state ?? null,
    lat: round(raw.lat, 5),
    lon: round(raw.lon, 5),
    nhn: raw.nhn ?? null,
    flur: raw.flur ?? null,
    pct,
    cls: classFromPercentile(pct),
    measured_at: raw.measured_at ?? null,
    source: sourceId,
  };
}

function round(v, n) {
  if (v == null || !Number.isFinite(v)) return v ?? null;
  const f = 10 ** n;
  return Math.round(v * f) / f;
}

// Merge this run's per-source results over the previous snapshot.
// Rules:
//  - a source that failed OR returned nothing keeps its previous stations (stale)
//  - a source that returned data replaces its previous stations
//  - within a returned set, a station missing a fresh value falls back to prev
export function mergeKeepLastGood(prevSnapshot, runResults) {
  const prevStations = (prevSnapshot?.stations) || [];
  const prevBySource = groupBy(prevStations, (s) => s.source);
  const prevById = new Map(prevStations.map((s) => [s.id, s]));

  const stations = [];
  const sources = [];

  for (const r of runResults) {
    const { adapter, ok, rows, error } = r;
    const prev = prevBySource.get(adapter.id) || [];

    if (!ok || rows.length === 0) {
      // carry previous, mark stale
      for (const s of prev) stations.push({ ...s, stale: true });
      sources.push({
        id: adapter.id, name: adapter.name, kind: adapter.kind,
        cadence: adapter.cadence, attribution: adapter.attribution, license: adapter.license,
        status: prev.length ? 'stale' : 'down',
        count: prev.length, error: error || null,
        fetched_at: prevSourceTime(prevSnapshot, adapter.id),
      });
      continue;
    }

    const fresh = rows.map((s) => {
      if (s.nhn == null && s.flur == null) {
        const p = prevById.get(s.id);
        if (p) return { ...p, ...s, nhn: p.nhn, flur: p.flur, measured_at: p.measured_at, stale: true };
      }
      return s;
    });
    stations.push(...fresh);
    sources.push({
      id: adapter.id, name: adapter.name, kind: adapter.kind,
      cadence: adapter.cadence, attribution: adapter.attribution, license: adapter.license,
      status: 'ok', count: fresh.length, error: null,
      fetched_at: new Date().toISOString(),
    });
  }

  return {
    generated_at: new Date().toISOString(),
    schema: 1,
    sources,
    stations,
  };
}

function prevSourceTime(snap, id) {
  const s = snap?.sources?.find((x) => x.id === id);
  return s?.fetched_at || null;
}
function groupBy(arr, key) {
  const m = new Map();
  for (const x of arr) { const k = key(x); (m.get(k) || m.set(k, []).get(k)).push(x); }
  return m;
}
