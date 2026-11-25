import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const root = resolve(import.meta.dirname, '..', '..');

// The smoke test drives the built dashboard served by the real api + mcp-server, started in-process by a test
// harness (apps/api/src/e2e) with a Postgres container and simulated Google and Claude. No Docker Compose involved.
//
// The api only answers to `Host: 127.0.0.1:3000` and its OAuth redirect URI is fixed to that address. So the browser
// always uses http://127.0.0.1:3000, and a forward proxy started by the harness (127.0.0.1:3101) hands those requests
// to the api on a private port. That keeps the smoke test independent of whatever else listens on port 3000.
const PROXY = 'http://127.0.0.1:3101';
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        // `<-loopback>` re-enables the proxy for 127.0.0.1, which Chromium bypasses by default.
        launchOptions: { args: [`--proxy-server=${PROXY}`, '--proxy-bypass-list=<-loopback>'] },
      },
    },
  ],
  webServer: {
    command: 'pnpm --filter @jarvis/web build && pnpm --filter @jarvis/api e2e:server',
    cwd: root,
    env: { JARVIS_WEB_DIST: resolve(root, 'apps', 'web', 'dist') },
    url: PROXY, // answers 200 once the stack behind it is up
    reuseExistingServer: false,
    timeout: 240_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
  },
});
