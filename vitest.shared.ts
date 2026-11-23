import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const packages = resolve(__dirname, 'packages');

// Tests resolve workspace packages (@jarvis/<pkg>[/subpath]) to their TypeScript source,
// without depending on `dist` (which may be missing or stale).
export const sharedConfig = defineConfig({
  resolve: {
    alias: [
      { find: /^@jarvis\/([^/]+)$/, replacement: `${packages}/$1/src/index.ts` },
      { find: /^@jarvis\/([^/]+)\/(.+)$/, replacement: `${packages}/$1/src/$2` },
    ],
  },
});
