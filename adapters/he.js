// Hessen — HLNUG "Messdatenportal" (Grundwasserstände DFÜ).
//
// HLNUG's public measurement portal is backed by a plain JSON API (no key):
//   https://app.hlnug-hessen.de/json/grdw/getThemeStations/10/106
//     10  = theme id "Grundwasserstände (DFÜ)"   (type "grdw")
//     106 = standard parameter "Grundwasserstand"
// One call returns every telemetered (DFÜ) groundwater station with its CURRENT
// status class. Because only DFÜ stations are published here, every value is
// genuinely near-real-time (unlike NRW's manually-read network).
//
// Each station carries HLNUG's official status class in `situation.situation`,
// a percentile class vs the 1991–2020 reference period (verified in the portal's
// own grdw theme module):
//   1 = sehr niedrig (<10th pct)   2 = niedrig (10–25)   3 = mittel/normal
//   4 = hoch (75–90)               5 = sehr hoch (>90)   0 = kein Wert (skip)
// We use that class for colour (authoritative, like LUBW/NLWKN) and a
// representative percentile for bar height. This endpoint returns a class, not a
// numeric level, so nhn/flur are left null (the per-station value endpoint would
// need one call per station; the class is the headline signal for the map).
//
// `situation.tstamp` is the reading time (Unix seconds) -> measured_at.
// Fields verified live 2026-11: lon/lat are plain WGS84 strings (not swapped).

const URL_ALL = 'https://app.hlnug-hessen.de/json/grdw/getThemeStations/10/106?tformat=d.m.Y%20h:i';

// HLNUG situation class -> our scheme + representative percentile (bar height).
const CLS = {
  1: { cls: 'vlow',   pct: 5  },   // sehr niedrig
  2: { cls: 'low',    pct: 18 },   // niedrig
  3: { cls: 'normal', pct: 50 },   // mittel
  4: { cls: 'high',   pct: 80 },   // hoch
  5: { cls: 'vhigh',  pct: 95 },   // sehr hoch
};

const STALE_DAYS = 21;  // DFÜ stations report at least weekly

export default {
  id: 'he',
  name: 'Hessen — HLNUG Messdatenportal',
  kind: 'state',
  cadence: 'DFÜ (nahezu echtzeit), Abruf 2×/Woche',
  attribution: 'HLNUG — Hessisches Landesamt für Naturschutz, Umwelt und Geologie',
  license: 'HLNUG (Nutzung mit Quellenangabe)',
  async fetch() {
    const res = await fetch(URL_ALL, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`HLNUG HTTP ${res.status}`);
    const arr = await res.json();
    if (!Array.isArray(arr) || !arr.length) throw new Error('HLNUG returned no stations');

    const now = Date.now();
    const out = [];
    for (const x of arr) {
      const sit = x.situation && x.situation.situation;
      const band = CLS[sit];
      if (!band) continue;                           // 0 / unclassified -> skip
      const lat = parseFloat(x.lat), lon = parseFloat(x.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!(lat > 49 && lat < 51.8 && lon > 7.5 && lon < 10.4)) continue;  // Hessen bounds
      const ts = x.situation && x.situation.tstamp;
      const measured_at = ts ? new Date(ts * 1000).toISOString() : null;
      const ageDays = ts ? (now - ts * 1000) / 86400000 : null;
      out.push({
        id: `he-${x.stationId}`,
        name: x.displayName || `GWM ${x.stationId}`,
        state: 'Hessen',
        lat: +lat.toFixed(5),
        lon: +lon.toFixed(5),
        nhn: null,
        flur: null,
        pct: band.pct,
        cls: band.cls,                               // HLNUG official class -> colour
        measured_at,
        stale: ageDays == null ? true : ageDays > STALE_DAYS,
      });
    }
    if (!out.length) throw new Error(`HLNUG: ${arr.length} rows but no usable GW stations (schema change?)`);
    return out;
  },
};
