import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const packages = resolve(__dirname, 'packages');

// Los tests resuelven los paquetes del workspace (@jarvis/<pkg>[/subruta]) a su código fuente TypeScript,
// sin depender de `dist` (que puede estar ausente o desactualizado).
export const sharedConfig = defineConfig({
  resolve: {
    alias: [
      { find: /^@jarvis\/([^/]+)$/, replacement: `${packages}/$1/src/index.ts` },
      { find: /^@jarvis\/([^/]+)\/(.+)$/, replacement: `${packages}/$1/src/$2` },
    ],
  },
});
