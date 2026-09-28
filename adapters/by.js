// Bavaria — Gewässerkundlicher Dienst (GKD) / Bayerisches Landesamt für Umwelt.
//
// Data access: each well has a stable summary page
//   https://www.gkd.bayern.de{path}/messwerte
// which shows the latest daily mean as
//   Grundwasserstand [m ü. NN]: 510,57   Flurabstand [m u. Gelände]: 5,34
//   Letzter Messwert vom 04.06.2026 10:00
// We fetch that page server-side (in the Action, so no browser CORS) and parse
// those three values. Station coordinates come from data/by.stations.json.
//
// Verified against page structure 2026-09. If GKD changes the markup, only the
// three regexes below need updating — everything downstream is untouched, and
// keep-last-good means a parse miss degrades gracefully instead of blanking BY.

import { readFile } from 'node:fs/promises';
import { getText, deNum, deDate, mapLimit } from '../lib/http.js';

const BASE = 'https://www.gkd.bayern.de';

const RE_NHN  = /m\s*ü\.?\s*NN[^\d\-]{0,60}(-?\d{1,4},\d+)/i;
const RE_FLUR = /Flurabstand[^\d\-]{0,80}(-?\d{1,3},\d+)/i;
const RE_DATE = /Letzter\s+Messwert\s+vom[\s\S]{0,60}?(\d{2}\.\d{2}\.\d{4}(?:[\s\S]{0,12}?\d{2}:\d{2})?)/i;

async function loadStations() {
  const url = new URL('../data/by.stations.json', import.meta.url);
  const j = JSON.parse(await readFile(url, 'utf8'));
  return j.stations || [];
}

async function fetchStation(st) {
  const html = await getText(`${BASE}${st.path}/messwerte`, { timeout: 20000, retries: 2 });
  const nhn  = deNum((html.match(RE_NHN)  || [])[1]);
  const flur = deNum((html.match(RE_FLUR) || [])[1]);
  const when = deDate((html.match(RE_DATE) || [])[1]);
  if (nhn == null && flur == null) throw new Error(`no values parsed for ${st.id}`);
  return {
    id: st.id, name: st.name, state: 'Bayern',
    lat: st.lat, lon: st.lon,
    nhn, flur, measured_at: when,
  };
}

export default {
  id: 'by',
  name: 'Bayern — GKD / LfU',
  kind: 'state',
  cadence: 'täglich (Tagesmittel, telemetrisch)',
  attribution: 'Bayerisches Landesamt für Umwelt (LfU), gkd.bayern.de',
  license: 'Nutzungsbedingungen LfU / DL-DE BY 2.0',
  async fetch() {
    const stations = await loadStations();
    const results = await mapLimit(stations, 6, (st) => fetchStation(st));
    // drop failed wells; keep-last-good will backfill from the previous snapshot
    return results.filter((r) => r && !r.__error && (r.nhn != null || r.flur != null));
  },
};
