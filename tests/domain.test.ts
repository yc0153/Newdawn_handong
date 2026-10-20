import test from 'node:test';
import assert from 'node:assert/strict';
import { quantize,representative } from '../src/lib/domain/grid';
import { validateSubmission,textLengths,validSummary,NOTICE_VERSION } from '../src/lib/domain/validation';
import { canDisplayCases,nextIndex } from '../src/lib/domain/freshness';
const base={...quantize(36.04,129.39),category:'transport',language:'ko',original_text:'가나다라마바사아자차',allow_map:false,allow_player:false,notice_version:NOTICE_VERSION};
test('minimum excludes Unicode whitespace and maximum includes it',()=>{
  assert.equal(validateSubmission(base).original_text,base.original_text);
  assert.throws(()=>validateSubmission({...base,original_text:'123456789\u00a0\t\n'}),/TEXT_TOO_SHORT/);
  assert.equal(textLengths('e\u0301').total,1);
  assert.equal(textLengths('🙂'.repeat(10)).nonspace,10);
  assert.equal(validateSubmission({...base,original_text:'x'.repeat(500)}).original_text.length,500);
  assert.throws(()=>validateSubmission({...base,original_text:'x'.repeat(501)}),/TEXT_TOO_LONG/);
  assert.equal(textLengths('a\u0085\u1680\u202f\u3000b').nonspace,2);
});
test('reject invalid consent, precise coordinates, absent and fabricated fields',()=>{
  assert.throws(()=>validateSubmission({...base,allow_player:true}),/INVALID_CONSENT/);
  assert.throws(()=>validateSubmission({...base,lat:36.04}),/INVALID_FIELDS/);
  assert.throws(()=>validateSubmission({...base,cell_x:NaN}),/INVALID_CELL/);
  assert.throws(()=>validateSubmission({...base,category:'anything'}),/INVALID_CATEGORY/);
  assert.throws(()=>validateSubmission({...base,notice_version:'wrong'}),/INVALID_NOTICE/);
});
test('review pin (staff-only exact pin): must sit inside the submitted cell, strict shape, optional',()=>{
  const c=representative(base);
  const rv={pano_id:1187902201,pin_pan:-30,pin_tilt:12.34567,view_pan:725.5,view_tilt:-3,view_zoom:1};
  const ok=validateSubmission({...base,review_pin:{lat:c.lat+0.0003,lon:c.lon-0.0004,roadview:rv}});
  assert.deepEqual(ok.review_pin,{lat:c.lat+0.0003,lon:c.lon-0.0004,roadview:{pano_id:1187902201,pin_pan:330,pin_tilt:12.346,view_pan:5.5,view_tilt:-3,view_zoom:1}});
  assert.deepEqual(validateSubmission({...base,review_pin:{lat:c.lat,lon:c.lon}}).review_pin,{lat:c.lat,lon:c.lon,roadview:null});
  // 핀이 없으면 키 자체가 없다(예전 등록과 같은 중복 판별 값).
  assert.ok(!('review_pin' in validateSubmission(base)));
  assert.ok(!('review_pin' in validateSubmission({...base,review_pin:null})));
  // 다른 칸의 좌표(약 200m 밖)는 거절
  assert.throws(()=>validateSubmission({...base,review_pin:{lat:c.lat+0.002,lon:c.lon}}),/INVALID_PIN/);
  assert.throws(()=>validateSubmission({...base,review_pin:{lat:c.lat,lon:c.lon,extra:1}}),/INVALID_PIN/);
  assert.throws(()=>validateSubmission({...base,review_pin:{lat:'36',lon:c.lon}}),/INVALID_PIN/);
  assert.throws(()=>validateSubmission({...base,review_pin:[c.lat,c.lon]}),/INVALID_PIN/);
  assert.throws(()=>validateSubmission({...base,review_pin:{lat:c.lat,lon:c.lon,roadview:{...rv,pano_id:1.5}}}),/INVALID_PIN/);
  assert.throws(()=>validateSubmission({...base,review_pin:{lat:c.lat,lon:c.lon,roadview:{...rv,pin_tilt:91}}}),/INVALID_PIN/);
  assert.throws(()=>validateSubmission({...base,review_pin:{lat:c.lat,lon:c.lon,roadview:{...rv,address:'x'}}}),/INVALID_PIN/);
  assert.throws(()=>validateSubmission({...base,review_pin:{lat:c.lat,lon:c.lon,roadview:{pano_id:1}}}),/INVALID_PIN/);
});
test('grid representative round-trip and approximate 200m spacing',()=>{
  for(const cell_x of [-5,0,10,40])for(const cell_y of [-4,0,15,30]){
    const cell={grid_version:'pohang-v1' as const,cell_x,cell_y};const point=representative(cell);
    assert.deepEqual(quantize(point.lat,point.lon),cell);
  }
  const a=representative(base),b=representative({...base,cell_y:base.cell_y+1});
  const northMeters=(b.lat-a.lat)*Math.PI/180*6371008.8;
  assert.ok(Math.abs(northMeters-200)<.0001);
  assert.throws(()=>quantize(Infinity,0),/INVALID_LOCATION/);
});
test('summary limits use codepoints and whitespace',()=>{
  assert.equal(validSummary('🙂'.repeat(250)),true);
  assert.equal(validSummary('🙂'.repeat(251)),false);
  assert.equal(validSummary('\u3000\t\n'),false);
});
test('freshness never shows expired, background, offline or unverified cases',()=>{
  assert.equal(canDisplayCases(59999,0,true,true),true);
  assert.equal(canDisplayCases(60000,0,true,true),false);
  assert.equal(canDisplayCases(1,null,true,true),false);
  assert.equal(canDisplayCases(1,0,false,true),false);
  assert.equal(canDisplayCases(1,0,true,false),false);
  assert.equal(canDisplayCases(0,1,true,true),false);
});
test('player circular navigation handles zero, one, reverse and last item',()=>{
  assert.equal(nextIndex(0,0,1),null);assert.equal(nextIndex(0,1,1),0);
  assert.equal(nextIndex(0,3,-1),2);assert.equal(nextIndex(2,3,1),0);
});

