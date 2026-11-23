# Jarvis

Personal assistant for daily work. Phase 1 syncs Gmail, Google Calendar and Google Tasks into a local PostgreSQL
database and exposes them to Claude (Claude Code, Claude Desktop, MCP Inspector) through an MCP server over HTTP.
Jarvis does not call any model and uses no Anthropic API keys: the model is whichever MCP client you use.

**Jarvis never sends email.** There is no send tool or method; it can only create drafts (`create_gmail_draft`)
that you review and send yourself from Gmail.

## Architecture

- `db`: PostgreSQL 17 (`pgdata` volume, no published ports).
- `migrate`: applies the migrations and exits.
- `worker`: syncs every account every 5 minutes (configurable).
- `mcp-server`: MCP tools at `http://127.0.0.1:3002/mcp` (listens on the host's `127.0.0.1` only; requires
  `Authorization: Bearer <token>`).

Secrets live in `secrets/` (git-ignored) and are mounted as Docker secrets. Google OAuth tokens are stored
(mode `0600`) in the `jarvis_tokens` volume.

See [`docs/architecture.md`](docs/architecture.md) for the design and [`docs/PENDING.md`](docs/PENDING.md) for open work.

## Requirements

- Docker and Docker Compose v2.
- A Google account (Gmail, Calendar, Tasks).
- `openssl` (to generate secrets) and, for development, Node.js 22+ and pnpm.
- Optional: Claude Code (`claude`) and `npx` for MCP Inspector.

## 1. Google Cloud Console

1. Go to <https://console.cloud.google.com/> and create a project (e.g. `jarvis`).
2. Under *APIs & Services > Library* enable **Gmail API**, **Google Calendar API** and **Google Tasks API**.
3. Under *APIs & Services > OAuth consent screen* (or *Google Auth Platform*):
   - User type: **External**.
   - Add exactly these 4 scopes (and no others; never `https://mail.google.com/`):
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.compose`
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/tasks`
   - Add your own address as a **test user**.
4. **Publish the app to production** (*Publish app* button). While the app is in *Testing* mode, Google expires the
   refresh token after 7 days and you would have to re-authorize every week. In production it does not expire.
   Since you will not go through Google verification (it is a personal app), when authorizing you will see the
   **"Google hasn't verified this app"** warning: it only means Google has not reviewed the app because you are its
   author and only user. Click *Advanced > Go to Jarvis (unsafe)* and accept the permissions. The Gmail scopes
   (`gmail.readonly`/`gmail.compose`) are restricted; the 100-user limit for unverified apps does not affect you.
5. Under *Credentials > Create credentials > OAuth client ID*, type **Desktop app**. Download the JSON and save it
   as `secrets/google-oauth-client.json`.

## 2. Secrets and configuration

```bash
mkdir -p secrets
openssl rand -hex 32 > secrets/mcp_token && chmod 600 secrets/mcp_token
openssl rand -hex 24 > secrets/pg_password && chmod 600 secrets/pg_password
chmod 600 secrets/google-oauth-client.json
cp jarvis.config.example.yaml jarvis.config.yaml
```

Edit `jarvis.config.yaml` and declare your accounts (`id` lowercase and unique):

```yaml
accounts:
  - id: personal
    provider: google
    email: you@example.com
    calendars: [primary]
```

Any key can be overridden from the environment with `JARVIS__SECTION__KEY`. Files in `secrets/` are never
committed.

## 3. Authorize the Google account

The OAuth flow opens a loopback server on the fixed port `53682` (configurable with `JARVIS_OAUTH_PORT`; the
address with `JARVIS_OAUTH_BIND`, default `127.0.0.1`). Inside Docker it must listen on `0.0.0.0`, published only
to the host's loopback:

```bash
docker compose up -d db
docker compose run --rm migrate
docker compose run --rm -p 127.0.0.1:53682:53682 -e JARVIS_OAUTH_BIND=0.0.0.0 \
  worker node dist/cli/jarvis.js auth --account personal
```

Open the URL the command prints in your browser, accept the permissions and wait for the success message. The
token is stored in the `jarvis_tokens` volume. Repeat with another `--account <id>` for each account.

## 4. Start everything

```bash
docker compose up -d --build
docker compose ps               # db and mcp-server healthy; migrate "exited (0)"
curl -s 127.0.0.1:3002/health   # {"status":"ok"}
docker compose logs -f worker   # should show a full sync without errors
```

To force a one-off sync (development, with `DATABASE_URL` pointing at the database):

```bash
pnpm jarvis sync --once
```

or, in Docker: `docker compose run --rm worker node dist/cli/jarvis.js sync --once`.

## 5. Connect Claude

### Claude Code

```bash
claude mcp add --transport http jarvis http://127.0.0.1:3002/mcp \
  --header "Authorization: Bearer $(cat secrets/mcp_token)"
```

Inside Claude Code, `/mcp` should list `jarvis` as connected.

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Transport **Streamable HTTP**, URL `http://127.0.0.1:3002/mcp`, and under *Authentication* the `Authorization`
header with value `Bearer <contents of secrets/mcp_token>`. Try `get_daily_briefing`.

### Tools

`get_daily_briefing`, `search_emails`, `read_thread`, `create_gmail_draft`, `list_events`, `find_free_slot`,
`block_focus_time`, `list_tasks`, `create_task`, `complete_task`.

## Development

```bash
pnpm install
pnpm build        # builds every package in topological order
pnpm test
pnpm typecheck    # after build
pnpm lint:deps    # architecture rules (dependency-cruiser)
```

## Troubleshooting

- **`needs_reauth` in the logs or the briefing:** the account's token was revoked or expired. Repeat step 3 for that
  account (`auth --account <id>`).
- **Port 53682 in use:** free the port, or use another one with `-e JARVIS_OAUTH_PORT=53700` and publish that same
  port (`-p 127.0.0.1:53700:53700`).
- **The token expires after 7 days:** the app is still in *Testing* mode; publish it to production (step 1.4) and
  re-authorize.
- **`mcp-server` never becomes healthy:** check `docker compose logs mcp-server`; usually `secrets/mcp_token` or
  `jarvis.config.yaml` is missing. Compose requires the three `secrets/` files and the config to exist before `up`.
- **Permission denied reading secrets:** on Linux hosts where your user is not uid 1000, the container's `node`
  user cannot read someone else's `0600` files; use `chmod 644` on `secrets/*` (the directory stays git-ignored) or
  change the owner.
- **401 from the MCP client:** the header must be `Authorization: Bearer <exact contents of secrets/mcp_token>`.
- Logs are structured JSON on stderr and never include email bodies or tokens.
