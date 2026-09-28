// Niedersachsen — NLWKN (Grundwasserstandsdaten online).
// Real source: NLWKN groundwater portal (station list + level series).
// TODO: fill in the service endpoint + fields. Returns [] until wired.

export default {
  id: 'ni',
  name: 'Niedersachsen — NLWKN',
  kind: 'state',
  cadence: 'einige Tage',
  attribution: 'NLWKN Niedersachsen',
  license: 'DL-DE BY 2.0',
  async fetch() {
    // TODO: NLWKN service -> map to raw stations.
    return [];
  },
};
