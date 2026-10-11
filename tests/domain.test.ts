import test from 'node:test';
import assert from 'node:assert/strict';
import { quantize,representative } from '../src/lib/domain/grid';
import { validateSubmission,textLengths,validSummary } from '../src/lib/domain/validation';
import { canDisplayCases,nextIndex } from '../src/lib/domain/freshness';
const base={...quantize(36.04,129.39),category:'transport',language:'ko',original_text:'가나다라마바사아자차',allow_map:false,allow_player:false,notice_version:'2026-10-06-v1'};
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
