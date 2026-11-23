# Jarvis — Fase 1: Fundación + Google + servidor MCP — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo TypeScript con dominio de puertos y adaptadores, persistencia en Postgres, integración con Gmail, Google Calendar y Google Tasks (multi-cuenta), un worker que sincroniza y un servidor MCP por HTTP usable desde Claude Code, todo levantado con Docker Compose.

**Architecture:** Dominio en TypeScript puro (`packages/core`) con interfaces (puertos); adaptadores de Google y de persistencia (Drizzle) en paquetes separados que las implementan; apps NestJS (`worker`, `mcp-server`) como raíz de composición con inyección de dependencias. Ver `docs/architecture.md`.

**Tech Stack:** Node 22, pnpm workspaces, TypeScript 5 (CommonJS, `module: Node16`), NestJS 11 (+ `@nestjs/schedule`), `@modelcontextprotocol/sdk` (Streamable HTTP), Drizzle ORM + `pg` + drizzle-kit, PostgreSQL 17, `googleapis` + `google-auth-library`, Luxon, Zod, `html-to-text`, `yaml`, `commander`, Vitest (+ `unplugin-swc` para decoradores), `@testcontainers/postgresql`, dependency-cruiser, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-23-jarvis-design.md` · Arquitectura: `docs/architecture.md`

**Esta es la fase 1 de 5.** Siguientes planes (se escriben al terminar la anterior):
2. Proyectos: `ProjectTransport` (local/SSH + `jarvis-remote`), descubrimiento, snapshots, personas y vinculación, espejo de tareas.
3. Agente: `AgentRunner` (Claude Code), cola de IA, highlights y resúmenes de reunión, `propose_action`.
4. `api` + dashboard React + chat.
5. Analíticas. (El agente nocturno es un proyecto aparte posterior.)

## Global Constraints

- **Nunca API key de Anthropic.** Ningún paquete de este plan llama a un modelo.
- **Nunca enviar correos.** No existe método, puerto ni herramienta de envío; sólo `drafts.create`.
- Scopes OAuth exactos: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.compose`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/tasks`. Nunca `https://mail.google.com/`.
- **POO + SOLID obligatorios:** servicios y adaptadores son clases; dependencias por constructor contra interfaces; `domain` no importa nada externo salvo Luxon; `application` sólo importa `domain`; nadie fuera de una raíz de composición (`apps/*/src/**/*.module.ts`, `apps/*/src/cli/**`) instancia un adaptador concreto. dependency-cruiser lo verifica.
- Diferencias entre proveedores sólo vía `ProviderCapabilities`, nunca `instanceof`.
- Todo dato sincronizado lleva `accountId`; IDs externos únicos por `(account_id, external_id)`; columna `raw jsonb`.
- Defaults de configuración: zona `America/Argentina/Buenos_Aires`, horario 09:00–19:00, días L–V (`[1,2,3,4,5]`, ISO), prefijo de foco `[Focus] `, horizonte de foco 5 días hábiles, sincronización cada 5 min, ventana inicial de Gmail 90 días, máximo 10 correos prioritarios en el briefing.
- Puertos publicados sólo en `127.0.0.1`. MCP exige `Authorization: Bearer <token>`.
- Secretos sólo en `secrets/` (git-ignorado) montados como Docker secrets; tokens OAuth con permisos `0600`.
- Logs a stderr, estructurados; nunca cuerpos de correo ni tokens en logs.

## Review Focus

1. **`historyId` de Gmail vencido** (la API responde 404 en `history.list`): el sync debe hacer un resync completo acotado a 90 días y seguir, no fallar en bucle. → test en Task 10.
2. **Respuesta en un hilo cuyo último mensaje es mío**: el borrador debe ir al otro participante, nunca a una dirección propia (incluidos alias). → test en Task 10.
3. **Eventos de día completo y eventos que cruzan medianoche** en la zona configurada: deben bloquear el hueco; el foco no puede caer encima. → test en Task 4.
4. **Token revocado (`invalid_grant`)**: el sync de esa cuenta se marca `needs_reauth` con mensaje "ejecutá `pnpm jarvis auth --account <id>`", y las demás cuentas siguen sincronizando. → test en Task 14.
5. **Correo sólo HTML, gigante o con texto citado en español** ("El lun, 3 nov 2026 a las 10:00, X escribió:"): el cuerpo devuelto es texto limpio, sin la cita, truncado con marcador. → test en Task 3.

---

## Estructura de archivos

```
package.json · pnpm-workspace.yaml · tsconfig.base.json · vitest.workspace.ts · .dependency-cruiser.cjs
.gitignore · .env.example · jarvis.config.example.yaml · docker-compose.yml · docker/node.Dockerfile
packages/core/src/domain/
  model/{email-address,time-range,account,mail,calendar,task}.ts
  ports/{mail,calendar,tasks,identity,clock,repositories,provider}.ts
  services/{email-cleaner,free-slot-finder,priority-rules}.ts
  errors.ts · index.ts
packages/core/src/application/
  provider-registry.ts · config.ts
  use-cases/{sync-account,get-daily-briefing,search-emails,read-thread,list-events,list-tasks,find-free-slot,block-focus-time,create-draft,create-task,complete-task}.ts
  index.ts
packages/core/src/testing/{in-memory-mail,in-memory-calendar,in-memory-tasks,in-memory-repositories,fixed-clock}.ts
packages/contracts/src/{mail-reader,draft-writer,calendar,tasks}.contract.ts
packages/config/src/{schema,load-config}.ts
packages/adapters-persistence/src/{schema,db,migrate}.ts · repositories/*.ts · drizzle/ (migraciones)
packages/adapters-google/src/
  oauth/{scopes,google-oauth-flow,token-store}.ts
  gmail/{gmail-adapter,mime-builder,gmail-mapper}.ts
  calendar/{google-calendar-adapter,calendar-mapper}.ts
  tasks/{google-tasks-adapter,tasks-mapper}.ts
  google-provider-factory.ts
apps/worker/src/{main,app.module,sync.scheduler,catch-up}.ts · cli/jarvis.ts
apps/mcp-server/src/{main,app.module,mcp.controller,bearer.guard,mcp-server.factory}.ts · tools/*.tools.ts
README.md
```

---

