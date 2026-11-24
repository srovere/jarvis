# Jarvis Phase 4a — Dashboard + Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local React dashboard (Today, Mail, Calendar, Tasks, Settings) with a first-run onboarding wizard, served by a new `apps/api` that reads data as an MCP client of `mcp-server`.

**Architecture:** Accounts and preferences move into Postgres behind new ports (`SettingsStore`, extended `AccountRepository`); every use case reads settings per call so worker and MCP server pick up changes live. `apps/api` (NestJS) exposes `/api/*`: setup/settings/OAuth/agent endpoints call application services through `@jarvis/composition`; data endpoints call MCP tools through one MCP client. `apps/web` (React + Vite) is built to static files served by `apps/api` on `127.0.0.1:3000`.

**Tech Stack:** TypeScript, NestJS 11, Drizzle + Postgres 17, googleapis / google-auth-library, `@modelcontextprotocol/sdk` (server and client), React 19 + Vite + React Router + TanStack Query + Tailwind + shadcn/ui, Vitest + Testing Library, Playwright, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-24-jarvis-dashboard-onboarding-design.md` (and the main design `docs/superpowers/specs/2026-11-23-jarvis-design.md`). §10 of the spec ("Clarifications") is binding.

## Global Constraints

- **Never an Anthropic API key.** The agent is the `claude` CLI authenticated with a subscription token from `claude setup-token` (env `CLAUDE_CODE_OAUTH_TOKEN`). Reject pasted values starting with `sk-ant-api`.
- **Never send email.** No send method, port, tool or endpoint; drafts only.
- OAuth scopes, exactly these 5: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.compose`, `https://www.googleapis.com/auth/calendar.events`, `https://www.googleapis.com/auth/tasks`, `https://www.googleapis.com/auth/calendar.calendarlist.readonly`. Never `https://mail.google.com/`.
- OOP + SOLID, ports & adapters: `domain` imports only Luxon; `application` only `domain`; only composition roots (`apps/*/src/**/*.module.ts`, `apps/*/src/cli/**`, `packages/composition`) and tests instantiate adapters. Extend `.dependency-cruiser.cjs` for `apps/api` and `apps/web` (web imports no `@jarvis/*` server package; it may import a shared DTO package if one is created).
- Ports published only on `127.0.0.1`: api `3000`, mcp-server `3002`. API rejects requests whose `Host` is not `127.0.0.1:3000`/`localhost:3000`, and state-changing requests whose `Origin` is present and not one of those.
- Secrets (`mcp_token`, `pg_password`, uploaded OAuth client, Google tokens, Claude token) are written mode `0600`, never returned by any endpoint, never logged. Data directory `/data` (volume `jarvis_data`): `/data/tokens/`, `/data/google/oauth-client.json`, `/data/agent/claude-token`.
- Settings precedence: database `settings` row > `jarvis.config.yaml` (optional) > schema defaults. YAML accounts are imported only when the database has no account and no settings row.
- Busy calendars are per account (`accounts.calendars_busy`, default `['primary']`); free-slot search uses the union over active accounts.
- Repository is English-only (code, UI strings, tests, docs).
- Tests: Vitest for all TS packages; Google and Claude are always simulated in tests (injected doubles at composition level, never an env switch in production images).

## Review Focus

- OAuth callback with a wrong/expired `state`, or the user denying consent → wizard shows the error, no account row or token file is created.
- Uploading a wrong client file (garbage, a `web`-type client, missing `client_secret`) → clear error naming the problem; nothing stored.
- Reconnecting an email that already exists (any status) → same account id, synced data kept, status `active`, `missing_scopes` refreshed.
- Changing time zone / work hours / busy calendars in Settings → the next MCP tool call and the next worker tick use the new values without restart.
- A request with `Origin: http://evil.example` or `Host: attacker:3000` → 403, nothing changes.

---

### Task 1: Spike — Claude subscription token headless in a container

**Files:**
- Create: `docker/spikes/claude-headless.Dockerfile`, `docs/spikes/2026-11-24-claude-headless.md`

