/* Grundwasser DE — static site. Reads ./data/latest.json (written by the daily
   pipeline) and renders the 3D bar map. No external libraries. */

const CLASSES=[
  {key:'vhigh',label:'sehr hoch',hex:'#12496e'},{key:'high',label:'hoch',hex:'#4e97c4'},
  {key:'normal',label:'normal',hex:'#6fb98f'},{key:'low',label:'niedrig',hex:'#e7a13a'},
  {key:'vlow',label:'sehr niedrig',hex:'#c24634'},
];
const CLASS_BY=Object.fromEntries(CLASSES.map(c=>[c.key,c]));
const HEIGHT_NOTE={
  pct:'Vergleichbar über alle Stationen — die eigentliche „hoch/niedrig“-Aussage.',
  nhn:'Warnung: bildet v. a. Geländehöhe ab (Süden hoch, Küste flach), nicht „viel Wasser“.',
  flur:'Tiefe zum Wasser. Hoher Balken = tiefes Wasser — läuft der Farbe entgegen.',
};

let DATA={sources:[],stations:[]}, SRC_KIND={}, LIVE_STATES=new Set();
const S={layer:'live',view:'3d',height:'pct',azimuth:-0.35,pitch:0.62,zoom:1,
         activeId:null,hoverId:null,active:new Set(CLASSES.map(c=>c.key))};

const cv=document.getElementById('map'), ctx=cv.getContext('2d');
let W=0,H=0,DPR=1,cx=0,cy=0,baseScale=1;
const LON0=10.45,LAT0=51.16,KX=Math.cos(LAT0*Math.PI/180);
const plane=(lon,lat)=>({x:(lon-LON0)*KX,y:(lat-LAT0)});
const MAXBAR=1.7;

const OUTLINE=[[8.4,55.05],[9.0,54.9],[9.9,54.98],[10.95,54.4],[11.4,54.4],[12.5,54.5],[13.4,54.1],[14.2,53.9],
 [14.15,52.9],[14.75,52.05],[14.6,51.8],[15.04,51.3],[14.8,50.87],[14.3,50.9],[13.5,50.7],[12.95,50.4],
 [12.5,50.4],[12.2,50.1],[12.4,49.75],[12.6,49.5],[13.4,48.9],[13.8,48.7],[13.0,47.85],[12.8,47.7],
 [13.05,47.6],[12.2,47.7],[11.3,47.45],[10.9,47.5],[10.45,47.55],[10.2,47.38],[9.6,47.55],[8.9,47.65],
 [8.55,47.8],[8.4,47.6],[7.7,47.55],[7.6,48.3],[8.0,48.9],[8.2,49.0],[7.6,49.05],[6.9,49.2],[6.36,49.46],
 [6.5,49.8],[6.1,50.05],[6.4,50.3],[6.0,50.75],[5.87,51.05],[6.1,51.85],[6.7,51.9],[7.05,52.4],[7.05,52.65],
 [6.7,52.65],[7.2,53.24],[7.0,53.35],[8.0,53.7],[8.5,53.55],[8.9,53.9],[8.6,54.4],[8.3,54.9],[8.4,55.05]];

async function boot(){
  try{
    const res=await fetch('./data/latest.json',{cache:'no-store'});
    DATA=await res.json();
  }catch(e){
    document.getElementById('banner').classList.add('show');
    document.getElementById('banner').innerHTML='<b>Konnte data/latest.json nicht laden.</b> Lokal via <code>npm run serve</code> öffnen (nicht per file://).';
  }
  SRC_KIND=Object.fromEntries((DATA.sources||[]).map(s=>[s.id,s.kind]));
  // Bundesländer that already have a live (non-model) network; GRUVO over these
  // is the "national" layer, shown only when toggled on.
  LIVE_STATES=new Set((DATA.stations||[]).filter(s=>SRC_KIND[s.source]==='state').map(s=>s.state));
  banner(); attribution(); renderSources();
  document.getElementById('heightNote').textContent=HEIGHT_NOTE.pct;
  wireUI(); resize(); applyLayer();
}