### Task 1: Esqueleto del monorepo y reglas de arquitectura

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.dependency-cruiser.cjs`, `.env.example`, `jarvis.config.example.yaml`, `secrets/.gitkeep`
- Create: `package.json` + `tsconfig.json` + `vitest.config.ts` en cada paquete de la estructura (`packages/core`, `packages/contracts`, `packages/config`, `packages/adapters-persistence`, `packages/adapters-google`, `apps/worker`, `apps/mcp-server`)
- Modify: `.gitignore` (agregar `secrets/*`, `!secrets/.gitkeep`, `jarvis.config.yaml`, `.env`, `dist/`)
- Test: `packages/core/src/smoke.test.ts`

**Interfaces:**
- Produces: nombres de paquete `@jarvis/core`, `@jarvis/contracts`, `@jarvis/config`, `@jarvis/adapters-persistence`, `@jarvis/adapters-google`, `@jarvis/worker`, `@jarvis/mcp-server`. Scripts raíz: `pnpm test`, `pnpm build`, `pnpm lint:deps`, `pnpm typecheck`.

- [ ] **Step 1:** Instalar pnpm sin sudo: `corepack enable --install-directory ~/.local/bin pnpm` y verificar `pnpm --version` (≥ 9).
- [ ] **Step 2:** Crear la configuración raíz. `tsconfig.base.json`: `strict`, `module: "Node16"`, `moduleResolution: "Node16"`, `target: "ES2022"`, `experimentalDecorators`, `emitDecoratorMetadata`, `declaration`, `composite`. Cada paquete `"type": "commonjs"`, `main: dist/index.js`, `types: dist/index.d.ts`. Vitest con `unplugin-swc` en las apps NestJS.
- [ ] **Step 3:** `.dependency-cruiser.cjs` con reglas que fallan si: `packages/core/src/domain` importa algo fuera de sí mismo salvo `luxon`; `packages/core/src/application` importa fuera de `domain`/`application` (salvo `luxon`, `zod`); cualquier archivo fuera de `apps/**` importa `@jarvis/adapters-*`; `packages/adapters-*` importan `apps/**`.
- [ ] **Step 4:** Escribir `smoke.test.ts` (`expect(1+1).toBe(2)`), correr `pnpm install && pnpm test` → PASS, y `pnpm lint:deps` → "no dependency violations found".
- [ ] **Step 5:** Commit `chore: scaffold monorepo with architecture rules`.

---

### Task 2: Modelo de dominio y puertos

**Files:**
- Create: `packages/core/src/domain/model/*.ts`, `packages/core/src/domain/ports/*.ts`, `packages/core/src/domain/errors.ts`, `packages/core/src/domain/index.ts`
- Test: `packages/core/src/domain/model/email-address.test.ts`, `time-range.test.ts`

**Interfaces:**
- Produces (exactos; el resto del plan los usa):

```ts
// model
class EmailAddress { static parse(raw: string): EmailAddress; readonly address: string /* lowercase */; readonly name?: string; equals(o: EmailAddress): boolean; toString(): string }
class TimeRange { constructor(start: DateTime, end: DateTime) /* throws InvalidTimeRange si end<=start */; overlaps(o: TimeRange): boolean; contains(t: DateTime): boolean; durationMinutes(): number }
type ProviderKind = 'google' | (string & {});
interface Account { id: string; provider: ProviderKind; email: EmailAddress; displayName?: string; status: 'active' | 'needs_reauth' | 'disabled' }
interface MailMessage { id: string; threadId: string; accountId: string; from: EmailAddress; to: EmailAddress[]; cc: EmailAddress[]; subject: string; date: DateTime; snippet: string; labels: string[]; messageIdHeader?: string; referencesHeader?: string; bodyText?: string; bodyHtml?: string; raw?: unknown }
interface MailThread { id: string; accountId: string; subject: string; messages: MailMessage[]; lastMessageAt: DateTime; unread: boolean; labels: string[] }
type MailThreadSummary = Omit<MailThread, 'messages'> & { participants: EmailAddress[]; lastFrom: EmailAddress; snippet: string }
interface CalendarEvent { id: string; accountId: string; calendarId: string; title: string; range: TimeRange; allDay: boolean; attendees: { email: EmailAddress; response: 'accepted'|'declined'|'tentative'|'needsAction'; self: boolean }[]; myResponse?: 'accepted'|'declined'|'tentative'|'needsAction'; videoLink?: string; htmlLink?: string; status: 'confirmed'|'tentative'|'cancelled'; raw?: unknown }
interface TaskList { id: string; accountId: string; title: string; isDefault: boolean }
interface Task { id: string; accountId: string; listId: string; title: string; notes?: string; status: 'open'|'completed'; due?: DateTime; createdAt?: DateTime; updatedAt: DateTime; completedAt?: DateTime; deleted: boolean; raw?: unknown }
// ports/mail.ts
interface SyncResult<C> { changes: C[]; nextCursor: string; fullResync: boolean }
type MailChange = { kind: 'upsert'; message: MailMessage } | { kind: 'delete'; messageId: string };
interface MailReader { listThreads(q: { query: string; maxResults: number }): Promise<MailThreadSummary[]>; getThread(threadId: string): Promise<MailThread>; sync(cursor: string | null, opts: { initialWindowDays: number }): Promise<SyncResult<MailChange>> }
interface DraftRequest { to?: EmailAddress[]; cc?: EmailAddress[]; subject?: string; body: string; threadId?: string }
interface DraftRef { draftId: string; threadId?: string; to: EmailAddress[]; subject: string }
interface DraftWriter { createDraft(r: DraftRequest): Promise<DraftRef> }
// ports/calendar.ts
type EventChange = { kind: 'upsert'; event: CalendarEvent } | { kind: 'delete'; eventId: string; calendarId: string };
interface CalendarReader { listCalendars(): Promise<{ id: string; title: string; primary: boolean }[]>; listEvents(range: TimeRange, calendarIds: string[]): Promise<CalendarEvent[]>; sync(calendarId: string, cursor: string | null): Promise<SyncResult<EventChange>> }
interface NewEvent { calendarId: string; title: string; range: TimeRange; description?: string; transparency: 'opaque' }
interface EventWriter { createEvent(e: NewEvent): Promise<{ id: string; htmlLink?: string }> }
// ports/tasks.ts
type TaskChange = { kind: 'upsert'; task: Task } | { kind: 'delete'; taskId: string };
interface TaskReader { listLists(): Promise<TaskList[]>; sync(listId: string, cursor: string | null): Promise<SyncResult<TaskChange>> }
interface TaskWriter { createTask(listId: string, t: { title: string; notes?: string; due?: DateTime }): Promise<Task>; completeTask(listId: string, taskId: string): Promise<Task>; createList(title: string): Promise<TaskList> }
// ports/identity.ts
interface IdentityProvider { ownAddresses(): Promise<EmailAddress[]> }
// ports/clock.ts
interface Clock { now(): DateTime }
// ports/provider.ts
interface ProviderCapabilities { threads: boolean; replyHeaders: boolean; sendAsAliases: boolean; taskLists: boolean; incrementalSync: boolean }
interface ProviderBundle { mail?: MailReader & DraftWriter; calendar?: CalendarReader & EventWriter; tasks?: TaskReader & TaskWriter; identity: IdentityProvider; capabilities: ProviderCapabilities }
interface ProviderFactory { readonly kind: ProviderKind; create(account: Account): Promise<ProviderBundle> }
// errors.ts
class DomainError extends Error {}; class InvalidTimeRange extends DomainError {}; class InvalidEmailAddress extends DomainError {}
class ReauthRequired extends DomainError { constructor(public readonly accountId: string) }
class CursorExpired extends DomainError {}
```

`ports/repositories.ts`: `AccountRepository { list(): Promise<Account[]>; get(id): Promise<Account>; upsert(a): Promise<void>; setStatus(id, status, detail?: string): Promise<void> }`, `SyncStateRepository { get(accountId, resource: string): Promise<string|null>; set(accountId, resource, cursor: string, at: DateTime): Promise<void>; lastRunAt(accountId, resource): Promise<DateTime|null> }`, `MailRepository { applyChanges(accountId, changes: MailChange[]): Promise<void>; recentThreads(accountId, q: { since: DateTime; limit: number }): Promise<MailThreadSummary[]>; threadsAwaitingReply(accountId, own: EmailAddress[], limit: number): Promise<MailThreadSummary[]> }`, `EventRepository { applyChanges(accountId, changes: EventChange[]): Promise<void>; inRange(accountIds: string[], range: TimeRange): Promise<CalendarEvent[]> }`, `TaskRepository { upsertLists(accountId, lists: TaskList[]): Promise<void>; applyChanges(accountId, listId, changes: TaskChange[]): Promise<void>; open(q: { accountIds: string[]; dueBefore?: DateTime }): Promise<Task[]> }`, `PersonLinkLookup { isLinkedToAnyProject(email: EmailAddress): Promise<boolean> }` (en fase 1 su implementación devuelve `false`).

- [ ] **Step 1: Tests** — `EmailAddress.parse('"Ana Pérez" <Ana@Example.COM>')` → `address === 'ana@example.com'`, `name === 'Ana Pérez'`; `parse('no-es-mail')` lanza `InvalidEmailAddress`. `TimeRange` 10:00–11:00 vs 11:00–12:00 → `overlaps === false` (extremo abierto); vs 10:30–11:30 → `true`; `new TimeRange(t, t)` lanza `InvalidTimeRange`; `durationMinutes()` de 09:00–10:30 → `90`.
- [ ] **Step 2:** Correr `pnpm --filter @jarvis/core test` → FAIL (módulos inexistentes).
- [ ] **Step 3:** Implementar modelo, puertos y errores tal como arriba; exportar todo desde `domain/index.ts`.
- [ ] **Step 4:** Tests → PASS; `pnpm lint:deps` → sin violaciones.
- [ ] **Step 5:** Commit `feat(core): domain model and ports`.

---

### Task 3: `EmailCleaner`

**Files:**
- Create: `packages/core/src/domain/services/email-cleaner.ts`
- Test: `packages/core/src/domain/services/email-cleaner.test.ts`

**Interfaces:**
- Consumes: `MailMessage` (Task 2).
- Produces: `class EmailCleaner { constructor(opts: { maxChars: number /* default 4000 */; htmlToText: (html: string) => string }); clean(m: Pick<MailMessage,'bodyText'|'bodyHtml'|'snippet'>): string; cleanSnippet(s: string): string }`. `htmlToText` se inyecta (la implementación con `html-to-text` vive en `adapters-google`), así `domain` no depende de la librería.

- [ ] **Step 1: Tests**
  - prefiere `bodyText`; si sólo hay `bodyHtml` usa `htmlToText`.
  - corta en la primera línea que matchee la cita: `/^On .+wrote:$/m`, `/^El .+escribió:$/m` (puede ocupar 2 líneas: unir línea partida antes de testear), `/^-{2,}\s*(Original Message|Mensaje original)\s*-{2,}/mi`, `/^De: .+\nEnviado: /m`, y bloques de líneas que empiezan con `>`.
  - quita firma desde una línea exactamente `-- ` o `--`, y líneas `Enviado desde mi iPhone` / `Sent from my iPhone`.
  - colapsa 3+ saltos de línea en 2 y recorta espacios.
  - entrada de 10 000 caracteres → salida de longitud ≤ `maxChars + 40` terminada en `\n[… truncado, 10000 caracteres en total]`.
  - mensaje sin cuerpo → devuelve `snippet` decodificado (`&#39;` → `'`).
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar `EmailCleaner`.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `feat(core): email cleaner`.

