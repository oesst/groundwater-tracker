// Berlin — Wasserportal Berlin (SenMVKU). Documented open API, updated daily.
//   API doc: https://wasserportal.berlin.de/download/wasserportal_berlin_getting_data.pdf
//
// Groundwater level ("Grundwasserstand"):
//   overview of all GW stations:
//     https://wasserportal.berlin.de/start.php?anzeige=tabelle_gw&messanzeige=ms_gw_berlin
//   per-station daily-mean CSV:
//     https://wasserportal.berlin.de/station.php?anzeige=d&station=<ID>&thema=gws&sreihe=tw&smode=c
//
// This adapter reads a station master (data/be.stations.json: id, name, lat, lon)
// and fetches each station's latest daily value. Build/refresh the master from the
// overview with `node scripts/build-stations-be.js` (parses the overview table).
//
// NOTE to confirm on first live run: the value column's datum for Berlin GW series
// (m ü. NHN vs. depth). It is mapped to `nhn` here; flip to `flur` if the portal
// reports depth for a given station set.

import { readFile } from 'node:fs/promises';
import { getText, deDate, mapLimit } from '../lib/http.js';
import { parseCsv, lastNumericRow } from '../lib/csv.js';

const BASE = 'https://wasserportal.berlin.de';

async function loadStations() {
  try {
    const url = new URL('../data/be.stations.json', import.meta.url);
    const j = JSON.parse(await readFile(url, 'utf8'));
    // only stations that have coordinates can be mapped
    return (j.stations || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  } catch { return []; }
}

async function fetchLatest(st) {
  const url = `${BASE}/station.php?anzeige=d&station=${encodeURIComponent(st.id)}&thema=gws&sreihe=tw&smode=c`;
  const csv = await getText(url, { timeout: 20000, retries: 2 });
  const rows = parseCsv(csv);
  const last = lastNumericRow(rows, { dateCol: 0, valueCol: 1 });
  if (!last) throw new Error(`no value for BE station ${st.id}`);
  return {
    id: `be-${st.id}`, name: st.name || `Messstelle ${st.id}`, state: 'Berlin',
    lat: st.lat, lon: st.lon, nhn: last.value, flur: null, measured_at: deDate(last.date),
  };
}

export default {
  id: 'be',
  name: 'Berlin — Wasserportal (SenMVKU)',
  kind: 'state',
  cadence: 'tagesaktuell (Tagesmittel)',
  attribution: 'Wasserportal Berlin, SenMVKU',
  license: 'DL-DE BY 2.0',
  async fetch() {
    const stations = await loadStations();
    if (!stations.length) return []; // master not built yet -> keep-last-good handles it
    const out = await mapLimit(stations, 6, (st) => fetchLatest(st));
    return out.filter((r) => r && !r.__error && r.nhn != null);
  },
};
