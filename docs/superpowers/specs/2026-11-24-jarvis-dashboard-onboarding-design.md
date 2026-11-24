# Jarvis — Dashboard and onboarding (phase 4a) — Design

Date: 2026-11-24. Builds on [`2026-11-23-jarvis-design.md`](2026-11-23-jarvis-design.md) (the "main design") and on
phase 1 as merged in `main`.

## 1. Intent

Jarvis must be usable as a product on its own: a person clones the repository, runs one command and does everything
else from a local web dashboard. Today the only interface is an MCP client (Claude Code / Claude Desktop) and setup is
a manual README procedure. This phase adds:

1. A React dashboard that becomes the primary way to use Jarvis day to day.
2. A first-run **onboarding wizard**: when no account is configured, the dashboard guides the user through
   connecting a mail/calendar provider, connecting the AI agent subscription and choosing preferences.
3. The backend (`apps/api`) that serves the dashboard, reading and writing data **as an MCP client** of
   `mcp-server` (as the main design already decided), plus its own endpoints for setup and settings.

Who it is for: the repository owner and any other **software engineer** who downloads the repository and can follow
a README (terminal, Docker, Git). Not for non-technical users.

### Phase numbering

The main design called the dashboard "phase 1" and analytics "phase 2". Implementation split the work into smaller
phases; this table is the reference from now on:

| Phase | Content | Status |
|---|---|---|
| 1 | Foundation + Google sync + MCP server | Done (merged 2026-11-24) |
| **4a** | **API + React dashboard (Today, Mail, Calendar, Tasks, Settings) + onboarding** | **This document** |
| 3 | Agent: `claude -p`, highlights, meeting briefs, chat in the dashboard, action approval | Next |
| 2 | Projects: local/SSH, discovery, people, task mirror | Later |
| 5 | Analytics charts | Later |

## 2. Goals, non-goals, anti-goals

**Goals**
- `./jarvis start` takes a fresh clone (with Docker installed) to a running stack and prints the dashboard URL.
- On first visit with no account, the dashboard opens the onboarding wizard; nothing else is reachable until at least
  one mail/calendar account is connected.
- Wizard steps: **1 Mail & Calendar** (choose provider → guide to create an OAuth client → upload the client file →
  connect → account appears) · **2 AI agent** (choose provider → paste subscription token → verify; skippable) ·
  **3 Preferences** · **4 Done**.
- Provider lists exist in the UI but contain exactly one entry each: **Google** (mail + calendar + tasks) and
  **Claude (subscription)** (AI agent).
- Each person uses **their own Google OAuth client**; the wizard explains how to create it, screen by screen.
- Accounts and preferences live in Postgres and are editable later in Settings; worker and MCP server pick up changes
  without a restart.
- Dashboard views: Today, Mail, Calendar, Tasks, Settings (see §6).

**Non-goals (this phase)**
- Chat with the agent, highlights, meeting briefs (phase 3). The agent step only connects and verifies.
- Projects, people, SSH (phase 2). Analytics charts (phase 5).
- A shared/verified "Jarvis" OAuth client (designed for, not built: §5.3).
- Login/multi-user, remote access, non-technical installer.
- Sending email (still never; drafts only).

**Anti-goals** (a failure even if it works)
- Any path that needs an Anthropic API key.
- Secrets or tokens shown again in the UI after being saved, logged, or committed.
- The dashboard and the MCP tools disagreeing about the data (the dashboard must read through the same tools).
- Ports reachable from outside `127.0.0.1`.

## 3. Constraints (carried over, plus changes)

- Everything from the main design §2 and phase 1 global constraints still applies (English-only repo, OOP + SOLID,
  ports & adapters, Docker, `127.0.0.1`, never send email, Claude subscription only).
- **OAuth scopes change from 4 to 5**: add `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
  (read-only list of the user's calendars, needed to pick "calendars that block time"). Still never
  `https://mail.google.com/`. Existing tokens lack the new scope: the account shows "Reconnect to grant calendar
  list access" and works otherwise.
- UI strings are in English (repository rule).

## 4. Approaches considered

| | Approach | Trade-offs | Decision |
|---|---|---|---|
| A | `apps/api` is an MCP client of `mcp-server` for all data reads/writes; own REST endpoints only for setup/settings | Practices the MCP client side (a stated learning goal); dashboard and agent see exactly the same data; one more hop; some new tools needed | **Chosen** (user, 2026-11-24; matches the main design) |
| B | `apps/api` calls the application services directly through `@jarvis/composition` | Simpler, fully typed; no MCP client practice; dashboard and agent paths can drift | Rejected |
| C | Direct reads, MCP only for chat | Chat goes through `claude -p` (the CLI is the MCP client), so the API would never use MCP — same as B | Rejected |

