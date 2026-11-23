/** Reglas de arquitectura hexagonal de Jarvis. */
const LUXON = ['(^|/)node_modules/luxon/', '(^|/)node_modules/@types/luxon/', '^luxon$'];
const ZOD = ['(^|/)node_modules/zod/', '^zod$'];
const TESTS = '\\.test\\.ts$';
const TEST_FILES = '\\.test(-support)?\\.ts$';
// Los tests colocados pueden importar el runner.
const VITEST = ['(^|/)node_modules/vitest/', '(^|/)node_modules/@vitest/', '^vitest(/|$)'];
const ADAPTER_PKG = ['^packages/adapters-[^/]+/', '^@jarvis/adapters-', '(^|/)node_modules/@jarvis/adapters-'];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-pure',
      comment: 'domain no importa nada fuera de sí mismo salvo luxon (los tests pueden importar vitest).',
      severity: 'error',
      from: { path: '^packages/core/src/domain/' },
      to: { pathNot: ['^packages/core/src/domain/', ...LUXON, ...VITEST] },
    },
    {
      name: 'application-only-domain',
      comment: 'application sólo importa domain/application (más luxon y zod).',
      severity: 'error',
      from: { path: '^packages/core/src/application/', pathNot: TEST_FILES },
      to: {
        pathNot: ['^packages/core/src/domain/', '^packages/core/src/application/', ...LUXON, ...ZOD],
      },
    },
    {
      name: 'application-tests-only-domain-and-doubles',
      comment: 'Los tests de application (y sus *.test-support.ts) además pueden importar vitest y los dobles de core/testing.',
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
        'Sólo las raíces de composición (packages/composition, apps/*/src/**/*.module.ts, apps/*/src/cli/**) y sus tests importan adaptadores; un adaptador puede importar su propio paquete.',
      severity: 'error',
      from: {
        pathNot: [
          '^packages/composition/src/',
          '^apps/[^/]+/src/.*\\.module\\.ts$',
          '^apps/[^/]+/src/cli/',
          '^apps/[^/]+/src/.*' + TESTS,
          '^packages/(adapters-[^/]+)/', // se refina en la regla siguiente
        ],
      },
      to: { path: ADAPTER_PKG },
    },
    {
      name: 'adapters-no-cross-import',
      comment: 'Un adaptador no importa a otro adaptador (sí a sí mismo).',
      severity: 'error',
      from: { path: '^packages/(adapters-[^/]+)/' },
      to: { path: ADAPTER_PKG, pathNot: '^packages/$1/' },
    },
    {
      name: 'composition-only-from-apps',
      comment: 'La raíz de composición compartida (packages/composition) sólo la importan las apps.',
      severity: 'error',
      from: { path: '^packages/', pathNot: '^packages/composition/' },
      to: { path: ['^packages/composition/', '^@jarvis/composition', '(^|/)node_modules/@jarvis/composition'] },
    },
    {
      name: 'adapters-not-apps',
      comment: 'Los adaptadores no importan apps.',
      severity: 'error',
      from: { path: '^packages/adapters-' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    exclude: { path: '(^|/)dist/' },
  },
};