function banner(){
  const seed=DATA.seed||(DATA.sources||[]).some(s=>s.status==='seed');
  const b=document.getElementById('banner');
  const when=DATA.generated_at?new Date(DATA.generated_at).toLocaleString('de-DE'):'—';
  document.getElementById('asof').textContent='Stand: '+when;
  if(seed){b.classList.add('show');
    b.innerHTML='<b>Seed-Snapshot.</b> Platzhalter bis zum ersten echten Pipeline-Lauf (GitHub Actions). '+
      'Bayern-Stationen sind echt, Werte hier noch synthetisch; „Demo“-Punkte verschwinden beim ersten Lauf.';}
}
function attribution(){
  // Per-source credit with licence — DL-DE BY 2.0 requires naming the source,
  // the licence, and that the data was modified. Lists only sources with data.
  const dldeUrl = (lic) => /zero/i.test(lic)
    ? 'https://www.govdata.de/dl-de/zero-2-0'
    : 'https://www.govdata.de/dl-de/by-2-0';
  const active = (DATA.sources||[]).filter(s => s.count > 0);
  const items = active.map(s => {
    const lic = s.license || '';
    const licHtml = /DL-DE/i.test(lic)
      ? `<a href="${dldeUrl(lic)}" target="_blank" rel="noopener">${esc(lic)}</a>` : esc(lic);
    return `<li>${esc(s.attribution || s.name)}${lic ? ' — ' + licHtml : ''}</li>`;
  }).join('');
  document.getElementById('attrib').innerHTML =
    '<b>Datenquellen &amp; Lizenzen</b>'
    + (items ? `<ul class="src-credits">${items}</ul>` : ' —')
    + '<p class="src-note">Die Grundwasserstände stammen von den genannten Stellen und wurden für diese '
    + 'Darstellung bearbeitet (Klassifizierung bzw. Perzentil-Berechnung, einheitliche Aufbereitung). '
    + 'Es besteht keine Gewähr, dass die bearbeiteten Daten mit den amtlichen Originaldaten übereinstimmen. '
    + 'GRUVO © BGR. Kartengrundlage © <a href="https://openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende, '
    + '© <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>.</p>';
}

/* ---------- layers ---------- */
let VIS=[];
function applyLayer(){
  const layer=S.layer;                                  // 'live' | 'national' | 'rivers'
  const rivers=layer==='rivers';
  VIS=(DATA.stations||[]).filter(s=>{
    const kind=SRC_KIND[s.source];
    if(layer==='rivers')   return kind==='river';       // Flüsse: only the gauges
    if(layer==='national') return kind==='model';       // GRUVO: only the monthly model
    return kind==='state';                              // Grundwasser live: only state networks
  });
  const hs=document.getElementById('heightSel');
  if(rivers){ S.height='pct'; hs.value='pct'; hs.disabled=true; } else { hs.disabled=false; }
  document.getElementById('heightNote').textContent = rivers
    ? 'Balkenhöhe = Lage im MNW–MHW-Band (Mittelwasser). Pfeil = Tendenz der letzten Stunden.'
    : HEIGHT_NOTE[S.height];
  document.getElementById('ribbonTitle').textContent =
    rivers ? 'Klasse — Pegel (Wasserstand vs. Mittelwasser)' :
    layer==='national' ? 'Klasse — GRUVO national (nur Monatsmodell)' :
    'Klasse — Grundwasser (Live-Messnetze)';
  renderLegend(); draw();
}
const shown=()=>VIS.filter(s=>s.cls?S.active.has(s.cls):true);