---

### Task 4: `FreeSlotFinder`

**Files:**
- Create: `packages/core/src/domain/services/free-slot-finder.ts`
- Test: `packages/core/src/domain/services/free-slot-finder.test.ts`

**Interfaces:**
- Consumes: `TimeRange`, `CalendarEvent`.
- Produces: `interface WorkSchedule { zone: string; startHour: number; endHour: number; workDays: number[] /* ISO 1=lunes */ }` y `class FreeSlotFinder { constructor(schedule: WorkSchedule); find(q: { now: DateTime; durationMinutes: number; busy: CalendarEvent[]; preferredStartHour?: number; horizonWorkDays: number }): TimeRange | null }`.

Algoritmo: para cada día hábil desde hoy (en `zone`) hasta `horizonWorkDays` días hábiles: ventana = `[max(startHour, preferredStartHour ?? startHour), endHour]` intersectada con `[now redondeado hacia arriba a múltiplo de 15 min, ∞)`; ocupados = eventos con `status !== 'cancelled'` y `myResponse !== 'declined'` (los de día completo ocupan el día entero; los que cruzan medianoche se recortan a la ventana); recorrer huecos en orden y devolver el primero con duración ≥ `durationMinutes`. `preferredStartHour` aplica sólo al primer día; los siguientes usan `startHour`.

