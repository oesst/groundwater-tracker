// Normalisation of raw adapter output + keep-last-good merge across runs.

import { percentileFromQuantiles, classFromPercentile } from './percentile.js';

// A station is "stale" when its last reading is older than its source's update
// cadence (days) — independent of whether this run's fetch succeeded.
const STALE_DAYS = { pegelonline: 3, hh: 14, be: 14, by: 14, ni: 16, he: 45, bw: 75, nw: 120, gruvo: 75 };
const DEF_STALE_DAYS = 21;
function staleByAge(measured_at, sourceId) {
  if (!measured_at) return true;
  const days = (Date.now() - Date.parse(measured_at)) / 86400000;
  return days > (STALE_DAYS[sourceId] ?? DEF_STALE_DAYS);
}

// A raw station from an adapter should look like:
//   { id, name, state, lat, lon, nhn?, flur?, measured_at?, extra? }
// This turns it into the canonical schema the site consumes.
export function normalizeStation(raw, sourceId, refStats) {
  const ref = refStats && refStats[raw.id];
  // An adapter may compute its own percentile (e.g. from each station's own
  // history); prefer it. Otherwise derive from reference-stats when available.
  const pct = (raw.pct != null) ? raw.pct
            : (ref ? percentileFromQuantiles(raw.nhn, ref.q) : null);
  return {
    id: raw.id,
    name: raw.name,
    state: raw.state ?? null,
    lat: round(raw.lat, 5),
    lon: round(raw.lon, 5),
    nhn: raw.nhn ?? null,
    flur: raw.flur ?? null,
    pct,
    // Respect an adapter-supplied class (e.g. an authority's own status,
    // like LUBW's); otherwise derive it from the percentile.
    cls: raw.cls ?? classFromPercentile(pct),
    measured_at: raw.measured_at ?? null,
    // Short-term tendency for gauges that have one (PEGELONLINE rivers):
    // 'rising' | 'falling' | 'stable' | null.
    trend: raw.trend ?? null,
    // River kilometre (PEGELONLINE), used to order gauges along a river.
    km: (typeof raw.km === 'number') ? raw.km : null,
    // Per-station recency flag from the adapter (e.g. OpenHygrisC "latest
    // available" readings that are months old). mergeKeepLastGood also sets
    // this on carried-over stations from a failed run.
    stale: raw.stale ?? false,
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
      // carry previous; "stale" reflects the reading's age, not the fetch failure
      for (const s of prev) stations.push({ ...s, stale: staleByAge(s.measured_at, adapter.id) });
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
        // Only carry a previous meter value for sources that actually have one.
        // Class-only sources (Hessen, PEGELONLINE rivers) legitimately have
        // nhn/flur null and must NOT be frozen or marked stale here.
        if (p && (p.nhn != null || p.flur != null)) {
          return { ...p, ...s, nhn: p.nhn, flur: p.flur, measured_at: p.measured_at, stale: true };
        }
      }
      return s;
    });
    stations.push(...fresh.map((s) => ({ ...s, stale: staleByAge(s.measured_at, adapter.id) })));
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
