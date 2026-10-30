// Baden-Württemberg — LUBW "Grundwasserstände und Quellschüttungen" (GuQ).
//
// The GuQ map app is backed by a clean JSON API on lupo-cloud.de:
//   stations:  https://lupo-cloud.de/guq-app/stations
//              -> { selectorStations: { items: [{label,id,lat,lon}] } }
//   station:   https://lupo-cloud.de/guq-app/station?id=<ID>
//              -> infopanel.station { sitename, locationname, location{lat,lon},
//                   type (330=Grundwasserstand, 3=Quellschüttung),
//                   class (1=niedrig, 2=mittel, 3=hoch, 0=keine Angabe),
//                   statistics.average{value,month,year}   // current monthly mean, m ü. NHN
//                   statistics.minMax{minValue,maxValue}   // over 1996..present }
//
// We keep only groundwater wells (type 330; springs report discharge in l/s, not
// a level). Colour (cls) uses LUBW's OWN official 3-class status. Bar-height pct is
// the current value's position within that well's observed 1996..present range.
// Verified against the live API 2026-10. Class legend text (LUBW template):
//   class 1 "niedrig", 2 "mittel", 3 "hoch".

import { getJSON, mapLimit } from '../lib/http.js';

const BASE = 'https://lupo-cloud.de/guq-app';
const CLASS = { 1: 'low', 2: 'normal', 3: 'high' };   // LUBW 3-class -> our scheme

async function fetchStation(s) {
  const d = await getJSON(`${BASE}/station?id=${encodeURIComponent(s.id)}`, { timeout: 20000, retries: 2 });
  const st = d && d.infopanel && d.infopanel.station;
  if (!st || st.type !== 330) return null;            // wells only; drop springs
  const stats = st.statistics || {};
  const av = stats.average || {}, mm = stats.minMax || {};
  const nhn = (typeof av.value === 'number') ? av.value : null;
  if (nhn == null) return null;
  let pct = null;
  if (typeof mm.minValue === 'number' && typeof mm.maxValue === 'number' && mm.maxValue > mm.minValue) {
    pct = Math.max(0, Math.min(100, +(100 * (nhn - mm.minValue) / (mm.maxValue - mm.minValue)).toFixed(1)));
  }
  const loc = st.location || {};
  const lat = Number.isFinite(loc.lat) ? loc.lat : s.lat;
  const lon = Number.isFinite(loc.lon) ? loc.lon : s.lon;
  const measured_at = (av.year && av.month)
    ? `${av.year}-${String(av.month).padStart(2, '0')}-01` : null;
  const name = [st.sitename, st.locationname].filter(Boolean).join(', ') || st.longname || `GWM ${s.id}`;
  return {
    id: `bw-${s.id}`, name, state: 'Baden-Württemberg',
    lat, lon, nhn, flur: null,
    pct, cls: CLASS[st.class] || null,
    measured_at,
  };
}

export default {
  id: 'bw',
  name: 'Baden-Württemberg — LUBW (GuQ)',
  kind: 'state',
  cadence: 'monatlich (Monatsmittel), tägl. Pegel an Teilmessnetz',
  attribution: 'LUBW Landesanstalt für Umwelt Baden-Württemberg (GuQ)',
  license: 'DL-DE BY 2.0',
  async fetch() {
    const top = await getJSON(`${BASE}/stations`, { timeout: 20000, retries: 2 });
    const items = (top && top.selectorStations && top.selectorStations.items) || [];
    if (!items.length) return [];
    const out = await mapLimit(items, 8, (s) => fetchStation(s));
    return out.filter((r) => r && !r.__error && r.nhn != null);
  },
};
