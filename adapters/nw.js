// Nordrhein-Westfalen — LANUV, ELWAS-WEB.
// Real source: ELWAS groundwater measuring points + level series (WFS/REST).
// TODO: fill in the ELWAS service endpoint + fields. Returns [] until wired.

export default {
  id: 'nw',
  name: 'Nordrhein-Westfalen — ELWAS / LANUV',
  kind: 'state',
  cadence: 'wöchentlich',
  attribution: 'LANUV NRW, ELWAS-WEB',
  license: 'DL-DE BY 2.0',
  async fetch() {
    // TODO: ELWAS WFS GetFeature -> map to raw stations.
    return [];
  },
};
