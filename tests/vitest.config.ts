import { defineConfig } from 'vitest/config';

// Repository-level tests (the `./jarvis` script); they need no build and no Docker.
export default defineConfig({
  test: { include: ['*.test.ts'], testTimeout: 30_000 },
});