/* ---------- projection + draw ---------- */
function resize(){
  DPR=Math.min(window.devicePixelRatio||1,2);W=cv.clientWidth;H=cv.clientHeight;
  cv.width=W*DPR;cv.height=H*DPR;ctx.setTransform(DPR,0,0,DPR,0,0);
  cx=W/2;cy=H/2+H*0.06;baseScale=Math.min(W/6.9,H/8.4);draw();
}
function project(x,y,z){
  const a=S.azimuth,xr=x*Math.cos(a)-y*Math.sin(a),yr=x*Math.sin(a)+y*Math.cos(a),sc=baseScale*S.zoom;
  return {sx:cx+xr*sc, sy:cy-yr*Math.sin(S.pitch)*sc-(z||0)*Math.cos(S.pitch)*sc, depth:yr};
}
function heightUnit(st){
  if(S.height==='pct')return st.pct==null?0:st.pct/100;
  if(S.height==='nhn')return st.nhn==null?0:Math.min(st.nhn/700,1);
  return st.flur==null?0:Math.min(st.flur/30,1);
}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
function shade(hex,a){const n=parseInt(hex.slice(1),16);let r=(n>>16)+a,g=((n>>8)&255)+a,b=(n&255)+a;r=Math.max(0,Math.min(255,r));g=Math.max(0,Math.min(255,g));b=Math.max(0,Math.min(255,b));return '#'+((1<<24)+(r<<16)+(g<<8)+b).toString(16).slice(1);}
// Rising/falling tendency marker for river gauges. Shape carries the direction;
// a white halo keeps it legible on any bar colour.
function drawTrend(x,y,dir){
  const s=4.8*S.zoom; ctx.save(); ctx.lineJoin='round';
  if(dir==='stable'){
    ctx.lineWidth=3.4;ctx.strokeStyle='#fff';ctx.beginPath();ctx.moveTo(x-s*0.8,y);ctx.lineTo(x+s*0.8,y);ctx.stroke();
    ctx.lineWidth=1.7;ctx.strokeStyle='#54646c';ctx.beginPath();ctx.moveTo(x-s*0.8,y);ctx.lineTo(x+s*0.8,y);ctx.stroke();
    ctx.restore();return;
  }
  const up=dir==='rising';
  ctx.beginPath();
  if(up){ctx.moveTo(x,y-s);ctx.lineTo(x-s*0.82,y+s*0.62);ctx.lineTo(x+s*0.82,y+s*0.62);}
  else  {ctx.moveTo(x,y+s);ctx.lineTo(x-s*0.82,y-s*0.62);ctx.lineTo(x+s*0.82,y-s*0.62);}
  ctx.closePath();
  ctx.lineWidth=2.6;ctx.strokeStyle='#fff';ctx.stroke();
  ctx.fillStyle='#12242c';ctx.fill();
  ctx.restore();
}