- [ ] **Step 1: Tests** (zona `America/Argentina/Buenos_Aires`, 9–19, L–V, horizonte 5)
  - lunes 08:00 sin eventos, 90 min → 09:00–10:30.
  - lunes 10:07, evento 10:30–12:00 → 12:00–13:30 (10:15–10:30 no alcanza).
  - viernes 18:00 → lunes 09:00–10:30 (salta fin de semana).
  - evento de día completo el lunes → martes 09:00.
  - evento domingo 22:00 – lunes 10:00 → lunes 10:00–11:30.
  - evento rechazado (`myResponse: 'declined'`) se ignora.
  - `preferredStartHour: 15` lunes 08:00 → 15:00–16:30.
  - todos los días llenos → `null`.
  - `durationMinutes: 600` (> jornada) → `null`.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar con Luxon.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `feat(core): free slot finder`.

---

### Task 5: `PriorityRules`, `ProviderRegistry` y dobles en memoria

**Files:**
- Create: `packages/core/src/domain/services/priority-rules.ts`, `packages/core/src/application/provider-registry.ts`, `packages/core/src/testing/*.ts`
- Test: `priority-rules.test.ts`, `provider-registry.test.ts`

**Interfaces:**
- Produces:
  - `class PriorityRules { constructor(links: PersonLinkLookup); async rank(threads: MailThreadSummary[], own: EmailAddress[], limit: number): Promise<MailThreadSummary[]> }` — incluye un hilo si: (`unread` y label `CATEGORY_PERSONAL` o sin label `CATEGORY_*`) **o** label `IMPORTANT`/`STARRED` **o** (`lastFrom` no es propio y `links.isLinkedToAnyProject(lastFrom)`). Excluye siempre `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, `SPAM`, `TRASH`. Orden: vinculados primero, después `lastMessageAt` desc.
  - `class ProviderRegistry { register(f: ProviderFactory): void; async forAccount(a: Account): Promise<ProviderBundle> }` — lanza `DomainError('No provider registered for kind "<kind>"')` si falta; cachea el bundle por `account.id`.
  - `testing/`: `InMemoryMailProvider implements MailReader, DraftWriter`, `InMemoryCalendarProvider implements CalendarReader, EventWriter`, `InMemoryTasksProvider implements TaskReader, TaskWriter`, `InMemoryRepositories` (todas las interfaces de `ports/repositories.ts`), `FixedClock implements Clock`. Se exportan como `@jarvis/core/testing`.

- [ ] **Step 1: Tests** — `PriorityRules`: promoción no leída excluida; no leído sin categoría incluido; leído pero `STARRED` incluido; con `links` que devuelve `true` para `cliente@x.com`, su hilo leído queda primero; `limit: 10` corta en 10. `ProviderRegistry`: kind desconocido lanza el mensaje exacto; dos `forAccount` del mismo id llaman `create` una sola vez.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar reglas, registro y dobles.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `feat(core): priority rules, provider registry, in-memory doubles`.

---

### Task 6: Suites de contrato por puerto

**Files:**
- Create: `packages/contracts/src/{mail-reader,draft-writer,calendar,tasks}.contract.ts`, `packages/contracts/src/index.ts`
- Test: `packages/core/src/testing/in-memory.contract.test.ts`

**Interfaces:**
- Produces: funciones `describeMailReaderContract(name: string, setup: () => Promise<{ reader: MailReader; seed(threads: MailThread[]): Promise<void> }>)`, `describeDraftWriterContract(name, setup: () => Promise<{ writer: DraftWriter; reader: MailReader; seed(...): Promise<void>; own: EmailAddress[] }>)`, `describeCalendarContract(name, setup)`, `describeTasksContract(name, setup)`. Cada una registra `describe/it` de Vitest.

Casos mínimos: `getThread` devuelve mensajes en orden cronológico; `sync(null)` devuelve `nextCursor` no vacío y `sync(nextCursor)` sin cambios devuelve `changes: []`; `createDraft` con `threadId` y sin `to` responde a `lastFrom` no propio y asunto con prefijo `Re: ` una sola vez (`Re: Re:` no se duplica); `createEvent` + `listEvents` en el rango lo incluye; `createTask` + `completeTask` deja `status: 'completed'` con `completedAt`.

- [ ] **Step 1:** Escribir las suites y `in-memory.contract.test.ts` que las ejecuta contra los dobles de Task 5.
- [ ] **Step 2:** Correr → FAIL donde los dobles no cumplan.
- [ ] **Step 3:** Ajustar los dobles hasta cumplir.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `test(contracts): port contract suites`.

---

### Task 7: Configuración

**Files:**
- Create: `packages/config/src/schema.ts`, `packages/config/src/load-config.ts`, `jarvis.config.example.yaml` (completar)
- Test: `packages/config/src/load-config.test.ts`

**Interfaces:**
- Produces: `type JarvisConfig = z.infer<typeof JarvisConfigSchema>` con: `timezone` (default `America/Argentina/Buenos_Aires`), `workSchedule { startHour: 9, endHour: 19, workDays: [1,2,3,4,5] }`, `focus { titlePrefix: '[Focus] ', horizonWorkDays: 5, defaultDurationMinutes: 90 }`, `sync { intervalMinutes: 5, gmailInitialWindowDays: 90 }`, `briefing { maxPriorityEmails: 10 }`, `email { maxBodyChars: 4000 }`, `accounts: { id: string; provider: 'google'; email: string; calendars?: string[] /* ids que cuentan como ocupado; default primary */ }[]`, `mcp { bind: '127.0.0.1', port: 3002, tokenFile: '/run/secrets/mcp_token' }`, `secretsDir: '/run/secrets'`, `dataDir: '/data'`. `function loadConfig(path: string, env: NodeJS.ProcessEnv): JarvisConfig` — YAML + overrides por env `JARVIS__SECCION__CLAVE` (p. ej. `JARVIS__SYNC__INTERVALMINUTES=10`).

- [ ] **Step 1: Tests** — YAML vacío salvo `accounts` → todos los defaults exactos de arriba; `startHour >= endHour` → error de validación con la ruta `workSchedule`; `workDays: [0]` → error; override por env aplicado y convertido a número; `timezone: 'Marte/Olimpo'` → error "invalid timezone".
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar (zona validada con `Intl.supportedValuesOf('timeZone')`).
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `feat(config): typed configuration loader`.

---

### Task 8: Persistencia (Drizzle) y repositorios

**Files:**
- Create: `packages/adapters-persistence/src/schema.ts`, `db.ts`, `migrate.ts`, `repositories/{account,sync-state,mail,event,task,person-link}.repository.ts`, `drizzle.config.ts`, `drizzle/` (generado)
- Test: `packages/adapters-persistence/src/repositories/*.test.ts` (Testcontainers `postgres:17`)

**Interfaces:**
- Consumes: puertos de `ports/repositories.ts` (Task 2).
- Produces: `createDb(url: string): Db`, `runMigrations(db: Db): Promise<void>`, clases `DrizzleAccountRepository`, `DrizzleSyncStateRepository`, `DrizzleMailRepository`, `DrizzleEventRepository`, `DrizzleTaskRepository`, `NullPersonLinkLookup` (devuelve `false`), cada una `implements` su puerto y recibe `Db` por constructor.

Tablas (todas con `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`): `accounts(provider, email, display_name, status, status_detail)`; `sync_state(account_id, resource, cursor, last_run_at, unique(account_id,resource))`; `mail_threads(account_id, external_id, subject, last_message_at, unread, labels text[], raw jsonb)`; `mail_messages(account_id, external_id, thread_id fk, from_address, from_name, to jsonb, cc jsonb, subject, sent_at, snippet, labels text[], message_id_header, references_header, raw jsonb)` — **sin cuerpo**; `calendars(account_id, external_id, title, is_primary)`; `events(account_id, calendar_id fk, external_id, title, starts_at, ends_at, all_day, status, my_response, attendees jsonb, video_link, html_link, raw jsonb)`; `task_lists(account_id, external_id, title, is_default)`; `tasks(account_id, list_id fk, external_id, title, notes, status, due_at, created_at_ext, updated_at_ext, completed_at, deleted, raw jsonb)`. Unique `(account_id, external_id)` en cada tabla sincronizada. Índices: `mail_threads(account_id,last_message_at desc)`, `events(account_id,starts_at)`, `tasks(account_id,status,due_at)`.

- [ ] **Step 1: Tests** — `applyChanges` con el mismo `upsert` dos veces deja una fila; `delete` la elimina; `threadsAwaitingReply` devuelve el hilo cuyo último mensaje no es propio y excluye el que respondí; `EventRepository.inRange` incluye un evento que empieza antes y termina dentro del rango; `TaskRepository.open` excluye completadas y `deleted`; `SyncStateRepository.set/get` persiste el cursor; `AccountRepository.setStatus` guarda `status_detail`.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar esquema, generar migración (`pnpm --filter @jarvis/adapters-persistence drizzle-kit generate`), implementar repositorios.
- [ ] **Step 4:** Correr → PASS (requiere Docker).
- [ ] **Step 5:** Commit `feat(persistence): drizzle schema, migrations and repositories`.

---

### Task 9: OAuth de Google y almacén de tokens

**Files:**
- Create: `packages/adapters-google/src/oauth/{scopes,token-store,google-oauth-flow}.ts`, `apps/worker/src/cli/jarvis.ts` (comando `auth`)
- Test: `scopes.test.ts`, `token-store.test.ts`, `google-oauth-flow.test.ts`

**Interfaces:**
- Produces: `const GOOGLE_SCOPES: readonly string[]` (los 4 exactos de Global Constraints); `class FileTokenStore { constructor(dir: string); read(accountId): Promise<Credentials | null>; write(accountId, c: Credentials): Promise<void> /* archivo <dir>/google-<accountId>.json, modo 0600 */ }`; `class GoogleOAuthFlow { constructor(clientSecretPath: string, store: FileTokenStore); authorizeInteractive(accountId: string): Promise<void> /* loopback en 127.0.0.1 puerto libre, access_type=offline, prompt=consent */; client(accountId: string): Promise<OAuth2Client> /* lanza ReauthRequired si no hay token; persiste tokens refrescados vía evento 'tokens' */ }`. CLI: `pnpm jarvis auth --account <id>` imprime la URL, espera el callback y confirma `Token guardado para <id>`.

- [ ] **Step 1: Tests** — `GOOGLE_SCOPES` igual (deep equal) a la lista exacta y no contiene `https://mail.google.com/`; `write` crea archivo con `mode & 0o777 === 0o600`; `client()` sin token lanza `ReauthRequired` con ese `accountId`; un evento `tokens` con `refresh_token` nuevo se persiste.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `feat(google): oauth flow and token store`.

