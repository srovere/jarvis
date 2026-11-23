# Jarvis — Phase 1: Foundation + Google + MCP server — Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TypeScript monorepo with a ports-and-adapters domain, Postgres persistence, integration with Gmail, Google Calendar and Google Tasks (multi-account), a worker that syncs and an HTTP MCP server usable from Claude Code, all started with Docker Compose.

**Architecture:** Pure TypeScript domain (`packages/core`) with interfaces (ports); Google and persistence (Drizzle) adapters in separate packages that implement them; NestJS apps (`worker`, `mcp-server`) as composition roots with dependency injection. See `docs/architecture.md`.

**Tech Stack:** Node 22, pnpm workspaces, TypeScript 5 (CommonJS, `module: Node16`), NestJS 11 (+ `@nestjs/schedule`), `@modelcontextprotocol/sdk` (Streamable HTTP), Drizzle ORM + `pg` + drizzle-kit, PostgreSQL 17, `googleapis` + `google-auth-library`, Luxon, Zod, `html-to-text`, `yaml`, `commander`, Vitest (+ `unplugin-swc` for decorators), `@testcontainers/postgresql`, dependency-cruiser, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-23-jarvis-design.md` · Architecture: `docs/architecture.md`

**This is phase 1 of 5.** Next plans (each written when the previous one is done):
2. Projects: `ProjectTransport` (local/SSH + `jarvis-remote`), discovery, snapshots, people and linking, task mirror.
3. Agent: `AgentRunner` (Claude Code), AI queue, highlights and meeting briefs, `propose_action`.
4. `api` + React dashboard + chat.
5. Analytics. (The nightly agent is a separate, later project.)

## Global Constraints

- **Never an Anthropic API key.** No package in this plan calls a model.
- **Never send email.** There is no send method, port or tool; only `drafts.create`.
- Exact OAuth scopes: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.compose`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/tasks`. Never `https://mail.google.com/`.
- **OOP + SOLID mandatory:** services and adapters are classes; dependencies through the constructor against interfaces; `domain` imports nothing external except Luxon; `application` only imports `domain`; nobody outside a composition root (`apps/*/src/**/*.module.ts`, `apps/*/src/cli/**`) instantiates a concrete adapter. dependency-cruiser verifies it.
- Provider differences only through `ProviderCapabilities`, never `instanceof`.
- Every synced record carries `accountId`; external IDs unique by `(account_id, external_id)`; `raw jsonb` column.
- Configuration defaults: zone `America/Argentina/Buenos_Aires`, hours 09:00–19:00, days Mon–Fri (`[1,2,3,4,5]`, ISO), focus prefix `[Focus] `, focus horizon 5 work days, sync every 5 min, initial Gmail window 90 days, at most 10 priority emails in the briefing.
- Ports published on `127.0.0.1` only. MCP requires `Authorization: Bearer <token>`.
- Secrets only in `secrets/` (git-ignored) mounted as Docker secrets; OAuth tokens with `0600` permissions.
- Structured logs to stderr; never email bodies or tokens in logs.
- Code, comments, user-facing strings, tests and documentation in English.

## Review Focus

1. **Expired Gmail `historyId`** (the API answers 404 on `history.list`): sync must do a full resync bounded to 90 days and carry on, not fail in a loop. → test in Task 10.
2. **Reply in a thread whose last message is mine**: the draft must go to the other participant, never to an own address (aliases included). → test in Task 10.
3. **All-day events and events crossing midnight** in the configured zone: they must block the slot; focus cannot land on top of them. → test in Task 4.
4. **Revoked token (`invalid_grant`)**: that account's sync is marked `needs_reauth` with the message "run `pnpm jarvis auth --account <id>`", and the other accounts keep syncing. → test in Task 14.
5. **HTML-only, huge, or Spanish-quoted email** ("El lun, 3 nov 2026 a las 10:00, X escribió:"): the returned body is clean text, without the quote, truncated with a marker. → test in Task 3.

---