const hitList=[];
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.beginPath();
  OUTLINE.forEach((p,i)=>{const q=plane(p[0],p[1]),s=project(q.x,q.y,0);i?ctx.lineTo(s.sx,s.sy):ctx.moveTo(s.sx,s.sy);});
  ctx.closePath();ctx.fillStyle='#dfe9ec';ctx.fill();ctx.strokeStyle='#b9c8cd';ctx.lineWidth=1.2;ctx.stroke();

  hitList.length=0;
  const flat=S.pitch>1.45;
  if(S.layer==='rivers'){ drawRivers(flat); return; }
  const list=shown().map(st=>{const q=plane(st.lon,st.lat);return {st,q,depth:project(q.x,q.y,0).depth};})
    .sort((a,b)=>b.depth-a.depth);
  for(const {st,q} of list){
    const base=project(q.x,q.y,0),top=project(q.x,q.y,heightUnit(st)*MAXBAR);
    const _m=12*S.zoom;                                   // cull fully off-screen bars
    if(base.sx+_m<0||base.sx-_m>W||Math.max(base.sy,top.sy)+_m<0||Math.min(base.sy,top.sy)-_m>H) continue;
    const cls=CLASS_BY[st.cls],col=cls?cls.hex:'#9aa7ad';
    const act=st.id===S.activeId,hov=st.id===S.hoverId,w=(act||hov?9:7)*S.zoom;
    if(flat){
      const rr=(act||hov?7:5.2)*S.zoom;
      ctx.beginPath();ctx.arc(base.sx,base.sy,rr,0,7);
      if(st.stale){ctx.fillStyle='#fff';ctx.globalAlpha=.9;ctx.fill();ctx.globalAlpha=1;
        ctx.setLineDash([3,2]);ctx.lineWidth=2;ctx.strokeStyle=col;ctx.stroke();ctx.setLineDash([]);}
      else{ctx.fillStyle=col;ctx.globalAlpha=.92;ctx.fill();ctx.globalAlpha=1;
        ctx.lineWidth=1.3;ctx.strokeStyle=act?'#12242c':'#fff';ctx.stroke();}
    }else{
      if(!S.dragging){ctx.beginPath();ctx.ellipse(base.sx,base.sy,w*0.9,w*0.4,0,0,7);ctx.fillStyle='rgba(18,36,44,.13)';ctx.fill();}
      const topY=Math.min(top.sy,base.sy),colH=Math.abs(base.sy-top.sy);
      roundRect(base.sx-w/2,topY,w,colH+w*0.35,Math.min(w/2,4));
      ctx.globalAlpha=st.stale?.5:1;ctx.fillStyle=col;ctx.fill();ctx.globalAlpha=1;
      if(st.stale&&!S.dragging){ctx.setLineDash([3,2]);ctx.lineWidth=1.4;ctx.strokeStyle=shade(col,-40);ctx.stroke();ctx.setLineDash([]);}
      if(act||hov){ctx.lineWidth=1.6;ctx.strokeStyle='#12242c';ctx.stroke();}
      if(!S.dragging){ctx.beginPath();ctx.ellipse(base.sx,topY,w/2,w*0.28,0,0,7);ctx.globalAlpha=st.stale?.5:1;ctx.fillStyle=shade(col,20);ctx.fill();ctx.globalAlpha=1;}
    }
    if(S.layer==='rivers' && st.trend && !S.dragging){
      const ay=(flat?base.sy:Math.min(top.sy,base.sy))-9*S.zoom;
      drawTrend(base.sx,ay,st.trend);
    }
    hitList.push({st,x:base.sx,yTop:Math.min(base.sy,top.sy),yBase:base.sy});
  }
}
/* ---------- rivers: course line + "water wall" whose height follows the level ---------- */
const MAXBAR_R=1.4;                 // wall height scale
const GAP=0.8, SUB=8;               // break rivers on >~85 km jumps; Catmull-Rom subdivisions
function lerp(a,b,t){return a+(b-a)*t;}
function lerpHex(h1,h2,t){const a=parseInt(h1.slice(1),16),b=parseInt(h2.slice(1),16);
  const r=Math.round(lerp(a>>16,b>>16,t)),g=Math.round(lerp((a>>8)&255,(b>>8)&255,t)),bl=Math.round(lerp(a&255,b&255,t));
  return '#'+((1<<24)+(r<<16)+(g<<8)+bl).toString(16).slice(1);}
function cr(p0,p1,p2,p3,t){const t2=t*t,t3=t2*t;return 0.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t2+(-p0+3*p1-3*p2+p3)*t3);}
const levelOf=st=>0.15+0.85*((st.pct==null?0:st.pct)/100);   // floor so even low water shows a wall
const hexOf=st=>CLASS_BY[st.cls]?CLASS_BY[st.cls].hex:'#9aa7ad';

