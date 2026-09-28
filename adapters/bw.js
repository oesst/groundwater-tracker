// Baden-Württemberg — LUBW (Landesanstalt für Umwelt).
// Real source: LUBW groundwater level data via the UDO / environmental data
// service (INSPIRE WFS + measured series). TODO: fill in the WFS typename and
// the level/timestamp fields, then map to the raw-station shape below.
//
// Until wired, this returns [] — the pipeline's keep-last-good + per-source
// status make that safe (BW simply shows as "not yet wired" rather than erroring).

export default {
  id: 'bw',
  name: 'Baden-Württemberg — LUBW',
  kind: 'state',
  cadence: 'täglich–wöchentlich',
  attribution: 'LUBW Landesanstalt für Umwelt Baden-Württemberg',
  license: 'DL-DE BY 2.0',
  async fetch() {
    // TODO: fetch LUBW groundwater stations + latest values, e.g.
    //   const gj = await getJSON(`${WFS}?service=WFS&request=GetFeature&typeNames=...&outputFormat=application/json`);
    //   return gj.features.map(f => ({ id:'bw-'+..., name, state:'Baden-Württemberg',
    //                                  lat, lon, nhn, flur, measured_at }));
    return [];
  },
};
