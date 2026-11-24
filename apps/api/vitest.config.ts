import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';
import { sharedConfig } from '../../vitest.shared';

export default mergeConfig(
  sharedConfig,
  defineConfig({
    plugins: [swc.vite({ module: { type: 'es6' } })],
    test: { include: ['src/**/*.test.ts'] },
  }),
);