function drawRivers(flat){
  // group gauges by river, order by river-km, split on big geographic gaps
  const groups=new Map();
  for(const st of shown()){ const k=st.state||'?'; (groups.get(k)||groups.set(k,[]).get(k)).push(st); }
  const runs=[];
  for(const [,arr] of groups){
    arr.sort((a,b)=>(a.km==null?1e9:a.km)-(b.km==null?1e9:b.km));
    let cur=[];
    for(let i=0;i<arr.length;i++){
      if(cur.length){ const p=cur[cur.length-1];
        if(Math.hypot((arr[i].lon-p.lon)*KX, arr[i].lat-p.lat)>GAP){ if(cur.length)runs.push(cur); cur=[]; } }
      cur.push(arr[i]);
    }
    if(cur.length) runs.push(cur);
  }
  // build geometry, depth-sort runs back-to-front
  const draws=[];
  for(const g of runs){
    if(g.length===1){ const q=plane(g[0].lon,g[0].lat); draws.push({single:g[0],depth:project(q.x,q.y,0).depth}); continue; }
    const P=g.map(st=>{const q=plane(st.lon,st.lat);return {x:q.x,y:q.y,L:levelOf(st),hex:hexOf(st)};});
    const samp=[];
    for(let i=0;i<P.length-1;i++){const p0=P[i-1]||P[i],p1=P[i],p2=P[i+1],p3=P[i+2]||P[i+1];
      for(let k=0;k<SUB;k++){const t=k/SUB;
        samp.push({x:cr(p0.x,p1.x,p2.x,p3.x,t),y:cr(p0.y,p1.y,p2.y,p3.y,t),L:lerp(p1.L,p2.L,t),hex:lerpHex(p1.hex,p2.hex,t)});}}
    const last=P[P.length-1]; samp.push({x:last.x,y:last.y,L:last.L,hex:last.hex});
    let ds=0; for(const s of samp) ds+=project(s.x,s.y,0).depth;
    draws.push({run:g,samp,depth:ds/samp.length});
  }
  draws.sort((a,b)=>b.depth-a.depth);

  for(const d of draws){
    if(d.single){ drawRiverSingle(d.single,flat); continue; }
    const base=d.samp.map(s=>project(s.x,s.y,0)), top=d.samp.map(s=>project(s.x,s.y,s.L*MAXBAR_R));
    if(flat){
      ctx.lineWidth=4.5*S.zoom;ctx.lineCap='round';ctx.lineJoin='round';
      for(let i=0;i<base.length-1;i++){ctx.strokeStyle=d.samp[i].hex;ctx.beginPath();ctx.moveTo(base[i].sx,base[i].sy);ctx.lineTo(base[i+1].sx,base[i+1].sy);ctx.stroke();}
    }else{
      for(let i=0;i<base.length-1;i++){ctx.beginPath();
        ctx.moveTo(base[i].sx,base[i].sy);ctx.lineTo(base[i+1].sx,base[i+1].sy);ctx.lineTo(top[i+1].sx,top[i+1].sy);ctx.lineTo(top[i].sx,top[i].sy);ctx.closePath();
        ctx.fillStyle=d.samp[i].hex;ctx.globalAlpha=.88;ctx.fill();ctx.globalAlpha=1;}
      ctx.lineJoin='round';
      ctx.lineWidth=1.5;ctx.beginPath();top.forEach((p,i)=>i?ctx.lineTo(p.sx,p.sy):ctx.moveTo(p.sx,p.sy));ctx.strokeStyle='rgba(18,36,44,.4)';ctx.stroke();
      ctx.lineWidth=1.3;ctx.beginPath();base.forEach((p,i)=>i?ctx.lineTo(p.sx,p.sy):ctx.moveTo(p.sx,p.sy));ctx.strokeStyle='#3a7ca5';ctx.stroke();
    }
    for(const st of d.run){ const q=plane(st.lon,st.lat),b=project(q.x,q.y,0),tp=project(q.x,q.y,levelOf(st)*MAXBAR_R);
      hitList.push({st,x:b.sx,yTop:Math.min(b.sy,tp.sy),yBase:b.sy});
      if(st.trend&&!S.dragging){const ay=(flat?b.sy:Math.min(tp.sy,b.sy))-9*S.zoom;drawTrend(b.sx,ay,st.trend);} }
  }
}
function drawRiverSingle(st,flat){
  const q=plane(st.lon,st.lat),b=project(q.x,q.y,0),tp=project(q.x,q.y,levelOf(st)*MAXBAR_R),col=hexOf(st);
  if(flat){ctx.fillStyle=col;ctx.beginPath();ctx.arc(b.sx,b.sy,4*S.zoom,0,7);ctx.fill();}
  else{ctx.lineWidth=5*S.zoom;ctx.lineCap='round';ctx.strokeStyle=col;ctx.beginPath();ctx.moveTo(b.sx,b.sy);ctx.lineTo(tp.sx,tp.sy);ctx.stroke();}
  hitList.push({st,x:b.sx,yTop:Math.min(b.sy,tp.sy),yBase:b.sy});
  if(st.trend&&!S.dragging){const ay=(flat?b.sy:Math.min(tp.sy,b.sy))-9*S.zoom;drawTrend(b.sx,ay,st.trend);}
}
// Coalesce redraws to one per animation frame; many pointer events then cost one draw.
let _raf=0;
function requestDraw(){ if(_raf)return; _raf=requestAnimationFrame(()=>{_raf=0;draw();}); }
function pick(mx,my){let best=null,bd=14;for(const h of hitList){const dx=Math.abs(mx-h.x);
  const dy=my<h.yTop?h.yTop-my:(my>h.yBase?my-h.yBase:0);const d=Math.hypot(dx,dy);if(d<bd){bd=d;best=h;}}return best?best.st:null;}

