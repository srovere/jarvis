# Jarvis

Personal assistant for daily work. Jarvis syncs Gmail, Google Calendar and Google Tasks into a local PostgreSQL
database, shows them in a local dashboard (Today, Mail, Calendar, Tasks, Settings) and exposes them to Claude
(Claude Code, Claude Desktop, MCP Inspector) through an MCP server over HTTP.

- **Jarvis never sends email.** There is no send tool, port or endpoint; it can only create drafts that you review
  and send yourself from Gmail.
- **Subscription only, never an API key.** The optional AI agent is the `claude` CLI authenticated with a token from
  `claude setup-token` (your Claude subscription). Jarvis rejects values that look like API keys.
- Everything runs on your machine and listens on `127.0.0.1` only.

## Quick start

Prerequisites: Docker with Compose v2, a Google account, and (for the AI agent step) Claude Code on your computer.

```bash
./jarvis start
```

The first run creates `secrets/mcp_token` and `secrets/pg_password` (random, mode `0600`, never overwritten), builds
the images, starts the stack and prints `Open http://127.0.0.1:3000`. Open it: the wizard walks you through

1. **Mail & Calendar**: upload your Google OAuth client (below), then *Connect with Google*.
2. **AI agent** (optional): run `claude setup-token` on your computer and paste the token. Skip it if you prefer.
3. **Preferences**: time zone, work hours, work days, calendars that block time.
4. **Done**: the first sync starts right away; *Go to dashboard* opens Today.

In the dashboard you can search mail and reply as a **draft**, find free slots and block focus time, and create or
complete tasks. With more than one account connected, every action asks which account to use. *Sync now* in the
header syncs right away; connecting an account also starts a sync.

Other commands: `./jarvis stop` (data is kept), `./jarvis status`, `./jarvis logs [api|worker|mcp-server|db]`.
`./jarvis start` is idempotent: run it again after pulling changes to rebuild.

### Google Cloud setup (one time)

The wizard shows these steps with links; in short:

1. Create a project in <https://console.cloud.google.com/> and enable the **Gmail API**, **Google Calendar API** and
   **Google Tasks API**.
