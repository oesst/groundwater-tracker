// Nordrhein-Westfalen — ELWAS-WEB (LANUK). ELWAS has no public API and no
// station list: the public JSF (Jakarta Faces) flow is replayed per station,
// keyed on the 9-digit LGD number (= HygrisC messstelle_id). Flow validated
// 2026-10 against the live site. A NRW site change can break the form flow;
// keep-last-good then holds the previous values.
//
// Per station (own cookie session), 4 steps:
//   1. GET   grundwasserMst.xhtml          -> search form (field ':mstnrId')
//   2. POST  search (mstnrId + gwMs_search) -> result list containing the id
//   3. POST  select result row (control value == id) -> detail view (':dDSwitcher')
//   4. POST  partial/ajax switch dDSwitcher=5 -> water-level table
// Table columns: [0]=Datum, [3]=Wasserstand [m ü. NHN], [4]=Flurabstand [m],
//                [5]=Geländeoberkante. Latest row = current value; full history
//                drives the percentile (vs 1991-2020, fallback full series).
//
// Station master: data/nw.stations.json (201 daily, publicly-released wells).

import { readFile } from 'node:fs/promises';
import { deNum, mapLimit } from '../lib/http.js';
import { quantiles11, percentileFromQuantiles } from '../lib/percentile.js';

const BASE = 'https://www.elwasweb.nrw.de/elwas-web/data/gw/zustand/gwm/'
           + 'grundwasserMst.xhtml?marea=1&mtheme=0&lindex=0&nested=true';
const UA = 'grundwasser-de/0.1 (+github; daily static pipeline)';

async function loadStations() {
  try {
    const url = new URL('../data/nw.stations.json', import.meta.url);
    return (JSON.parse(await readFile(url, 'utf8')).stations || [])
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));
  } catch { return []; }
}

/* ---- tiny cookie jar + fetch wrappers (Node fetch has no cookie store) ---- */
function makeJar() { return new Map(); }
function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}
function storeCookies(jar, res) {
  const all = res.headers.getSetCookie ? res.headers.getSetCookie()
            : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  for (const line of all) {
    const pair = line.split(';', 1)[0];
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
async function req(jar, url, { method = 'GET', body, headers = {} } = {}, timeout = 45000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method, body, redirect: 'follow', signal: ctl.signal,
      headers: { 'User-Agent': UA, 'Accept-Language': 'de', Cookie: cookieHeader(jar), ...headers },
    });
    storeCookies(jar, res);
    const text = await res.text();
    return { text, url: res.url, status: res.status };
  } finally { clearTimeout(t); }
}
const postForm = (jar, curUrl, action, pairs, headers) =>
  req(jar, new URL(action, curUrl).href,
      { method: 'POST', body: new URLSearchParams(pairs).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...(headers || {}) } });

