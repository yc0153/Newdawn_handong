// 등록 성공 결과를 완료 화면으로 넘기는 메모리 저장소. URL·브라우저 저장소에 넣지 않는다.
let lastReceipt: { reference: string } | null = null;
export function setReceipt(r: { reference: string }) { lastReceipt = r; }
// 읽어도 지우지 않는다(개발 모드 이중 실행 대비). 새 의견 작성 화면이 열릴 때 지운다.
export function peekReceipt() { return lastReceipt; }
export function clearReceipt() { lastReceipt = null; }