**Interfaces:**
- Produces: the exact CLI invocation, env vars, image install method and output format the `ClaudeCliRunner` (Task 7) must use.

- [ ] **Step 1:** Write a minimal image (`node:22-slim`, user `node`, empty `HOME`, Claude Code CLI installed with a pinned version) whose command is `claude -p "Reply with OK" --output-format json`.
- [ ] **Step 2:** The controller (not a subagent) asks the user to run `claude setup-token` and to export the token in their own shell; run `docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN <image>`. The token never goes into a file in the repo or into logs.
- [ ] **Step 3:** Record in the spike doc: install command and version, exit code, JSON fields (result, usage/cost fields showing subscription use), latency, behaviour with an invalid token (exit code + message), and whether any writable `HOME` is required.
- [ ] **Step 4: Gate.** If it does not work headless, STOP and bring the options to the user before Task 7. Otherwise commit the doc and Dockerfile: `docs: spike claude headless subscription token`.

### Task 2: Scopes, schema migration and account model

**Files:**
- Modify: `packages/adapters-google/src/oauth/scopes.ts`, `packages/core/src/domain/model/account.ts`, `packages/core/src/domain/ports/repositories.ts`, `packages/adapters-persistence/src/schema.ts`, `packages/adapters-persistence/src/repositories/account.repository.ts`, `packages/adapters-persistence/src/mappers.ts`, `packages/core/src/testing/in-memory-repositories.ts`
- Create: migration `packages/adapters-persistence/drizzle/0002_*.sql` (generated)
- Test: account repository tests (Postgres testcontainer, as in phase 1) and its in-memory twin via a shared contract in `packages/contracts`

**Interfaces:**
- Produces:
  - `GOOGLE_SCOPES` (5 entries, order: the 4 existing + `calendar.calendarlist.readonly`).
  - `Account` gains `busyCalendars: string[]` (default `['primary']`), `missingScopes: string[]` (default `[]`), `createdVia: 'wizard' | 'config' | 'cli'`.
  - `AccountRepository` gains `findByEmail(email: EmailAddress): Promise<Account | null>`, `setBusyCalendars(id: string, ids: string[]): Promise<void>`, `setMissingScopes(id: string, scopes: string[]): Promise<void>`, `deleteData(id: string): Promise<void>` (removes synced mail/events/tasks/sync_state of the account, keeps the row).
  - Table `settings` (`id smallint primary key check (id = 1)`, `data jsonb not null`, audit columns). Columns on `accounts`: `calendars_busy text[] not null default '{primary}'`, `missing_scopes text[] not null default '{}'`, `created_via text not null default 'config'`.

- [ ] **Step 1: Write failing tests** (contract, both adapters): `findByEmail` returns the row regardless of status and is case-insensitive; `setBusyCalendars(['primary','team@group'])` round-trips; `deleteData` removes the account's events/tasks/threads and keeps the row and other accounts' data; scopes test asserts `GOOGLE_SCOPES` has length 5 and never contains `https://mail.google.com/`.
- [ ] **Step 2:** Run, see FAIL.
- [ ] **Step 3:** Implement; generate the migration with drizzle-kit; update mappers.
- [ ] **Step 4:** `pnpm test` green.
- [ ] **Step 5:** Commit `feat(persistence): settings table and account calendars/scopes columns`.

### Task 3: SettingsStore port and live settings in every use case

**Files:**
- Create: `packages/core/src/domain/ports/settings.ts`, `packages/adapters-persistence/src/repositories/settings.repository.ts`, `packages/composition/src/layered-settings.ts`, `packages/core/src/testing/in-memory-settings.ts`
- Modify: `packages/core/src/application/config.ts`, every use case and `focus-slot-search.ts` that takes `AppSettings`, `packages/composition/src/providers.module.ts`, `packages/composition/src/app-settings.ts`
- Test: contract for `SettingsStore` (in-memory + Drizzle); use-case tests updated; a new test per Review Focus item 4

