# Jarvis — Pending work

Status as of 2026-11-25. Phase 1 is merged into `main`; phase 4a (dashboard + onboarding) is implemented on
`feat/phase4a-dashboard`, pending the real-account verification below.

## Where we are

**Phase 1 (Foundation + Google + MCP server): implemented.** All 16 tasks of the plan
[`superpowers/plans/2026-11-23-jarvis-phase1-foundation-google-mcp.md`](superpowers/plans/2026-11-23-jarvis-phase1-foundation-google-mcp.md)
are done; each one passed a spec and quality review (with fix rounds where needed).

- 372 tests passing; `pnpm lint:deps` with no violations; `pnpm typecheck` clean (after `pnpm build`).
- Verified in Docker (without a Google account): `db` healthy, `migrate` exits 0, `worker` up,
  `mcp-server` healthy, `/health` → `{"status":"ok"}`, `/mcp` without token → 401, with token it lists the 10 tools.
- Verified against real Postgres: `jarvis migrate` and `jarvis sync --once`.
- Code and documentation translated to English (2026-11-23).

Design: [`superpowers/specs/2026-11-23-jarvis-design.md`](superpowers/specs/2026-11-23-jarvis-design.md) ·
Architecture: [`architecture.md`](architecture.md) · Installation: [`../README.md`](../README.md)

## Next steps (in order)

1. ~~Final whole-branch review + fix round~~ — done and merged on 2026-11-24 (C1, C2, I1-I5 fixed).
   Re-check C1 (live Google tools from the `mcp-server` container) and C2 (re-authorization recovery) during the
   real-account verification.
2. **Phase 4a — dashboard + onboarding** ([design](superpowers/specs/2026-11-24-jarvis-dashboard-onboarding-design.md)):
   implemented (`./jarvis start`, `api` container, React dashboard, onboarding wizard, Settings, Claude token step,
   Playwright smoke test). **Remaining: verify with the real Google account through the wizard** (re-check C1 and C2
   there, the "unverified app" screens, the 5th scope and the Claude token verification inside the `api` container).
   Create a test draft and event only with explicit confirmation.
3. **Documentation** (see next section).
4. Next phases, in the new order: 3 Agent (Claude Code, highlights, meeting summaries, chat, action approval) ·
   2 Projects (local/SSH, discovery, people, task mirror) · 5 Analytics.

## Pending documentation

- [ ] **Architecture diagram** — update `docs/architecture.md` with what was actually built: the
      `@jarvis/composition` package (shared composition root), `apps/worker` and `apps/mcp-server`, the sync flow
      with reconciliation, the Docker deployment (services, secrets, volumes, ports).
- [ ] **Tables and entities** — every table in `packages/adapters-persistence/src/schema.ts` (columns, unique keys,
      FKs, indexes), how it maps to the domain entities (`packages/core/src/domain/model`) and the repositories'
      business rules (email threads, uniqueness per calendar/list, reconciliation on full resync, sync cursors).
- [ ] **Detailed MCP operation** — Streamable HTTP transport with sessions, token authentication, the 10 tools
      (inputs, outputs, errors, examples), external content marking (`<external_content>`), draft rules (never
      sends, replies in thread, default recipient), focus blocks (slot search, deduplication), and how Claude Code
      uses it.
- [ ] **Product documentation** — what Jarvis is, what it is for, day-to-day use cases (morning briefing, focus,
      to-dos from emails, drafts), what it does and does not do (security, privacy, limits), phase roadmap.
- [ ] **Installation and configuration guide** — expand the README into a full step-by-step guide: requirements,
      Google Cloud (with screenshots or detail for each screen), secrets and permissions, every
      `jarvis.config.yaml` key and `JARVIS__…` overrides, multiple accounts, day-to-day operation (logs,
      `sync --once`, re-authorizing), upgrades, Postgres backup/restore, moving to another machine, common problems.

## Onboarding wizard (phase 4a): done

- [x] Mail and calendar accounts: provider select, OAuth client upload, Connect with Google, accounts in the database.
- [x] AI agent subscription: Claude token (`setup-token`), verified with the CLI in the `api` container; skippable.
- [x] Secrets generation: `./jarvis start` creates `secrets/mcp_token` and `secrets/pg_password` (`0600`, never
      overwritten) and warns about uid != 1000.
- [x] Installation docs rewritten around `./jarvis start` (README).

### Deferred from phase 4a

- [ ] CI: nothing runs `pnpm test`, `pnpm e2e` or the image builds automatically yet.
- [ ] The Playwright smoke test only covers the happy path; add the OAuth denied / wrong client file paths.
- [ ] "Use Jarvis's client" option (needs a verified Google client shipped with the build; designed, not built).
- [ ] `./jarvis`: no `update`/`reset` subcommands; migrating the phase 1 `jarvis_tokens` volume is not supported
      (it only warns).
- [ ] Port 3000/3002 are fixed (the OAuth redirect URI and the `Host` allow-list depend on `127.0.0.1:3000`); a
      conflict with another local program must be solved by stopping that program.
- [ ] Run the containers read-only (`read_only: true` + tmpfs `/tmp`): the spike showed only `/tmp` and `/data` need
      to be writable.
- [ ] Windows/macOS: the uid note and ACL commands are Linux-specific; untested with Docker Desktop.
- [ ] Host port 3000 must be free before `./jarvis start`; the script does not give a clear "port in use" message.
- [ ] Run `shellcheck ./jarvis` once (before the real-account session); also harden the script: fail fast when a
      container exits, uid != 1000 branch.
