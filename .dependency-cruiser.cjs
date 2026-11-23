/** Reglas de arquitectura hexagonal de Jarvis. */


/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-pure',
      comment: 'domain no importa nada fuera de sí mismo salvo luxon.',
      severity: 'error',
      from: { path: '^packages/core/src/domain/' },
      to: {
        pathNot: ['^packages/core/src/domain/', '^node_modules/luxon/', '^node_modules/@types/luxon/'],
      },
    },
    {
      name: 'application-only-domain',
      comment: 'application sólo importa domain/application (más luxon y zod).',
      severity: 'error',
      from: { path: '^packages/core/src/application/' },
      to: {
        pathNot: [
          '^packages/core/src/domain/',
          '^packages/core/src/application/',
          '^node_modules/luxon/',
          '^node_modules/@types/luxon/',
          '^node_modules/zod/',
        ],
      },
    },
    {
      name: 'adapters-only-from-apps',
      comment: 'Sólo apps/** puede importar @jarvis/adapters-*.',
      severity: 'error',
      from: { pathNot: '^apps/' },
      to: { path: ['^packages/adapters-[^/]+/', '/@jarvis/adapters-[^/]+/'] },
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