---

### Task 10: `GmailAdapter`

**Files:**
- Create: `packages/adapters-google/src/gmail/{gmail-adapter,mime-builder,gmail-mapper}.ts`, `packages/adapters-google/src/html-to-text.ts`
- Test: `gmail-adapter.test.ts`, `mime-builder.test.ts`, `gmail.contract.test.ts`

**Interfaces:**
- Consumes: `MailReader`, `DraftWriter`, `IdentityProvider` (Task 2); contratos (Task 6).
- Produces: `class GmailAdapter implements MailReader, DraftWriter, IdentityProvider { constructor(gmail: gmail_v1.Gmail, accountId: string) }`; `function buildMime(d: { from: EmailAddress; to: EmailAddress[]; cc: EmailAddress[]; subject: string; body: string; inReplyTo?: string; references?: string }): string /* base64url */`; `function htmlToPlainText(html: string): string` (wrapper de `html-to-text`, ignora imágenes, `wordwrap: false`).

Detalles fijados: `listThreads` usa `threads.list({ q, maxResults })` + `threads.get(format: 'metadata', metadataHeaders: From,To,Cc,Subject,Date)`. `getThread` usa `format: 'full'`, decodifica partes `text/plain` y `text/html` (base64url, charset del header). `sync(null)` = listado de mensajes `newer_than:<initialWindowDays>d` + `users.getProfile().historyId` como cursor, `fullResync: true`; `sync(cursor)` = `history.list({ startHistoryId, historyTypes: ['messageAdded','messageDeleted','labelAdded','labelRemoved'] })` paginado; si la API responde 404 → igual que `sync(null)` con `fullResync: true`. `createDraft` con `threadId`: lee el hilo, toma el último mensaje, `to` por defecto = su `from`, y si ese `from` es propio (según `ownAddresses()`), el primer destinatario `to` no propio; `subject` por defecto `Re: <asunto>` sin duplicar `Re:`; `In-Reply-To` = `Message-ID` del último, `References` = `References` previo + ese `Message-ID`; `drafts.create({ requestBody: { message: { raw, threadId } } })`. `ownAddresses` = `users.settings.sendAs.list` (todas las `sendAsEmail`). Asuntos no ASCII codificados `=?UTF-8?B?...?=`.

