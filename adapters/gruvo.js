// BGR GRUVO — national monthly groundwater-state layer.
//
// GRUVO ("Grundwasserstand-Online", Bundesanstalt für Geowissenschaften und
// Rohstoffe) publishes a nationwide monthly groundwater class per well, backed
// by a public ArcGIS REST service. We use it to FILL THE STATES THAT HAVE NO
// live state adapter yet — one source, national coverage, instead of 10 more
// bespoke portals. Where a state already has its own (fresher) network, GRUVO
// is suppressed, so there is no double-coverage (see WIRED below).
//
// Service (the version suffix rotates, e.g. v107 -> v109 -> …, so we discover
// the current one from the folder listing and fall back to a known-good value):
//   https://services.bgr.de/agswa/rest/services/grundwasser/<version>/MapServer
//     layer 3 = "Clustermessstellen" (dense national set; layer 2 = 119 sparse
//               reference wells). Field state_now_c = current monthly class:
//                 1 sehr niedrig · 2 niedrig · 3 normal · 4 hoch · 5 sehr hoch
//     well_id is prefixed with the Bundesland code (e.g. "BB_27381011").
//     geometry returned as WGS84 (outSR=4326); step_date = month (epoch ms).
//
// This is a MONTHLY, partly modelled layer — coarser than the state networks —
// so values carry the month's step_date and are flagged stale past ~45 days.

const FOLDER = 'https://services.bgr.de/agswa/rest/services/grundwasser';
const FALLBACK_VERSION = 'gruvo_v109_short';
const LAYER = 3;

// Two-letter Bundesland prefixes that ALREADY have a dedicated adapter — GRUVO
// skips these to avoid overlapping a state's own network. Update when adding a
// state adapter.
const WIRED = new Set(['BY', 'BE', 'BW', 'NW', 'NI', 'HE']);

const STATE = {
  BB: 'Brandenburg', BE: 'Berlin', BW: 'Baden-Württemberg', BY: 'Bayern',
  HB: 'Bremen', HE: 'Hessen', HH: 'Hamburg', MV: 'Mecklenburg-Vorpommern',
  NI: 'Niedersachsen', NW: 'Nordrhein-Westfalen', RP: 'Rheinland-Pfalz',
  SH: 'Schleswig-Holstein', SL: 'Saarland', SN: 'Sachsen',
  ST: 'Sachsen-Anhalt', TH: 'Thüringen',
};

const CLS = {
  1: { cls: 'vlow',   pct: 5  },
  2: { cls: 'low',    pct: 18 },
  3: { cls: 'normal', pct: 50 },
  4: { cls: 'high',   pct: 80 },
  5: { cls: 'vhigh',  pct: 95 },
};

const STALE_DAYS = 45;  // monthly layer

async function discoverVersion() {
  try {
    const r = await fetch(`${FOLDER}?f=json`);
    const j = await r.json();
    const svcs = (j.services || [])
      .map((s) => s.name)
      .filter((n) => /gruvo_v\d+_short$/.test(n));
    if (svcs.length) {
      svcs.sort((a, b) => (+a.match(/v(\d+)/)[1]) - (+b.match(/v(\d+)/)[1]));
      return svcs[svcs.length - 1].split('/').pop();
    }
  } catch { /* fall back */ }
  return FALLBACK_VERSION;
}

// Attribute keys come back fully-qualified (schema.table.field); resolve the
// ones we need by suffix so a schema rename doesn't silently break us.
function keyResolver(attrs) {
  const keys = Object.keys(attrs);
  const find = (suffix) => keys.find((k) => k === suffix || k.endsWith('.' + suffix)) || null;
  return {
    well_id: find('well_id'),
    well_name: find('well_name'),
    state_now_c: find('state_now_c'),
    step_date: find('step_date'),
  };
}

export default {
  id: 'gruvo',
  name: 'BGR GRUVO — Monatswert (Länder ohne eigenes Messnetz)',
  kind: 'model',
  cadence: 'Monatswert (BGR GRUVO), nur Länder ohne eigenen Adapter',
  attribution: 'Bundesanstalt für Geowissenschaften und Rohstoffe (BGR), GRUVO',
  license: '© BGR (GRUVO)',
  async fetch() {
    const version = await discoverVersion();
    const base = `${FOLDER}/${version}/MapServer/${LAYER}/query`;
    const now = Date.now();
    const out = [];
    let offset = 0, pages = 0, K = null;

    for (;;) {
      const url = `${base}?where=1%3D1&outFields=*&outSR=4326&returnGeometry=true`
        + `&f=json&resultOffset=${offset}&resultRecordCount=2000`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`GRUVO HTTP ${res.status} (version ${version})`);
      const j = await res.json();
      if (j.error) throw new Error(`GRUVO query error: ${JSON.stringify(j.error)}`);
      const feats = j.features || [];
      if (!feats.length) break;
      if (!K) K = keyResolver(feats[0].attributes);
      if (!K.well_id || !K.state_now_c) throw new Error('GRUVO: expected fields not found (schema change?)');

      for (const ft of feats) {
        const a = ft.attributes, g = ft.geometry || {};
        const id = a[K.well_id];
        if (!id) continue;
        const pre = String(id).slice(0, 2);
        if (WIRED.has(pre)) continue;                 // state has its own adapter
        const band = CLS[a[K.state_now_c]];
        if (!band) continue;
        const lon = g.x, lat = g.y;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (!(lat > 47 && lat < 55.5 && lon > 5.5 && lon < 15.5)) continue;
        const ts = K.step_date ? a[K.step_date] : null;
        const measured_at = (typeof ts === 'number') ? new Date(ts).toISOString() : null;
        const ageDays = (typeof ts === 'number') ? (now - ts) / 86400000 : null;
        out.push({
          id: `gruvo-${id}`,
          name: (a[K.well_name] || id).toString().trim(),
          state: STATE[pre] || 'Deutschland',
          lat: +lat.toFixed(5),
          lon: +lon.toFixed(5),
          nhn: null,
          flur: null,
          pct: band.pct,
          cls: band.cls,                              // BGR GRUVO monthly class -> colour
          measured_at,
          stale: ageDays == null ? false : ageDays > STALE_DAYS,
        });
      }
      pages++;
      if (!j.exceededTransferLimit) break;
      offset += feats.length;
      if (pages > 20) break;                          // safety
    }

    if (!out.length) throw new Error('GRUVO returned no usable stations');
    return out;
  },
};
