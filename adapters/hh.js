// Hamburg — BUKEA "Grundwassermessstellen" (Geoportal Hamburg / OGC API Features).
//
// Hamburg publishes its groundwater monitoring network as a clean OGC API
// Features (GeoJSON) dataset — the richest city-state source: current daily
// value, metres above NHN, Flurabstand, AND an official percentile class.
//
//   https://api.hamburg.de/datasets/v1/grundwassermessstellen
//     collection "grundwassermessstellen" — the full daily time series
//     (~195k rows). We take the latest reading per station by sorting the
//     collection descending on datum_as_date and keeping each station's first
//     (newest) row. 41 stations, telemetered daily (verified 2026-11).
//
// Per feature: messstellennummer, messstellenbezeichnung, wasserstand_mnhn
// (m ü. NHN), wasserstand_mugok (Flurabstand), klassifikation_gwstand (official
// percentile class, e.g. "sehr niedrig (<5 bis 10 Perzentil)"), datum_as_date,
// geometry (WGS84). Colour uses Hamburg's own class (authoritative); bar height
// is a representative percentile for that band. Stations without a class ("-")
// are kept with their metre values but render uncoloured.

const BASE = 'https://api.hamburg.de/datasets/v1/grundwassermessstellen'
           + '/collections/grundwassermessstellen/items';
const STALE_DAYS = 14;  // daily network

// Official class label -> our scheme + representative percentile.
function classOf(s) {
  s = (s || '').toLowerCase();
  if (s.includes('sehr niedrig')) return { cls: 'vlow',   pct: 5  };
  if (s.includes('sehr hoch'))    return { cls: 'vhigh',  pct: 95 };
  if (s.includes('niedrig'))      return { cls: 'low',    pct: 18 };
  if (s.includes('hoch'))         return { cls: 'high',   pct: 80 };
  if (s.includes('normal') || s.includes('mittel')) return { cls: 'normal', pct: 50 };
  return { cls: null, pct: null };   // "-" = no classification
}
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v)) ? v : null;

export default {
  id: 'hh',
  name: 'Hamburg — BUKEA (Geoportal Hamburg)',
  kind: 'state',
  cadence: 'täglich (Tagesmittel), Abruf 2×/Woche',
  attribution: 'Freie und Hansestadt Hamburg (BUKEA), Geoportal Hamburg',
  license: 'DL-DE BY 2.0',
  async fetch() {
    // Sorted newest-first; 500 rows covers ~12 days × 41 stations, so every
    // station's latest reading is its first occurrence even with a few days lag.
    const res = await fetch(`${BASE}?f=json&limit=500&sortby=-datum_as_date`,
      { headers: { Accept: 'application/geo+json,application/json' } });
    if (!res.ok) throw new Error(`Hamburg OAF HTTP ${res.status}`);
    const j = await res.json();
    const feats = j.features || [];
    if (!feats.length) throw new Error('Hamburg OAF returned no features');

    const now = Date.now();
    const seen = new Set();
    const out = [];
    for (const ft of feats) {
      const p = ft.properties || {}, g = ft.geometry || {};
      const num = p.messstellennummer;
      if (num == null || seen.has(num)) continue;        // keep latest row per station
      seen.add(num);
      const c = g.coordinates || [];
      const lon = +c[0], lat = +c[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const band = classOf(p.klassifikation_gwstand);
      const d = (p.datum_as_date || '').slice(0, 10);
      const measured_at = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d + 'T00:00:00' : null;
      const ageDays = measured_at ? (now - Date.parse(measured_at)) / 86400000 : null;
      out.push({
        id: `hh-${num}`,
        name: (p.messstellenbezeichnung || `GWM ${num}`).toString().trim(),
        state: 'Hamburg',
        lat: +lat.toFixed(5),
        lon: +lon.toFixed(5),
        nhn: numOrNull(p.wasserstand_mnhn),
        flur: numOrNull(p.wasserstand_mugok),
        pct: band.pct,
        cls: band.cls,                                   // Hamburg official class -> colour
        measured_at,
        stale: ageDays == null ? true : ageDays > STALE_DAYS,
      });
    }
    if (!out.length) throw new Error('Hamburg: no usable stations (schema change?)');
    return out;
  },
};
