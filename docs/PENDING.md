# Jarvis — Pending work

Status as of 2026-11-23. Merged into `main` (branch `feat/jarvis-fase1`).

## Where we are

**Phase 1 (Foundation + Google + MCP server): implemented.** All 16 tasks of the plan
[`superpowers/plans/2026-11-23-jarvis-phase1-foundation-google-mcp.md`](superpowers/plans/2026-11-23-jarvis-phase1-foundation-google-mcp.md)
are done; each one passed a spec and quality review (with fix rounds where needed).

- 348 tests passing; `pnpm lint:deps` with no violations; `pnpm typecheck` clean (after `pnpm build`).
- Verified in Docker (without a Google account): `db` healthy, `migrate` exits 0, `worker` up,
  `mcp-server` healthy, `/health` → `{"status":"ok"}`, `/mcp` without token → 401, with token it lists the 10 tools.
- Verified against real Postgres: `jarvis migrate` and `jarvis sync --once`.
- Code and documentation translated to English (2026-11-23).

Design: [`superpowers/specs/2026-11-23-jarvis-design.md`](superpowers/specs/2026-11-23-jarvis-design.md) ·
Architecture: [`architecture.md`](architecture.md) · Installation: [`../README.md`](../README.md)

## Next steps (in order)

1. **Final whole-branch review** (most capable model) + a single fix round with whichever of the technical
   items below are chosen to be fixed.
2. **Real verification with the Google account** following the README: Google Cloud project, secrets,
   `jarvis.config.yaml`, `docker compose run … auth`, `docker compose up -d`, `claude mcp add …`. Create a test
   draft and event only with explicit confirmation.
3. ~~Merge `feat/jarvis-fase1` into `main`~~ — done on 2026-11-23 (without the final review; run it against `main`).
4. **Documentation** (see next section).
5. Next phases of the design: 2 Projects (local/SSH, discovery, people, task mirror) ·
   3 Agent (Claude Code, highlights, meeting summaries, action approval) ·
   4 API + React dashboard + chat · 5 Analytics.

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

## Technical items (for the final review)

### Priority

- `jarvis sync --once` exits with code 0 when an account ends up `needs_reauth` (everything "skipped").
  Include the account status in the summary and exit with an error.
- README: troubleshooting suggests `chmod 644` for the secrets; prefer `chown 1000:1000` or `setfacl`, and
  clarify the uid in step 2.
- `pnpm typecheck` on a clean clone needs `pnpm build` first (types resolve from `dist`); test files are not
  type-checked (`tsconfig.test.json`). Fix the `InMemoryMailProvider.sync` arity this hides.
- Accounts removed from the config stay `active` in the database and keep being synced.
- MCP: sessions have no idle TTL (they grow until restart); email subject and sender are not marked as external
  content; no 401 tests for GET/DELETE.
- `ProvidersModule`: the positional `inject` loses type checking of the argument order.

### Minor

- Style: `email-cleaner` files use double quotes (the rest use single quotes).
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