**Interfaces:**
- Produces:
  - `interface Preferences { zone; workSchedule: { startHour; endHour; workDays }; focus: { titlePrefix; horizonWorkDays; defaultDurationMinutes }; sync: { intervalMinutes; gmailInitialWindowDays }; briefing: { maxPriorityEmails } }` (domain model, plain data).
  - `interface SettingsStore { load(): Promise<Preferences | null>; save(p: Preferences): Promise<void> }` (port; `null` = never saved).
  - `interface SettingsProvider { current(): Promise<AppSettings> }` (application); `AppSettings` keeps its shape, `busyCalendars` now built from `AccountRepository` rows.
  - `LayeredSettings implements SettingsProvider` in composition: DB row > YAML-derived `Preferences` > defaults; caches for 5 s (`ttlMs` ctor param, Clock injected).
  - `TOKENS.SettingsProvider`, `TOKENS.SettingsStore`; `TOKENS.AppSettings` is removed. `FreeSlotFinder` is created per call from `settings.workSchedule` (or takes it as a parameter) instead of being a singleton bound at startup.

- [ ] **Step 1: Failing tests:** `LayeredSettings` returns DB values over YAML over defaults; after `store.save(...)` and TTL expiry, `current()` reflects the change; `FindFreeSlot` uses the new work hours on the next call after `save` (Review Focus 4); busy calendars come from `accounts.calendars_busy` and the union covers two accounts.
- [ ] **Step 2:** Run, FAIL.
- [ ] **Step 3:** Refactor use cases to `await this.settings.current()` at the start of `execute`; wire tokens.
- [ ] **Step 4:** Full suite, typecheck, lint:deps green.
- [ ] **Step 5:** Commit `refactor(core): read settings per call through SettingsProvider`.

### Task 4: Config import and worker live reload

**Files:**
- Create: `packages/core/src/application/use-cases/import-config.ts`
- Modify/Delete: replace `apps/worker/src/config-account-seeder.ts` with an `ImportConfigOnStart` bootstrap hook that calls `ImportConfig`; `apps/worker/src/sync.scheduler.ts`; `packages/core/src/application/provider-registry.ts`; `packages/core/src/domain/ports/provider.ts`; `packages/adapters-google/src/google-provider-factory.ts`
- Test: `import-config.test.ts`, scheduler tests, registry tests

**Interfaces:**
- Consumes: `SettingsStore`, `AccountRepository` (Task 2/3).
- Produces:
  - `ImportConfig.execute(seed: { preferences: Preferences; accounts: { id; provider; email; calendars?: string[] }[] }): Promise<'imported' | 'skipped'>` — imports only if there is no account and no settings row; accounts get `createdVia: 'config'`, settings row is saved (counts as onboarding done, spec §10.8). Otherwise `'skipped'`, and if the YAML lists accounts the hook logs one warning that YAML accounts are ignored.
  - `ProviderFactory.fingerprint?(account: Account): Promise<string>`; `ProviderRegistry.forAccount` rebuilds the cached bundle when the fingerprint changed. `GoogleProviderFactory.fingerprint` = token file mtime + size (needs `FileTokenStore.stat(accountId)`).
  - `SyncScheduler` reads `intervalMinutes` from `SettingsProvider` each tick (re-schedules when it changes) and polls every 30 s for accounts with a pending sync request (Task 8 adds the request column; until then the poll is a no-op behind an interface `SyncRequests { pending(): Promise<string[]>; clear(id): Promise<void> }`).

- [ ] **Step 1: Failing tests:** import on empty DB creates accounts + settings; second run `'skipped'`; DB with a wizard account + YAML accounts → skipped + warning; registry rebuilds after fingerprint change and reuses otherwise; scheduler picks a new interval.
- [ ] **Step 2–4:** FAIL → implement → green (full suite, typecheck, lint:deps).
- [ ] **Step 5:** Commit `feat: import config once and reload settings and tokens live`.

### Task 5: Google OAuth client store and web OAuth flow

