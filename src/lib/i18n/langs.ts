// 지원 언어(lip.center와 같은 15개). 이름은 그 언어로 쓴 이름이라 번역하지 않는다.
export const LANGS = [
  { code: 'ko', name: '한국어' },
  { code: 'en', name: 'English' },
  { code: 'zh', name: '中文' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'fil', name: 'Filipino' },
  { code: 'th', name: 'ไทย' },
  { code: 'km', name: 'ខ្មែរ' },
  { code: 'ja', name: '日本語' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ne', name: 'नेपाली' },
  { code: 'si', name: 'සිංහල' },
  { code: 'mn', name: 'Монгол' },
  { code: 'uz', name: 'Oʻzbekcha' },
  { code: 'ur', name: 'اردو' },
] as const;

export type Lang = (typeof LANGS)[number]['code'];
export const RTL_LANGS: readonly Lang[] = ['ur'];

const CODES = new Set<string>(LANGS.map((l) => l.code));
// 다른 사이트가 넘길 수 있는 다른 표기. 예: zh-CN, tl, vn, jp, kr
const ALIASES: Record<string, Lang> = {
  'zh-cn': 'zh', 'zh-hans': 'zh', 'zh-sg': 'zh', 'zh-tw': 'zh', 'zh-hant': 'zh', 'zh-hk': 'zh', cn: 'zh', chi: 'zh', zho: 'zh', chinese: 'zh',
  tl: 'fil', ph: 'fil', tgl: 'fil', filipino: 'fil', tagalog: 'fil',
  vn: 'vi', vie: 'vi', vietnamese: 'vi',
  in: 'id', ind: 'id', indonesian: 'id',
  kh: 'km', khm: 'km', khmer: 'km',
  jp: 'ja', jpn: 'ja', japanese: 'ja',
  kr: 'ko', kor: 'ko', korean: 'ko',
  eng: 'en', english: 'en',
  tha: 'th', thai: 'th',
  hin: 'hi', hindi: 'hi',
  np: 'ne', nep: 'ne', nepali: 'ne',
  lk: 'si', sin: 'si', sinhala: 'si', sinhalese: 'si',
  mon: 'mn', mongolian: 'mn',
  uzb: 'uz', 'uz-latn': 'uz', uzbek: 'uz',
  urd: 'ur', pk: 'ur', urdu: 'ur',
};

/** 주소의 ?lang= 값 등을 지원 언어 코드로 바꾼다. 모르는 값이면 null. */
export function normalizeLang(input: string | null | undefined): Lang | null {
  if (!input) return null;
  const v = input.trim().toLowerCase().replace(/_/g, '-');
  if (!v || v.length > 20) return null;
  if (CODES.has(v)) return v as Lang;
  if (ALIASES[v]) return ALIASES[v];
  const base = v.split('-')[0];
  if (CODES.has(base)) return base as Lang;
  return ALIASES[base] ?? null;
}

/** <html lang>에 넣을 값. 중국어는 간체 글꼴이 고르게 나오도록 zh-Hans로 적는다. */
export function htmlLang(lang: Lang): string {
  return lang === 'zh' ? 'zh-Hans' : lang;
}
