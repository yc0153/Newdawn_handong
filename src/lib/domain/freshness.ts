export const POLL_INTERVAL_MS=30_000;
export const MAX_UNVERIFIED_MS=60_000;
export const PLAYER_INTERVAL_MS=12_000;
// Pass a monotonic timestamp, e.g. performance.now().
export function canDisplayCases(now:number,lastVerified:number|null,online:boolean,visible:boolean){
  return online&&visible&&lastVerified!==null&&now>=lastVerified&&now-lastVerified<MAX_UNVERIFIED_MS;
}
export function nextIndex(current:number,total:number,direction:1|-1){
  if(total<=0)return null;
  return ((current+direction)%total+total)%total;
}
