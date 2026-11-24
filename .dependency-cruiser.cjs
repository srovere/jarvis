/** Jarvis's hexagonal architecture rules. */
const LUXON = ['(^|/)node_modules/luxon/', '(^|/)node_modules/@types/luxon/', '^luxon$'];
const ZOD = ['(^|/)node_modules/zod/', '^zod$'];
const TESTS = '\\.test\\.ts$';
const TEST_FILES = '\\.test(-support)?\\.ts$';
// Co-located tests may import the runner.
const VITEST = ['(^|/)node_modules/vitest/', '(^|/)node_modules/@vitest/', '^vitest(/|$)'];
const ADAPTER_PKG = ['^packages/adapters-[^/]+/', '^@jarvis/adapters-', '(^|/)node_modules/@jarvis/adapters-'];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-pure',
      comment: 'domain imports nothing outside itself except luxon (tests may import vitest).',
      severity: 'error',
      from: { path: '^packages/core/src/domain/' },
      to: { pathNot: ['^packages/core/src/domain/', ...LUXON, ...VITEST] },
    },
    {
      name: 'application-only-domain',
      comment: 'application only imports domain/application (plus luxon and zod).',
      severity: 'error',
      from: { path: '^packages/core/src/application/', pathNot: TEST_FILES },
      to: {
        pathNot: ['^packages/core/src/domain/', '^packages/core/src/application/', ...LUXON, ...ZOD],
      },
    },
    {
      name: 'application-tests-only-domain-and-doubles',
      comment: 'application tests (and their *.test-support.ts) may also import vitest and the core/testing doubles.',
      severity: 'error',
      from: { path: '^packages/core/src/application/.*' + TEST_FILES },
      to: {
        pathNot: [
          '^packages/core/src/domain/',
          '^packages/core/src/application/',
          '^packages/core/src/testing/',
          ...LUXON,
          ...ZOD,
          ...VITEST,
        ],
      },
    },
    {
      name: 'adapters-only-from-composition-roots',
      comment:
        'Only composition roots (packages/composition, apps/*/src/**/*.module.ts, apps/*/src/cli/**) and their tests import adapters; an adapter may import its own package.',
      severity: 'error',
      from: {
        pathNot: [
          '^packages/composition/src/',
          '^apps/[^/]+/src/.*\\.module\\.ts$',
          '^apps/[^/]+/src/cli/',
          '^apps/[^/]+/src/.*' + TESTS,
          '^packages/(adapters-[^/]+)/', // refined by the next rule
        ],
      },
      to: { path: ADAPTER_PKG },
    },
    {
      name: 'adapters-no-cross-import',
      comment: 'An adapter does not import another adapter (itself is fine).',
      severity: 'error',
      from: { path: '^packages/(adapters-[^/]+)/' },
      to: { path: ADAPTER_PKG, pathNot: '^packages/$1/' },
    },
    {
      name: 'composition-only-from-apps',
      comment: 'The shared composition root (packages/composition) is only imported by apps.',
      severity: 'error',
      from: { path: '^packages/', pathNot: '^packages/composition/' },
      to: { path: ['^packages/composition/', '^@jarvis/composition', '(^|/)node_modules/@jarvis/composition'] },
    },
    {
      name: 'apps-isolated',
      comment:
        'An app (worker, mcp-server, api) never imports another app; the api reaches mcp-server only through MCP (its tests may boot the server in-process).',
      severity: 'error',
      from: { path: '^apps/([^/]+)/', pathNot: TEST_FILES },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'web-isolated',
      comment: 'apps/web (browser code) imports no @jarvis/* package and nothing under packages/.',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: ['^packages/', '^@jarvis/', '(^|/)node_modules/@jarvis/'] },
    },
    {
      name: 'adapters-not-apps',
      comment: 'Adapters do not import apps.',
      severity: 'error',
      from: { path: '^packages/adapters-' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    exclude: { path: '(^|/)(dist|node_modules)/' },
  },
};