2. *Menu > Google Auth platform > Get started*: app name and support email, audience **External**, contact email,
   accept the policy and *Create*. This wizard does not ask for scopes.
   Then, in *Google Auth platform > Branding*, complete *App domain* (required by Google): *Application home page*,
   *Application privacy policy link* and *Application terms of service link*, and under *Authorized domains* add the
   domain of those pages (e.g. `yourname.github.io` for a GitHub Pages site). The pages must be public and on a domain
   you own; Google may ask you to verify it in [Google Search Console](https://search.google.com/search-console).
   *Save*.
3. *Google Auth platform > Data access > Add or remove scopes*: under *Manually add scopes* paste exactly these 5
   (never `https://mail.google.com/`), *Add to table*, *Update*, then *Save*:
   `gmail.readonly`, `gmail.compose`, `calendar.events`, `tasks` and `calendar.calendarlist.readonly`
   (all under `https://www.googleapis.com/auth/`).
4. *Google Auth platform > Audience*: add yourself under *Test users*, then **Publish app**. In *Testing* mode Google
   expires the refresh token after 7 days. Because it is your own unverified app you will see "Google hasn't verified
   this app" when connecting: choose *Advanced > Go to Jarvis (unsafe)*.
5. *Google Auth platform > Clients > Create client*, application type **Desktop app**, any name, *Create*; in the
   dialog click *Download JSON* (Google may only show the secret then; if you missed it, create a new client) and
   upload the file in the wizard. Jarvis stores it in its data volume (mode `0600`) and never shows it again.

### Claude token (optional)

On your own computer run `claude setup-token`, sign in with your subscription and paste the printed token in step 2
(or later in *Settings > AI agent*). Jarvis verifies it by running the Claude Code CLI inside the `api` container.

## Ports and data

| What | Where |
|---|---|
| Dashboard and API | `http://127.0.0.1:3000` (the only host accepted is `127.0.0.1:3000` / `localhost:3000`) |
| MCP server | `http://127.0.0.1:3002/mcp` (requires `Authorization: Bearer <secrets/mcp_token>`) |
| PostgreSQL | not published |

Port 3000 or 3002 already in use on your machine? `./jarvis start` will fail while binding it: stop the other
program (the address is fixed because the Google redirect URI is `http://127.0.0.1:3000/api/oauth/google/callback`).

Data lives in Docker volumes: `pgdata` (database) and `jarvis_data` (`/data`: `tokens/` Google tokens,
`google/oauth-client.json`, `agent/claude-token`). `docker compose down -v` deletes them.

### File permissions (uid 1000)

The containers run as the `node` user (**uid 1000**) and read `secrets/` through bind mounts. If your host user is
uid 1000 nothing is needed. Otherwise `./jarvis start` warns you; give uid 1000 access without opening the files to
everyone, either

```bash
sudo setfacl -m u:1000:x secrets && sudo setfacl -m u:1000:r secrets/mcp_token secrets/pg_password
```

or `sudo chown 1000:1000 secrets/*` (keep mode `600`). Never `chmod 644` secrets. The script does not run `sudo`
for you.

## Connect Claude to the MCP server

### Claude Code

```bash
claude mcp add --transport http jarvis http://127.0.0.1:3002/mcp \
  --header "Authorization: Bearer $(cat secrets/mcp_token)"
```

`/mcp` inside Claude Code should list `jarvis` as connected.

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Transport **Streamable HTTP**, URL `http://127.0.0.1:3002/mcp`, header `Authorization: Bearer <contents of
secrets/mcp_token>`. Try `get_daily_briefing`.

### Tools

`get_daily_briefing`, `search_emails`, `read_thread`, `create_gmail_draft`, `list_events`, `find_free_slot`,
`block_focus_time`, `list_tasks`, `create_task`, `complete_task`, `list_calendars`, `list_task_lists`,
`get_sync_status`, `trigger_sync`.

## Advanced: `jarvis.config.yaml`

The YAML file is optional. It seeds defaults (time zone, work hours, ...) and can declare accounts for a headless
setup; whatever you save in the dashboard takes precedence (database > YAML > defaults). YAML accounts are imported
only while the database has no account and no saved preferences. See `jarvis.config.example.yaml` for every key;
any key can be overridden with `JARVIS__SECTION__KEY` environment variables.

Docker Compose cannot make a bind mount or a secret optional, so the default `docker-compose.yml` has neither. To use
the YAML (and/or the phase 1 Docker-secret OAuth client, which is still honoured), add a
`docker-compose.override.yml` next to it (Compose loads it automatically):

```yaml
x-config: &config
  type: bind
  source: ./jarvis.config.yaml
  target: /app/jarvis.config.yaml
  read_only: true

services:
  migrate:
    environment: { JARVIS_CONFIG: /app/jarvis.config.yaml }
    volumes: [*config]
  worker:
    environment: { JARVIS_CONFIG: /app/jarvis.config.yaml }
    volumes: [*config]
  mcp-server:
    environment: { JARVIS_CONFIG: /app/jarvis.config.yaml }
    volumes: [*config]
    secrets: [google_oauth_client]   # optional: instead of uploading the client in the wizard
  api:
    environment: { JARVIS_CONFIG: /app/jarvis.config.yaml }
    volumes: [*config]
    secrets: [google_oauth_client]

secrets:
  google_oauth_client:
    file: ./secrets/google-oauth-client.json
```

(Drop the `google_oauth_client` lines if you upload the client in the wizard.) Without the dashboard you can still
authorize an account from the command line:

```bash
docker compose run --rm -p 127.0.0.1:53682:53682 -e JARVIS_OAUTH_BIND=0.0.0.0 \
  worker node dist/cli/jarvis.js auth --account personal
```

## Development

```bash
pnpm install
pnpm build        # builds every package in topological order (web included)
pnpm test         # unit and integration tests (Postgres tests start a container)
pnpm typecheck    # after build
pnpm lint:deps    # architecture rules (dependency-cruiser)
pnpm e2e          # Playwright smoke test of the onboarding wizard (starts its own Postgres container)
```

`pnpm e2e` needs Chromium for Playwright (`pnpm --filter @jarvis/web exec playwright install chromium`). It serves the
real api and mcp-server in-process with simulated Google and Claude; it does not use Docker Compose.

See [`docs/architecture.md`](docs/architecture.md) for the design and [`docs/PENDING.md`](docs/PENDING.md) for open work.

## Troubleshooting

- **`./jarvis start` says the api did not become healthy:** `./jarvis logs api` (and `./jarvis logs mcp-server`).
- **Permission denied reading secrets:** see *File permissions* above.
- **An account shows "needs re-authorization":** use *Reconnect* in the dashboard banner or *Settings > Accounts*. The
  worker and mcp-server pick up the new token without a restart.
- **Tokens expire after 7 days:** the Google app is still in *Testing* mode; publish it to production and reconnect.
- **"Reconnect to grant calendar list access":** the account was connected before the 5th scope existed; reconnect it.
- **Old `jarvis_tokens` volume warning:** phase 1 data is not migrated; reconnect your accounts in the browser and
  then remove the old volume with `docker volume rm <project>_jarvis_tokens`.
- **401 from an MCP client:** the header must be `Authorization: Bearer <exact contents of secrets/mcp_token>`.
- Logs are structured JSON on stderr and never include email bodies or tokens.
