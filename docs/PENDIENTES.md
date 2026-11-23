# Jarvis — Pendientes

Estado al 2026-11-23. Mergeado a `main` (rama `feat/jarvis-fase1`).

## Dónde estamos

**Fase 1 (Fundación + Google + servidor MCP): implementada.** Las 16 tareas del plan
[`superpowers/plans/2026-11-23-jarvis-fase1-fundacion-google-mcp.md`](superpowers/plans/2026-11-23-jarvis-fase1-fundacion-google-mcp.md)
están terminadas; cada una pasó revisión de spec y calidad (con rondas de corrección cuando hizo falta).

- 348 tests pasando; `pnpm lint:deps` sin violaciones; `pnpm typecheck` limpio (después de `pnpm build`).
- Verificado en Docker (sin cuenta de Google): `db` sana, `migrate` sale 0, `worker` arriba,
  `mcp-server` sano, `/health` → `{"status":"ok"}`, `/mcp` sin token → 401, con token lista las 10 herramientas.
- Verificado contra Postgres real: `jarvis migrate` y `jarvis sync --once`.

Diseño: [`superpowers/specs/2026-11-23-jarvis-design.md`](superpowers/specs/2026-11-23-jarvis-design.md) ·
Arquitectura: [`architecture.md`](architecture.md) · Instalación: [`../README.md`](../README.md)

## Próximos pasos (en orden)

1. **Revisión final de toda la rama** (modelo más capaz) + una sola ronda de correcciones con los
   pendientes técnicos de abajo que se decidan arreglar antes del merge.
2. **Verificación real con la cuenta de Google** siguiendo el README: proyecto en Google Cloud,
   secretos, `jarvis.config.yaml`, `docker compose run … auth`, `docker compose up -d`,
   `claude mcp add …`. Crear un borrador y un evento de prueba sólo con confirmación explícita.
3. ~~Merge de `feat/jarvis-fase1` a `main`~~ — hecho el 2026-11-23 (sin la revisión final; hacerla sobre `main`).
4. **Documentación** (ver sección siguiente).
5. Fases siguientes del diseño: 2 Proyectos (local/SSH, descubrimiento, personas, espejo de tareas) ·
   3 Agente (Claude Code, highlights, resúmenes de reunión, aprobación de acciones) ·
   4 API + dashboard React + chat · 5 Analíticas.

## Documentación pendiente

- [ ] **Diagrama de arquitectura** — actualizar `docs/architecture.md` con lo construido realmente:
      paquete `@jarvis/composition` (raíz de composición compartida), `apps/worker` y `apps/mcp-server`,
      flujo de sincronización con reconciliación, despliegue Docker (servicios, secretos, volúmenes, puertos).
- [ ] **Explicación de tablas y entidades** — cada tabla de `packages/adapters-persistence/src/schema.ts`
      (columnas, claves únicas, FKs, índices), su correspondencia con las entidades del dominio
      (`packages/core/src/domain/model`) y las reglas de negocio de los repositorios (hilos de correo,
      unicidad por calendario/lista, reconciliación en resync completo, cursores de sincronización).
- [ ] **Explicación detallada del funcionamiento del MCP** — transporte Streamable HTTP con sesiones,
      autenticación por token, las 10 herramientas (entradas, salidas, errores, ejemplos), marcado de
      contenido externo (`<external_content>`), reglas de borradores (nunca envía, respuesta en hilo,
      destinatario por defecto), bloques de foco (búsqueda de hueco, deduplicación), y cómo lo usa Claude Code.
- [ ] **Documentación del producto** — qué es Jarvis, para qué sirve, casos de uso del día a día
      (briefing matinal, foco, pendientes desde correos, borradores), qué hace y qué no hace (seguridad,
      privacidad, límites), roadmap de fases.
- [ ] **Guía de instalación y configuración** — ampliar el README a una guía completa paso a paso:
      requisitos, Google Cloud (con capturas o detalle de cada pantalla), secretos y permisos, todas las
      claves de `jarvis.config.yaml` y overrides `JARVIS__…`, varias cuentas, operación diaria
      (logs, `sync --once`, re-autorizar), actualización, backup/restore de Postgres, mover a otra máquina,
      problemas frecuentes.

