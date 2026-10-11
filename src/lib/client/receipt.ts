// 등록 성공 결과를 완료 화면으로 넘기는 메모리 저장소. URL·브라우저 저장소에 넣지 않는다.
let lastReceipt: { reference: string } | null = null;
export function setReceipt(r: { reference: string }) { lastReceipt = r; }
export function takeReceipt() { const r = lastReceipt; lastReceipt = null; return r; }