**Files:**
- Create: `packages/adapters-google/src/oauth/client-secret-store.ts`, `packages/core/src/domain/ports/account-connector.ts`
- Modify: `packages/adapters-google/src/oauth/google-oauth-flow.ts`, `packages/adapters-google/src/oauth/token-store.ts`, `packages/adapters-google/src/index.ts`
- Test: `client-secret-store.test.ts`, `google-oauth-flow.test.ts` (Google token endpoint simulated with a local HTTP double, as phase 1 tests do)

**Interfaces:**
- Produces:
  - `GoogleClientSecretStore` (`dataDir/google/oauth-client.json`, legacy fallback `secretsDir/google_oauth_client`): `status(): Promise<'present' | 'missing'>`, `save(json: string): Promise<void>` (validates: object with `installed.client_id` and `installed.client_secret`; a `web` client is rejected with "Create an OAuth client of type Desktop app"; writes `0600`), `read(): Promise<{ clientId; clientSecret }>`.
  - Port `AccountConnector` (provider-agnostic, in core): `readonly kind: ProviderKind`; `beginAuthorization(input: { redirectUri: string }): Promise<{ url: string; state: string; verifier: string }>`; `completeAuthorization(input: { code: string; redirectUri: string; verifier: string }): Promise<{ email: EmailAddress; credentials: unknown; grantedScopes: string[] }>`; `saveCredentials(accountId: string, credentials: unknown): Promise<void>`; `deleteCredentials(accountId: string): Promise<void>`; `missingScopes(granted: string[]): string[]`.
  - `GoogleAccountConnector implements AccountConnector`: PKCE (S256), `access_type=offline`, `prompt=consent`, the 5 scopes; email from the ID token / `gmail.users.getProfile`; rejects responses without `refresh_token` with the existing message.
  - `GoogleOAuthFlow.authorizeInteractive` (CLI) is reimplemented on top of `GoogleAccountConnector` with its loopback server.

- [ ] **Step 1: Failing tests:** each invalid client file case (Review Focus 2); valid save writes `0600`; `beginAuthorization` URL contains exactly the 5 scopes, `code_challenge_method=S256`, the redirect URI; `completeAuthorization` returns email and granted scopes; `missingScopes` lists `calendar.calendarlist.readonly` for an old 4-scope grant.
- [ ] **Step 2–4:** FAIL → implement → green.
- [ ] **Step 5:** Commit `feat(google): client secret store and PKCE web authorization`.

### Task 6: ConnectAccount and account management services

**Files:**
- Create: `packages/core/src/application/use-cases/connect-account.ts`, `.../remove-account.ts`, `.../set-busy-calendars.ts`, `packages/core/src/application/account-id.ts`
- Modify: `apps/worker/src/cli/jarvis.ts` (`auth` uses `ConnectAccount`; `--account` becomes optional: without it the id is derived), `packages/composition/src/providers.module.ts`
- Test: unit tests with in-memory doubles; CLI test updated

**Interfaces:**
- Consumes: `AccountConnector`, `AccountRepository`, `SettingsStore`.
- Produces:
  - `deriveAccountId(email: EmailAddress, taken: Set<string>): string` — slug of the local part (`[a-z0-9_-]`, starts alphanumeric, fallback `account`), then `-2`, `-3`…
  - `ConnectAccount`: `begin(kind: ProviderKind, redirectUri: string)` → `{ url, state, verifier }` (caller stores `state`/`verifier` server-side); `complete(kind, { code, redirectUri, verifier })` → `Account`. Reuses the row found by `findByEmail` (any status) else derives a new id; saves credentials before setting `active`; sets `missingScopes`; `createdVia` `'wizard'` (or `'cli'` from the CLI); invalidates the registry bundle.
  - `RemoveAccount.execute(id, { deleteData: boolean })` → status `disabled`, credentials deleted, optional `deleteData`.
  - `SetBusyCalendars.execute(id, ids: string[])` (non-empty).
  - `TOKENS.ConnectAccount`, `TOKENS.RemoveAccount`, `TOKENS.SetBusyCalendars`, `TOKENS.AccountConnectors` (array, one per kind).