/* ---- minimal JSF form parser (regex; mirrors the HA integration) ---- */
function parseForms(html) {
  const forms = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = formRe.exec(html))) {
    const action = (m[1].match(/\baction="([^"]*)"/i) || [])[1] || '';
    const inner = m[2];
    const fields = [], controls = [];
    for (const im of inner.matchAll(/<input\b([^>]*)>/gi)) {
      const a = im[1];
      const name = (a.match(/\bname="([^"]*)"/i) || [])[1]; if (!name) continue;
      if (/\bdisabled\b/i.test(a)) continue;
      const type = ((a.match(/\btype="([^"]*)"/i) || [])[1] || 'text').toLowerCase();
      const value = (a.match(/\bvalue="([^"]*)"/i) || [])[1] || '';
      if (['submit', 'button', 'image'].includes(type)) controls.push([name, value]);
      else if (!['reset', 'file'].includes(type) &&
               (!['checkbox', 'radio'].includes(type) || /\bchecked\b/i.test(a))) fields.push([name, value]);
    }
    for (const bm of inner.matchAll(/<button\b([^>]*)>/gi)) {
      const a = bm[1]; const name = (a.match(/\bname="([^"]*)"/i) || [])[1];
      if (name) controls.push([name, (a.match(/\bvalue="([^"]*)"/i) || [])[1] || '']);
    }
    for (const sm of inner.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
      const name = (sm[1].match(/\bname="([^"]*)"/i) || [])[1]; if (!name) continue;
      const opts = [...sm[2].matchAll(/<option\b([^>]*)>/gi)].map((o) => ({
        v: (o[1].match(/\bvalue="([^"]*)"/i) || [])[1] || '', sel: /\bselected\b/i.test(o[1]) }));
      const chosen = (opts.find((o) => o.sel) || opts[0]);
      if (chosen) fields.push([name, chosen.v]);
    }
    forms.push({ action, fields, controls });
  }
  return forms;
}
const endsWith = (forms, suf) =>
  forms.find((f) => f.fields.some(([n]) => n.endsWith(suf)) || f.controls.some(([n]) => n.endsWith(suf)));

/* ---- parse the water-level table from the JSF partial-response ---- */
function extractUpdates(xml) {
  // CDATA bodies of <update> elements
  return [...xml.matchAll(/<update[^>]*>([\s\S]*?)<\/update>/gi)]
    .map((u) => u[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')).join('\n');
}
function parseTable(html) {
  const tb = html.match(/<tbody[^>]*wasserUndFlurAbstaendeErg[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tb) return [];
  const rows = [];
  for (const tr of tb[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((c) => c[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim());
    if (cells.length) rows.push(cells);
  }
  return rows;
}

async function fetchStation(st) {
  const jar = makeJar();
  let r = await req(jar, BASE);
  let forms = parseForms(r.text);
  const sForm = endsWith(forms, ':mstnrId');
  if (!sForm) throw new Error('search form missing');
  const stationField = sForm.fields.find(([n]) => n.endsWith(':mstnrId'))[0];
  const searchCtl = sForm.controls.find(([n]) => n.includes('gwMs_search'));
  if (!searchCtl) throw new Error('search control missing');
  let data = sForm.fields.map(([n, v]) => [n, n === stationField ? st.id : v]);
  data.push([searchCtl[0], searchCtl[1] || 'Suchen']);
  r = await postForm(jar, r.url, sForm.action, data);
  if (!r.text.includes(st.id)) throw new Error('station not in results');

  forms = parseForms(r.text);
  const rForm = forms.find((f) => f.controls.some((c) => c[1] === st.id));
  if (!rForm) throw new Error('result row missing');
  const stCtl = rForm.controls.find((c) => c[1] === st.id);
  r = await postForm(jar, r.url, rForm.action, [...rForm.fields, [stCtl[0], stCtl[1]]]);

  forms = parseForms(r.text);
  const dForm = endsWith(forms, ':dDSwitcher');
  if (!dForm) throw new Error('detail form missing');
  const switchName = dForm.fields.find(([n]) => n.endsWith(':dDSwitcher'))[0];
  const formIdField = dForm.fields.find(([n, v]) => n === v && n.endsWith(':detail_form_id'));
  const vsName = (dForm.fields.find(([n]) => n.endsWith('.faces.ViewState')) || [])[0];
  if (!formIdField || !vsName) throw new Error('JSF detail identifiers missing');
  const ns = vsName.replace(/\.ViewState$/, '');
  let d4 = dForm.fields.map(([n, v]) => [n, n === switchName ? '5' : v]);
  d4.push([ns + '.partial.ajax', 'true'], [ns + '.source', switchName],
          [ns + '.partial.execute', switchName + ' ' + formIdField[1]],
          [ns + '.partial.render', '@all'], [ns + '.behavior.event', 'change'],
          [ns + '.partial.event', 'change']);
  r = await postForm(jar, r.url, dForm.action, d4, { 'Faces-Request': 'partial/ajax' });

  const rows = parseTable(extractUpdates(r.text));
  const series = [];
  for (const c of rows) {
    if (c.length < 6) continue;
    const date = c[0]; const nhn = deNum(c[3]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || nhn == null) continue;
    series.push({ date, nhn, flur: deNum(c[4]) });
  }
  if (!series.length) throw new Error('no values parsed');
  series.sort((a, b) => a.date.localeCompare(b.date));
  const latest = series[series.length - 1];
  let ref = series.filter((p) => p.date >= '1991' && p.date < '2021').map((p) => p.nhn);
  if (ref.length < 24) ref = series.map((p) => p.nhn);
  const q = quantiles11(ref);
  const pct = q ? percentileFromQuantiles(latest.nhn, q) : null;
  return {
    id: `nw-${st.id}`, name: st.name || `GWM ${st.id}`, state: 'Nordrhein-Westfalen',
    lat: st.lat, lon: st.lon, nhn: latest.nhn, flur: latest.flur,
    pct, measured_at: latest.date + 'T00:00:00',
  };
}

export default {
  id: 'nw',
  name: 'Nordrhein-Westfalen — ELWAS / LANUK',
  kind: 'state',
  cadence: 'täglich (Teilmessnetz), Abruf 2×/Woche',
  attribution: 'LANUK NRW, ELWAS-WEB; Stammdaten OpenHygrisC (DL-DE Zero)',
  license: 'DL-DE BY 2.0',
  async fetch() {
    const stations = await loadStations();
    if (!stations.length) return [];
    const out = await mapLimit(stations, 4, (st) => fetchStation(st));
    return out.filter((r) => r && !r.__error && r.nhn != null);
  },
};
