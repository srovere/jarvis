import { defineConfig } from 'vitest/config';

// Replaces vitest.workspace.ts (deprecated in vitest 3.2): each package has its own config.
export default defineConfig({
  test: { projects: ['packages/*', 'apps/*'] },
});