## Pendientes técnicos (para la revisión final)

### Prioritarios

- `jarvis sync --once` sale con código 0 cuando una cuenta queda `needs_reauth` (todo "skipped").
  Incluir el estado de la cuenta en el resumen y salir con error.
- README: la solución de problemas sugiere `chmod 644` para los secretos; preferir
  `chown 1000:1000` o `setfacl`, y aclarar el uid en el paso 2.
- `pnpm typecheck` en un clon limpio necesita `pnpm build` antes (los tipos se resuelven desde `dist`);
  los archivos de test no se chequean (`tsconfig.test.json`). Corregir la aridad de
  `InMemoryMailProvider.sync` que esto oculta.
- Cuentas eliminadas de la config siguen `active` en la base y se siguen sincronizando.
- MCP: sesiones sin TTL de inactividad (crecen hasta reiniciar); asunto y remitente de correos no se
  marcan como contenido externo; faltan tests de 401 para GET/DELETE.
- `ProvidersModule`: el `inject` posicional pierde chequeo de tipos del orden de argumentos.

### Menores

- Estilo: archivos de `email-cleaner` con comillas dobles (el resto simples).
- EmailCleaner: `&#0;` decodifica a NUL; truncado puede cortar pares sustitutos.
- FreeSlotFinder: faltan tests de bordes (eventos desordenados, `now` después de hora fin, fin de semana,
  horizonte agotado); sin validación de entradas.
- Gmail: encabezados largos sin plegar; cuerpos sólo con `attachmentId` se pierden; sync completo
  secuencial y en memoria; resúmenes de hilo cuentan borradores.
- Persistencia: recálculo N+1 de hilos; títulos de calendario placeholder nunca se corrigen;
  `upsertLists` sin transacción; puerto de DB fijo en 5432.
- OAuth: comparación de `state` no constante; permisos del directorio de tokens existente no se ajustan.
- Logs JSON sin timestamp; `main.ts` del worker importa el módulo CLI.
- Worker sin healthcheck en Docker.

## Decisiones tomadas durante la implementación (revisables)

- OAuth escucha en `127.0.0.1:${JARVIS_OAUTH_PORT ?? 53682}` (puerto fijo para Docker).
- Tests de Vitest resuelven `@jarvis/*` al código fuente (config compartida `vitest.shared.ts`).
- Reglas de capas con dependency-cruiser; sólo `*.module.ts`, `cli/**`, tests y `packages/composition`
  pueden importar adaptadores.
- EmailCleaner: se eliminan las líneas citadas con `>` (no se corta el cuerpo); un encabezado
  "El … escribió:" / "On … wrote:" sólo cuenta si tiene `@` o le sigue una cita; si queda vacío se usa el snippet.
- Unicidad: eventos por `(cuenta, calendario, id)`, tareas por `(cuenta, lista, id)`.
- Gmail: los borradores (`DRAFT`) no se sincronizan ni se usan como ancla de respuesta; mensajes en
  papelera/spam se eliminan; en un hilo sólo propio se responde al último remitente ajeno o se informa error.
- Google Tasks: cursor sin pérdidas `<iso>|<ids>`; las fechas de vencimiento se interpretan como fecha
  local en la zona configurada.
- Calendario: eventos de duración cero se amplían a 1 minuto; días completos sin fin duran 1 día.
- Resync completo: se borran localmente los elementos ausentes del snapshot dentro de la ventana
  (correo 90 días, calendario 30 días, tareas toda la lista).
- Bloque de foco: se busca duplicado antes de buscar hueco, en todo el horizonte; no se pueden tener dos
  bloques con el mismo nombre pendientes a la vez.
- Briefing: si falla obtener las direcciones propias de una cuenta, se usa el correo de la cuenta.
- Composición compartida en el paquete `@jarvis/composition`; `@nestjs/schedule` fijado en ^6 y
  `commander` en ^13 (las versiones nuevas son sólo ESM).
