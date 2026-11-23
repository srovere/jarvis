# Jarvis Architecture

> Living document. It describes **how Jarvis is built**. The **why** and the scope decisions are in
> [`superpowers/specs/2026-11-23-jarvis-design.md`](superpowers/specs/2026-11-23-jarvis-design.md).

## 1. Context view

Jarvis is a personal assistant that runs locally in Docker. It integrates email, calendar and task providers, reads the state of development projects on several servers and uses an AI agent (Claude Code, with the user's subscription) to summarize, answer questions and propose actions.

```mermaid
flowchart LR
  U((User))
  subgraph Host["Jarvis host (Docker Compose)"]
    J[Jarvis]
  end
  CC[Claude Code<br/>in the terminal]
  G[(Google<br/>Gmail · Calendar · Tasks)]
  MS[(Microsoft 365<br/>future)]
  S1[[Dev server 1<br/>repos + ~/.claude]]
  S2[[Dev server N]]
  L[[Local folders<br/>repos + ~/.claude]]
  AI[Claude<br/>subscription]

  U -- browser --> J
  U -- uses --> CC
  CC -- MCP --> J
  J -- OAuth/REST --> G
  J -. future .-> MS
  J -- restricted SSH --> S1
  J -- restricted SSH --> S2
  J -- volumes --> L
  J -- claude -p --> AI
```

## 2. Containers (Docker Compose)

```mermaid
flowchart TB
  subgraph compose["docker compose (ports on 127.0.0.1 only)"]
    web["web<br/>React + Vite (nginx)"]
    api["api<br/>NestJS"]
    mcp["mcp-server<br/>NestJS + MCP SDK<br/>Streamable HTTP"]
    worker["worker<br/>NestJS + @nestjs/schedule"]
    db[("db<br/>PostgreSQL 17")]
  end
  web -- REST / SSE --> api
  api -- MCP client --> mcp
  api -- spawn --> cli1["claude -p<br/>(chat)"]
  cli1 -- MCP client --> mcp
  worker -- spawn --> cli2["claude -p<br/>(summaries)"]
  mcp --> core
  api --> core
  worker --> core
  core["packages/core<br/>(domain + adapters)"] --> db
```

| Container | Role | Exposes |
|---|---|---|
| `web` | React dashboard. No business logic. | `127.0.0.1:3000` |
| `api` | Dashboard backend: reads/writes through an **MCP client**, admin endpoints (registry, linking, approvals), chat orchestration (`AgentRunner`), SSE streaming. | `127.0.0.1:3001` |
| `mcp-server` | **The agents' only gateway** to data and actions. Domain tools on top of `core`. | `127.0.0.1:3002` (bearer token) |
| `worker` | Jobs: sync, project discovery, snapshots, task mirror, AI queue. | — |
| `db` | Persistence. | internal network only |

`api` and `worker` ship the Claude Code CLI; the subscription token arrives as a Docker secret.

## 3. Layers and dependencies (ports and adapters)

```mermaid
flowchart TB
  subgraph apps["apps/* (delivery layer · NestJS)"]
    A1[api<br/>controllers · SSE]
    A2[mcp-server<br/>MCP tools]
    A3[worker<br/>jobs]
  end
  subgraph app["packages/core/application (use cases)"]
    UC[GetDailyBriefing · BlockFocusTime · CreateDraft<br/>SyncAccount · DiscoverProjects · RefreshHighlights<br/>LinkEntity · ProposeAction · ApproveAction …]
  end
  subgraph dom["packages/core/domain (pure TS)"]
    E[Entities and value objects<br/>MailThread · CalendarEvent · Task · Project · Person · Account]
    S[Domain services<br/>FreeSlotFinder · ThreadLinker · EmailCleaner · PriorityRules]
    P[Ports (interfaces)]
  end
  subgraph adapters["packages/adapters-* (infrastructure)"]
    AG[adapters-google]
    AT[adapters-transport<br/>local · ssh]
    AA[adapters-agent<br/>claude-code]
    AP[adapters-persistence<br/>drizzle/postgres]
  end
  apps --> app
  app --> dom
  adapters -- implement --> P
  apps -. composition (DI) .-> adapters
```

**Dependency rule:** arrows point inwards. `domain` imports nothing external; `application` only imports `domain`; adapters import `domain` (to implement ports) and their SDKs; apps are the **composition root** that wires everything together with NestJS dependency injection. A lint rule (`dependency-cruiser`) enforces this.

## 4. Main ports

```mermaid
classDiagram
  direction LR
  class MailReader {
    <<interface>>
    +listThreads(query, page) MailThreadSummary[]
    +getThread(id) MailThread
    +sync(cursor) SyncResult~MailChange~
  }
  class DraftWriter {
    <<interface>>
    +createDraft(DraftRequest) DraftRef
  }
  class CalendarReader {
    <<interface>>
    +listEvents(range, calendars) CalendarEvent[]
    +sync(cursor) SyncResult~EventChange~
  }
  class EventWriter {
    <<interface>>
    +createEvent(NewEvent) EventRef
  }
  class TaskReader {
    <<interface>>
    +listLists() TaskList[]
    +sync(cursor) SyncResult~TaskChange~
  }
  class TaskWriter {
    <<interface>>
    +createTask(listId, NewTask) TaskRef
    +completeTask(ref)
    +createList(name) TaskList
  }
  class IdentityProvider {
    <<interface>>
    +ownAddresses() EmailAddress[]
  }
  class ProjectTransport {
    <<interface>>
    +listClaudeProjects() ClaudeProjectDir[]
    +readFile(path) FileContent
    +stat(path) FileStat
    +gitLog(repo, since) Commit[]
    +gitStatus(repo) GitStatus
    +gitRemote(repo) string
    +writeJarvisFile(repo, relPath, content)
    +ensureGitExclude(repo)
  }
  class AgentRunner {
    <<interface>>
    +run(AgentRequest) AsyncIterable~AgentEvent~
    +capabilities() AgentCapabilities
  }
  class Summarizer {
    <<interface>>
    +projectHighlights(ProjectContext) Highlights
    +meetingBrief(MeetingContext) Brief
    +suggestProject(ThreadContext) ProjectSuggestion
  }
  class GmailAdapter
  class GoogleCalendarAdapter
  class GoogleTasksAdapter
  class LocalTransport
  class SshTransport
  class ClaudeCodeRunner
  class AgentSummarizer

  MailReader <|.. GmailAdapter
  DraftWriter <|.. GmailAdapter
  IdentityProvider <|.. GmailAdapter
  CalendarReader <|.. GoogleCalendarAdapter
  EventWriter <|.. GoogleCalendarAdapter
  TaskReader <|.. GoogleTasksAdapter
  TaskWriter <|.. GoogleTasksAdapter
  ProjectTransport <|.. LocalTransport
  ProjectTransport <|.. SshTransport
  AgentRunner <|.. ClaudeCodeRunner
  Summarizer <|.. AgentSummarizer
  AgentSummarizer --> AgentRunner
```

In addition, one repository port per aggregate (`AccountRepository`, `ProjectRepository`, `MailRepository`, `EventRepository`, `TaskRepository`, `PersonRepository`, `HighlightRepository`, `PendingActionRepository`, `SyncStateRepository`), implemented with Drizzle.

### Registries and factories (the O in SOLID)

```mermaid
classDiagram
  class ProviderRegistry {
    +register(kind: ProviderKind, factory: ProviderFactory)
    +forAccount(account: Account) ProviderBundle
  }
  class ProviderFactory {
    <<interface>>
    +create(account, credentials) ProviderBundle
  }
  class ProviderBundle {
    mail?: MailReader & DraftWriter
    calendar?: CalendarReader & EventWriter
    tasks?: TaskReader & TaskWriter
    identity: IdentityProvider
    capabilities: ProviderCapabilities
  }
  class GoogleProviderFactory
  class MicrosoftProviderFactory
  ProviderFactory <|.. GoogleProviderFactory
  ProviderFactory <|.. MicrosoftProviderFactory : future
  ProviderRegistry o-- ProviderFactory
  ProviderFactory ..> ProviderBundle

  class TransportRegistry {
    +register(kind: "local"|"ssh"|string, factory)
    +forServer(server: Server) ProjectTransport
  }
  class AgentRegistry {
    +register(kind, factory)
    +default() AgentRunner
  }
```

Provider differences are queried through **capabilities** (`ProviderCapabilities`: `threads`, `replyHeaders`, `sendAsAliases`, `taskLists`, `freeBusy`…), never with `instanceof`.

## 5. Key flows

### 5.1 Syncing an account

```mermaid
sequenceDiagram
  participant W as worker (SyncScheduler)
  participant UC as SyncAccount
  participant R as ProviderRegistry
  participant P as GmailAdapter / Calendar / Tasks
  participant DB as Repositories
  W->>UC: execute(accountId)
  UC->>DB: syncState(account, resource)
  UC->>R: forAccount(account)
  R-->>UC: ProviderBundle
  UC->>P: sync(cursor)
  P-->>UC: changes + new cursor
  UC->>DB: upsert entities (+ raw JSONB)
  UC->>UC: ThreadLinker / EventLinker (derived linking)
  UC->>DB: store links + cursor
  Note over UC,DB: if the cursor expires → bounded full resync (90 days)
```

### 5.2 Project discovery and snapshots

```mermaid
sequenceDiagram
  participant W as worker
  participant D as DiscoverProjects
  participant T as ProjectTransport (local|ssh)
  participant DB as Repositories
  participant Q as AiJobQueue
  W->>D: execute(serverId)
  D->>T: listClaudeProjects()
  T-->>D: dirs in ~/.claude/projects
  D->>T: stat(candidates) · gitRemote(path)
  D->>DB: discovery_proposals (pending confirmation)
  Note over W: confirmed projects
  W->>T: readFile(registered documents) · gitLog(since)
  W->>DB: document_snapshots (hash, mtime) · commits
  alt some hash changed
    W->>Q: enqueue RefreshHighlights(project) (2h debounce)
  end
```

### 5.3 Chat with action approval

```mermaid
sequenceDiagram
  participant UI as web
  participant API as api
  participant AR as ClaudeCodeRunner
  participant CLI as claude -p
  participant MCP as mcp-server
  UI->>API: POST /chat {sessionId, message}
  API->>AR: run({prompt, allowedTools: read-only + propose_action, resume})
  AR->>CLI: spawn (stream-json, --mcp-config, --allowedTools)
  CLI->>MCP: get_project_status / search_emails …
  MCP-->>CLI: data
  CLI->>MCP: propose_action(create_gmail_draft, params, rationale)
  MCP-->>CLI: pending_action_id
  CLI-->>AR: events (text, tool_use, result)
  AR-->>API: AgentEvent stream
  API-->>UI: SSE
  UI->>API: POST /actions/{id}/approve
  API->>MCP: create_gmail_draft(params)  (MCP client)
  MCP-->>API: draftId
  API-->>UI: confirmed
```

### 5.4 Background AI queue

`AiJobQueue` (Postgres table + processor in `worker`): concurrency 1, per-key debounce (`highlights:<project>`), configurable daily cap, time window for meeting briefs (07:30) and catch-up of missed runs on startup. Each run records duration, reason and result.

### 5.5 Task mirror

`TaskChange` in a list linked to a project → `MirrorTasks(project)` → Markdown render → `ProjectTransport.ensureGitExclude` + `writeJarvisFile(".jarvis/tasks.md")`.

## 6. Data model

```mermaid
erDiagram
  ACCOUNT ||--o{ MAIL_THREAD : syncs
  ACCOUNT ||--o{ CALENDAR : syncs
  ACCOUNT ||--o{ TASK_LIST : syncs
  ACCOUNT ||--o{ SYNC_STATE : has
  MAIL_THREAD ||--o{ MAIL_MESSAGE : contains
  CALENDAR ||--o{ EVENT : contains
  TASK_LIST ||--o{ TASK : contains
  TASK_LIST }o--o| PROJECT : "belongs to (0..1)"
  SERVER ||--o{ PROJECT : hosts
  SERVER ||--o{ DISCOVERY_PROPOSAL : produces
  PROJECT ||--o{ PROJECT_DOCUMENT : registers
  PROJECT_DOCUMENT ||--o{ DOCUMENT_SNAPSHOT : versions
  PROJECT ||--o{ PROJECT_HIGHLIGHT : versions
  PROJECT ||--o{ COMMIT : records
  PERSON }o--o{ PROJECT : "PERSON_PROJECT"
  MAIL_THREAD }o--o{ PROJECT : "THREAD_PROJECT (derived|suggested|manual)"
  EVENT }o--o{ PROJECT : "EVENT_PROJECT (derived|manual)"
  EVENT ||--o| MEETING_BRIEF : has
  MAIL_MESSAGE }o--o{ PERSON : participants
  EVENT }o--o{ PERSON : attendees
  CHAT_SESSION ||--o{ PENDING_ACTION : proposes
  AI_JOB }o--|| PROJECT : "about (optional)"
```

Conventions: internal UUID IDs; external IDs unique as `(account_id, external_id)`; a `raw jsonb` column with the provider's original response; `created_at`/`updated_at` everywhere; links store `origin` and `created_at` for historical analytics.

## 7. Repository layout

```
jarvis/
├─ apps/
│  ├─ api/            NestJS: chat, actions, registry, links, read-models modules
│  ├─ mcp-server/     NestJS + MCP SDK: one provider per tool group
│  ├─ worker/         NestJS + schedule: sync, discovery, snapshots, mirror, ai-queue
│  └─ web/            React + Vite
├─ packages/
│  ├─ core/
│  │  ├─ domain/       entities, value objects, services, ports
│  │  └─ application/  use cases
│  ├─ adapters-google/
│  ├─ adapters-transport/   local, ssh
│  ├─ adapters-agent/       claude-code
│  ├─ adapters-persistence/ drizzle (schema, migrations, repositories)
│  ├─ contracts/            per-port contract tests (reusable by adapters)
│  └─ shared/               DTOs and Zod schemas (api ↔ web ↔ mcp)
├─ agent/             agent instructions, skills and permissions (versioned)
├─ remote/            jarvis-remote (SSH forced command) + installer
├─ docker/            Dockerfiles
├─ docs/              architecture, specs, plans
├─ secrets/           (git-ignored) OAuth, tokens, keys
├─ jarvis.config.example.yaml
└─ docker-compose.yml
```

## 8. Security (technical summary)

| Risk | Mitigation |
|---|---|
| Unwanted email sending | There is no send port or tool; the `gmail.compose` scope is only used for drafts. |
| Uncontrolled agent actions | In chat, only read tools + `propose_action`; the real execution is triggered by `api` after approval. |
| Prompt injection from emails/documents | External content is delimited and marked as untrusted; the agent has no Bash or file editing. |
| Arbitrary execution on servers | `SshTransport` only with named operations + `jarvis-remote` as forced command in `authorized_keys`. |
| Improper writes to repos | Only `writeJarvisFile` under `.jarvis/`; excluded via `.git/info/exclude`; never commits. |
| Secrets | Docker secrets from `secrets/` (git-ignored); OAuth tokens 0600; nothing sensitive in logs. |
| Network exposure | Ports on `127.0.0.1`; MCP with bearer token. |

## 9. How to extend

**New provider (e.g. Microsoft 365)**
1. Create `packages/adapters-microsoft` with classes that implement the needed ports (`MailReader`, `DraftWriter`, …) and declare their `capabilities()`.
2. Implement `MicrosoftProviderFactory` and `MicrosoftOAuthFlow`.
3. Make the `packages/contracts` suite pass for each port.
4. Register the factory in `ProviderRegistry` (providers Nest module). Domain and use cases do not change.

**New transport** (e.g. a remote agent over HTTP): implement `ProjectTransport`, pass the contracts, register it in `TransportRegistry`, add the `kind` to the config schema.

**New agent**: implement `AgentRunner` (`AgentEvent` streaming, sessions, allowed MCP tools) and register it in `AgentRegistry`. `AgentSummarizer` works on top of any `AgentRunner`.