## File structure

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
packages/adapters-persistence/src/{schema,db,migrate}.ts · repositories/*.ts · drizzle/ (migrations)
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

### Task 1: Monorepo skeleton and architecture rules

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.dependency-cruiser.cjs`, `.env.example`, `jarvis.config.example.yaml`, `secrets/.gitkeep`
- Create: `package.json` + `tsconfig.json` + `vitest.config.ts` in each package of the structure (`packages/core`, `packages/contracts`, `packages/config`, `packages/adapters-persistence`, `packages/adapters-google`, `apps/worker`, `apps/mcp-server`)
- Modify: `.gitignore` (add `secrets/*`, `!secrets/.gitkeep`, `jarvis.config.yaml`, `.env`, `dist/`)
- Test: `packages/core/src/smoke.test.ts`

**Interfaces:**
- Produces: package names `@jarvis/core`, `@jarvis/contracts`, `@jarvis/config`, `@jarvis/adapters-persistence`, `@jarvis/adapters-google`, `@jarvis/worker`, `@jarvis/mcp-server`. Root scripts: `pnpm test`, `pnpm build`, `pnpm lint:deps`, `pnpm typecheck`.

- [ ] **Step 1:** Install pnpm without sudo: `corepack enable --install-directory ~/.local/bin pnpm` and check `pnpm --version` (≥ 9).
- [ ] **Step 2:** Create the root configuration. `tsconfig.base.json`: `strict`, `module: "Node16"`, `moduleResolution: "Node16"`, `target: "ES2022"`, `experimentalDecorators`, `emitDecoratorMetadata`, `declaration`, `composite`. Each package `"type": "commonjs"`, `main: dist/index.js`, `types: dist/index.d.ts`. Vitest with `unplugin-swc` in the NestJS apps.
- [ ] **Step 3:** `.dependency-cruiser.cjs` with rules that fail if: `packages/core/src/domain` imports anything outside itself except `luxon`; `packages/core/src/application` imports outside `domain`/`application` (except `luxon`, `zod`); any file outside `apps/**` imports `@jarvis/adapters-*`; `packages/adapters-*` import `apps/**`.
- [ ] **Step 4:** Write `smoke.test.ts` (`expect(1+1).toBe(2)`), run `pnpm install && pnpm test` → PASS, and `pnpm lint:deps` → "no dependency violations found".
- [ ] **Step 5:** Commit `chore: scaffold monorepo with architecture rules`.

---

### Task 2: Domain model and ports

**Files:**
- Create: `packages/core/src/domain/model/*.ts`, `packages/core/src/domain/ports/*.ts`, `packages/core/src/domain/errors.ts`, `packages/core/src/domain/index.ts`
- Test: `packages/core/src/domain/model/email-address.test.ts`, `time-range.test.ts`

**Interfaces:**
- Produces (exact; the rest of the plan uses them):

```ts
// model
class EmailAddress { static parse(raw: string): EmailAddress; readonly address: string /* lowercase */; readonly name?: string; equals(o: EmailAddress): boolean; toString(): string }
class TimeRange { constructor(start: DateTime, end: DateTime) /* throws InvalidTimeRange if end<=start */; overlaps(o: TimeRange): boolean; contains(t: DateTime): boolean; durationMinutes(): number }
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

`ports/repositories.ts`: `AccountRepository { list(): Promise<Account[]>; get(id): Promise<Account>; upsert(a): Promise<void>; setStatus(id, status, detail?: string): Promise<void> }`, `SyncStateRepository { get(accountId, resource: string): Promise<string|null>; set(accountId, resource, cursor: string, at: DateTime): Promise<void>; lastRunAt(accountId, resource): Promise<DateTime|null> }`, `MailRepository { applyChanges(accountId, changes: MailChange[]): Promise<void>; recentThreads(accountId, q: { since: DateTime; limit: number }): Promise<MailThreadSummary[]>; threadsAwaitingReply(accountId, own: EmailAddress[], limit: number): Promise<MailThreadSummary[]> }`, `EventRepository { applyChanges(accountId, changes: EventChange[]): Promise<void>; inRange(accountIds: string[], range: TimeRange): Promise<CalendarEvent[]> }`, `TaskRepository { upsertLists(accountId, lists: TaskList[]): Promise<void>; applyChanges(accountId, listId, changes: TaskChange[]): Promise<void>; open(q: { accountIds: string[]; dueBefore?: DateTime }): Promise<Task[]> }`, `PersonLinkLookup { isLinkedToAnyProject(email: EmailAddress): Promise<boolean> }` (in phase 1 its implementation returns `false`).

- [ ] **Step 1: Tests** — `EmailAddress.parse('"Ana Pérez" <Ana@Example.COM>')` → `address === 'ana@example.com'`, `name === 'Ana Pérez'`; `parse('not-an-email')` throws `InvalidEmailAddress`. `TimeRange` 10:00–11:00 vs 11:00–12:00 → `overlaps === false` (open end); vs 10:30–11:30 → `true`; `new TimeRange(t, t)` throws `InvalidTimeRange`; `durationMinutes()` of 09:00–10:30 → `90`.
- [ ] **Step 2:** Run `pnpm --filter @jarvis/core test` → FAIL (missing modules).
- [ ] **Step 3:** Implement model, ports and errors exactly as above; export everything from `domain/index.ts`.
- [ ] **Step 4:** Tests → PASS; `pnpm lint:deps` → no violations.
- [ ] **Step 5:** Commit `feat(core): domain model and ports`.

---

### Task 3: `EmailCleaner`

**Files:**
- Create: `packages/core/src/domain/services/email-cleaner.ts`
- Test: `packages/core/src/domain/services/email-cleaner.test.ts`

**Interfaces:**
- Consumes: `MailMessage` (Task 2).
- Produces: `class EmailCleaner { constructor(opts: { maxChars: number /* default 4000 */; htmlToText: (html: string) => string }); clean(m: Pick<MailMessage,'bodyText'|'bodyHtml'|'snippet'>): string; cleanSnippet(s: string): string }`. `htmlToText` is injected (the `html-to-text` implementation lives in `adapters-google`), so `domain` does not depend on the library.