/* ---------- interaction ---------- */
let drag=null;
cv.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,moved:false};S.dragging=true;cv.setPointerCapture(e.pointerId);});
cv.addEventListener('pointermove',e=>{
  const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>2)drag.moved=true;
    S.azimuth+=dx*0.006;S.pitch=Math.max(0.28,Math.min(1.5,S.pitch+dy*0.005));
    if(S.pitch>1.45)setView('2d',true);else if(S.view==='2d'&&S.pitch<1.4)setView('3d',true);
    drag.x=e.clientX;drag.y=e.clientY;requestDraw();
  }else{const st=pick(mx,my),tip=document.getElementById('tip');
    if(st){tip.style.opacity=1;tip.style.left=mx+'px';tip.style.top=my+'px';
      tip.innerHTML='<b>'+esc(st.name)+'</b> · '+(CLASS_BY[st.cls]?CLASS_BY[st.cls].label:'—')+(st.stale?' · <i>veraltet</i>':'');
      if(S.hoverId!==st.id){S.hoverId=st.id;requestDraw();}}
    else if(S.hoverId){S.hoverId=null;tip.style.opacity=0;requestDraw();}}
});
cv.addEventListener('pointerup',e=>{S.dragging=false;if(drag&&!drag.moved){const r=cv.getBoundingClientRect();
  const st=pick(e.clientX-r.left,e.clientY-r.top);S.activeId=st?st.id:null;renderDetail(st);}drag=null;draw();});
cv.addEventListener('pointerleave',()=>{S.hoverId=null;S.dragging=false;document.getElementById('tip').style.opacity=0;requestDraw();});
cv.addEventListener('wheel',e=>{e.preventDefault();S.zoom=Math.max(0.5,Math.min(3.2,S.zoom*(e.deltaY<0?1.1:0.9)));requestDraw();},{passive:false});

/* ---------- UI ---------- */
function setView(v,fromDrag){S.view=v;document.querySelectorAll('#viewSeg button').forEach(b=>b.classList.toggle('on',b.dataset.view===v));
  if(!fromDrag)S.pitch=v==='2d'?1.5:0.62;draw();}
