import { defineConfig } from 'vitest/config';
import { thirdPartyLicenses } from './build/licenses.mjs';

export default defineConfig({
  base: './',
  // 公開物に第三者ライセンス（three.js の MIT License の著作権表示と許諾文）を含める（レビュー指摘 7）
  plugins: [thirdPartyLicenses()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