- [ ] **Step 1: Tests**
  - prefers `bodyText`; if there is only `bodyHtml` it uses `htmlToText`.
  - cuts at the first line matching a quote: `/^On .+wrote:$/m`, `/^El .+escribió:$/m` (may span 2 lines: join the split line before testing), `/^-{2,}\s*(Original Message|Mensaje original)\s*-{2,}/mi`, `/^De: .+\nEnviado: /m`, and blocks of lines starting with `>`.
  - removes the signature from a line that is exactly `-- ` or `--`, and the lines `Enviado desde mi iPhone` / `Sent from my iPhone`.
  - collapses 3+ newlines into 2 and trims whitespace.
  - 10 000-character input → output of length ≤ `maxChars + 40` ending in `\n[… truncated, 10000 chars total]`.
  - message without body → returns the decoded `snippet` (`&#39;` → `'`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement `EmailCleaner`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): email cleaner`.

---

### Task 4: `FreeSlotFinder`

**Files:**
- Create: `packages/core/src/domain/services/free-slot-finder.ts`
- Test: `packages/core/src/domain/services/free-slot-finder.test.ts`

**Interfaces:**
- Consumes: `TimeRange`, `CalendarEvent`.
- Produces: `interface WorkSchedule { zone: string; startHour: number; endHour: number; workDays: number[] /* ISO 1=Monday */ }` and `class FreeSlotFinder { constructor(schedule: WorkSchedule); find(q: { now: DateTime; durationMinutes: number; busy: CalendarEvent[]; preferredStartHour?: number; horizonWorkDays: number }): TimeRange | null }`.

Algorithm: for each work day from today (in `zone`) up to `horizonWorkDays` work days: window = `[max(startHour, preferredStartHour ?? startHour), endHour]` intersected with `[now rounded up to a multiple of 15 min, ∞)`; busy = events with `status !== 'cancelled'` and `myResponse !== 'declined'` (all-day events take the whole day; those crossing midnight are clipped to the window); walk the gaps in order and return the first one with duration ≥ `durationMinutes`. `preferredStartHour` applies to the first day only; later days use `startHour`.

- [ ] **Step 1: Tests** (zone `America/Argentina/Buenos_Aires`, 9–19, Mon–Fri, horizon 5)
  - Monday 08:00 with no events, 90 min → 09:00–10:30.
  - Monday 10:07, event 10:30–12:00 → 12:00–13:30 (10:15–10:30 is too short).
  - Friday 18:00 → Monday 09:00–10:30 (skips the weekend).
  - all-day event on Monday → Tuesday 09:00.
  - event Sunday 22:00 – Monday 10:00 → Monday 10:00–11:30.
  - declined event (`myResponse: 'declined'`) is ignored.
  - `preferredStartHour: 15` Monday 08:00 → 15:00–16:30.
  - every day full → `null`.
  - `durationMinutes: 600` (> working day) → `null`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement with Luxon.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): free slot finder`.

---

### Task 5: `PriorityRules`, `ProviderRegistry` and in-memory doubles

**Files:**
- Create: `packages/core/src/domain/services/priority-rules.ts`, `packages/core/src/application/provider-registry.ts`, `packages/core/src/testing/*.ts`
- Test: `priority-rules.test.ts`, `provider-registry.test.ts`

**Interfaces:**
- Produces:
  - `class PriorityRules { constructor(links: PersonLinkLookup); async rank(threads: MailThreadSummary[], own: EmailAddress[], limit: number): Promise<MailThreadSummary[]> }` — includes a thread if: (`unread` and label `CATEGORY_PERSONAL` or no `CATEGORY_*` label) **or** label `IMPORTANT`/`STARRED` **or** (`lastFrom` is not own and `links.isLinkedToAnyProject(lastFrom)`). Always excludes `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL`, `SPAM`, `TRASH`. Order: linked first, then `lastMessageAt` desc.
  - `class ProviderRegistry { register(f: ProviderFactory): void; async forAccount(a: Account): Promise<ProviderBundle> }` — throws `DomainError('No provider registered for kind "<kind>"')` when missing; caches the bundle by `account.id`.
  - `testing/`: `InMemoryMailProvider implements MailReader, DraftWriter`, `InMemoryCalendarProvider implements CalendarReader, EventWriter`, `InMemoryTasksProvider implements TaskReader, TaskWriter`, `InMemoryRepositories` (every interface in `ports/repositories.ts`), `FixedClock implements Clock`. Exported as `@jarvis/core/testing`.

