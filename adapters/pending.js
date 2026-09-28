// The remaining states + the GRUVO model layer, as documented pending adapters.
// Each returns [] (non-fatal) until its real service is wired. Split any of
// these into its own file (like by.js / be.js) when you implement it.
//
// Where the current groundwater actually lives, per service (so wiring is a
// lookup, not a hunt). Most of these are interactive map viewers (UDO/WMS) or
// monthly PDFs rather than clean data APIs — expect per-state reverse-engineering
// plus a live test run to confirm field names.
//   SH  LLUR — Umwelt-/Wasserportal Schleswig-Holstein
//   HH  BUKEA — Wasserportal / Geoportal Hamburg
//   HB  SUKW Bremen
//   MV  LUNG Mecklenburg-Vorpommern
//   BB  LfU Brandenburg — Landesgrundwasserdienst (Kartenviewer)
//   ST  LHW Sachsen-Anhalt — Gewässerkundlicher Landesdienst
//   SN  LfULG Sachsen — iDA / Wasserportal Sachsen
//   TH  TLUBN Thüringen
//   HE  HLNUG — "Grundwasser online" (Grundwasserportal Hessen)
//   RP  LfU Rheinland-Pfalz — Wasserportal / Geodaten
//   SL  LUA Saarland
//   GRUVO  BGR — served as map tiles (ArcGIS export), not a public feature query;
//          for the national monthly 5-class layer, revisit if BGR exposes a
//          queryable FeatureServer, or ingest the published forecast ZIPs.

function pending(id, name, opts = {}) {
  return {
    id, name,
    kind: opts.kind || 'state',
    cadence: opts.cadence || 'unbekannt',
    attribution: opts.attribution || name,
    license: opts.license || 'siehe Landesdienst',
    async fetch() { return []; },
  };
}

export default [
  pending('sh', 'Schleswig-Holstein — LLUR'),
  pending('hh', 'Hamburg — BUKEA'),
  pending('hb', 'Bremen — SUKW'),
  pending('mv', 'Mecklenburg-Vorpommern — LUNG'),
  pending('bb', 'Brandenburg — LfU'),
  pending('st', 'Sachsen-Anhalt — LHW'),
  pending('sn', 'Sachsen — LfULG'),
  pending('th', 'Thüringen — TLUBN'),
  pending('he', 'Hessen — HLNUG'),
  pending('rp', 'Rheinland-Pfalz — LfU'),
  pending('sl', 'Saarland — LUA'),
  pending('gruvo', 'BGR GRUVO — Monatsklasse', {
    kind: 'model', cadence: 'monatlich',
    attribution: '© BGR (GRUVO)', license: 'siehe BGR',
  }),
];
