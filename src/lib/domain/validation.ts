import { GRID_VERSION, type Cell } from './grid';
export const CATEGORIES=['transport','language','environment','other'] as const;
export const LANGUAGES=['ko','en','other'] as const;
export const NOTICE_VERSION='2026-10-06-v1';
export type Submission=Cell & {category:typeof CATEGORIES[number];language:typeof LANGUAGES[number];original_text:string;allow_map:boolean;allow_player:boolean;notice_version:string};
const KEYS=['grid_version','cell_x','cell_y','category','language','original_text','allow_map','allow_player','notice_version'];
export class ValidationError extends Error {
  constructor(public code:string,public field?:string){super(code);}
}
export function textLengths(text:string){
  const normalized=text.normalize('NFC');
  return {normalized,total:[...normalized].length,nonspace:[...normalized.replace(/\p{White_Space}/gu,'')].length};
}
/** expectedNotice가 null이면 형식만 검사한다(서버: DB의 현재 안내 버전과 RPC에서 비교). */
export function validateSubmission(input:unknown,expectedNotice:string|null=NOTICE_VERSION):Submission {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ValidationError('INVALID_BODY');
  const x=input as Record<string,unknown>;
  if(Object.keys(x).some(k=>!KEYS.includes(k))||KEYS.some(k=>!(k in x)))throw new ValidationError('INVALID_FIELDS');
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
  return {grid_version:GRID_VERSION,cell_x:x.cell_x as number,cell_y:x.cell_y as number,
    category:x.category as Submission['category'],language:x.language as Submission['language'],
    original_text:text.normalized,allow_map:x.allow_map,allow_player:x.allow_player,notice_version:x.notice_version};
}
export function validSummary(text:string){const x=textLengths(text);return x.nonspace>0&&x.total<=250;}
