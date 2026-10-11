// 검수용 로컬 지도 타일. 실제 지도가 아니라 "TEST TILE" 격자 이미지다(외부 타일 서버 접근이 막힌 검수 환경용).
import http from 'node:http';
const port = Number(process.env.TILE_PORT ?? 8099);
http.createServer((req, res) => {
  const m = req.url.match(/^\/(\d+)\/(\d+)\/(\d+)\.svg$/);
  if (!m) { res.writeHead(404); return res.end(); }
  const [, z, x, y] = m;
  const shade = (Number(x) + Number(y)) % 2 ? '#e7edf2' : '#edf2f6';
  res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
  res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${shade}"/><path d="M0 .5H256M.5 0V256" stroke="#c9d5df"/><path d="M0 128H256M128 0V256" stroke="#dbe3ea" stroke-dasharray="4 4"/><text x="8" y="20" font-family="sans-serif" font-size="11" fill="#9aabba">TEST TILE ${z}/${x}/${y}</text></svg>`);
}).listen(port, '127.0.0.1', () => console.log('tile server on', port));
