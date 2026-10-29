// Berlin — Wasserportal Berlin (SenMVKU). Documented open API, updated daily.
//   API doc: https://wasserportal.berlin.de/download/wasserportal_berlin_getting_data.pdf
//
// Groundwater level ("Grundwasserstand"), per-station CSV (Einzelwerte):
//   https://wasserportal.berlin.de/station.php?anzeige=d&station=<ID>&thema=gws
//        &sreihe=ew&smode=c&exportthema=gw&nstoffid=0&nstoffid2=0
// CSV: ';'-separated, German decimals, a metadata header block, then rows
//   "DD.MM.YYYY;<value>". Value is the groundwater level in m ü. NHN (verified
//   vs GOK). Flurabstand is derived as GOK - NHN using the GOK in the master.
//
// Percentile: computed here from each well's OWN history against the 1991-2020
// baseline (falls back to the full series when that window is thin), so Berlin
// needs no separate reference-stats file. normalize() keeps an adapter-supplied
// pct as-is.
//
// Station master: data/be.stations.json (283 daily 'tagesaktuell' wells with
// WGS84 coords + GOK). Refresh/expand via scripts/build-stations-be.js.

import { readFile } from 'node:fs/promises';
import { getText, deNum, deDate, mapLimit } from '../lib/http.js';
import { quantiles11, percentileFromQuantiles } from '../lib/percentile.js';

const BASE = 'https://wasserportal.berlin.de';
const RE_ROW = /^(\d{2})\.(\d{2})\.(\d{4});\s*(-?\d+(?:,\d+)?)\s*$/;

async function loadStations() {
  try {
    const url = new URL('../data/be.stations.json', import.meta.url);
    const j = JSON.parse(await readFile(url, 'utf8'));
    return (j.stations || []).filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  } catch { return []; }
}

async function fetchLatest(st) {
  const url = `${BASE}/station.php?anzeige=d&station=${encodeURIComponent(st.id)}`
            + `&thema=gws&sreihe=ew&smode=c&exportthema=gw&nstoffid=0&nstoffid2=0`;
  const csv = await getText(url, { timeout: 20000, retries: 2 });

  const series = [];               // {year, value}
  let last = null;                 // newest row
  for (const line of csv.split(/\r?\n/)) {
    const m = line.trim().match(RE_ROW);
    if (!m) continue;
    const value = deNum(m[4]);
    if (value == null) continue;
    const year = +m[3];
    series.push({ year, value });
    last = { date: `${m[1]}.${m[2]}.${m[3]}`, value };
  }
  if (!last) throw new Error(`no value for BE station ${st.id}`);

  // percentile vs 1991-2020 baseline (fallback: full series)
  let ref = series.filter((v) => v.year >= 1991 && v.year <= 2020).map((v) => v.value);
  if (ref.length < 24) ref = series.map((v) => v.value);
  const q = quantiles11(ref);
  const pct = q ? percentileFromQuantiles(last.value, q) : null;

  const nhn = last.value;
  const flur = Number.isFinite(st.gok) ? +(st.gok - nhn).toFixed(2) : null;
  return {
    id: `be-${st.id}`, name: st.name || `Messstelle ${st.id}`, state: 'Berlin',
    lat: st.lat, lon: st.lon, nhn, flur, pct, measured_at: deDate(last.date),
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
    if (!stations.length) return [];
    const out = await mapLimit(stations, 8, (st) => fetchLatest(st));
    return out.filter((r) => r && !r.__error && r.nhn != null);
  },
};
