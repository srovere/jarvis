import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    // src/e2e/ boots a long-running server for the Playwright smoke test (vitest.e2e.config.ts).
    test: { include: ['src/**/*.test.ts'], exclude: ['src/e2e/**', '**/node_modules/**'] },
  }),
);