- [ ] **Step 1: Tests** (cliente `gmail_v1.Gmail` simulado con objetos de respuesta grabados en `__fixtures__/`)
  - `buildMime` con asunto `Reunión ñandú` produce header `Subject: =?UTF-8?B?...?=` que decodifica al original; incluye `In-Reply-To` y `References` cuando se pasan; cuerpo UTF-8.
  - Review Focus 2: hilo cuyo último mensaje es de `yo@gmail.com` (alias en sendAs) a `cliente@x.com` → borrador `to = [cliente@x.com]`.
  - Review Focus 1: `history.list` rechaza con `{ code: 404 }` → `sync('123')` devuelve `fullResync: true` y cursor nuevo.
  - `getThread` de un mensaje sólo HTML devuelve `bodyHtml` y `bodyText` indefinido.
  - nunca se invoca `messages.send` ni `drafts.send` (spy en el cliente simulado; assert `not.toHaveBeenCalled()` en todos los tests).
  - `gmail.contract.test.ts` corre `describeMailReaderContract` y `describeDraftWriterContract` contra el adaptador con un fake de Gmail en memoria (`__fixtures__/fake-gmail.ts`).
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar adaptador, mapper y MIME.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `feat(google): gmail adapter (read, sync, drafts)`.

---

### Task 11: `GoogleCalendarAdapter` y `GoogleTasksAdapter`

**Files:**
- Create: `packages/adapters-google/src/calendar/*.ts`, `packages/adapters-google/src/tasks/*.ts`, `packages/adapters-google/src/google-provider-factory.ts`
- Test: `google-calendar-adapter.test.ts`, `google-tasks-adapter.test.ts`, `calendar.contract.test.ts`, `tasks.contract.test.ts`, `google-provider-factory.test.ts`

**Interfaces:**
- Produces: `class GoogleCalendarAdapter implements CalendarReader, EventWriter { constructor(cal: calendar_v3.Calendar, accountId: string, zone: string) }`; `class GoogleTasksAdapter implements TaskReader, TaskWriter { constructor(tasks: tasks_v1.Tasks, accountId: string) }`; `class GoogleProviderFactory implements ProviderFactory { kind = 'google'; constructor(oauth: GoogleOAuthFlow, zone: string) }` con `capabilities = { threads: true, replyHeaders: true, sendAsAliases: true, taskLists: true, incrementalSync: true }`.

Detalles: eventos de día completo (`start.date`) → `TimeRange` desde 00:00 del día en `zone` hasta 00:00 del día siguiente (`end.date` es exclusivo), `allDay: true`. `videoLink` = `hangoutLink` o la primera `conferenceData.entryPoints[type=video].uri`. `sync(calendarId, null)` = `events.list({ singleEvents: true, timeMin: hoy-30d, showDeleted: true })` hasta obtener `nextSyncToken`; con cursor usa `syncToken`; respuesta 410 → resync completo, `fullResync: true`. Eventos `status: 'cancelled'` → `EventChange` `delete`. Tasks: `sync(listId, cursor)` donde cursor = ISO de `updatedMin`; `showCompleted: true, showHidden: true, showDeleted: true`; `isDefault` = primera lista devuelta por `tasklists.list` (la que Google crea como "My Tasks"/"Mis tareas").

- [ ] **Step 1: Tests** — evento `start.date: '2026-11-24', end.date: '2026-11-25'` → rango 2026-11-24T00:00−03:00 a 2026-11-25T00:00−03:00; `syncToken` con 410 → `fullResync: true`; evento cancelado → `delete`; `createEvent` envía `transparency: 'opaque'` y zona; `completeTask` envía `status: 'completed'`; tarea con `deleted: true` → `delete`; factory devuelve bundle con las capacidades exactas; contratos de calendario y tareas pasan contra fakes en memoria de las APIs.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `feat(google): calendar and tasks adapters, provider factory`.

---

### Task 12: Casos de uso de sincronización y lectura

**Files:**
- Create: `packages/core/src/application/use-cases/{sync-account,get-daily-briefing,search-emails,read-thread,list-events,list-tasks,find-free-slot}.ts`, `packages/core/src/application/index.ts`
- Test: un `*.test.ts` por caso de uso, con dobles de Task 5

