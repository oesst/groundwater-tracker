// Oberflächengewässer — PEGELONLINE (Wasserstraßen- und Schifffahrtsverwaltung
// des Bundes, WSV). Free, keyless REST API for the federal waterways gauges
// (large rivers + canals): 15-minute water levels plus each gauge's
// characteristic values (MNW/MW/MHW …).
//
//   https://www.pegelonline.wsv.de/webservices/rest-api/v2
//
// We keep only gauges that carry a MNW/MHW reference, so every shown point has a
// meaningful "vs. mean water" class; purely tidal/coastal gauges without that
// reference are skipped. Class + bar height come from the position of the
// current level inside the MNW–MHW band. A short-term tendency (rising/falling)
// is derived from the last few hours, since v2 exposes no trend field.

const BASE = 'https://www.pegelonline.wsv.de/webservices/rest-api/v2';
const STALE_HOURS = 24;
const TREND_WINDOW = 'PT6H';
const TREND_CONCURRENCY = 20;
const TREND_DEADBAND_CM = 1;

function classOf(value, cv) {
  const { MNW, MW, MHW, NW, HW } = cv;
  if (MNW == null || MHW == null || MHW <= MNW) return { cls: null, pct: null };
  const pct = Math.round(Math.max(0, Math.min(100, (100 * (value - MNW)) / (MHW - MNW))));
  let cls;
  if (value <= MNW)      cls = (NW != null && value <= NW + (MNW - NW) * 0.25) ? 'vlow' : 'low';
  else if (value >= MHW) cls = (HW != null && value >= MHW + (HW - MHW) * 0.5) ? 'vhigh' : 'high';
  else                   cls = 'normal';
  return { cls, pct };
}

async function trendOf(uuid) {
  try {
    const r = await fetch(`${BASE}/stations/${uuid}/W/measurements.json?start=${TREND_WINDOW}`);
    if (!r.ok) return null;
    const m = await r.json();
    if (!Array.isArray(m) || m.length < 2) return null;
    const d = m[m.length - 1].value - m[0].value;
    if (Math.abs(d) < TREND_DEADBAND_CM) return 'stable';
    return d > 0 ? 'rising' : 'falling';
  } catch { return null; }
}

export default {
  id: 'pegelonline',
  name: 'PEGELONLINE — Pegel an Bundeswasserstraßen (WSV)',
  kind: 'river',
  cadence: '15-Min-Wasserstand (WSV PEGELONLINE), Tendenz aus den letzten 6 h',
  attribution: 'Wasserstraßen- und Schifffahrtsverwaltung des Bundes (WSV), PEGELONLINE',
  license: 'PEGELONLINE (WSV) — freie Nutzung mit Quellenangabe',
  async fetch() {
    const url = `${BASE}/stations.json?includeTimeseries=true&includeCurrentMeasurement=true&includeCharacteristicValues=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`PEGELONLINE HTTP ${res.status}`);
    const st = await res.json();
    const now = Date.now();

    // keep gauges with a usable W current value, coords, and a MNW/MHW class
    const kept = [];
    for (const s of st) {
      const w = (s.timeseries || []).find((t) => t.shortname === 'W');
      const cm = w && w.currentMeasurement;
      if (!cm || !Number.isFinite(s.latitude) || !Number.isFinite(s.longitude)) continue;
      const cv = {};
      for (const c of (w.characteristicValues || [])) cv[c.shortname] = c.value;
      const { cls, pct } = classOf(cm.value, cv);
      if (!cls) continue;                               // no MNW/MHW reference -> skip
      kept.push({ s, cm, cls, pct });
    }

    // tendency, with limited concurrency
    const trends = new Array(kept.length).fill(null);
    let i = 0;
    const worker = async () => { while (i < kept.length) { const idx = i++; trends[idx] = await trendOf(kept[idx].s.uuid); } };
    await Promise.all(Array.from({ length: Math.min(TREND_CONCURRENCY, kept.length) }, worker));

    const out = kept.map(({ s, cm, cls, pct }, idx) => {
      const ageH = (now - Date.parse(cm.timestamp)) / 3600000;
      return {
        id: `pegel-${s.number || s.uuid}`,
        name: s.longname,
        state: (s.water && s.water.longname) || 'Gewässer',   // river name in the 'state' slot
        lat: +s.latitude.toFixed(5),
        lon: +s.longitude.toFixed(5),
        nhn: null, flur: null,
        pct, cls,
        trend: trends[idx],
        measured_at: cm.timestamp,
        stale: Number.isFinite(ageH) ? ageH > STALE_HOURS : true,
      };
    });
    if (!out.length) throw new Error('PEGELONLINE returned no usable gauges');
    return out;
  },
};
