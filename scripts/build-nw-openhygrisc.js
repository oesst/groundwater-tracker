// Rebuild data/nw.levels.json from OpenHygrisC "Grundwasserstaende" (NRW, DL-DE Zero).
//   node scripts/build-nw-openhygrisc.js
//
// NRW has no stable live API (see adapters/nw.js). This regenerates the committed
// snapshot the adapter reads, from the state's bulk open-data export. It must run
// where opengeodata.nrw.de is reachable (GitHub Actions runners are) — NOT from
// the egress-restricted dev containers.
//
// The water-level export is a ~256 MB DEFLATE zip whose single CSV inflates to
// several GB, so we never hold it in memory: stream the download to a temp file,
// then stream-inflate it through readline. For each telemetered, publicly-released
// well in data/nw.stations.json we keep the latest available reading and compute
// its percentile within that well's own 2020..present distribution.
//
// Output rows: { id, name, lat, lon, nhn, flur, pct, measured_at }
//   nhn  = wasserstand, m ue. NHN            flur = flurabstand, m
//   pct  = empirical percentile (0..100) of the latest value in the well's series
//   measured_at = YYYY-MM-DD of that latest reading
//
// NOTE: "latest available" is per station and can be months/years old — the
// adapter flags stale readings and the frontend shows each one's date.

import { writeFile, readFile, open, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import readline from 'node:readline';
import zlib from 'node:zlib';
import os from 'node:os';
import path from 'node:path';

const URL_ZIP = 'https://www.opengeodata.nrw.de/produkte/umwelt_klima/wasser/grundwasser/'
              + 'hygrisc/OpenHygrisC_gw-wasserstand_2020-2029_EPSG25832_CSV.zip';
const STATIONS = new URL('../data/nw.stations.json', import.meta.url);
const OUT = new URL('../data/nw.levels.json', import.meta.url);

// Quality filter (drops mining/artesian outliers and thin series).
const ok = (nhn, flur, n) =>
  Number.isFinite(nhn) && nhn >= -5 && nhn < 1200 &&
  Number.isFinite(flur) && flur >= 0 && flur <= 80 && n >= 30;

async function main() {
  const master = JSON.parse(await readFile(STATIONS, 'utf8'));
  const meta = new Map();                         // id -> {name,lat,lon}
  for (const s of (master.stations || [])) meta.set(String(s.id), s);
  if (!meta.size) throw new Error('no stations in nw.stations.json');

  // 1. stream the zip to a temp file
  const tmp = path.join(os.tmpdir(), `nw-wstd-${Date.now()}.zip`);
  const res = await fetch(URL_ZIP);
  if (!res.ok) throw new Error('download failed: HTTP ' + res.status);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));

  // 2. parse the local file header to find the compressed-data offset + method
  const fh = await open(tmp, 'r');
  const head = Buffer.alloc(64);
  await fh.read(head, 0, 64, 0);
  await fh.close();
  if (head.readUInt32LE(0) !== 0x04034b50) { await rm(tmp, { force: true }); throw new Error('not a zip'); }
  const method = head.readUInt16LE(8);
  const nameLen = head.readUInt16LE(26), extraLen = head.readUInt16LE(28);
  const dataOffset = 30 + nameLen + extraLen;

  // 3. stream-inflate the single entry and parse CSV line by line
  const src = createReadStream(tmp, { start: dataOffset });
  const stream = method === 0 ? src : src.pipe(zlib.createInflateRaw());
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let IDX = null, cId, cDate, cLvl, cFlur;
  const series = new Map();                        // id -> [{date, nhn, flur}]
  for await (const line of rl) {
    if (!IDX) {                                    // header row
      const H = line.split(';').map((x) => x.trim());
      IDX = H;
      cId = H.indexOf('messstelle_id');
      cDate = H.indexOf('datum_messung');
      cLvl = H.findIndex((h) => /wasserstand/i.test(h) && !/messstelle/i.test(h));
      cFlur = H.findIndex((h) => /flurabstand/i.test(h));
      if (cId < 0) cId = 1;
      if (cDate < 0) cDate = 3;
      if (cLvl < 0) cLvl = 6;
      if (cFlur < 0) cFlur = 7;
      console.log(`columns: id=${cId} date=${cDate} level=${cLvl} flur=${cFlur}`);
      continue;
    }
    const r = line.split(';');
    const id = (r[cId] || '').trim();
    if (!meta.has(id)) continue;                   // only our telemetered wells
    const nhn = parseFloat((r[cLvl] || '').replace(',', '.'));
    if (!Number.isFinite(nhn)) continue;
    const flur = parseFloat((r[cFlur] || '').replace(',', '.'));
    const date = (r[cDate] || '').trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    let a = series.get(id); if (!a) series.set(id, a = []);
    a.push({ date, nhn, flur });
  }
  await rm(tmp, { force: true });

  // 4. per station: latest reading + empirical percentile within its own series
  const out = [];
  for (const [id, arr] of series) {
    arr.sort((x, y) => x.date.localeCompare(y.date));
    const latest = arr[arr.length - 1];
    const n = arr.length;
    if (!ok(latest.nhn, latest.flur, n)) continue;
    const vals = arr.map((p) => p.nhn);
    const le = vals.filter((v) => v <= latest.nhn).length;
    const pct = +(100 * le / n).toFixed(1);
    const m = meta.get(id);
    out.push({
      id, name: m.name || `GWM ${id}`, lat: m.lat, lon: m.lon,
      nhn: +latest.nhn.toFixed(2),
      flur: +latest.flur.toFixed(2),
      pct, measured_at: latest.date,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(OUT, JSON.stringify(out) + '\n');
  const dates = out.map((s) => s.measured_at).sort();
  console.log(`nw.levels.json: ${out.length} stations, ${dates[0]} .. ${dates[dates.length - 1]}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
