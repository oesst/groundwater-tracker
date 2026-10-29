// Build data/be.stations.json from the Wasserportal Berlin groundwater overview.
//   node scripts/build-stations-be.js
//
// Parses the GW overview table (anzeige=tabelle_gw) for the daily-telemetered
// ('tagesaktuell') GW-Stand stations, reprojects Rechtswert/Hochwert from
// ETRS89/UTM33N (EPSG:25833) to WGS84, and writes id, name, lat, lon, gok.
// Set INCLUDE_ALL=1 to include non-telemetered wells too (far more HTTP calls daily).

import { writeFile } from 'node:fs/promises';
import { getText } from '../lib/http.js';

const OVERVIEW = 'https://wasserportal.berlin.de/start.php?anzeige=tabelle_gw&messanzeige=ms_gw_berlin';
const OUT = new URL('../data/be.stations.json', import.meta.url);
const INCLUDE_ALL = process.env.INCLUDE_ALL === '1';

// inverse Transverse Mercator, EPSG:25833 (ETRS89/UTM 33N, GRS80)
function utm33ToWgs84(E, N) {
  const a=6378137, f=1/298.257222101, e2=f*(2-f), k0=0.9996, E0=500000, lon0=15*Math.PI/180;
  const ep2=e2/(1-e2), e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2));
  const M=N/k0, mu=M/(a*(1-e2/4-3*e2*e2/64-5*e2**3/256));
  const phi1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)
    +(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const s=Math.sin(phi1), c=Math.cos(phi1), t=Math.tan(phi1);
  const C1=ep2*c*c, T1=t*t, N1=a/Math.sqrt(1-e2*s*s), R1=a*(1-e2)/Math.pow(1-e2*s*s,1.5), D=(E-E0)/(N1*k0);
  const phi=phi1-(N1*t/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24
    +(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720);
  const lon=lon0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/c;
  return [+(phi*180/Math.PI).toFixed(6), +(lon*180/Math.PI).toFixed(6)];
}

const strip = (h) => h.replace(/<[^>]*>/g, ' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();

const html = await getText(OVERVIEW, { timeout: 30000, retries: 2 });
const stations = [];
for (const tr of html.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
  const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => strip(m[1]));
  if (cells.length < 12) continue;
  const id = (tr.match(/station=(\d+)/) || [])[1] || cells[0];
  const [nr, bezirk, , auspr, , gokS, , , , rechtsS, hochS] = cells;
  if (!/GW-?Stand/i.test(auspr)) continue;
  if (!INCLUDE_ALL && !/tagesaktuell/i.test(auspr)) continue;
  const E = +rechtsS, Nn = +hochS, gok = parseFloat(String(gokS).replace(',', '.'));
  if (!(E > 0 && Nn > 0)) continue;
  const [lat, lon] = utm33ToWgs84(E, Nn);
  stations.push({ id, name: `GWM ${id} (${bezirk})`, lat, lon, gok: Number.isFinite(gok) ? gok : null });
}
stations.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(OUT, JSON.stringify({
  _note: `Berlin groundwater-level station master (Wasserportal). ${stations.length} ${INCLUDE_ALL?'':'daily '}GW-Stand stations, UTM33N->WGS84, GOK in m ü. NHN. Rebuild: node scripts/build-stations-be.js`,
  stations,
}, null, 1) + '\n');
console.log(`be.stations.json: ${stations.length} stations`);