- [ ] **Step 1: Tests** — `PriorityRules`: unread promotion excluded; unread without category included; read but `STARRED` included; with `links` returning `true` for `client@x.com`, their read thread comes first; `limit: 10` cuts at 10. `ProviderRegistry`: unknown kind throws the exact message; two `forAccount` calls with the same id call `create` once.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement rules, registry and doubles.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): priority rules, provider registry, in-memory doubles`.

---

### Task 6: Per-port contract suites

**Files:**
- Create: `packages/contracts/src/{mail-reader,draft-writer,calendar,tasks}.contract.ts`, `packages/contracts/src/index.ts`
- Test: `packages/core/src/testing/in-memory.contract.test.ts`

**Interfaces:**
- Produces: functions `describeMailReaderContract(name: string, setup: () => Promise<{ reader: MailReader; seed(threads: MailThread[]): Promise<void> }>)`, `describeDraftWriterContract(name, setup: () => Promise<{ writer: DraftWriter; reader: MailReader; seed(...): Promise<void>; own: EmailAddress[] }>)`, `describeCalendarContract(name, setup)`, `describeTasksContract(name, setup)`. Each one registers Vitest `describe/it` blocks.

Minimum cases: `getThread` returns messages in chronological order; `sync(null)` returns a non-empty `nextCursor` and `sync(nextCursor)` without changes returns `changes: []`; `createDraft` with `threadId` and no `to` replies to the non-own `lastFrom` with a subject prefixed `Re: ` only once (`Re: Re:` is not duplicated); `createEvent` + `listEvents` over the range includes it; `createTask` + `completeTask` leaves `status: 'completed'` with `completedAt`.

- [ ] **Step 1:** Write the suites and `in-memory.contract.test.ts`, which runs them against the Task 5 doubles.
- [ ] **Step 2:** Run → FAIL where the doubles do not comply.
- [ ] **Step 3:** Adjust the doubles until they comply.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `test(contracts): port contract suites`.

---

### Task 7: Configuration

**Files:**
- Create: `packages/config/src/schema.ts`, `packages/config/src/load-config.ts`, `jarvis.config.example.yaml` (complete it)
- Test: `packages/config/src/load-config.test.ts`

**Interfaces:**
- Produces: `type JarvisConfig = z.infer<typeof JarvisConfigSchema>` with: `timezone` (default `America/Argentina/Buenos_Aires`), `workSchedule { startHour: 9, endHour: 19, workDays: [1,2,3,4,5] }`, `focus { titlePrefix: '[Focus] ', horizonWorkDays: 5, defaultDurationMinutes: 90 }`, `sync { intervalMinutes: 5, gmailInitialWindowDays: 90 }`, `briefing { maxPriorityEmails: 10 }`, `email { maxBodyChars: 4000 }`, `accounts: { id: string; provider: 'google'; email: string; calendars?: string[] /* ids that count as busy; default primary */ }[]`, `mcp { bind: '127.0.0.1', port: 3002, tokenFile: '/run/secrets/mcp_token' }`, `secretsDir: '/run/secrets'`, `dataDir: '/data'`. `function loadConfig(path: string, env: NodeJS.ProcessEnv): JarvisConfig` — YAML + env overrides `JARVIS__SECTION__KEY` (e.g. `JARVIS__SYNC__INTERVALMINUTES=10`).

- [ ] **Step 1: Tests** — YAML empty except for `accounts` → all the exact defaults above; `startHour >= endHour` → validation error with path `workSchedule`; `workDays: [0]` → error; env override applied and converted to a number; `timezone: 'Mars/Olympus'` → error "invalid timezone".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement (zone validated with `Intl.supportedValuesOf('timeZone')`).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(config): typed configuration loader`.

---

### Task 8: Persistence (Drizzle) and repositories

**Files:**
- Create: `packages/adapters-persistence/src/schema.ts`, `db.ts`, `migrate.ts`, `repositories/{account,sync-state,mail,event,task,person-link}.repository.ts`, `drizzle.config.ts`, `drizzle/` (generated)
- Test: `packages/adapters-persistence/src/repositories/*.test.ts` (Testcontainers `postgres:17`)

**Interfaces:**
- Consumes: ports from `ports/repositories.ts` (Task 2).
- Produces: `createDb(url: string): Db`, `runMigrations(db: Db): Promise<void>`, classes `DrizzleAccountRepository`, `DrizzleSyncStateRepository`, `DrizzleMailRepository`, `DrizzleEventRepository`, `DrizzleTaskRepository`, `NullPersonLinkLookup` (returns `false`), each one `implements` its port and receives `Db` through the constructor.

Tables (all with `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`): `accounts(provider, email, display_name, status, status_detail)`; `sync_state(account_id, resource, cursor, last_run_at, unique(account_id,resource))`; `mail_threads(account_id, external_id, subject, last_message_at, unread, labels text[], raw jsonb)`; `mail_messages(account_id, external_id, thread_id fk, from_address, from_name, to jsonb, cc jsonb, subject, sent_at, snippet, labels text[], message_id_header, references_header, raw jsonb)` — **no body**; `calendars(account_id, external_id, title, is_primary)`; `events(account_id, calendar_id fk, external_id, title, starts_at, ends_at, all_day, status, my_response, attendees jsonb, video_link, html_link, raw jsonb)`; `task_lists(account_id, external_id, title, is_default)`; `tasks(account_id, list_id fk, external_id, title, notes, status, due_at, created_at_ext, updated_at_ext, completed_at, deleted, raw jsonb)`. Unique `(account_id, external_id)` on every synced table. Indexes: `mail_threads(account_id,last_message_at desc)`, `events(account_id,starts_at)`, `tasks(account_id,status,due_at)`.