- [ ] **Step 1: Failing tests:** new email → new id `ana` then `ana-2` for a different email with same local part; existing email (disabled) → same id, `active`, data kept (Review Focus 3); connector failure → no row created (Review Focus 1); remove deletes credentials and keeps data unless asked.
- [ ] **Step 2–4:** FAIL → implement → green.
- [ ] **Step 5:** Commit `feat(core): connect, remove and configure accounts`.

### Task 7: Agent connection (Claude subscription)

**Files:**
- Create: `packages/core/src/domain/ports/agent.ts`, `packages/core/src/application/use-cases/connect-agent.ts`, new package `packages/adapters-claude` (`claude-cli-runner.ts`, `file-agent-credential-store.ts`), contract `packages/contracts/src/agent-runner.contract.ts`
- Test: unit tests with a fake process spawner; contract for fake + real runner (real one with a fake `claude` executable script on `PATH`)

**Interfaces:**
- Consumes: Task 1 findings (invocation, output format, error codes).
- Produces:
  - `interface AgentRunner { readonly kind: string; verify(): Promise<{ ok: true; latencyMs: number } | { ok: false; reason: string }> }` and `interface AgentCredentialStore { save(token: string): Promise<void>; present(): Promise<boolean>; clear(): Promise<void> }`.
  - `ClaudeCliRunner` spawns the CLI with `CLAUDE_CODE_OAUTH_TOKEN` read from `/data/agent/claude-token`, timeout 60 s, never logs the token or prompt output.
  - `ConnectAgent`: `saveToken(kind, token)` (rejects `sk-ant-api…` with "This looks like an API key. Jarvis uses your Claude subscription: run `claude setup-token`."; rejects empty), `verify(kind)` → stores `agent: { provider, status: 'connected' | 'failed', verifiedAt, latencyMs }` in settings, `skip()` → `status: 'skipped'`. `Preferences` gains optional `agent`.
  - Agent provider list: `[{ kind: 'claude', label: 'Claude (subscription)' }]`.

- [ ] **Step 1: Failing tests:** API-key rejection; verify success/failure recorded; timeout → failed with reason; token never appears in thrown messages.
- [ ] **Step 2–4:** FAIL → implement → green.
- [ ] **Step 5:** Commit `feat: connect and verify the Claude subscription agent`.

### Task 8: New and extended MCP tools

**Files:**
- Create: use cases `list-calendars.ts`, `list-task-lists.ts`, `get-sync-status.ts`, `request-sync.ts` in `packages/core/src/application/use-cases/`; `apps/mcp-server/src/tools/sync.tools.ts`
- Modify: `calendar.tools.ts` (`list_events` optional `from`/`to` ISO dates; `list_calendars`), `tasks.tools.ts` (`list_task_lists`), `email.tools.ts` (`search_emails` results include `accountId`), schema migration for `accounts.sync_requested_at timestamptz null`, worker `SyncRequests` adapter (Task 4 interface), `mcp.e2e.test.ts`
- Test: tool tests through the SDK client (as phase 1), e2e listing 14 tools

