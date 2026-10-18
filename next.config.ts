import type { NextConfig } from 'next';

// 학교 사이트 iframe 삽입을 허용할 출처(공백 구분). 비어 있으면 같은 출처만 허용한다.
// 이 값은 빌드 시 헤더에 반영되므로 배포 설정에서 지정한 뒤 빌드한다.
const frameAncestors = ["'self'", ...(process.env.ALLOWED_FRAME_ANCESTORS ?? '').split(/\s+/).filter(Boolean)].join(' ');

const common = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // GPS·카메라·마이크를 쓰지 않는다.
  { key: 'Permissions-Policy', value: 'geolocation=(), camera=(), microphone=(), payment=()' },
];

const config: NextConfig = {
  // 검수용으로 설정이 다른 두 번째 빌드를 나란히 둘 때만 바꾼다(기본 .next).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  // 로컬 DB 모드의 내장 Postgres(WASM)는 번들하지 않고 node_modules에서 그대로 불러온다.
  serverExternalPackages: ['@electric-sql/pglite'],
  async headers() {
    return [
      { source: '/:path*', headers: [...common, { key: 'Content-Security-Policy', value: `frame-ancestors ${frameAncestors}` }] },
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }] },
      {
        source: '/admin/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};
export default config;