UI layout decisions (user, via mockups): wizard with **steps on the left, content on the right**; Today view with
**summary cards on top and three columns (Agenda · Emails · Tasks) below**.

## 5. Setup and onboarding

### 5.1 `./jarvis start` (bootstrap script)

A POSIX shell script at the repository root:
1. Checks Docker / Compose v2 are available; clear message otherwise.
2. Creates `secrets/` if missing and generates, only if absent, `secrets/mcp_token` and `secrets/pg_password`
   (`openssl rand`, falling back to `/dev/urandom`), mode `0600`, owner = invoking user. Prints the uid note if it is
   not 1000 (containers run as `node`, uid 1000) and fixes access with the documented method.
3. No `jarvis.config.yaml` is required anymore (see §5.4).
4. `docker compose up -d --build`, waits for health, prints `Open http://127.0.0.1:3000`.
Also: `./jarvis stop`, `./jarvis logs`, `./jarvis status`. Idempotent; never overwrites existing secrets.

### 5.2 First-run detection

`GET /api/setup/status` → `{ accounts: n, agent: 'connected'|'skipped'|'none', preferencesSaved: bool }`. The web app
routes to `/onboarding` while `accounts === 0` or preferences were never saved; the wizard resumes at the first
incomplete step (state is derived from the database, not from the browser).

### 5.3 Step 1 — Mail & Calendar (Google)

- Provider select (one entry: Google). The provider list comes from the API (`GET /api/providers?kind=mail`), backed
  by a registry in the composition root, so adding Microsoft later is a new entry, not a UI change.
- **OAuth client**: if none is stored yet, the step shows the guide (create project → enable Gmail, Calendar, Tasks
  APIs → consent screen External with the **5 scopes**, add yourself as test user, **publish to production** (explains
  the "unverified app" warning and the 7-day expiry in Testing) → create OAuth client of type **Desktop app** →
  download JSON). Each item links to the right Google Cloud Console page and expands with detail. Then an upload
  field accepts the JSON; the API validates its shape (`installed.client_id`, `client_secret`) and stores it at
  `<dataDir>/google/oauth-client.json` (mode `0600`) in the writable `jarvis_data` volume. The legacy Docker secret
  `google_oauth_client` is still honoured if present (backward compatible) and the upload step is then skipped.
- Designed but not built: a "Use Jarvis's client" option, shown only if the build ships a verified client.
- **Connect with Google**: `GET /api/oauth/google/start` builds the consent URL (5 scopes, `access_type=offline`,
  `prompt=consent`, random `state` + PKCE) with redirect `http://127.0.0.1:3000/api/oauth/google/callback`
  (loopback redirect, accepted by Desktop clients). The callback verifies `state` (constant time), exchanges the
  code, reads the account email from the token / profile, creates or reactivates the account (id derived from the
  email local part, unique-ified), writes the token file (`0600`) and redirects back to the wizard.
- After connecting, the step lists the account and offers "Add another account". The OAuth code moves from the CLI
  into a reusable application service (`ConnectAccount`) used by both the API callback and the existing
  `jarvis auth` CLI (which stays as an alternative).

### 5.4 Accounts and preferences in the database

- `accounts` becomes the source of truth (it already exists; add `calendars_busy text[]`, `created_via
  'wizard'|'config'`). Removing an account in Settings sets `disabled` and deletes its token file; synced data is kept
  until the user confirms "Delete synced data".
- New table `settings` (single row, `jsonb` validated by the existing zod schemas for `timezone`, `workSchedule`,
  `focus`, `sync`, `briefing`, `email`; plus `agent: { provider, status, verifiedAt }`).
- Precedence: database settings > `jarvis.config.yaml` (optional, now only a seed and for infra keys such as
  `mcp.*`, `secretsDir`, `dataDir`) > defaults. On first start, accounts declared in the YAML are imported into the
  database (`created_via='config'`); later YAML edits to accounts are ignored with a warning (one source of truth).
- **Live reload**: a `SettingsProvider` port with a database adapter. Worker reads settings and active accounts at
  the start of every tick; MCP server reads them per tool call (cached a few seconds). The OAuth client cache is
  invalidated when an account's token file changes (mtime) — this also closes the phase-1 limitation where the MCP
  server needed one failed call to pick up a re-authorized token.

