import { defineConfig, globalIgnores } from 'eslint/config';
import next from '@next/eslint-plugin-next';
import ts from 'typescript-eslint';
export default defineConfig([
  ...ts.configs.recommended,
  next.configs['core-web-vitals'],
  globalIgnores(['.next/**','.next-kakao/**','tests/e2e/kakao-mock.js','next-env.d.ts','test-results/**','playwright-report/**']),
]);