**Interfaces:**
- Consumes: puertos, `ProviderRegistry`, `EmailCleaner`, `FreeSlotFinder`, `PriorityRules`, `Clock`.
- Produces: `interface AppSettings { zone: string; workSchedule: WorkSchedule; focus: { titlePrefix: string; horizonWorkDays: number; defaultDurationMinutes: number }; sync: { gmailInitialWindowDays: number }; briefing: { maxPriorityEmails: number }; busyCalendars: Record<string /* accountId */, string[]> }` en `application/config.ts` (la app la arma desde `JarvisConfig`, así `core` no depende de `@jarvis/config`). Casos de uso (todas clases con `execute`):
  - `SyncAccount.execute(accountId: string): Promise<{ resources: Record<'mail'|'calendar'|'tasks', 'ok'|'skipped'|'error'>; fullResync: string[] }>` — por recurso: lee cursor, `sync`, `applyChanges`, guarda cursor. `ReauthRequired` → `accounts.setStatus(id,'needs_reauth','ejecutá pnpm jarvis auth --account <id>')` y devuelve sin lanzar. Error en un recurso no impide los otros.
  - `GetDailyBriefing.execute({ dateOffsetDays: number }): Promise<DailyBriefing>` con `DailyBriefing = { date: string /* ISO date en zona */; events: BriefingEvent[]; priorityEmails: BriefingEmail[]; tasksDue: BriefingTask[]; accountsNeedingReauth: string[] }`; `BriefingEvent = { id; title; start: string; end: string; allDay; videoLink?; attendees: string[] }` (excluye rechazados y cancelados), `BriefingEmail = { threadId; from: string; subject; date: string; snippet /* limpio */ }`, `BriefingTask = { id; title; due?: string; list: string }` (vencen hasta el fin del día pedido).
  - `SearchEmails.execute({ query, maxResults /* 1..20, default 5 */ }): Promise<EmailResult[]>` con `EmailResult = { id; threadId; from; subject; date; body /* EmailCleaner.clean */ }` — consulta en vivo al proveedor de cada cuenta activa.
  - `ReadThread.execute({ accountId?, threadId }): Promise<{ threadId; subject; messages: EmailResult[] }>`.
  - `ListEvents.execute({ from: string; to: string }): Promise<BriefingEvent[]>` (desde DB).
  - `ListTasks.execute({ status?: 'open'|'completed'|'all' }): Promise<BriefingTask[]>`.
  - `FindFreeSlot.execute({ durationMinutes; preferredStartHour? }): Promise<{ start: string; end: string } | null>` (ocupado = eventos en DB de los calendarios configurados).

- [ ] **Step 1: Tests** — Review Focus 4: dos cuentas, la primera lanza `ReauthRequired` en `sync` → queda `needs_reauth` con el mensaje exacto y la segunda se sincroniza; `SyncAccount` guarda el `nextCursor`; `GetDailyBriefing(1)` con reloj lunes 20:00 devuelve eventos del martes; excluye evento rechazado; `priorityEmails.length <= 10`; `accountsNeedingReauth` lista la cuenta marcada; `SearchEmails` con `maxResults: 50` se acota a 20; el `body` viene limpio (sin cita); `FindFreeSlot` delega en `FreeSlotFinder` con los eventos de DB.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `feat(core): sync and read use cases`.

---

### Task 13: Casos de uso de escritura

**Files:**
- Create: `packages/core/src/application/use-cases/{block-focus-time,create-draft,create-task,complete-task}.ts`
- Test: un `*.test.ts` por caso de uso

**Interfaces:**
- Produces:
  - `BlockFocusTime.execute({ taskName: string; durationMinutes?: number /* default 90 */; preferredStartHour?: number; accountId?: string }): Promise<{ status: 'created'; eventId; start; end; htmlLink? } | { status: 'already_exists'; eventId; start; end } | { status: 'no_slot'; searchedWorkDays: number }>` — título exacto `${titlePrefix}${taskName}`; si el día del hueco ya tiene un evento con ese título exacto → `already_exists`; crea en el calendario primario de la cuenta (la primera activa si no se indica) y guarda el evento en DB.
  - `CreateDraft.execute({ to?: string[]; cc?: string[]; subject?: string; body: string; threadId?: string; accountId?: string }): Promise<{ draftId; threadId?; to: string[]; subject; gmailUrl: string }>` — valida que haya `to` o `threadId` (si no, `DomainError('Se necesita "to" o "thread_id"')`); `gmailUrl = https://mail.google.com/mail/#drafts?compose=<draftId>`.
  - `CreateTask.execute({ title; notes?; due?: string; listId?: string; accountId? })` → `BriefingTask` (lista por defecto si no se indica).
  - `CompleteTask.execute({ taskId; accountId? })` → `BriefingTask`.

- [ ] **Step 1: Tests** — `BlockFocusTime` crea `[Focus] Refactor auth` 09:00–10:30; segunda llamada mismo día → `already_exists` sin crear otro evento; agenda llena → `no_slot` con `searchedWorkDays: 5`; `CreateDraft` sin `to` ni `threadId` lanza el mensaje exacto; con `threadId` delega en `DraftWriter` sin `to`; `CompleteTask` deja la tarea completada en DB.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `feat(core): write use cases (focus, drafts, tasks)`.

---

### Task 14: App `worker` (NestJS): composición, scheduler y recuperación

**Files:**
- Create: `apps/worker/src/{main,app.module,providers.module,sync.scheduler,catch-up}.ts`; completar `apps/worker/src/cli/jarvis.ts` con `migrate` y `sync --once`
- Test: `catch-up.test.ts`, `sync.scheduler.test.ts`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `ProvidersModule` (módulo Nest reutilizable por `mcp-server`) que expone por **tokens** (`TOKENS.ProviderRegistry`, `TOKENS.Clock`, `TOKENS.AccountRepository`, …, definidos en `packages/core/src/application/tokens.ts` como `Symbol`s) las implementaciones concretas, y todos los casos de uso como providers. `class CatchUp { static isOverdue(lastRunAt: DateTime | null, now: DateTime, intervalMinutes: number): boolean }`. `SyncScheduler` con `@Interval` según `sync.intervalMinutes`, ejecuta `SyncAccount` para cada cuenta `active` en serie y, al iniciar (`onApplicationBootstrap`), corre una vez si `CatchUp.isOverdue`. Cuentas de `config.accounts` se `upsert`an en DB al arrancar.

- [ ] **Step 1: Tests** — `isOverdue(null, …)` → `true`; última corrida hace 4 min con intervalo 5 → `false`; hace 6 min → `true`; scheduler con dos cuentas (una `needs_reauth`) sólo sincroniza la activa; dos ticks simultáneos no corren en paralelo (el segundo se omite mientras el primero está en curso).
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar módulo, scheduler, `main.ts` (logger a stderr) y comandos CLI.
- [ ] **Step 4:** Correr → PASS; `pnpm lint:deps` → sin violaciones.
- [ ] **Step 5:** Commit `feat(worker): composition root, sync scheduler with catch-up`.

---

### Task 15: App `mcp-server` (NestJS + MCP SDK)

**Files:**
- Create: `apps/mcp-server/src/{main,app.module,mcp.controller,bearer.guard,mcp-server.factory}.ts`, `apps/mcp-server/src/tools/{briefing,email,calendar,tasks}.tools.ts`
- Test: `apps/mcp-server/src/mcp.e2e.test.ts`, `bearer.guard.test.ts`

