// Build data/nw.stations.json from OpenHygrisC (NRW, DL-DE Zero).
//   node scripts/build-stations-nw.js
//
// Downloads the station master CSV (gw-messstelle, stored uncompressed in the
// zip), keeps daily-telemetered ('turnus_wasserstand=täglich'), publicly-
// released ('freigabe_wstd=ja') water-level wells, reprojects the ~100m-coarsened
// ETRS89/UTM32N coordinates to WGS84, thins to ~200 evenly, and writes the master.
// IDs (messstelle_id) are the 9-digit ELWAS LGD numbers the adapter needs.
//
// NOTE: opengeodata.nrw.de must be reachable from wherever this runs (it is from
// GitHub Actions runners). Set CAP to change the station budget.

import { writeFile } from 'node:fs/promises';
import zlib from 'node:zlib';

const URL_ZIP = 'https://www.opengeodata.nrw.de/produkte/umwelt_klima/wasser/grundwasser/hygrisc/OpenHygrisC_gw-messstelle_EPSG25832_CSV.zip';
const OUT = new URL('../data/nw.stations.json', import.meta.url);
const CAP = Number(process.env.CAP || 200);

function utm32ToWgs84(E, N) {
  const a=6378137,f=1/298.257222101,e2=f*(2-f),k0=0.9996,E0=500000,lon0=9*Math.PI/180;
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2)),ep2=e2/(1-e2),M=N/k0,mu=M/(a*(1-e2/4-3*e2*e2/64-5*e2**3/256));
  const p1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu);
  const s=Math.sin(p1),co=Math.cos(p1),t=Math.tan(p1),C=ep2*co*co,T=t*t,N1=a/Math.sqrt(1-e2*s*s),R=a*(1-e2)/Math.pow(1-e2*s*s,1.5),D=(E-E0)/(N1*k0);
  const lat=p1-(N1*t/R)*(D*D/2-(5+3*T+10*C-4*C*C-9*ep2)*D**4/24+(61+90*T+298*C+45*T*T-252*ep2-3*C*C)*D**6/720);
  const lon=lon0+(D-(1+2*T+C)*D**3/6+(5-2*C+28*T-3*C*C+8*ep2+24*T*T)*D**5/120)/co;
  return [+(lat*180/Math.PI).toFixed(5),+(lon*180/Math.PI).toFixed(5)];
}
const demask=(x)=>{x=(x||'').trim(); return x?parseInt(x.replace(/X/g,'5'),10):NaN;};

// read the single stored/deflated entry from the zip
function readZipCsv(buf){
  const dv=new DataView(buf.buffer,buf.byteOffset,buf.byteLength);
  if(dv.getUint32(0,true)!==0x04034b50) throw new Error('not a zip');
  const method=dv.getUint16(8,true), compSize=dv.getUint32(18,true);
  const nameLen=dv.getUint16(26,true), extraLen=dv.getUint16(28,true);
  const start=30+nameLen+extraLen;
  const data=buf.subarray(start, start+compSize);
  const raw = method===0 ? data : zlib.inflateRawSync(data);
  return Buffer.from(raw).toString('utf8');
}

const res = await fetch(URL_ZIP);
if(!res.ok) throw new Error('download failed: HTTP '+res.status);
const csv = readZipCsv(Buffer.from(await res.arrayBuffer()));
const lines = csv.split(/\r?\n/); const H=lines[0].split(';'); const c=(n)=>H.indexOf(n);
const ID=c('messstelle_id'),NM=c('name'),E=c('e32'),N=c('n32'),WSM=c('wasserstandsmessstelle'),FR=c('freigabe_wstd'),TU=c('turnus_wasserstand');
let cand=[];
for(let i=1;i<lines.length;i++){const r=lines[i].split(';'); if(r.length<H.length) continue;
  if((r[WSM]||'').trim()!=='ja'||(r[FR]||'').trim()!=='ja'||(r[TU]||'').trim()!=='täglich') continue;
  const e=demask(r[E]),n=demask(r[N]); if(!(e>0&&n>0)) continue;
  const [lat,lon]=utm32ToWgs84(e,n); if(!(lat>50&&lat<53&&lon>5&&lon<10)) continue;
  cand.push({id:(r[ID]||'').trim(),name:(r[NM]||'').replace(/\s+/g,' ').trim(),lat,lon});}
let out=cand;
if(cand.length>CAP){const step=cand.length/CAP; out=[]; for(let i=0;i<cand.length;i+=step) out.push(cand[Math.floor(i)]);}
await writeFile(OUT, JSON.stringify({_note:`NRW daily, publicly-released water-level wells from OpenHygrisC (DL-DE Zero), reprojected to WGS84, thinned to ${out.length}. IDs are 9-digit ELWAS LGD numbers.`, stations:out}, null, 1)+'\n');
console.log(`nw.stations.json: ${out.length} of ${cand.length} daily-released wells`);
