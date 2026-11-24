# Spike: Claude subscription token headless in a container

Date: 2026-11-24. Image: `docker/spikes/claude-headless.Dockerfile`.

**Result: works.** A token from `claude setup-token` (prefix `sk-ant-oat01-`) authenticates the Claude Code CLI headless, with no login state on disk.

## Install

- Base `node:22-slim`, `npm install -g @anthropic-ai/claude-code@2.1.330` (pinned), runs as user `node`.

## Invocation

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN=<token> <image>
# command: claude -p "Reply with OK" --output-format json
```

The token is passed only as the env var `CLAUDE_CODE_OAUTH_TOKEN`; nothing else is configured.

## Output (`--output-format json`, one JSON object on stdout)

| Field | Success | Invalid token |
|---|---|---|
| exit code | 0 | 1 |
| `is_error` | `false` | `true` |
| `result` | `"OK"` | `"Failed to authenticate. API Error: 401 OAuth access token is invalid."` |
| `terminal_reason` | `completed` | `api_error` |
| `api_error_status` / `api_error_type` | absent | `401` / `authentication_error` |
| `modelUsage` keys | `claude-sonnet-5-5` (default model) | empty |

`total_cost_usd` is reported (≈ 0.02 for this prompt) even with a subscription token; it is the CLI's notional estimate, not a charge. Subscription use is implied by the OAuth token type (no API key is present anywhere).

## Latency

- Valid token: ~16 s wall clock for `docker run` (cold container), `duration_ms` 6.1 s inside the CLI.
- Invalid token: ~12 s wall clock, `duration_ms` 2.5 s.
- The runner's 60 s timeout leaves ample margin.

## Filesystem

- Fully read-only root fails: `EROFS: read-only file system, mkdir '/tmp/claude-1000'`.
- `--read-only --tmpfs /tmp` works, even with a read-only `HOME`. Only a writable `/tmp` is required.

## Decisions for `ClaudeCliRunner` (Task 7) and `docker/api.Dockerfile` (Task 16)

- Spawn `claude -p <prompt> --output-format json` with env `CLAUDE_CODE_OAUTH_TOKEN` read from `/data/agent/claude-token`; inherit no other credentials.
- Parse stdout as JSON; success ⇔ exit 0 and `is_error === false`. On failure, reason = `result` (it never contains the token); map `api_error_status: 401` to "Token rejected: run `claude setup-token` again".
- Install the CLI with npm, pinned to `2.1.330`; the container needs a writable `/tmp`.
