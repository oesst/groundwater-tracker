// Niedersachsen — NLWKN "Grundwasserstand online".
//
// NLWKN runs a documented public REST/JSON web service (the portal's own
// "Benutzerhandbuch Webservice"). One call returns every groundwater station
// WITH its current daily value and NLWKN's official status class — no scraping,
// no per-station calls. Updated daily (previous day's value drops at 00:00,
// current day usually available by ~06:00). Raw (unvalidated) data; validated
// series live at wasserdaten.niedersachsen.de.
//
//   GET {BASE}stammdaten/stationen/All?subscription-key={KEY}
//
// Response: an object whose (only) array property is the station list. Each
// groundwater station (Stationsart 3103) carries — field names verified against
// the portal's own client code:
//   STA_ID, STA_Nummer, Name
//   Longitude, Latitude           -> SWAPPED in the service: Longitude holds the
//                                    latitude value and Latitude the longitude
//                                    (documented quirk; confirmed in portal JS).
//   AktuellGrundwasserstandsklasse-> official status class (we use it for colour)
//   Parameter[].Datenspuren[]     -> { Gebernummer, AktuellerMesswert_Text (m NHN),
//                                      AktuellerMesswertNNM_Text (m u. GOK),
//                                      AktuellerMesswert_Zeitpunkt }
//     Gebernummer "1" = official production sensor (GEBER001).
//
// Colour uses NLWKN's OWN class (authoritative, like LUBW for BW). Bar height
// (pct) is a representative percentile derived from that class band, since this
// endpoint gives a class rather than a numeric percentile.
//
// Keys below are the portal's public webservice keys (published in its manual
// and client). Used server-side in CI; CORS only blocks browsers.

const BASE = 'https://bis.azure-api.net/PegelonlineNeu/REST/';
const KEY = '19094e54510d4e89b140ff2d3abf715f';
const URL_ALL = `${BASE}stammdaten/stationen/All?subscription-key=${KEY}`;

// NLWKN official class -> our scheme + a representative percentile for bar height.
const CLS = {
  'Höchstwert überschritten':   { cls: 'vhigh',  pct: 99 },
  'sehr hoch':                  { cls: 'vhigh',  pct: 92 },
  'hoch':                       { cls: 'high',   pct: 80 },
  'normal':                     { cls: 'normal', pct: 50 },
  'niedrig':                    { cls: 'low',    pct: 18 },
  'sehr niedrig':               { cls: 'vlow',   pct: 6  },
  'Niedrigstwert unterschritten': { cls: 'vlow', pct: 1 },
};

const num = (s) => {
  if (s == null) return null;
  const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

// Zeitpunkt may be epoch-ms, "DD.MM.YYYY[ HH:mm]", or ISO. -> ISO string or null.
function parseWhen(z) {
  if (z == null || z === 'Keine Daten') return null;
  const s = String(z).trim();
  if (/^\d{10,}$/.test(s)) { const d = new Date(+s); return isNaN(d) ? null : d.toISOString(); }
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) {
    const [, dd, mm, yy, hh = '00', mi = '00'] = m;
    return `${yy}-${mm}-${dd}T${hh}:${mi}:00`;
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

// Find the station array regardless of the wrapper property name.
function pickArray(j) {
  if (Array.isArray(j)) return j;
  if (j && typeof j === 'object') {
    if (Array.isArray(j.getStammdatenResult)) return j.getStammdatenResult;
    for (const k of Object.keys(j)) if (Array.isArray(j[k])) return j[k];
  }
  return [];
}

const STALE_DAYS = 14;  // NI is daily; flag anything not updated in ~2 weeks

export default {
  id: 'ni',
  name: 'Niedersachsen — NLWKN Grundwasserstand online',
  kind: 'state',
  cadence: 'täglich (Rohdaten), Abruf 2×/Woche',
  attribution: 'NLWKN, www.grundwasserstandonline.nlwkn.niedersachsen.de',
  license: 'DL-DE BY 2.0',
  async fetch() {
    const res = await fetch(URL_ALL, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error(`NLWKN HTTP ${res.status}`);
    const arr = pickArray(await res.json());
    if (!arr.length) throw new Error('NLWKN returned no stations');

    const now = Date.now();
    const out = [];
    for (const t of arr) {
      // groundwater wells only
      if (t.Stationsart != null && t.Stationsart !== 3103) continue;
      const klass = (t.AktuellGrundwasserstandsklasse || '').trim();
      // NLWKN swaps the coordinate fields (documented).
      const lat = num(t.Longitude), lon = num(t.Latitude);
      if (lat == null || lon == null) continue;
      if (!(lat > 51 && lat < 54.2 && lon > 6 && lon < 11.8)) continue;  // NI bounds

      // Across all official-sensor (Gebernummer "1") traces, take the latest reading.
      let best = null;
      for (const p of (t.Parameter || [])) {
        for (const d of (p.Datenspuren || [])) {
          if (String(d.Gebernummer) !== '1') continue;
          const when = parseWhen(d.AktuellerMesswert_Zeitpunkt);
          if (!when) continue;
          if (!best || when > best.when) {
            best = { when, nhn: num(d.AktuellerMesswert_Text), flur: num(d.AktuellerMesswertNNM_Text) };
          }
        }
      }

      const band = CLS[klass] || null;
      const nhn = best ? best.nhn : null;
      if (nhn == null && !band) continue;            // nothing usable
      const measured_at = best ? best.when : null;
      const ageDays = measured_at ? (now - Date.parse(measured_at)) / 86400000 : null;

      out.push({
        id: `ni-${t.STA_ID}`,
        name: t.Name || `GWM ${t.STA_Nummer || t.STA_ID}`,
        state: 'Niedersachsen',
        lat, lon,
        nhn,
        flur: best ? best.flur : null,
        pct: band ? band.pct : null,
        cls: band ? band.cls : null,              // NLWKN official class -> colour
        measured_at,
        stale: ageDays == null ? true : ageDays > STALE_DAYS,
      });
    }
    if (!out.length) throw new Error(`NLWKN: ${arr.length} rows but no usable GW stations (schema change?)`);
    return out;
  },
};