- [ ] **Step 1: Tests** — `applyChanges` with the same `upsert` twice leaves one row; `delete` removes it; `threadsAwaitingReply` returns the thread whose last message is not own and excludes the one I replied to; `EventRepository.inRange` includes an event that starts before and ends inside the range; `TaskRepository.open` excludes completed and `deleted`; `SyncStateRepository.set/get` persists the cursor; `AccountRepository.setStatus` stores `status_detail`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the schema, generate the migration (`pnpm --filter @jarvis/adapters-persistence drizzle-kit generate`), implement the repositories.
- [ ] **Step 4:** Run → PASS (requires Docker).
- [ ] **Step 5:** Commit `feat(persistence): drizzle schema, migrations and repositories`.

---

### Task 9: Google OAuth and token store

**Files:**
- Create: `packages/adapters-google/src/oauth/{scopes,token-store,google-oauth-flow}.ts`, `apps/worker/src/cli/jarvis.ts` (`auth` command)
- Test: `scopes.test.ts`, `token-store.test.ts`, `google-oauth-flow.test.ts`

**Interfaces:**
- Produces: `const GOOGLE_SCOPES: readonly string[]` (the exact 4 from Global Constraints); `class FileTokenStore { constructor(dir: string); read(accountId): Promise<Credentials | null>; write(accountId, c: Credentials): Promise<void> /* file <dir>/google-<accountId>.json, mode 0600 */ }`; `class GoogleOAuthFlow { constructor(clientSecretPath: string, store: FileTokenStore); authorizeInteractive(accountId: string): Promise<void> /* loopback on 127.0.0.1 free port, access_type=offline, prompt=consent */; client(accountId: string): Promise<OAuth2Client> /* throws ReauthRequired when there is no token; persists refreshed tokens via the 'tokens' event */ }`. CLI: `pnpm jarvis auth --account <id>` prints the URL, waits for the callback and confirms `Token saved for <id>`.

- [ ] **Step 1: Tests** — `GOOGLE_SCOPES` deep-equals the exact list and does not contain `https://mail.google.com/`; `write` creates a file with `mode & 0o777 === 0o600`; `client()` without a token throws `ReauthRequired` with that `accountId`; a `tokens` event with a new `refresh_token` is persisted.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(google): oauth flow and token store`.

---

### Task 10: `GmailAdapter`

**Files:**
- Create: `packages/adapters-google/src/gmail/{gmail-adapter,mime-builder,gmail-mapper}.ts`, `packages/adapters-google/src/html-to-text.ts`
- Test: `gmail-adapter.test.ts`, `mime-builder.test.ts`, `gmail.contract.test.ts`

**Interfaces:**
- Consumes: `MailReader`, `DraftWriter`, `IdentityProvider` (Task 2); contracts (Task 6).
- Produces: `class GmailAdapter implements MailReader, DraftWriter, IdentityProvider { constructor(gmail: gmail_v1.Gmail, accountId: string) }`; `function buildMime(d: { from: EmailAddress; to: EmailAddress[]; cc: EmailAddress[]; subject: string; body: string; inReplyTo?: string; references?: string }): string /* base64url */`; `function htmlToPlainText(html: string): string` (wrapper around `html-to-text`, ignores images, `wordwrap: false`).

Fixed details: `listThreads` uses `threads.list({ q, maxResults })` + `threads.get(format: 'metadata', metadataHeaders: From,To,Cc,Subject,Date)`. `getThread` uses `format: 'full'`, decodes `text/plain` and `text/html` parts (base64url, charset from the header). `sync(null)` = message listing `newer_than:<initialWindowDays>d` + `users.getProfile().historyId` as cursor, `fullResync: true`; `sync(cursor)` = paginated `history.list({ startHistoryId, historyTypes: ['messageAdded','messageDeleted','labelAdded','labelRemoved'] })`; if the API answers 404 → same as `sync(null)` with `fullResync: true`. `createDraft` with `threadId`: reads the thread, takes the last message, `to` defaults to its `from`, and if that `from` is own (per `ownAddresses()`), the first non-own `to` recipient; `subject` defaults to `Re: <subject>` without duplicating `Re:`; `In-Reply-To` = the last message's `Message-ID`, `References` = previous `References` + that `Message-ID`; `drafts.create({ requestBody: { message: { raw, threadId } } })`. `ownAddresses` = `users.settings.sendAs.list` (every `sendAsEmail`). Non-ASCII subjects encoded as `=?UTF-8?B?...?=`.

- [ ] **Step 1: Tests** (simulated `gmail_v1.Gmail` client with recorded response objects in `__fixtures__/`)
  - `buildMime` with subject `Reunión ñandú` produces a `Subject: =?UTF-8?B?...?=` header that decodes to the original; includes `In-Reply-To` and `References` when given; UTF-8 body.
  - Review Focus 2: thread whose last message is from `me@gmail.com` (alias in sendAs) to `client@x.com` → draft `to = [client@x.com]`.
  - Review Focus 1: `history.list` rejects with `{ code: 404 }` → `sync('123')` returns `fullResync: true` and a new cursor.
  - `getThread` of an HTML-only message returns `bodyHtml` and undefined `bodyText`.
  - `messages.send` and `drafts.send` are never invoked (spy on the simulated client; assert `not.toHaveBeenCalled()` in every test).
  - `gmail.contract.test.ts` runs `describeMailReaderContract` and `describeDraftWriterContract` against the adapter with an in-memory Gmail fake (`__fixtures__/fake-gmail.ts`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement adapter, mapper and MIME.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(google): gmail adapter (read, sync, drafts)`.

