export const GRID_VERSION='pohang-v1' as const;
const R=6371008.8,ORIGIN_LAT=36,ORIGIN_LON=129.3,REF_LAT=36.04,SIZE=200;
const RAD=Math.PI/180;
export type Cell={grid_version:typeof GRID_VERSION;cell_x:number;cell_y:number};
export function quantize(lat:number,lon:number):Cell {
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat < -90||lat>90||lon < -180||lon>180) throw new Error('INVALID_LOCATION');
  const cell_x=Math.floor(R*(lon-ORIGIN_LON)*RAD*Math.cos(REF_LAT*RAD)/SIZE);
  const cell_y=Math.floor(R*(lat-ORIGIN_LAT)*RAD/SIZE);
  return {grid_version:GRID_VERSION,cell_x,cell_y};
}
export function representative(cell:Cell):{lat:number;lon:number} {
  if(cell.grid_version!==GRID_VERSION||!Number.isSafeInteger(cell.cell_x)||!Number.isSafeInteger(cell.cell_y)) throw new Error('INVALID_CELL');
  return {lat:ORIGIN_LAT+(cell.cell_y+.5)*SIZE/R/RAD,
    lon:ORIGIN_LON+(cell.cell_x+.5)*SIZE/(R*Math.cos(REF_LAT*RAD))/RAD};
}
// Region eligibility is checked against server-controlled allowed_cells.
// Do not retain/send the raw input coordinates after quantize().
// Cell edges for drawing the allowed area. South-west and north-east corners.
export function cellBounds(cell:Cell):[[number,number],[number,number]] {
  const c=representative(cell);
  const dLat=SIZE/2/R/RAD, dLon=SIZE/2/(R*Math.cos(REF_LAT*RAD))/RAD;
  return [[c.lat-dLat,c.lon-dLon],[c.lat+dLat,c.lon+dLon]];
}
export const cellKey=(x:number,y:number)=>`${x}:${y}`;
/** 허용 셀을 가로 연속 구간 → 세로 병합해 최소한의 직사각형으로 묶는다(그리기용). */
export function mergeCells(cells:{cell_x:number;cell_y:number}[]):{x0:number;x1:number;y0:number;y1:number}[] {
  const rows=new Map<number,number[]>();
  for(const c of cells)rows.set(c.cell_y,[...(rows.get(c.cell_y)??[]),c.cell_x]);
  const runs:{x0:number;x1:number;y:number}[]=[];
  for(const [y,xs] of [...rows].sort((a,b)=>a[0]-b[0])){
    const s=[...new Set(xs)].sort((a,b)=>a-b);let start=s[0],prev=s[0];
    for(const x of s.slice(1)){if(x===prev+1){prev=x;continue;}runs.push({x0:start,x1:prev,y});start=prev=x;}
    runs.push({x0:start,x1:prev,y});
  }
  const open=new Map<string,{x0:number;x1:number;y0:number;y1:number}>();const done:{x0:number;x1:number;y0:number;y1:number}[]=[];
  for(const r of runs){
    const k=`${r.x0}:${r.x1}`;const o=open.get(k);
    if(o&&o.y1===r.y-1){o.y1=r.y;continue;}
    if(o)done.push(o);
    open.set(k,{x0:r.x0,x1:r.x1,y0:r.y,y1:r.y});
  }
  return [...done,...open.values()];
}
/** 격자 모서리 (x, y)의 위경도. 칸 (x, y)는 모서리 (x, y)~(x+1, y+1) 사이다. */
export function cornerLatLng(x:number,y:number):[number,number] {
  return [ORIGIN_LAT+y*SIZE/R/RAD, ORIGIN_LON+x*SIZE/(R*Math.cos(REF_LAT*RAD))/RAD];
}
/**
 * 허용 영역의 바깥 테두리(구멍 포함)를 모서리 좌표 선분으로 돌려준다.
 * 이웃 칸이 없는 변만 모은 뒤 같은 줄에서 이어지는 변을 하나로 합친다(그리기용).
 */