**Interfaces:**
- Consumes: `ProvidersModule` y casos de uso (Tasks 12–14).
- Produces: endpoint `POST/GET/DELETE /mcp` (Streamable HTTP, sesiones con `mcp-session-id`), `GET /health` → `{ status: 'ok' }` sin auth. Herramientas registradas con `McpServer.registerTool(name, { title, description, inputSchema, outputSchema }, handler)` y respuesta `{ content: [{ type: 'text', text }], structuredContent }`:

| Herramienta | Entrada (Zod) | Caso de uso |
|---|---|---|
| `get_daily_briefing` | `date_offset_days: int 0..7 = 0` | `GetDailyBriefing` |
| `search_emails` | `query: string min 1`, `max_results: int 1..20 = 5` | `SearchEmails` |
| `read_thread` | `thread_id: string`, `account_id?: string` | `ReadThread` |
| `list_events` | `from: ISO date`, `to: ISO date` | `ListEvents` |
| `list_tasks` | `status: 'open'|'completed'|'all' = 'open'` | `ListTasks` |
| `find_free_slot` | `duration_minutes: int 15..480 = 90`, `preferred_start_hour?: int 0..23` | `FindFreeSlot` |
| `block_focus_time` | `task_name: string min 1`, `duration_minutes = 90`, `preferred_start_hour?` | `BlockFocusTime` |
| `create_gmail_draft` | `to?: string[]`, `cc?: string[]`, `subject?: string`, `body: string`, `thread_id?: string` | `CreateDraft` |
| `create_task` | `title`, `notes?`, `due?: ISO date` | `CreateTask` |
| `complete_task` | `task_id` | `CompleteTask` |

Descripciones en inglés, orientadas a cuándo usar cada herramienta (el modelo las lee); `create_gmail_draft` dice explícitamente "Creates a DRAFT only. Never sends." Todo cuerpo/snippet de correo en `structuredContent` y en `text` va envuelto en `<external_content source="email">…</external_content>`. Errores de dominio → `{ isError: true, content: [{ type: 'text', text: mensaje }] }`, nunca stack traces. `BearerGuard` compara en tiempo constante contra el contenido de `mcp.tokenFile`.

- [ ] **Step 1: Tests** — e2e con `Client` + `StreamableHTTPClientTransport` del SDK contra la app Nest levantada en un puerto efímero con dobles en memoria: `listTools()` devuelve exactamente los 10 nombres; `get_daily_briefing` devuelve `structuredContent.date`; `search_emails` envuelve el cuerpo en `<external_content`; `create_gmail_draft` sin `to` ni `thread_id` → `isError: true` con el mensaje exacto de Task 13; ninguna herramienta contiene "send" en el nombre; request sin header `Authorization` → HTTP 401; `/health` sin token → 200.
- [ ] **Step 2:** Correr → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Correr → PASS.
- [ ] **Step 5:** Commit `feat(mcp-server): MCP tools over streamable HTTP`.

---

### Task 16: Docker Compose, README y verificación de punta a punta

**Files:**
- Create: `docker/node.Dockerfile` (multi-stage, `node:22-slim`, `pnpm deploy --filter <app>`), `docker-compose.yml`, `README.md`
- Modify: `.env.example`, `jarvis.config.example.yaml`

**Interfaces:**
- Produces: servicios `db` (postgres:17, volumen `pgdata`, sin puertos publicados, healthcheck `pg_isready`), `migrate` (one-shot `node dist/cli/jarvis.js migrate`, `depends_on: db healthy`), `worker`, `mcp-server` (`127.0.0.1:3002:3002`, healthcheck `/health`), ambos `depends_on: migrate completed_successfully`. Secrets: `google_oauth_client` (`secrets/google-oauth-client.json`), `mcp_token` (`secrets/mcp_token`), `pg_password`. Volumen `jarvis_tokens` montado en `/data/tokens` para `FileTokenStore`. Config montada de `./jarvis.config.yaml` en `/app/jarvis.config.yaml:ro`.

- [ ] **Step 1:** Escribir Dockerfile y compose. `docker compose config` → sin errores.
- [ ] **Step 2:** README en español con: requisitos; **Google Cloud Console** paso a paso (crear proyecto; habilitar Gmail API, Google Calendar API, Google Tasks API; pantalla de consentimiento *External* con los 4 scopes exactos y el propio correo como usuario de prueba; **publicar a producción** para evitar el vencimiento de 7 días y qué significa el aviso "app no verificada"; crear ID de cliente OAuth tipo *Desktop app*; guardar el JSON en `secrets/google-oauth-client.json`); generar `secrets/mcp_token` (`openssl rand -hex 32 > secrets/mcp_token && chmod 600 secrets/mcp_token`); `cp jarvis.config.example.yaml jarvis.config.yaml`; `docker compose run --rm -p 127.0.0.1:53682:53682 worker node dist/cli/jarvis.js auth --account personal` (el flujo loopback usa ese puerto fijo dentro del contenedor; documentarlo en `GoogleOAuthFlow` como `JARVIS_OAUTH_PORT`, default `53682`); `docker compose up -d`; registro en Claude Code: `claude mcp add --transport http jarvis http://127.0.0.1:3002/mcp --header "Authorization: Bearer $(cat secrets/mcp_token)"`; prueba con MCP Inspector: `npx @modelcontextprotocol/inspector` → transporte *Streamable HTTP*, URL `http://127.0.0.1:3002/mcp`, header `Authorization`.
- [ ] **Step 3:** Verificación real (con la cuenta de Santiago, sólo lectura salvo un borrador y un evento de prueba que él apruebe): `docker compose up -d` → `docker compose ps` todos `healthy`/`exited (0)` para `migrate`; `curl -s 127.0.0.1:3002/health` → `{"status":"ok"}`; `docker compose logs worker` muestra un sync completo sin errores; en MCP Inspector `get_daily_briefing` devuelve los eventos de hoy; desde Claude Code `/mcp` lista `jarvis` conectado.
- [ ] **Step 4:** `pnpm test && pnpm lint:deps && pnpm typecheck` → todo PASS.
- [ ] **Step 5:** Commit `feat: docker compose deployment and setup guide`.