---

### Task 11: `GoogleCalendarAdapter` and `GoogleTasksAdapter`

**Files:**
- Create: `packages/adapters-google/src/calendar/*.ts`, `packages/adapters-google/src/tasks/*.ts`, `packages/adapters-google/src/google-provider-factory.ts`
- Test: `google-calendar-adapter.test.ts`, `google-tasks-adapter.test.ts`, `calendar.contract.test.ts`, `tasks.contract.test.ts`, `google-provider-factory.test.ts`

**Interfaces:**
- Produces: `class GoogleCalendarAdapter implements CalendarReader, EventWriter { constructor(cal: calendar_v3.Calendar, accountId: string, zone: string) }`; `class GoogleTasksAdapter implements TaskReader, TaskWriter { constructor(tasks: tasks_v1.Tasks, accountId: string) }`; `class GoogleProviderFactory implements ProviderFactory { kind = 'google'; constructor(oauth: GoogleOAuthFlow, zone: string) }` with `capabilities = { threads: true, replyHeaders: true, sendAsAliases: true, taskLists: true, incrementalSync: true }`.

Details: all-day events (`start.date`) → `TimeRange` from 00:00 of the day in `zone` to 00:00 of the next day (`end.date` is exclusive), `allDay: true`. `videoLink` = `hangoutLink` or the first `conferenceData.entryPoints[type=video].uri`. `sync(calendarId, null)` = `events.list({ singleEvents: true, timeMin: today-30d, showDeleted: true })` until a `nextSyncToken` arrives; with a cursor it uses `syncToken`; a 410 response → full resync, `fullResync: true`. Events with `status: 'cancelled'` → `EventChange` `delete`. Tasks: `sync(listId, cursor)` where cursor = ISO of `updatedMin`; `showCompleted: true, showHidden: true, showDeleted: true`; `isDefault` = first list returned by `tasklists.list` (the one Google creates as "My Tasks").

- [ ] **Step 1: Tests** — event `start.date: '2026-11-24', end.date: '2026-11-25'` → range 2026-11-24T00:00−03:00 to 2026-11-25T00:00−03:00; `syncToken` with 410 → `fullResync: true`; cancelled event → `delete`; `createEvent` sends `transparency: 'opaque'` and the zone; `completeTask` sends `status: 'completed'`; task with `deleted: true` → `delete`; the factory returns a bundle with the exact capabilities; calendar and tasks contracts pass against in-memory API fakes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(google): calendar and tasks adapters, provider factory`.

---

### Task 12: Sync and read use cases

**Files:**
- Create: `packages/core/src/application/use-cases/{sync-account,get-daily-briefing,search-emails,read-thread,list-events,list-tasks,find-free-slot}.ts`, `packages/core/src/application/index.ts`
- Test: one `*.test.ts` per use case, with the Task 5 doubles

**Interfaces:**
- Consumes: ports, `ProviderRegistry`, `EmailCleaner`, `FreeSlotFinder`, `PriorityRules`, `Clock`.
- Produces: `interface AppSettings { zone: string; workSchedule: WorkSchedule; focus: { titlePrefix: string; horizonWorkDays: number; defaultDurationMinutes: number }; sync: { gmailInitialWindowDays: number }; briefing: { maxPriorityEmails: number }; busyCalendars: Record<string /* accountId */, string[]> }` in `application/config.ts` (the app builds it from `JarvisConfig`, so `core` does not depend on `@jarvis/config`). Use cases (all classes with `execute`):
  - `SyncAccount.execute(accountId: string): Promise<{ resources: Record<'mail'|'calendar'|'tasks', 'ok'|'skipped'|'error'>; fullResync: string[] }>` — per resource: read cursor, `sync`, `applyChanges`, store cursor. `ReauthRequired` → `accounts.setStatus(id,'needs_reauth','run pnpm jarvis auth --account <id>')` and returns without throwing. An error in one resource does not stop the others.
  - `GetDailyBriefing.execute({ dateOffsetDays: number }): Promise<DailyBriefing>` with `DailyBriefing = { date: string /* ISO date in zone */; events: BriefingEvent[]; priorityEmails: BriefingEmail[]; tasksDue: BriefingTask[]; accountsNeedingReauth: string[] }`; `BriefingEvent = { id; title; start: string; end: string; allDay; videoLink?; attendees: string[] }` (excludes declined and cancelled), `BriefingEmail = { threadId; from: string; subject; date: string; snippet /* clean */ }`, `BriefingTask = { id; title; due?: string; list: string }` (due by the end of the requested day).
  - `SearchEmails.execute({ query, maxResults /* 1..20, default 5 */ }): Promise<EmailResult[]>` with `EmailResult = { id; threadId; from; subject; date; body /* EmailCleaner.clean */ }` — live query to the provider of each active account.
  - `ReadThread.execute({ accountId?, threadId }): Promise<{ threadId; subject; messages: EmailResult[] }>`.
  - `ListEvents.execute({ from: string; to: string }): Promise<BriefingEvent[]>` (from the DB).
  - `ListTasks.execute({ status?: 'open'|'completed'|'all' }): Promise<BriefingTask[]>`.
  - `FindFreeSlot.execute({ durationMinutes; preferredStartHour? }): Promise<{ start: string; end: string } | null>` (busy = DB events of the configured calendars).

- [ ] **Step 1: Tests** — Review Focus 4: two accounts, the first throws `ReauthRequired` on `sync` → it ends up `needs_reauth` with the exact message and the second one syncs; `SyncAccount` stores the `nextCursor`; `GetDailyBriefing(1)` with a Monday 20:00 clock returns Tuesday's events; excludes a declined event; `priorityEmails.length <= 10`; `accountsNeedingReauth` lists the flagged account; `SearchEmails` with `maxResults: 50` is capped at 20; the `body` comes clean (no quote); `FindFreeSlot` delegates to `FreeSlotFinder` with the DB events.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): sync and read use cases`.

