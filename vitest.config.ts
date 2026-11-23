import { defineConfig } from 'vitest/config';

// Reemplaza a vitest.workspace.ts (deprecado en vitest 3.2): cada paquete tiene su propia config.
export default defineConfig({
  test: { projects: ['packages/*', 'apps/*'] },
});