function wireUI(){
  document.getElementById('viewSeg').addEventListener('click',e=>{const b=e.target.closest('button');if(b)setView(b.dataset.view);});
  document.getElementById('layerSeg').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;
    S.layer=b.dataset.layer;document.querySelectorAll('#layerSeg button').forEach(x=>x.classList.toggle('on',x===b));applyLayer();});
  document.getElementById('heightSel').addEventListener('change',e=>{S.height=e.target.value;
    document.getElementById('heightNote').textContent=HEIGHT_NOTE[S.height];draw();});
  window.addEventListener('resize',resize);
}
function renderLegend(){
  const c=Object.fromEntries(CLASSES.map(x=>[x.key,0]));VIS.forEach(s=>{if(s.cls)c[s.cls]++;});
  const rib=document.getElementById('ribbon');rib.innerHTML='';
  CLASSES.forEach(cl=>{const s=document.createElement('div');s.className='s';s.style.background=cl.hex;
    s.style.flexGrow=c[cl.key];s.style.opacity=S.active.has(cl.key)?1:.35;s.title=cl.label+': '+c[cl.key];
    s.onclick=()=>toggle(cl.key);rib.appendChild(s);});
  const lg=document.getElementById('legend');lg.innerHTML='';
  CLASSES.forEach(cl=>{const it=document.createElement('div');it.className='it'+(S.active.has(cl.key)?'':' off');
    it.innerHTML='<span class="sw" style="background:'+cl.hex+'"></span>'+cl.label+'<span class="n">'+c[cl.key]+'</span>';
    it.onclick=()=>toggle(cl.key);lg.appendChild(it);});
  const ns=VIS.filter(s=>s.stale).length;
  if(ns){const note=document.createElement('div');note.className='it';note.style.cursor='default';
    note.innerHTML='<span class="sw" style="background:#fff;border:1.5px dashed #9aa7ad;box-sizing:border-box"></span>veraltet (letzter Wert)<span class="n">'+ns+'</span>';
    lg.appendChild(note);}
  if(S.layer==='rivers'){
    const t=document.createElement('div');t.className='it';t.style.cursor='default';t.style.marginTop='6px';
    t.style.fontSize='12px';t.style.color='var(--ink-soft)';
    t.innerHTML='Tendenz:&nbsp; <b style="color:#12242c">▲</b>&nbsp;steigend &nbsp; <b style="color:#12242c">▼</b>&nbsp;fallend &nbsp; <b style="color:#54646c">–</b>&nbsp;gleich';
    lg.appendChild(t);
  }
}
function toggle(k){if(S.active.has(k))S.active.delete(k);else S.active.add(k);if(!S.active.size)CLASSES.forEach(c=>S.active.add(c.key));renderLegend();draw();}
function renderDetail(st){
  const d=document.getElementById('detail');
  if(!st){d.innerHTML='<div class="detail-empty">Balken antippen für Details (Meterwert, Stand, Quelle).</div>';return;}
  const cls=CLASS_BY[st.cls],src=(DATA.sources||[]).find(x=>x.id===st.source);
  const isRiver=SRC_KIND[st.source]==='river';
  const TREND_LABEL={rising:'steigend ▲',falling:'fallend ▼',stable:'gleichbleibend –'};
  const when=st.measured_at?new Date(st.measured_at).toLocaleDateString('de-DE'):'—';
  const ageDays=st.measured_at?Math.floor((Date.now()-new Date(st.measured_at))/86400000):null;
  const staleBadge=st.stale?'<span class="badge" style="background:#d98a00;margin:0 0 10px 8px">veraltet</span>':'';
  const staleNote=st.stale?'<div class="muted" style="margin:10px 0 0;color:#b06b00;line-height:1.35">Letzter verfügbarer Wert — kein aktueller Messwert (Stand '+when+(ageDays!=null?', vor ~'+Math.max(1,Math.round(ageDays/30))+' Mon.':'')+').</div>':'';
  d.innerHTML='<div style="font-weight:700;font-size:15px;margin-bottom:2px">'+esc(st.name)+'</div>'+
    '<div class="muted" style="margin-bottom:8px">'+esc(st.state||'')+'</div>'+
    '<div class="badge" style="background:'+(cls?cls.hex:'#9aa7ad')+';margin-bottom:10px">'+(cls?cls.label:'ohne Klasse')+'</div>'+staleBadge+
    '<dl class="kv">'+
    (isRiver
      ? kv('Lage MNW–MHW',st.pct==null?'—':st.pct+' %')+kv('Tendenz',TREND_LABEL[st.trend]||'—')+kv('Fluss-km',st.km==null?'—':st.km)
      : kv('Perzentil',st.pct==null?'—':st.pct+' %')+kv('m ü. NHN',st.nhn==null?'—':st.nhn+' m')+kv('Flurabstand',st.flur==null?'—':st.flur+' m u. GOK'))
    +kv('Stand',when)+kv('Quelle',src?esc(src.name):st.source)+'</dl>'+staleNote;
}
const kv=(k,v)=>'<dt>'+k+'</dt><dd>'+v+'</dd>';
function renderSources(){
  const el=document.getElementById('sources');el.innerHTML='';
  (DATA.sources||[]).forEach(a=>{const div=document.createElement('div');div.className='src';
    const when=a.fetched_at?new Date(a.fetched_at).toLocaleDateString('de-DE'):'—';
    div.innerHTML='<span class="dot '+a.status+'"></span><span><span class="nm">'+esc(a.name)+'</span>'+
      '<div class="meta">'+(a.kind==='model'?'Modell':'Messnetz')+' · '+esc(a.cadence||'')+' · '+a.status+' ('+when+')</div></span>'+
      '<span class="cnt">'+(a.count||0)+'</span>';el.appendChild(div);});
}
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

boot();