---

### Task 13: Write use cases

**Files:**
- Create: `packages/core/src/application/use-cases/{block-focus-time,create-draft,create-task,complete-task}.ts`
- Test: one `*.test.ts` per use case

**Interfaces:**
- Produces:
  - `BlockFocusTime.execute({ taskName: string; durationMinutes?: number /* default 90 */; preferredStartHour?: number; accountId?: string }): Promise<{ status: 'created'; eventId; start; end; htmlLink? } | { status: 'already_exists'; eventId; start; end } | { status: 'no_slot'; searchedWorkDays: number }>` — exact title `${titlePrefix}${taskName}`; if the slot's day already has an event with that exact title → `already_exists`; creates it on the account's primary calendar (the first active one if none is given) and stores the event in the DB.
  - `CreateDraft.execute({ to?: string[]; cc?: string[]; subject?: string; body: string; threadId?: string; accountId?: string }): Promise<{ draftId; threadId?; to: string[]; subject; gmailUrl: string }>` — checks that there is a `to` or a `threadId` (otherwise `DomainError('Either "to" or "thread_id" is required')`); `gmailUrl = https://mail.google.com/mail/#drafts?compose=<draftId>`.
  - `CreateTask.execute({ title; notes?; due?: string; listId?: string; accountId? })` → `BriefingTask` (default list if none is given).
  - `CompleteTask.execute({ taskId; accountId? })` → `BriefingTask`.

- [ ] **Step 1: Tests** — `BlockFocusTime` creates `[Focus] Refactor auth` 09:00–10:30; a second call on the same day → `already_exists` without creating another event; full agenda → `no_slot` with `searchedWorkDays: 5`; `CreateDraft` with neither `to` nor `threadId` throws the exact message; with `threadId` it delegates to `DraftWriter` without `to`; `CompleteTask` leaves the task completed in the DB.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): write use cases (focus, drafts, tasks)`.

---

### Task 14: `worker` app (NestJS): composition, scheduler and catch-up

**Files:**
- Create: `apps/worker/src/{main,app.module,providers.module,sync.scheduler,catch-up}.ts`; complete `apps/worker/src/cli/jarvis.ts` with `migrate` and `sync --once`
- Test: `catch-up.test.ts`, `sync.scheduler.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `ProvidersModule` (Nest module reusable by `mcp-server`) that exposes the concrete implementations through **tokens** (`TOKENS.ProviderRegistry`, `TOKENS.Clock`, `TOKENS.AccountRepository`, …, defined in `packages/core/src/application/tokens.ts` as `Symbol`s), and every use case as a provider. `class CatchUp { static isOverdue(lastRunAt: DateTime | null, now: DateTime, intervalMinutes: number): boolean }`. `SyncScheduler` with `@Interval` per `sync.intervalMinutes`, runs `SyncAccount` for each `active` account in series and, on startup (`onApplicationBootstrap`), runs once if `CatchUp.isOverdue`. Accounts from `config.accounts` are `upsert`ed into the DB on startup.

- [ ] **Step 1: Tests** — `isOverdue(null, …)` → `true`; last run 4 min ago with interval 5 → `false`; 6 min ago → `true`; scheduler with two accounts (one `needs_reauth`) only syncs the active one; two simultaneous ticks do not run in parallel (the second is skipped while the first is in progress).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the module, scheduler, `main.ts` (logger to stderr) and CLI commands.
- [ ] **Step 4:** Run → PASS; `pnpm lint:deps` → no violations.
- [ ] **Step 5:** Commit `feat(worker): composition root, sync scheduler with catch-up`.

