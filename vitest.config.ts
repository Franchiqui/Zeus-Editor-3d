import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Tests de UNIDAD (rápidos, sin navegador). Los de navegador viven en
 * `e2e/*.spec.ts` y se corren con `npm run test:e2e` (Playwright) — no aquí.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});