**Interfaces:**
- Produces (tool name → input → `structuredContent`):
  - `list_calendars` → `{ account_id? }` → `{ calendars: { accountId, id, title, primary, busy }[] }` (live from the provider; an account missing the calendar-list scope returns only `primary` plus `missingScope: true`).
  - `list_events` → adds optional `from`, `to` (YYYY-MM-DD, `to` ≥ `from`, max 31 days); default unchanged.
  - `list_task_lists` → `{}` → `{ lists: { accountId, id, title }[] }`.
  - `get_sync_status` → `{}` → `{ accounts: { accountId, email, status, lastSyncAt: string | null, missingScopes: string[] }[] }`.
  - `trigger_sync` → `{ account_id? }` → `{ requested: string[] }` (sets `sync_requested_at`; the worker's 30 s poll runs it and clears it).
  - `search_emails` items gain `accountId`. All titles/subjects/senders keep `<external_content>` marking.

- [ ] **Step 1: Failing tests** per tool (structured output shape, external-content marking, `to` < `from` rejected, worker poll clears the request).
- [ ] **Step 2–4:** FAIL → implement → green.
- [ ] **Step 5:** Commit `feat(mcp): calendars, task lists, sync status and sync trigger tools`.

### Task 9: `apps/api` skeleton: security, MCP client, setup endpoints

**Files:**
- Create: `apps/api/` (`main.ts`, `app.module.ts`, `local-only.guard.ts`, `mcp-client.service.ts`, `setup.controller.ts`, `health.controller.ts`, `package.json`, `tsconfig*.json`, `vitest.config.ts`)
- Modify: `.dependency-cruiser.cjs`, root `tsconfig`/workspace references
- Test: guard tests, setup controller tests, MCP client test against an in-process `mcp-server` app with in-memory providers

**Interfaces:**
- Produces:
  - `LocalOnlyGuard` (global): 403 unless `Host` ∈ {`127.0.0.1:3000`, `localhost:3000`}; for non-GET, 403 if `Origin` is present and not one of `http://127.0.0.1:3000`, `http://localhost:3000`, and 415 unless `content-type: application/json` (uploads use JSON with the file text).
  - `McpClientService`: `call<T>(tool: string, args: object): Promise<T>` returns `structuredContent`; maps tool errors to `502 { error }` (text only); reconnects once on session loss; bearer token from `mcp_token`; URL from `JARVIS_MCP_URL` (default `http://mcp-server:3002/mcp`).
  - `GET /api/health`; `GET /api/setup/status` → `{ accounts: number; agent: 'connected' | 'failed' | 'skipped' | 'none'; preferencesSaved: boolean; googleClient: 'present' | 'missing' }`; `GET /api/providers?kind=mail|agent` → `{ kind, label }[]`.
  - Static: serves `apps/web/dist` at `/` with SPA fallback (excluding `/api`).

- [ ] **Step 1: Failing tests:** Review Focus 5 cases; setup status for empty DB / imported config; MCP client returns structured content from the in-process server.
- [ ] **Step 2–4:** FAIL → implement → green (also lint:deps).
- [ ] **Step 5:** Commit `feat(api): local-only API with setup status and MCP client`.

### Task 10: API — accounts, OAuth, settings and agent endpoints

**Files:**
- Create: `apps/api/src/accounts.controller.ts`, `oauth.controller.ts`, `settings.controller.ts`, `agent.controller.ts`, `oauth-pending.ts` (in-memory map state → `{ verifier, kind, returnTo, expiresAt }`, 10 min)
- Test: controller tests with in-memory services and a fake connector

**Interfaces:**
- Produces:
  - `GET /api/accounts` → `{ id, provider, email, status, statusDetail?, missingScopes, busyCalendars }[]`; `DELETE /api/accounts/:id?deleteData=true|false`; `PUT /api/accounts/:id/calendars` `{ ids }`.
  - `GET /api/google/client` → `{ status }`; `PUT /api/google/client` `{ json: string }` → 204 or 400 `{ error }`.
  - `GET /api/oauth/:kind/start?returnTo=/onboarding|/settings` → 302 to provider; `GET /api/oauth/:kind/callback` → validates state (constant-time, single use, not expired) → `ConnectAccount.complete` → 302 to `returnTo?connected=<id>` or `returnTo?error=<message>` (Review Focus 1). Redirect URI `http://127.0.0.1:3000/api/oauth/google/callback`.
  - `GET /api/settings` → `Preferences` (effective values) ; `PUT /api/settings` (zod-validated with the `@jarvis/config` schemas) → 204/400.
  - `PUT /api/agent/token` `{ kind, token }` → 204/400; `POST /api/agent/verify` → `{ ok, latencyMs? , reason? }`; `POST /api/agent/skip`.

- [ ] **Step 1: Failing tests:** each endpoint happy path + the error paths in Review Focus 1–3; token values never present in responses.
- [ ] **Step 2–4:** FAIL → implement → green.
- [ ] **Step 5:** Commit `feat(api): accounts, OAuth, settings and agent endpoints`.

### Task 11: API — data endpoints through MCP

**Files:**
- Create: `apps/api/src/data.controller.ts` (or one controller per area) and DTO mapping
- Test: controller tests against the in-process MCP server with in-memory providers

**Interfaces:**
- Consumes: tools of Task 8 and phase 1.
- Produces (each a thin call to one tool; response = `structuredContent`):
  - `GET /api/today` → `get_daily_briefing` + `find_free_slot`-free summary: `{ date, cards: { meetings, freeMinutes, priorityEmails, tasksDue }, events, emails, tasks }` (free minutes computed from the briefing's events within work hours by a tool or by `get_daily_briefing` gaining `freeMinutes` — builder's choice, but through MCP).
  - `GET /api/mail/search?q&from&after&before&accountId` → `search_emails`; `GET /api/mail/threads/:accountId/:threadId` → `read_thread`; `POST /api/mail/drafts` → `create_gmail_draft`.
  - `GET /api/calendar/events?from&to` → `list_events`; `GET /api/calendar/calendars` → `list_calendars`; `POST /api/calendar/free-slot` → `find_free_slot`; `POST /api/calendar/focus` → `block_focus_time`.
  - `GET /api/tasks?status` → `list_tasks`; `GET /api/tasks/lists` → `list_task_lists`; `POST /api/tasks` → `create_task`; `POST /api/tasks/:accountId/:taskId/complete` → `complete_task`.
  - `GET /api/sync` → `get_sync_status`; `POST /api/sync` → `trigger_sync`.

- [ ] **Step 1–4:** failing tests per endpoint (shape, MCP error → 502 with message) → implement → green.
- [ ] **Step 5:** Commit `feat(api): data endpoints backed by MCP tools`.

### Task 12: `apps/web` scaffold, shell and API client

**Files:**
- Create: `apps/web/` (Vite React TS, Tailwind, shadcn/ui init, `src/api/client.ts`, `src/api/hooks.ts` (TanStack Query), `src/app/router.tsx`, `src/app/shell.tsx`, `src/app/reauth-banner.tsx`, `src/app/sync-indicator.tsx`)
- Test: component tests (Vitest + Testing Library, `msw` for the API)

**Interfaces:**
- Produces: route tree `/onboarding/*`, `/` (Today), `/mail`, `/mail/:accountId/:threadId`, `/calendar`, `/tasks`, `/settings/*`; `RequireSetup` redirects to `/onboarding` while `accounts === 0 || !preferencesSaved`; shell = left nav + top bar (sync indicator "synced N min ago" + Sync now) + banner listing `needs_reauth` accounts with **Reconnect** (→ `/api/oauth/google/start?returnTo=/settings/accounts`). Right side reserved (empty) for the phase-3 chat. All server text rendered as text, never HTML.

- [ ] **Step 1–4:** failing tests (redirect to onboarding, banner appears for `needs_reauth`, Sync now posts) → implement → green; `pnpm --filter @jarvis/web build` produces `dist/`.
- [ ] **Step 5:** Commit `feat(web): app shell, routing and API client`.

### Task 13: Web — onboarding wizard

**Files:**
- Create: `apps/web/src/onboarding/` (`wizard.tsx` with left step list, `mail-step.tsx`, `google-client-guide.tsx`, `agent-step.tsx`, `preferences-form.tsx` (shared with Settings), `done-step.tsx`, `timezone-combobox.tsx`)
- Test: component tests per step

**Interfaces:**
- Consumes: Task 9–10 endpoints.
- Produces: the approved layouts (spec §4, §5.3–5.7): steps on the left; step 1 provider select (from `/api/providers?kind=mail`), guide with 4 expandable items linking to the Google Cloud Console pages (project, APIs library, consent screen with the 5 scopes listed and the "publish to production" explanation, credentials → Desktop app), file drop → `PUT /api/google/client`, **Connect with Google**, connected accounts list + "Add another account", errors from `?error=`; step 2 agent (paste token, Verify, Skip for now); step 3 preferences grid (timezone combobox "City — Country (UTC±hh:mm)" from `Intl.supportedValuesOf('timeZone')`, prefilled from the browser; work hours; day pills; per-account busy calendars from `/api/calendar/calendars` with manual id input when `missingScope`; horizon; Advanced collapsible); step 4 summary + first sync progress (`/api/sync`) + Go to dashboard. Wizard resumes at the first incomplete step from `/api/setup/status`.

- [ ] **Step 1–4:** failing tests (resume step; client upload error shown; API-key paste error shown; preferences submit payload; busy calendars manual fallback) → implement → green.
- [ ] **Step 5:** Commit `feat(web): onboarding wizard`.

### Task 14: Web — Today, Mail, Calendar, Tasks

**Files:**
- Create: `apps/web/src/today/`, `src/mail/`, `src/calendar/`, `src/tasks/`
- Test: component tests per view

**Interfaces:**
- Produces (spec §6): Today = 4 cards + 3 columns (approved option B); Mail = search form + thread list + thread view + Reply-as-draft dialog with "Open in Gmail" link (label says the draft is not sent); Calendar = week view (Mon–Sun of the selected week, prev/next), Find free slot and Block focus time dialogs; Tasks = list filter (open/overdue/completed), create dialog (title, due, list), complete checkbox (optimistic, rolled back on error). Account selector shown when >1 active account.

- [ ] **Step 1–4:** failing tests (cards numbers from fixture, draft dialog never offers "Send", overdue filter, complete rollback) → implement → green.
- [ ] **Step 5:** Commit `feat(web): today, mail, calendar and tasks views`.

### Task 15: Web — Settings

**Files:**
- Create: `apps/web/src/settings/` (`accounts.tsx`, `agent.tsx`, `preferences.tsx` reusing `preferences-form.tsx`)
- Test: component tests

**Interfaces:**
- Produces: Accounts (status badges, Reconnect, Add account → same OAuth flow with `returnTo=/settings/accounts`, Remove with a confirm dialog offering "Also delete synced data", missing-scope hint), AI agent (status, replace token, Verify), Preferences (same form, saves via `PUT /api/settings`).

- [ ] **Step 1–4:** failing tests (remove dialog sends `deleteData` choice, missing-scope hint, preferences save) → implement → green.
- [ ] **Step 5:** Commit `feat(web): settings`.

### Task 16: Packaging: `./jarvis` script, Docker, README, smoke test

**Files:**
- Create: `jarvis` (POSIX sh, executable), `docker/api.Dockerfile` (builds web + api, installs the pinned Claude Code CLI per Task 1), `tests/jarvis-script.test.sh` (or a Vitest test that runs the script in a temp dir with a fake `docker`), `apps/web/e2e/onboarding.spec.ts` (Playwright)
- Modify: `docker-compose.yml` (service `api` on `127.0.0.1:3000:3000`, `depends_on` migrate + mcp-server healthy, secrets `pg_password` + `mcp_token`; volume `jarvis_data:/data` for api/worker/mcp-server replacing `jarvis_tokens`; `google_oauth_client` secret and the YAML bind become optional), `docker/node.Dockerfile` (`/data` owned by node), `.env.example`, `README.md`, `docs/PENDING.md`, `docs/architecture.md` (containers section)

**Interfaces:**
- Produces: `./jarvis start|stop|status|logs`. `start`: checks `docker compose version`; creates `secrets/` and, only if absent, `mcp_token` (32 bytes hex) and `pg_password` (24 bytes hex) with `0600`; warns if uid ≠ 1000 and applies the README method; warns if a `jarvis_tokens` volume exists; `docker compose up -d --build`; waits for `api` health; prints `Open http://127.0.0.1:3000`. Idempotent; never overwrites secrets.
- Playwright smoke: starts `api` + `mcp-server` in-process with in-memory providers, a fake `AccountConnector` and a fake `AgentRunner`, test database; walks the wizard to Today.

- [ ] **Step 1–4:** failing script test (secrets created once, second run unchanged, perms 0600) and smoke test → implement → green; `docker compose config` valid.
- [ ] **Step 5:** README rewritten around `./jarvis start` + the wizard (manual YAML path kept as "Advanced"); PENDING updated. Commit `feat: one-command start, api container and onboarding docs`.