---

### Task 15: `mcp-server` app (NestJS + MCP SDK)

**Files:**
- Create: `apps/mcp-server/src/{main,app.module,mcp.controller,bearer.guard,mcp-server.factory}.ts`, `apps/mcp-server/src/tools/{briefing,email,calendar,tasks}.tools.ts`
- Test: `apps/mcp-server/src/mcp.e2e.test.ts`, `bearer.guard.test.ts`

**Interfaces:**
- Consumes: `ProvidersModule` and use cases (Tasks 12–14).
- Produces: `POST/GET/DELETE /mcp` endpoint (Streamable HTTP, sessions with `mcp-session-id`), `GET /health` → `{ status: 'ok' }` without auth. Tools registered with `McpServer.registerTool(name, { title, description, inputSchema, outputSchema }, handler)` and response `{ content: [{ type: 'text', text }], structuredContent }`:

| Tool | Input (Zod) | Use case |
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

Descriptions in English, focused on when to use each tool (the model reads them); `create_gmail_draft` says explicitly "Creates a DRAFT only. Never sends." Every email body/snippet in `structuredContent` and in `text` is wrapped in `<external_content source="email">…</external_content>`. Domain errors → `{ isError: true, content: [{ type: 'text', text: message }] }`, never stack traces. `BearerGuard` compares in constant time against the contents of `mcp.tokenFile`.

- [ ] **Step 1: Tests** — e2e with the SDK's `Client` + `StreamableHTTPClientTransport` against the Nest app started on an ephemeral port with in-memory doubles: `listTools()` returns exactly the 10 names; `get_daily_briefing` returns `structuredContent.date`; `search_emails` wraps the body in `<external_content`; `create_gmail_draft` with neither `to` nor `thread_id` → `isError: true` with the exact message from Task 13; no tool name contains "send"; request without an `Authorization` header → HTTP 401; `/health` without token → 200.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(mcp-server): MCP tools over streamable HTTP`.

---

### Task 16: Docker Compose, README and end-to-end verification

**Files:**
- Create: `docker/node.Dockerfile` (multi-stage, `node:22-slim`, `pnpm deploy --filter <app>`), `docker-compose.yml`, `README.md`
- Modify: `.env.example`, `jarvis.config.example.yaml`

**Interfaces:**
- Produces: services `db` (postgres:17, `pgdata` volume, no published ports, `pg_isready` healthcheck), `migrate` (one-shot `node dist/cli/jarvis.js migrate`, `depends_on: db healthy`), `worker`, `mcp-server` (`127.0.0.1:3002:3002`, `/health` healthcheck), both `depends_on: migrate completed_successfully`. Secrets: `google_oauth_client` (`secrets/google-oauth-client.json`), `mcp_token` (`secrets/mcp_token`), `pg_password`. Volume `jarvis_tokens` mounted at `/data/tokens` for `FileTokenStore`. Config mounted from `./jarvis.config.yaml` at `/app/jarvis.config.yaml:ro`.

- [ ] **Step 1:** Write the Dockerfile and compose file. `docker compose config` → no errors.
- [ ] **Step 2:** README (in English) with: requirements; **Google Cloud Console** step by step (create a project; enable Gmail API, Google Calendar API, Google Tasks API; *External* consent screen with the 4 exact scopes and your own address as a test user; **publish to production** to avoid the 7-day expiry and what the "unverified app" warning means; create an OAuth client ID of type *Desktop app*; save the JSON as `secrets/google-oauth-client.json`); generate `secrets/mcp_token` (`openssl rand -hex 32 > secrets/mcp_token && chmod 600 secrets/mcp_token`); `cp jarvis.config.example.yaml jarvis.config.yaml`; `docker compose run --rm -p 127.0.0.1:53682:53682 worker node dist/cli/jarvis.js auth --account personal` (the loopback flow uses that fixed port inside the container; document it in `GoogleOAuthFlow` as `JARVIS_OAUTH_PORT`, default `53682`); `docker compose up -d`; registration in Claude Code: `claude mcp add --transport http jarvis http://127.0.0.1:3002/mcp --header "Authorization: Bearer $(cat secrets/mcp_token)"`; test with MCP Inspector: `npx @modelcontextprotocol/inspector` → *Streamable HTTP* transport, URL `http://127.0.0.1:3002/mcp`, `Authorization` header.
- [ ] **Step 3:** Real verification (with the user's account, read-only except for a test draft and event they approve): `docker compose up -d` → `docker compose ps` all `healthy`/`exited (0)` for `migrate`; `curl -s 127.0.0.1:3002/health` → `{"status":"ok"}`; `docker compose logs worker` shows a full sync without errors; in MCP Inspector `get_daily_briefing` returns today's events; from Claude Code `/mcp` lists `jarvis` as connected.
- [ ] **Step 4:** `pnpm test && pnpm lint:deps && pnpm typecheck` → all PASS.
- [ ] **Step 5:** Commit `feat: docker compose deployment and setup guide`.
