import { GRID_VERSION, quantize, type Cell } from './grid';
import type { ReviewPin, ReviewRoadview } from './types';
export const CATEGORIES=['transport','language','environment','other'] as const;
export const LANGUAGES=['ko','en','other'] as const;
/** 개발 기본 공개 안내 버전. 실제 비교는 DB(service_settings.notice_version)와 한다. */
export const NOTICE_VERSION='2026-10-20-v2';
export type Submission=Cell & {category:typeof CATEGORIES[number];language:typeof LANGUAGES[number];original_text:string;allow_map:boolean;allow_player:boolean;notice_version:string;review_pin?:ReviewPin};
const KEYS=['grid_version','cell_x','cell_y','category','language','original_text','allow_map','allow_player','notice_version'];
// 선택 필드: 담당자 검토용 정확한 핀. 공개 경로에는 쓰지 않는다.
const OPTIONAL=['review_pin'];
const PIN_KEYS=['lat','lon','roadview'];
const RV_KEYS=['pano_id','pin_pan','pin_tilt','view_pan','view_tilt','view_zoom'];
export class ValidationError extends Error {
  constructor(public code:string,public field?:string){super(code);}
}
export function textLengths(text:string){
  const normalized=text.normalize('NFC');
  return {normalized,total:[...normalized].length,nonspace:[...normalized.replace(/\p{White_Space}/gu,'')].length};
}
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const round=(v:number,d:number)=>Math.round(v*10**d)/10**d;
const pan=(v:number)=>{const p=round(((v%360)+360)%360,3);return p>=360?0:p;};
const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);

/**
 * 담당자 검토용 핀 검사. 좌표는 제출한 칸 안이어야 한다(다른 곳 좌표를 끼워 넣지 못하게).
 * 로드뷰 값은 방향(도)과 확대 단계만 받는다. 좌표는 반올림하지 않는다(칸 경계를 넘지 않도록).
 */
export function validateReviewPin(input:unknown,cell:{cell_x:number;cell_y:number}):ReviewPin {
  const bad=()=>new ValidationError('INVALID_PIN','location');
  if(!plain(input)||Object.keys(input).some(k=>!PIN_KEYS.includes(k))||!num(input.lat)||!num(input.lon))throw bad();
  let q;
  try{q=quantize(input.lat,input.lon);}catch{throw bad();}
  if(q.cell_x!==cell.cell_x||q.cell_y!==cell.cell_y)throw bad();
  let roadview:ReviewRoadview|null=null;
  const rv=input.roadview;
  if(rv!==undefined&&rv!==null){
    if(!plain(rv)||Object.keys(rv).length!==RV_KEYS.length||RV_KEYS.some(k=>!num(rv[k])))throw bad();
    const r=rv as Record<string,number>;
    if(!Number.isSafeInteger(r.pano_id)||r.pano_id<=0)throw bad();
    if(Math.abs(r.pin_tilt)>90||Math.abs(r.view_tilt)>90||Math.abs(r.view_zoom)>3)throw bad();
    roadview={pano_id:r.pano_id,pin_pan:pan(r.pin_pan),pin_tilt:round(r.pin_tilt,3),view_pan:pan(r.view_pan),view_tilt:round(r.view_tilt,3),view_zoom:round(r.view_zoom,3)};
  }
  return {lat:input.lat,lon:input.lon,roadview};
}

/** expectedNotice가 null이면 형식만 검사한다(서버: DB의 현재 안내 버전과 RPC에서 비교). */
export function validateSubmission(input:unknown,expectedNotice:string|null=NOTICE_VERSION):Submission {
  if(!plain(input))throw new ValidationError('INVALID_BODY');
  const x=input;
  if(Object.keys(x).some(k=>!KEYS.includes(k)&&!OPTIONAL.includes(k))||KEYS.some(k=>!(k in x)))throw new ValidationError('INVALID_FIELDS');
  if(x.grid_version!==GRID_VERSION)throw new ValidationError('INVALID_GRID','grid_version');
  if(!Number.isSafeInteger(x.cell_x)||!Number.isSafeInteger(x.cell_y))throw new ValidationError('INVALID_CELL','cell_x');
  if(!CATEGORIES.includes(x.category as Submission['category']))throw new ValidationError('INVALID_CATEGORY','category');
  if(!LANGUAGES.includes(x.language as Submission['language']))throw new ValidationError('INVALID_LANGUAGE','language');
  if(typeof x.allow_map!=='boolean'||typeof x.allow_player!=='boolean')throw new ValidationError('INVALID_CONSENT');
  if(x.allow_player&&!x.allow_map)throw new ValidationError('INVALID_CONSENT','allow_player');
  if(typeof x.notice_version!=='string'||x.notice_version.length<1||x.notice_version.length>64||(expectedNotice!==null&&x.notice_version!==expectedNotice))throw new ValidationError('INVALID_NOTICE','notice_version');
  if(typeof x.original_text!=='string')throw new ValidationError('INVALID_TEXT','original_text');
  const text=textLengths(x.original_text);
  if(text.nonspace<10)throw new ValidationError('TEXT_TOO_SHORT','original_text');
  if(text.total>500)throw new ValidationError('TEXT_TOO_LONG','original_text');
  const cell={cell_x:x.cell_x as number,cell_y:x.cell_y as number};
  const review_pin=x.review_pin===undefined||x.review_pin===null?undefined:validateReviewPin(x.review_pin,cell);
  return {grid_version:GRID_VERSION,...cell,
    category:x.category as Submission['category'],language:x.language as Submission['language'],
    original_text:text.normalized,allow_map:x.allow_map,allow_player:x.allow_player,notice_version:x.notice_version,
    // 핀이 없으면 키 자체를 넣지 않는다(예전 등록과 같은 중복 판별 값 유지).
    ...(review_pin?{review_pin}:{})};
}
export function validSummary(text:string){const x=textLengths(text);return x.nonspace>0&&x.total<=250;}