### 5.5 Step 2 — AI agent (Claude subscription)

- Provider select (one entry: "Claude (subscription)"), from `GET /api/providers?kind=agent`.
- Instructions: install Claude Code on your machine, run `claude setup-token`, paste the token. Never an API key; the
  field rejects strings that look like API keys (`sk-ant-api…`) with an explanation.
- `POST /api/agent/token` stores it at `<dataDir>/agent/claude-token` (`0600`); `POST /api/agent/verify` runs the
  CLI inside the `api` container (`claude -p "Reply with OK"` with `CLAUDE_CODE_OAUTH_TOKEN` from the file, timeout
  60 s) behind an `AgentRunner` port, and records status + latency. The Claude Code CLI is installed in the `api`
  image (pinned version).
- "Skip for now" marks the agent as skipped; the dashboard shows a hint in Settings. Nothing in this phase needs the
  agent to work.

### 5.6 Step 3 — Preferences

Grid of label + field (approved mockup v2): time zone (searchable combobox "City — Country (UTC±hh:mm)", prefilled
from the browser), work hours (from/to), work days (toggle pills Mon–Sun), calendars that block time (checklist
from the connected accounts' calendar list; primary preselected), focus search horizon (work days). "Advanced"
collapsible: focus prefix, sync interval, max priority emails, first Gmail sync window. Saved through
`PUT /api/settings`, validated with the same zod schemas.

### 5.7 Step 4 — Done

Summary (accounts, agent status, first sync progress — the worker is triggered immediately for new accounts) and
"Go to dashboard".

## 6. Dashboard

Shell: left navigation (Today, Mail, Calendar, Tasks, Settings), top bar with "synced N min ago" + **Sync now**, and a
global banner when any account `needs_reauth` with a **Reconnect** button (goes straight to the Google consent flow
for that account). Space on the right is reserved for the phase-3 chat panel.

- **Today**: four summary cards (meetings today, free hours within work hours, priority emails, tasks due), then
  three columns: Agenda (events + free slots), Priority emails, Tasks due. Items open their detail.
- **Mail**: search (text, sender, date range, account), thread list, thread view (cleaned messages, external
  content rendered as plain text, never HTML), **Reply → creates a draft** (never sends) with "Open in Gmail".
- **Calendar**: week view of events from the busy calendars; actions **Find free slot** and **Block focus time**
  (name, duration).
- **Tasks**: Google Tasks lists; filters open / overdue / completed; create (title, optional due, list); complete.
- **Settings**: Accounts (status, add, reconnect, remove), AI agent (status, replace token, verify), Preferences
  (same form as step 3).

All data reads/writes go `web → api → MCP tools → core`. The account selector appears wherever more than one account
is active.

## 7. API and MCP changes

- `apps/api` (NestJS): REST for the web app under `/api/*`; holds **one MCP client** (official SDK, Streamable HTTP,
  bearer token from `mcp_token`) with reconnect; maps tool `structuredContent` to DTOs. Setup/settings/OAuth/agent
  endpoints call application services through `@jarvis/composition` (they are not tools).
- New / extended MCP tools needed by the views (each with structured output, external-content marking as today):
  `list_calendars`, `list_events` with a date range (week), `list_task_lists`, `list_tasks` with status filter,
  `get_sync_status` (per account: last sync, status), `trigger_sync`. `search_emails` returns `accountId` per result
  (fixes a phase-1 minor item). Tool count changes from 10 to ~14; Claude Code gets them too.
- `apps/web`: React + TypeScript + Vite, React Router, TanStack Query, Tailwind + shadcn/ui. Built as static files and
  served by `apps/api` (one container, one port: `127.0.0.1:3000`).
- Docker: new `api` service (`127.0.0.1:3000`), writable volume `jarvis_data` (tokens, uploaded OAuth client, agent
  token) mounted by `api`, `worker`, `mcp-server`; `google_oauth_client` secret becomes optional.

## 8. Security

- Only `127.0.0.1`; no login (single-user local tool, as in the main design). The API checks the `Host`/`Origin`
  headers (`127.0.0.1:3000` / `localhost:3000`) to block DNS-rebinding and cross-site requests; state-changing
  endpoints require a same-origin `POST`/`PUT`/`DELETE` with JSON content type.
- Uploaded/pasted secrets are written `0600`, never returned by any endpoint (only "present / verified at"), never
  logged.
- OAuth: `state` + PKCE, constant-time comparison, redirect URI fixed to loopback.
- Email/event content rendered as text (no `dangerouslySetInnerHTML`); links shown, not auto-followed.

## 9. Testing

- Unit tests for new services (`ConnectAccount`, settings precedence/import, account removal, provider registry,
  agent token validation) with doubles.
- Contract tests for the `SettingsProvider` and `AgentRunner` ports (fake + real adapters; the real `claude` runner
  is simulated in tests).
- API e2e with a real MCP server in-process and simulated Google (as phase 1 does).
- Web: component tests (Vitest + Testing Library) for the wizard steps and Today; one Playwright smoke test that
  runs through onboarding against simulated Google.
- `./jarvis start` tested with a shell test (secrets generated once, never overwritten).

## 10. Clarifications (from the builder check; Claude's calls unless noted)

1. **Agent authentication is a spike first.** The first task of the plan proves that a `claude setup-token` token
   works headless in the `api` container (`CLAUDE_CODE_OAUTH_TOKEN`, empty `HOME`, no `~/.claude`) and runs on the
   subscription. If it does not, stop and bring the options to the user (e.g. mounting the host's `~/.claude`) before
   building step 2.
2. **What goes through MCP vs. composition.** Rule: *user data* (emails, threads, events, calendars, task lists,
   tasks, sync status, draft/focus/task actions) goes through MCP tools; *installation state* (setup status,
   providers, accounts and their status, OAuth, agent, settings) goes through `/api` endpoints backed by application
   services. So: top-bar sync status → `get_sync_status`; calendar checklist in step 3 → `list_calendars` (the
   account is already connected and active at that point); Settings › Accounts and the `needs_reauth` banner →
   `GET /api/accounts`.
3. **Secrets and migrations.** `api` gets `pg_password` and `mcp_token` (DB for setup/settings, token for its MCP
   client); `mcp-server` already has DB access. `api` depends on `migrate` completing successfully, like the other
   services; the new migration adds `settings` and the new `accounts` columns.
4. **One writable data volume.** Replace `jarvis_tokens` with `jarvis_data` mounted at `/data` in `api`, `worker` and
   `mcp-server`. Tokens stay at `<dataDir>/tokens/` (same path as today), plus `<dataDir>/google/` and
   `<dataDir>/agent/`. The image pre-creates `/data` owned by uid 1000. No migration of existing volumes: phase 1 was
   never used with a real account; `./jarvis start` warns if an old `jarvis_tokens` volume exists.
5. **Scopes per account.** New connections request the 5 scopes. Token refresh never sends scopes (it only uses the
   refresh token), so old tokens keep working for everything else. The granted scopes are read from the token
   response (`scope`) and stored with the token; `accounts.missing_scopes text[]` drives the "Reconnect to grant
   calendar list access" hint. Without that scope, step 3 / Settings fall back to "primary only" plus a manual id field.
6. **Busy calendars are per account** (already so in the YAML account schema: `accounts[].calendars`). They are stored
   in `accounts.calendars_busy`; there is no global calendars setting. Free-slot search, focus blocks and the Today
   "free hours" card use the union of busy calendars of all active accounts.
7. **Account identity.** Reconnecting an email that already has a row (any status) reuses that row and its data.
   New ids: slug of the email local part, with `-2`, `-3`… if taken. "Delete synced data" is a separate explicit action.
8. **Upgrading phase-1 installs.** If the YAML declares accounts, the import also seeds the `settings` row from the YAML
   and counts as onboarding done; the agent step then appears as a "Connect your AI agent" hint in Settings, not as a
   forced wizard.
9. **Tool compatibility.** Changes to existing tools are backward compatible (optional parameters, extra output
   fields): `list_events` gains optional `from`/`to`, `list_tasks` an optional `status`, `search_emails` adds
   `accountId`. New tools: `list_calendars`, `list_task_lists`, `get_sync_status`, `trigger_sync` (10 → 14).
10. **Simulated Google in tests.** Injected adapters at the composition level (the in-memory providers used in phase 1),
    selected only by the test harness, never by an environment variable in the production image. The Playwright smoke
    test starts `api` + `mcp-server` in-process with those doubles and a test database; it does not run against
    Docker Compose. There is no CI yet.

## 11. Left to the builder

Exact table/column names, endpoint payloads, component breakdown, styling details within the approved layouts,
polling intervals, how the wizard links to each Google Cloud Console page, and the account-id derivation rule —
within the decisions above.