export function cellOutline(cells:{cell_x:number;cell_y:number}[]):[[number,number],[number,number]][] {
  const has=new Set(cells.map(c=>cellKey(c.cell_x,c.cell_y)));
  const hz=new Map<number,number[]>(), vt=new Map<number,number[]>();
  const add=(m:Map<number,number[]>,k:number,v:number)=>{const a=m.get(k);if(a)a.push(v);else m.set(k,[v]);};
  for(const k of has){
    const [x,y]=k.split(':').map(Number);
    if(!has.has(cellKey(x,y-1)))add(hz,y,x);      // 아래 변: y줄, x~x+1
    if(!has.has(cellKey(x,y+1)))add(hz,y+1,x);    // 위 변
    if(!has.has(cellKey(x-1,y)))add(vt,x,y);      // 왼쪽 변: x줄, y~y+1
    if(!has.has(cellKey(x+1,y)))add(vt,x+1,y);    // 오른쪽 변
  }
  const out:[[number,number],[number,number]][]=[];
  const join=(m:Map<number,number[]>,mk:(line:number,a:number,b:number)=>[[number,number],[number,number]])=>{
    for(const [line,vs] of m){
      const s=[...new Set(vs)].sort((a,b)=>a-b);let start=s[0],prev=s[0];
      for(const v of s.slice(1)){if(v===prev+1){prev=v;continue;}out.push(mk(line,start,prev+1));start=prev=v;}
      out.push(mk(line,start,prev+1));
    }
  };
  join(hz,(y,a,b)=>[[a,y],[b,y]]);
  join(vt,(x,a,b)=>[[x,a],[x,b]]);
  return out;
}
/**
 * 허용 칸들의 경계를 닫힌 고리(꼭짓점 목록, 모서리 좌표)로 돌려준다.
 * 바깥 고리는 반시계(넓이 +), 구멍은 시계(넓이 −) 방향이다. 직선 위 중간 꼭짓점은 뺀다.
 * 카카오 지도처럼 "바깥 + 구멍" 다각형만 그릴 수 있는 지도에서 쓴다.
 */
export type Ring = [number, number][];
export function cellRings(cells:{cell_x:number;cell_y:number}[]):{outer:Ring;holes:Ring[]}[] {
  const has=new Set(cells.map(c=>cellKey(c.cell_x,c.cell_y)));
  const vk=(x:number,y:number)=>`${x},${y}`;
  type Edge={a:[number,number];b:[number,number];used:boolean};
  const from=new Map<string,Edge[]>();
  const add=(a:[number,number],b:[number,number])=>{const e={a,b,used:false};const k=vk(a[0],a[1]);const l=from.get(k);if(l)l.push(e);else from.set(k,[e]);};
  for(const k of has){
    const [x,y]=k.split(':').map(Number);
    // 칸이 진행 방향 왼쪽에 오도록 방향을 정한다.
    if(!has.has(cellKey(x,y-1)))add([x,y],[x+1,y]);
    if(!has.has(cellKey(x+1,y)))add([x+1,y],[x+1,y+1]);
    if(!has.has(cellKey(x,y+1)))add([x+1,y+1],[x,y+1]);
    if(!has.has(cellKey(x-1,y)))add([x,y+1],[x,y]);
  }
  const rings:Ring[]=[];
  for(const list of from.values())for(const start of list){
    if(start.used)continue;
    const pts:Ring=[];let e=start;
    for(let guard=0;guard<4*has.size+8;guard++){
      e.used=true;pts.push(e.a);
      if(e.b[0]===start.a[0]&&e.b[1]===start.a[1])break;
      const cand=(from.get(vk(e.b[0],e.b[1]))??[]).filter(n=>!n.used);
      if(cand.length===0)break;
      // 꼭짓점이 맞닿은 곳에서는 왼쪽으로 꺾는 변을 골라 고리를 작게 닫는다.
      const dx=e.b[0]-e.a[0],dy=e.b[1]-e.a[1];
      cand.sort((p,q)=>{const turn=(n:Edge)=>{const nx=n.b[0]-n.a[0],ny=n.b[1]-n.a[1];return dx*ny-dy*nx;};return turn(q)-turn(p);});
      e=cand[0];
    }
    // 같은 직선 위 꼭짓점 제거
    const simple:Ring=[];
    for(let i=0;i<pts.length;i++){
      const p=pts[(i-1+pts.length)%pts.length],c=pts[i],n=pts[(i+1)%pts.length];
      if((c[0]-p[0])*(n[1]-c[1])-(c[1]-p[1])*(n[0]-c[0])!==0)simple.push(c);
    }
    rings.push(simple);
  }
  const area=(r:Ring)=>r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2;
  const inside=(pt:[number,number],r:Ring)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const [xi,yi]=r[i],[xj,yj]=r[j];if((yi>pt[1])!==(yj>pt[1])&&pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)c=!c;}return c;};
  const outers=rings.filter(r=>area(r)>0).map(r=>({outer:r,holes:[] as Ring[],a:area(r)})).sort((p,q)=>p.a-q.a);
  for(const h of rings.filter(r=>area(r)<0)){
    // 구멍 안쪽 점: 첫 변 가운데에서 진행 방향 오른쪽(칸이 없는 쪽)으로 조금
    const [a,b]=[h[0],h[1]];const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;const len=Math.hypot(b[0]-a[0],b[1]-a[1])||1;
    const pt:[number,number]=[mx+(b[1]-a[1])/len*0.25,my-(b[0]-a[0])/len*0.25];
    const owner=outers.find(o=>inside(pt,o.outer));
    if(owner)owner.holes.push(h);
  }
  return outers.map(({outer,holes})=>({outer,holes}));
}