test('allowed-area outline merges edges and keeps holes', async () => {
  const { cellOutline, cornerLatLng, quantize: q } = await import('../src/lib/domain/grid');
  const norm = (segs: [[number, number], [number, number]][]) => segs.map((s) => JSON.stringify(s)).sort();
  // 가로 2칸 직사각형: 변 4개로 합쳐진다.
  assert.deepEqual(norm(cellOutline([{ cell_x: 0, cell_y: 0 }, { cell_x: 1, cell_y: 0 }])),
    norm([[[0, 0], [2, 0]], [[0, 1], [2, 1]], [[0, 0], [0, 1]], [[2, 0], [2, 1]]]));
  // 3x3에서 가운데가 빠지면 바깥 4변 + 구멍 4변.
  const ring = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (x !== 1 || y !== 1) ring.push({ cell_x: x, cell_y: y });
  assert.equal(cellOutline(ring).length, 8);
  // 모서리 좌표는 그 칸 안의 점을 다시 같은 칸으로 격자화한다.
  const [lat, lon] = cornerLatLng(40.5, 44.5);
  assert.deepEqual(q(lat, lon), { grid_version: 'pohang-v1', cell_x: 40, cell_y: 44 });
});

test('allowed-area rings: outer counter-clockwise, holes clockwise, pinch corners close', async () => {
  const { cellRings } = await import('../src/lib/domain/grid');
  const area = (r: [number, number][]) => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  const two = cellRings([{ cell_x: 0, cell_y: 0 }, { cell_x: 1, cell_y: 0 }]);
  assert.equal(two.length, 1);
  assert.equal(two[0].outer.length, 4);
  assert.equal(area(two[0].outer), 2);
  const ring = [];
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) if (x !== 1 || y !== 1) ring.push({ cell_x: x, cell_y: y });
  const withHole = cellRings(ring);
  assert.equal(withHole.length, 1);
  assert.equal(area(withHole[0].outer), 9);
  assert.equal(withHole[0].holes.length, 1);
  assert.equal(area(withHole[0].holes[0]), -1);
  // 대각선으로만 맞닿은 두 칸: 고리 2개로 닫힌다.
  const pinch = cellRings([{ cell_x: 0, cell_y: 0 }, { cell_x: 1, cell_y: 1 }]);
  assert.equal(pinch.length, 2);
  assert.deepEqual(pinch.map((p) => area(p.outer)), [1, 1]);
  // 떨어진 두 덩어리
  assert.equal(cellRings([{ cell_x: 0, cell_y: 0 }, { cell_x: 5, cell_y: 5 }]).length, 2);
});