- [ ] MCP connect errors are not logged in the `api` (users only see "MCP server unavailable").
- [ ] `ListCalendars` has no per-account failure isolation (one failing account fails the list; the form falls
      back to manual ids).
- [ ] Agent status can be stale after a failed or thrown verify (Settings may show "connected" after replacing the
      token with a bad one until the next verify); the wizard shows an agent "failed" as done.
- [ ] Calendar view: multi-day events appear only on their first day.
- [ ] `LayeredSettings.current()` has no in-flight de-duplication (at most two parallel DB reads).
- [ ] M1: the uploaded client/agent token use `JARVIS_DATA_DIR` while tokens use `config.dataDir`; derive both from
      one value (same in Docker, differs only for a YAML user with a custom `dataDir`).
- [ ] M2 (intentional): the `email` settings (`maxBodyChars`) stay YAML-only although spec §5.4 lists them.
- [ ] M3: the draft fallback link `https://mail.google.com/mail/#drafts` opens the browser's default Google account;
      add `/u/<email>/`.
- [ ] M5: "Reconnect" has no `login_hint`; tell the user which email to choose (picking another adds a new account).
- [ ] Accepted deviation: timezone labels show the IANA region instead of the country (no dependency-free source).

## Technical items (for the final review)

### Priority

- `pnpm typecheck` on a clean clone needs `pnpm build` first (types resolve from `dist`); test files are not
  type-checked (`tsconfig.test.json`). Fix the `InMemoryMailProvider.sync` arity this hides.
- MCP: sessions have no idle TTL (they grow until restart); no 401 tests for GET/DELETE.
- `ProvidersModule`: the positional `inject` loses type checking of the argument order.

### Minor
- Scheduler "sync finished" log counts skipped `needs_reauth` accounts.

- EmailCleaner: `&#0;` decodes to NUL; truncation can split surrogate pairs.
- FreeSlotFinder: missing edge-case tests (unsorted events, `now` after end of day, weekend, exhausted horizon);
  no input validation.
- Gmail: long headers are not folded; bodies with only an `attachmentId` are lost; full sync is sequential and
  in memory; thread summaries count drafts.
- Persistence: N+1 thread recomputation; placeholder calendar titles are never corrected; `upsertLists` without a
  transaction; DB port fixed at 5432.
- OAuth: non-constant-time `state` comparison; permissions of an existing token directory are not adjusted.
- JSON logs without timestamp; the worker's `main.ts` imports the CLI module.
- Worker has no Docker healthcheck.
- Calendar: `listCalendars` uses `calendarList.list`, which the granted `calendar.events` scope does not cover (403
  on first use); document it on the port or drop it.
- Calendar config: the calendars that count as busy are also the only ones synced; "show in briefing but not busy"
  is not possible (say so in `jarvis.config.example.yaml`).
- Focus blocks are stored under `calendarId: 'primary'`; if the user lists the primary calendar by its real id the
  local copy is never reconciled. Normalize `primary` or write to the first busy calendar.
- `find_free_slot`/`block_focus_time`: the `preferred_start_hour` description promises earlier slots as a fallback
  that `FreeSlotFinder` does not implement (fix the text or the behavior).
- Task lists deleted in Google are never removed locally; their open tasks stay in `list_tasks` and the briefing.
- `search_emails` results have no `accountId`, so the model cannot pass `account_id` to `read_thread` (matters with
  several accounts); `create_gmail_draft` with a `thread_id` from a second account fails.
- `search_emails`: the "latest message" of a thread can be the user's own unsent draft; skip `DRAFT`.
- Draft link `#drafts?compose=<draftId>`: Gmail may expect the message id; check in the real-account verification.
- Gmail full sync is all-or-nothing: a 403 `userRateLimitExceeded` restarts the whole 90-day fetch next tick.
- An event shared by two busy calendars is listed twice in the briefing and in `list_events`.
- Events stored before migration 0001 default to `blocks_time = true` until they change or a full resync rewrites
  them.

## Decisions made during implementation (open to revision)

- OAuth listens on `127.0.0.1:${JARVIS_OAUTH_PORT ?? 53682}` (fixed port for Docker).
- Vitest tests resolve `@jarvis/*` to source (shared config `vitest.shared.ts`).
- Layer rules with dependency-cruiser; only `*.module.ts`, `cli/**`, tests and `packages/composition` may import
  adapters.
- EmailCleaner: `>`-quoted lines are removed (the body is not cut); an "On … wrote:" / "El … escribió:" header
  only counts if it contains `@` or is followed by a quote; if nothing is left, the snippet is used.
- Uniqueness: events by `(account, calendar, id)`, tasks by `(account, list, id)`.
- Gmail: drafts (`DRAFT`) are neither synced nor used as a reply anchor; messages in trash/spam are deleted; in a
  self-only thread the reply goes to the last other sender, or an error is reported.
- Google Tasks: lossless cursor `<iso>|<ids>`; due dates are read as a local date in the configured zone.
- Calendar: zero-length events are widened to 1 minute; all-day events without an end last 1 day.
- Full resync: stored items missing from the snapshot within the window are deleted locally (email 90 days,
  calendar 30 days, tasks the whole list).
- Focus block: duplicates are searched before the slot, over the whole horizon; two pending blocks with the same
  name cannot coexist.
- Briefing: if fetching an account's own addresses fails, the account email is used.
- Shared composition in the `@jarvis/composition` package; `@nestjs/schedule` pinned to ^6 and `commander` to ^13
  (newer versions are ESM-only).
- Repository language: code, user-facing strings, tests and documentation are in English. Spanish is only used as
  deliberate test data (e.g. Spanish reply-attribution headers, non-ASCII encoding fixtures).
