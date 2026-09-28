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

let DATA={sources:[],stations:[]}, SRC_KIND={};
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
  const lic=[...new Set((DATA.sources||[]).filter(s=>s.count>0).map(s=>s.attribution).filter(Boolean))];
  document.getElementById('attrib').innerHTML='<b>Datenquellen:</b> '+(lic.length?lic.map(esc).join(' · '):'—')+
    '. Lizenzen je Landesdienst (überw. DL-DE BY 2.0). GRUVO © BGR.';
}

/* ---------- layers ---------- */
let VIS=[];
function applyLayer(){
  const wantModel=S.layer==='gruvo';
  VIS=(DATA.stations||[]).filter(s=>((SRC_KIND[s.source]==='model')===wantModel));
  const hs=document.getElementById('heightSel');
  if(wantModel){S.height='pct';hs.value='pct';hs.disabled=true;} else hs.disabled=false;
  document.getElementById('heightNote').textContent=HEIGHT_NOTE[S.height];
  document.getElementById('ribbonTitle').textContent=wantModel?'GRUVO-Klasse (monatlich)':'Live-Klasse (Länder)';
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

const hitList=[];
function draw(){
  ctx.clearRect(0,0,W,H);
  ctx.beginPath();
  OUTLINE.forEach((p,i)=>{const q=plane(p[0],p[1]),s=project(q.x,q.y,0);i?ctx.lineTo(s.sx,s.sy):ctx.moveTo(s.sx,s.sy);});
  ctx.closePath();ctx.fillStyle='#dfe9ec';ctx.fill();ctx.strokeStyle='#b9c8cd';ctx.lineWidth=1.2;ctx.stroke();

  const list=shown().map(st=>{const q=plane(st.lon,st.lat);return {st,q,depth:project(q.x,q.y,0).depth};})
    .sort((a,b)=>b.depth-a.depth);
  hitList.length=0;
  const flat=S.pitch>1.45;
  for(const {st,q} of list){
    const base=project(q.x,q.y,0),top=project(q.x,q.y,heightUnit(st)*MAXBAR);
    const cls=CLASS_BY[st.cls],col=cls?cls.hex:'#9aa7ad';
    const act=st.id===S.activeId,hov=st.id===S.hoverId,w=(act||hov?9:7)*S.zoom;
    if(flat){
      ctx.beginPath();ctx.arc(base.sx,base.sy,(act||hov?7:5.2)*S.zoom,0,7);
      ctx.fillStyle=col;ctx.globalAlpha=.92;ctx.fill();ctx.globalAlpha=1;
      ctx.lineWidth=1.3;ctx.strokeStyle=act?'#12242c':'#fff';ctx.stroke();
    }else{
      ctx.beginPath();ctx.ellipse(base.sx,base.sy,w*0.9,w*0.4,0,0,7);ctx.fillStyle='rgba(18,36,44,.13)';ctx.fill();
      const topY=Math.min(top.sy,base.sy),colH=Math.abs(base.sy-top.sy);
      roundRect(base.sx-w/2,topY,w,colH+w*0.35,Math.min(w/2,4));ctx.fillStyle=col;ctx.fill();
      if(act||hov){ctx.lineWidth=1.6;ctx.strokeStyle='#12242c';ctx.stroke();}
      ctx.beginPath();ctx.ellipse(base.sx,topY,w/2,w*0.28,0,0,7);ctx.fillStyle=shade(col,20);ctx.fill();
    }
    hitList.push({st,x:base.sx,yTop:Math.min(base.sy,top.sy),yBase:base.sy});
  }
}
function pick(mx,my){let best=null,bd=14;for(const h of hitList){const dx=Math.abs(mx-h.x);
  const dy=my<h.yTop?h.yTop-my:(my>h.yBase?my-h.yBase:0);const d=Math.hypot(dx,dy);if(d<bd){bd=d;best=h;}}return best?best.st:null;}

/* ---------- interaction ---------- */
let drag=null;
cv.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,moved:false};cv.setPointerCapture(e.pointerId);});
cv.addEventListener('pointermove',e=>{
  const r=cv.getBoundingClientRect(),mx=e.clientX-r.left,my=e.clientY-r.top;
  if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>2)drag.moved=true;
    S.azimuth+=dx*0.006;S.pitch=Math.max(0.28,Math.min(1.5,S.pitch+dy*0.005));
    if(S.pitch>1.45)setView('2d',true);else if(S.view==='2d'&&S.pitch<1.4)setView('3d',true);
    drag.x=e.clientX;drag.y=e.clientY;draw();
  }else{const st=pick(mx,my),tip=document.getElementById('tip');
    if(st){S.hoverId=st.id;tip.style.opacity=1;tip.style.left=mx+'px';tip.style.top=my+'px';
      tip.innerHTML='<b>'+esc(st.name)+'</b> · '+(CLASS_BY[st.cls]?CLASS_BY[st.cls].label:'—');draw();}
    else if(S.hoverId){S.hoverId=null;tip.style.opacity=0;draw();}}
});
cv.addEventListener('pointerup',e=>{if(drag&&!drag.moved){const r=cv.getBoundingClientRect();
  const st=pick(e.clientX-r.left,e.clientY-r.top);S.activeId=st?st.id:null;renderDetail(st);draw();}drag=null;});
cv.addEventListener('pointerleave',()=>{S.hoverId=null;document.getElementById('tip').style.opacity=0;draw();});
cv.addEventListener('wheel',e=>{e.preventDefault();S.zoom=Math.max(0.5,Math.min(3.2,S.zoom*(e.deltaY<0?1.1:0.9)));draw();},{passive:false});

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
}
function toggle(k){if(S.active.has(k))S.active.delete(k);else S.active.add(k);if(!S.active.size)CLASSES.forEach(c=>S.active.add(c.key));renderLegend();draw();}
function renderDetail(st){
  const d=document.getElementById('detail');
  if(!st){d.innerHTML='<div class="detail-empty">Balken antippen für Details (Meterwert, Stand, Quelle).</div>';return;}
  const cls=CLASS_BY[st.cls],src=(DATA.sources||[]).find(x=>x.id===st.source);
  const when=st.measured_at?new Date(st.measured_at).toLocaleDateString('de-DE'):'—';
  d.innerHTML='<div style="font-weight:700;font-size:15px;margin-bottom:2px">'+esc(st.name)+'</div>'+
    '<div class="muted" style="margin-bottom:8px">'+esc(st.state||'')+(st.stale?' · veraltet':'')+'</div>'+
    '<div class="badge" style="background:'+(cls?cls.hex:'#9aa7ad')+';margin-bottom:10px">'+(cls?cls.label:'ohne Klasse')+'</div>'+
    '<dl class="kv">'+kv('Perzentil',st.pct==null?'—':st.pct+' %')+kv('m ü. NHN',st.nhn==null?'—':st.nhn+' m')+
    kv('Flurabstand',st.flur==null?'—':st.flur+' m u. GOK')+kv('Stand',when)+kv('Quelle',src?esc(src.name):st.source)+'</dl>';
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
