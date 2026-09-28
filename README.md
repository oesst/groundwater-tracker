# Grundwasser Deutschland

Nationwide German groundwater monitor. A **static site on GitHub Pages**, fed once a day by a
**GitHub Actions pipeline** that pulls each state's data, normalises it, and writes a single
`data/latest.json`. The browser only ever reads that file — no server, no CORS at request time.

- **Colour = Zustandsklasse** (sehr hoch … sehr niedrig)
- **Bar height = percentile** — where today's level sits within that well's own 1991–2020 range
  (the only measure comparable across stations; raw metres mostly draw topography)
- Metre values (m ü. NHN, Flurabstand) + "Stand" date shown per station on click

## How it works

```
GitHub Actions (daily cron)
        │  runs
        ▼
  fetch/run.js ── adapters/*.js ──▶ each state service (server-side, no CORS)
        │  normalise + percentile (vs data/reference-stats.json)
        │  merge KEEP-LAST-GOOD over previous snapshot
        ▼
  data/latest.json  ──commit──▶  repo  ──served by──▶  GitHub Pages ─▶ index.html + app.js
```

The Action **is** the server — it just runs once a day instead of per request. Groundwater updates
daily at best, so a daily build matches the data's real cadence; live per-visitor fetching would buy
nothing and reintroduce CORS.

## Deploy (≈5 minutes)

1. Push this repo to GitHub (see the commands your assistant gave you, or `git init && …`).
2. **Settings → Pages →** Build and deployment → **Deploy from a branch** → `main` / `/ (root)`.
3. **Settings → Actions → General →** allow workflows, and **Workflow permissions → Read and write**
   (the pipeline commits `data/latest.json` back).
4. **Actions → Fetch groundwater data → Run workflow** to populate immediately (or wait for 05:00 UTC).
5. Site is live at `https://<user>.github.io/<repo>/`. It renders straight away from the committed
   **seed** snapshot until the first real run.

`data/latest.json` and `data/reference-stats.json` are already committed (seed), so the site is never
blank. Regenerate the seed anytime with `npm run seed`.

## Data source status

| Adapter | State | Status | Real source |
|---|---|---|---|
| `by` | Bayern | **live** | GKD / LfU per-well `…/messwerte` (m ü. NHN, Flurabstand), daily |
| `be` | Berlin | **live** (needs master) | Wasserportal Berlin CSV API (`thema=gws`), daily |
| `bw` | Baden-Württemberg | scaffold | LUBW / UDO map viewer (no clean values API) |
| `nw` | Nordrhein-Westfalen | scaffold | ELWAS-WEB / LANUV |
| `ni` | Niedersachsen | scaffold | NLWKN |
| `pending.js` | 11 remaining states | scaffold | see file header (agency per state) |
| `gruvo` | (model layer) | scaffold | BGR serves tiles, not a public feature query |

**Reality of "all states":** German groundwater is federal — 16 separate portals. Only **Bavaria** and
**Berlin** publish current levels through a documented, machine-readable endpoint; both are wired here.
Most other states expose current values only via interactive map viewers (UDO/WMS) or monthly PDFs, so
each remaining adapter is a bespoke job that must be validated against the live service (which happens
when the Action runs — see `lib/geoservices.js` for WFS/ArcGIS helpers and `lib/csv.js` for CSV ones).

- **Bavaria** is wired end-to-end; `data/by.stations.json` seeds 8 confirmed wells (town-level coords —
  refine/expand via `npm run build:by-stations`).
- **Berlin** adapter is real, but needs its station master built once (`node scripts/build-stations-be.js`,
  then add coordinates). Until then it returns `[]` and keep-last-good leaves the map intact.
- The rest return `[]` until wired — per-source status shows them as "not yet wired", never breaking the build.

> First real run also validates Bavaria's HTML parse. If GKD changed its markup, only the three
> regexes in `adapters/by.js` need adjusting — everything downstream is untouched.

## Add / wire a state

1. Copy `adapters/by.js` (or a scaffold) to `adapters/<code>.js`.
2. In `fetch()`, hit that state's service **server-side** and return raw stations:
   `{ id, name, state, lat, lon, nhn?, flur?, measured_at? }`.
3. Register it in `adapters/index.js`.
4. Make sure each returned `id` has a matching entry in `data/reference-stats.json` so it gets a
   percentile (see below). Without it the station still shows its metre value, just no class.

## Reference baselines (percentiles)

`data/reference-stats.json` holds `{ "<id>": { "q": [p0,p10,…,p100] } }` per station — the 1991–2020
distribution used to rank today's value. Build it once from **GEMS-GER** (the nationwide 1991–2022
series BGR links from the GRUVO download page): `npm run build:refstats` (template in
`scripts/build-reference-stats.js`). It changes rarely, so it's committed and the daily job just reads it.

## Local preview

```bash
npm run seed      # (re)generate the demo snapshot
npm run serve     # http://localhost:8080  (don't open index.html via file://)
```

## Notes

- **Refresh:** daily build (`cron: '0 5 * * *'`, UTC, best-effort). The daily commit also keeps the
  scheduled workflow from being auto-disabled after 60 days of repo inactivity.
- **Free history:** git already versions `latest.json`, so you accumulate a daily national record for free.
- **Attribution / licensing:** each state carries its own source + licence (mostly DL-DE BY 2.0);
  these travel with the data (`sources[].attribution/license`) and are shown in the footer. GRUVO © BGR.
- Code: MIT (see `LICENSE`). Data licences belong to the respective providers.
