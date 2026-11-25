import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedConfig } from '../../vitest.shared';

// Not a test: this boots the stack the Playwright smoke test (apps/web/e2e) drives. See src/e2e/smoke-server.test.ts.
export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: { include: ['src/e2e/**/*.test.ts'], testTimeout: 0, hookTimeout: 180_000 },
  }),
);
