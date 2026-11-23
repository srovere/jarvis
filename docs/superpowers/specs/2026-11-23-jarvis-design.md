# Jarvis — Diseño

Fecha: 2026-11-23 · Estado: borrador para aprobación

## 1. Intención

Santiago desarrolla varios proyectos en paralelo, cada uno en un servidor de desarrollo distinto, trabajando siempre con Claude Code y pidiéndole que "guarde el progreso en memoria". Hoy la información para organizar el día está dispersa: Gmail, Google Calendar, Google Tasks y las memorias de Claude Code repartidas en varios servidores.

Jarvis es un asistente personal dirigido por IA que:

1. Reúne correos, eventos, tareas y proyectos en un solo lugar y los **vincula entre sí** a través de proyectos y personas.
2. Muestra un **dashboard** local (React) para leer, actuar y hacerle preguntas a un agente.
3. Sabe, para cada proyecto, **qué se hizo por última vez, cuándo, qué sigue y qué está pendiente**, y lo usa para preparar reuniones.
4. Expone todo como **servidor MCP** propio, usable desde Claude Code en la terminal y desde el chat del dashboard.

Objetivo secundario explícito: **aprender a construir agentes** y practicar MCP (servidor y cliente).

## 2. Restricciones (no negociables)

- **Solo suscripción de Claude, nunca API key de Anthropic.** Toda llamada a un modelo pasa por el CLI de Claude Code (`claude -p`), autenticado con el token de suscripción (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`). Esto excluye LangGraph, el Anthropic SDK y el Agent SDK.
- **Todo corre local** con Docker Compose. Control total, sin hosting externo.
- **TypeScript** en todo el stack; **React** en el frontend; **PostgreSQL**.
- **Nunca enviar correos.** Solo borradores. El agente no tiene ninguna herramienta que envíe.
- Credenciales (Google OAuth, claves SSH, token de Claude) fuera del repo, montadas como secretos.
- **Extensibilidad con POO y principios SOLID.** Se empieza con Google (Gmail, Calendar, Tasks), Claude Code y acceso local/SSH, pero el código debe poder sumar otros proveedores (p. ej. Microsoft 365), otros agentes y otros transportes **sin modificar el dominio**: solo agregando adaptadores (ver §5.1).
- **Multi-cuenta desde el modelo de datos**: se usa una sola cuenta al inicio, pero todo dato sincronizado pertenece a una `account` (proveedor + identidad).
- **Independiente de la máquina**: Jarvis corre hoy en la máquina local de Santiago, pero debe poder moverse a otra sin cambios de código: todo lo específico del host (rutas, puertos, servidores) es configuración y volúmenes de Docker.

## 3. Objetivos, no-objetivos y anti-objetivos

**Objetivos (fase 1)**
- Registro de servidores y proyectos con descubrimiento automático por SSH.
- Sincronización de Gmail (metadatos + cuerpo bajo demanda), Calendar y Tasks.
- Vinculación personas↔proyectos, correos/eventos→proyectos (derivada y manual), tareas→proyecto (por lista de Google Tasks).
- Highlights por proyecto y resumen previo a cada reunión del día, generados por Claude.
- Espejo de tareas de Google Tasks a `.jarvis/tasks.md` en el repo del proyecto.
- Servidor MCP con las herramientas del dominio.
- Dashboard: briefing del día, proyectos, correos, eventos, tareas, vinculación manual y chat con el agente.
- Guardar desde el día uno el historial necesario para las analíticas.

**Fase 2 (fuera de alcance ahora, pero el diseño la habilita)**
- Gráficos de analíticas (ver §9).
- Agente nocturno autónomo que lee `.jarvis/tasks.md` en cada servidor, analiza requerimientos y escribe propuestas en `.jarvis/proposals/`.

**No-objetivos**
- Enviar correos, borrar correos, borrar o modificar eventos ajenos, adjuntos.
- Acceso desde fuera de la máquina (celular, otros equipos), multiusuario, autenticación de usuarios.
- Sincronización bidireccional de tareas con el repo.

**Anti-objetivos (fracaso aunque "funcione")**
- Que el agente pueda ejecutar comandos arbitrarios en los servidores de desarrollo.
- Que una acción con efecto externo (borrador, evento, tarea) ocurra sin que Santiago la vea y la apruebe cuando la propone el agente desde el chat.
- Que algún componente requiera API key de Anthropic.
- Que Jarvis ensucie los repos (commits, cambios en `.gitignore`).

## 4. Enfoques considerados

| Enfoque | Qué es | Por qué no / sí |
|---|---|---|
| A. Claude Code + conectores claude.ai + dashboard como Artifact | Sin infraestructura propia | Descartado: Santiago quiere todo local en Docker y control total; no lee memorias remotas por SSH. |
| B1. App propia + LangGraph.js + API de Claude | Agente programado como grafo | Descartado: requiere API key (viola la restricción de suscripción). |
| C. Servidor MCP mínimo en Python (spec original de Gemini) | 4 herramientas para Claude Code | Superado por el alcance actual; su contenido (scopes, borradores en hilos, logging) se reutiliza. |
| **B2. App propia en Docker + servidor MCP propio + Claude Code sin interfaz como motor del agente** | **Elegido** | Cumple suscripción-only, local, control total y aprendizaje de MCP en ambos lados. |

## 5. Arquitectura

```
                  ┌─────────────── docker compose ───────────────────────────┐
navegador ──────► │ web (React+Vite, nginx)                                    │
localhost:3000    │      │ REST/SSE                                            │
                  │      ▼                                                     │
                  │ api (NestJS) ──MCP client──► mcp-server (NestJS, Streamable HTTP)│
                  │      │                              │                      │
                  │      └─► claude -p ──MCP client─────┘                      │
                  │           (suscripción)             ▼                      │
                  │ worker (jobs) ─────────────────► core ──► Google APIs      │
                  │      │                              │   ──► SSH a servidores│
                  │      └─► claude -p (resúmenes)      ▼                      │
                  │                                  db (Postgres)             │
                  └────────────────────────────────────────────────────────────┘
Claude Code en la terminal de Santiago ──MCP (HTTP, localhost)──► mcp-server
```

**Monorepo** (pnpm workspaces):

| Paquete | Responsabilidad |
|---|---|
| `packages/core` | Clientes de Google (Gmail, Calendar, Tasks), cliente SSH acotado, acceso a DB (Drizzle), lógica de dominio (vinculación, huecos libres, limpieza de correos). Sin HTTP. |
| `packages/shared` | Tipos y esquemas Zod compartidos entre api, web y mcp-server. |
| `apps/mcp-server` | Servidor MCP (SDK oficial TS, transporte Streamable HTTP) sobre `core`. Única puerta para que un **agente** toque datos. |
| `apps/api` | Backend del dashboard. Lee/escribe datos **como cliente MCP** del `mcp-server` (práctica de cliente MCP) y endpoints propios para lo que no es herramienta (vinculación manual, aprobaciones, registro). Orquesta el chat lanzando `claude -p`. |
| `apps/worker` | Jobs programados: sincronización, descubrimiento SSH, espejo de tareas, generación de resúmenes con `claude -p`. Usa `core` directamente. |
| `apps/web` | React + Vite. |
| `db` | Postgres 17 con volumen persistente. |

Todos los puertos se publican solo en `127.0.0.1` por defecto (configurable).

### 5.1 Arquitectura de extensibilidad (puertos y adaptadores)

El dominio (`packages/core/domain`) define **interfaces (puertos)** y no conoce a Google, Claude ni SSH. Cada integración es un **adaptador** en su propio paquete que implementa esos puertos. Una **raíz de composición** por app (`apps/*/src/container.ts`) arma las dependencias a partir de la configuración; nada fuera de ella hace `new` de un adaptador concreto.

| Puerto (interfaces segregadas) | Adaptador inicial | Futuro |
|---|---|---|
| `MailReader`, `DraftWriter` | `GmailAdapter` | `OutlookAdapter` (Microsoft Graph) |
| `CalendarReader`, `EventWriter`, `FreeBusyProvider` | `GoogleCalendarAdapter` | `OutlookCalendarAdapter` |
| `TaskReader`, `TaskWriter` | `GoogleTasksAdapter` | `MicrosoftToDoAdapter` |
| `IdentityProvider` (direcciones propias, alias) | `GmailSendAsIdentity` | Graph |
| `AuthFlow` (OAuth por proveedor) | `GoogleOAuthFlow` | `MicrosoftOAuthFlow` |
| `ProjectTransport` (operaciones con nombre sobre un host: listar proyectos, leer archivo, stat, git log/status/remote, escribir en `.jarvis/`) | `LocalTransport` (rutas del host montadas en el contenedor), `SshTransport` | otros (p. ej. API de un agente remoto) |
| `AgentRunner` (ejecutar un prompt con herramientas MCP permitidas, sesión reanudable, salida en streaming) | `ClaudeCodeRunner` (`claude -p`, suscripción) | otro agente/CLI |
| `Summarizer` (highlights, resúmenes de reunión, sugerencias de vínculo, con salida validada por esquema) | `AgentSummarizer` sobre `AgentRunner` | — |
| Repositorios (`ProjectRepository`, `EmailRepository`, …) | Drizzle/Postgres | — |

Principios aplicados:
- **S**: cada clase una responsabilidad (p. ej. `EmailCleaner`, `FreeSlotFinder`, `ThreadLinker`, `ProjectDiscoverer` son servicios de dominio separados de los adaptadores).
- **O**: nuevo proveedor/transporte/agente = nueva clase + registro en un `ProviderRegistry`/`TransportRegistry`/`AgentRegistry`; el dominio no cambia.
- **L**: los adaptadores cumplen el contrato completo del puerto; las diferencias reales entre proveedores (hilos de Gmail vs conversaciones de Outlook, listas de tareas, alias) se expresan con **capacidades declaradas** (`capabilities()`) que el dominio consulta, nunca con `instanceof`.
- **I**: puertos de lectura y escritura separados, para que el chat/MCP pueda recibir solo lectura donde corresponda.
- **D**: servicios de dominio dependen de interfaces, inyectadas por constructor.

Los tipos del dominio son neutrales al proveedor (`MailThread`, `MailMessage`, `CalendarEvent`, `Task`, `Person`), y los IDs externos se guardan como `(account_id, external_id)`. Los datos crudos del proveedor van a una columna JSONB.

### 5.2 Independencia de la máquina

- Configuración en un archivo `jarvis.config.yaml` + variables de entorno (zona horaria, horario laboral, cuentas, servidores, tope de IA); secretos en `secrets/`.
- Los servidores con transporte `local` declaran qué rutas del host se montan (p. ej. `~/.claude/projects`, `/data/devel`) en `docker-compose.override.yml`, generado por `pnpm jarvis init` según la configuración. Mover Jarvis a otra máquina = copiar config + secretos + volumen de Postgres (o restaurar backup) y ajustar los montajes.
- Los jobs programados son **recuperables**: al arrancar (o despertar la máquina), el worker detecta ejecuciones atrasadas (sincronización, resúmenes de las 07:30) y las corre una vez, sin duplicar.
- El servidor MCP escucha en `127.0.0.1` por defecto; con `mcp.bind` y el token bearer puede exponerse (p. ej. para que sesiones de Claude Code en servidores remotos lo usen vía túnel SSH inverso). No se configura en fase 1, pero el diseño no lo impide.

## 6. Componentes en detalle

### 6.1 Registro de servidores y proyectos

- **Servidor**: nombre, tipo de transporte (`local` | `ssh`), y sus parámetros (para `ssh`: host, puerto, usuario, referencia a clave; para `local`: rutas montadas y `home`). La máquina donde corre Jarvis usa `LocalTransport`; los servidores remotos, `SshTransport`. Ambos implementan `ProjectTransport`, así que el resto del sistema no distingue entre ellos.
- **Descubrimiento**: por cada servidor, listar `~/.claude/projects/*`. Cada carpeta corresponde a un directorio donde se usó Claude Code; su nombre es la ruta con `/` reemplazada por `-` (la reconstrucción es ambigua si la ruta tiene guiones: verificar candidatos con `test -d`; si no se resuelve, pedir confirmación). Para cada ruta válida, obtener `git remote get-url origin`. El resultado se presenta como **propuestas** que Santiago confirma, edita o descarta en el dashboard. Carpetas sin repo (p. ej. `~`) se proponen marcadas como "no repo".
- **Proyecto**: nombre, servidor, ruta, repo GitHub, carpeta de memoria, lista de **documentos** (rutas) con tipo (`memory-project`, `memory-other`, `claude-md`, `spec`, `plan`, `readme`, `otro`), y la lista de Google Tasks asociada.
- **Documentos detectados automáticamente**: archivos de `memory/` (clasificados por el `type` del frontmatter), `CLAUDE.md`, `README*`, `docs/superpowers/specs/*`, `docs/superpowers/plans/*` y rutas mencionadas en las memorias `type: project`. Santiago puede agregar o quitar documentos a mano.

### 6.2 Acceso SSH acotado

- Clave dedicada para Jarvis, montada como secreto de solo lectura; `known_hosts` fijado (sin aceptar huellas nuevas en silencio).
- El cliente SSH en `core` expone **solo operaciones con nombre**, nunca un comando libre: `listClaudeProjects`, `readFile(path)` (solo rutas registradas o dentro de la carpeta del proyecto/memoria), `stat`, `gitLog(since)`, `gitStatus`, `gitRemote`, `writeJarvisFile(relPath, content)` (solo bajo `<proyecto>/.jarvis/`) y `ensureGitExclude` (agrega `.jarvis/` a `.git/info/exclude`).
- Argumentos validados y escapados; rutas normalizadas y verificadas contra el prefijo permitido (sin `..`, sin symlinks fuera del prefijo).
- **Restricción también del lado del servidor** (decisión de Claude): la clave de Jarvis se instala en cada servidor con `command="~/.jarvis/jarvis-remote"` en `authorized_keys` (más `no-port-forwarding,no-pty,no-agent-forwarding,no-X11-forwarding`). `jarvis-remote` es un script pequeño, versionado en este repo, que solo acepta las operaciones con nombre anteriores (lee `SSH_ORIGINAL_COMMAND`) y rechaza todo lo demás. Así, ni siquiera quien tenga la clave puede ejecutar comandos arbitrarios. Entregables: el script, sus tests y un procedimiento de instalación por servidor (`pnpm jarvis install-server <host>`).

### 6.3 Sincronización con Google

- **OAuth**: cliente "Desktop app" en un proyecto propio de Google Cloud. Scopes: `gmail.readonly`, `gmail.compose`, `calendar.events`, `tasks`. App en modo *In production* sin verificar (uso personal) para que el refresh token no venza a los 7 días. Flujo inicial con comando `pnpm jarvis auth` (servidor loopback). Tokens en un volumen con permisos 0600.
- **Gmail**: sincronización incremental por `historyId`. Se guardan metadatos (id, threadId, from, to, cc, subject, fecha, labels, snippet, si Santiago respondió en el hilo). El **cuerpo se obtiene bajo demanda** y se limpia (HTML→texto, sin texto citado, sin firmas largas, truncado). Ventana inicial: 90 días.
- **Calendar**: sincronización por `syncToken` de los calendarios del usuario (configurable cuáles cuentan como "ocupado"). Se guardan título, inicio, fin, todo-el-día, invitados, estado de respuesta, link de videollamada, calendario de origen.
- **Tasks**: listas y tareas (por `updatedMin`), con fechas de creación, vencimiento y completado.
- Frecuencia por defecto: cada 5 minutos (configurable). Errores de red/cuota: reintento con backoff, sin perder el cursor.

### 6.4 Personas y vinculación

- **Personas** se crean a partir de direcciones de correo vistas en correos e invitados de eventos. Santiago las vincula a 0..N proyectos.
- **Correos**: proyecto derivado del hilo → de las personas del hilo (excluyendo a Santiago). Si apunta a un solo proyecto, se asigna; si apunta a varios, queda como **sugerencia** con candidatos y Claude propone uno por asunto/contenido; Santiago confirma. La asignación manual por hilo prevalece siempre.
- **Eventos**: mismo criterio por invitados; asignación manual prevalece. Un evento puede tener 0..N proyectos.
- **Tareas**: 0..1 proyecto, determinado por la lista de Google Tasks (una lista por proyecto; la lista por defecto = sin proyecto). Cambiar de proyecto = mover de lista. Al confirmar un proyecto, el registro permite **asociar una lista existente o crear una nueva** con el nombre del proyecto (decisión de Claude); listas sin proyecto se muestran como "sin asignar".
- **Direcciones propias**: las direcciones de Santiago se obtienen de la configuración *send-as* de Gmail (alias incluidos) y se excluyen de la vinculación por personas; también definen "Santiago respondió en el hilo".

### 6.4.1 Correos prioritarios (decisión de Claude)

Consulta SQL, sin IA: hilos con mensajes no leídos en la categoría *Primary*, o con etiqueta IMPORTANT/STARRED, o **sin respuesta de Santiago** cuyo último mensaje es de una persona vinculada a algún proyecto. Orden: vinculados a proyecto primero, luego por fecha. Máximo 10 en el briefing.

### 6.5 Espejo de tareas al repo

- Dirección única: Google Tasks → `<proyecto>/.jarvis/tasks.md` en el servidor del proyecto. Se regenera completo cuando cambian las tareas de esa lista.
- `.jarvis/` se excluye vía `.git/info/exclude`; Jarvis nunca commitea ni toca `.gitignore`.
- Formato: Markdown legible por humanos y por Claude, con frontmatter (`project`, `generated_at`, `source: google-tasks`) y una sección por tarea (id de Google, título, estado, vencimiento, notas). El agente nocturno (fase 2) escribirá en `.jarvis/proposals/` y nunca en `tasks.md`.

### 6.6 Highlights de proyecto y resúmenes de reunión

- El worker toma una **copia** de cada documento registrado (contenido + hash + mtime) y del `git log` reciente. Si cambió algún hash, encola la regeneración de highlights.
- **Highlights** (por proyecto): `ultimo_trabajo` (qué y cuándo), `proximos_pasos`, `pendientes/bloqueos`, `referencias` (documentos citados). Los genera `claude -p` con salida JSON validada contra un esquema; se versionan (historial).
- **Resumen previo a reunión**: cada mañana (y al sincronizar un evento nuevo del día) para eventos vinculados a proyectos: highlights del proyecto + hilos de correo recientes con los invitados + tareas abiertas del proyecto → texto breve "para estar al tanto antes de la reunión".
- Toda invocación a `claude -p` se hace con herramientas deshabilitadas o limitadas a lectura, prompt fijo, y el contenido externo marcado como datos no confiables.
- **Cuidado del uso de la suscripción** (decisión de Claude): todos los trabajos de IA en segundo plano pasan por una cola única con concurrencia 1, *debounce* (un proyecto se regenera como mucho una vez cada 2 horas aunque cambie varias veces), un **tope diario configurable** (por defecto 40 invocaciones) y una ventana preferida (generación de resúmenes de reunión a las 07:30; highlights fuera de esa hora solo si cambió algo). Si se alcanza el tope, se posterga al día siguiente y el dashboard lo indica. El chat interactivo no cuenta para el tope. Se registra cada invocación (duración, motivo) para poder ajustar.

### 6.7 Servidor MCP

Transporte Streamable HTTP en `127.0.0.1`, con token bearer local compartido (para que otro proceso de la máquina no lo use sin permiso). Herramientas (nombres orientativos; el builder puede ajustar):

| Herramienta | Tipo |
|---|---|
| `get_daily_briefing(date_offset_days)` | lectura: eventos del día con resumen previo, correos prioritarios, tareas que vencen, highlights de proyectos activos |
| `search_emails(query, max_results)` / `read_thread(thread_id)` | lectura (sintaxis nativa Gmail; cuerpo limpio y truncado) |
| `list_events(range, project?)` | lectura |
| `list_tasks(project?, status?)` | lectura |
| `list_projects()` / `get_project_status(project)` | lectura |
| `find_free_slot(duration_minutes, preferred_start_hour?)` | lectura |
| `create_gmail_draft(to?, subject, body, thread_id?, cc?)` | escritura |
| `block_focus_time(task_name, duration_minutes, preferred_start_hour?, project?)` | escritura |
| `create_task(title, notes?, due?, project?)` / `complete_task(task_id)` | escritura |
| `link_entity(kind, id, project)` | escritura (local) |

Reglas:
- **Borradores**: si hay `thread_id`, `to` es opcional (por defecto, remitente del último mensaje), asunto `Re:` y encabezados `In-Reply-To`/`References` copiados del último mensaje. Nunca existe herramienta de envío.
- **Bloque de foco**: busca el próximo hueco libre dentro del horario laboral (por defecto 09:00–19:00, lunes a viernes, `America/Argentina/Buenos_Aires`, todo configurable) en los próximos 5 días hábiles, considerando ocupados los eventos de los calendarios configurados. Título `[Focus] {task_name}`. Si ya existe un `[Focus] {task_name}` ese mismo día, no duplica: lo informa.
- Respuestas estructuradas (`structuredContent` + texto breve). El contenido de correos va marcado como externo/no confiable.
- Logs a stderr / logger estructurado; nunca datos sensibles completos en logs.

### 6.8 Chat del dashboard (agente)

- `api` lanza `claude -p --output-format stream-json` con `--mcp-config` apuntando al `mcp-server`, `--allowedTools` limitado a herramientas MCP de Jarvis (sin Bash, sin edición de archivos), y `--resume <session>` para continuar conversaciones. La salida se transmite al navegador por SSE.
- **Aprobación de acciones**: en el chat, las herramientas de escritura no se ejecutan directamente. El agente usa una herramienta `propose_action(kind, params, rationale)` que registra una acción pendiente; el dashboard la muestra con botón **Aprobar / Descartar**, y al aprobar `api` ejecuta la herramienta real vía MCP. (Desde Claude Code en la terminal, las herramientas de escritura quedan sujetas a los permisos normales de Claude Code.)
- La configuración del agente (instrucciones, skills, permisos) vive versionada en el repo (`agent/`), es parte del aprendizaje.
- El contenedor `api` incluye el CLI de Claude Code; `CLAUDE_CODE_OAUTH_TOKEN` como secreto.

### 6.9 Dashboard (web)

Vistas:
- **Hoy**: agenda con resumen previo por reunión, correos prioritarios, tareas que vencen, bloques de foco.
- **Proyectos**: lista con highlights, última actividad y semáforo simple; detalle con documentos, personas, hilos, eventos y tareas vinculados.
- **Correos / Eventos / Tareas**: listas filtrables por proyecto, con vinculación manual y sugerencias pendientes de confirmar.
- **Personas**: vincular personas a proyectos.
- **Registro**: servidores y propuestas de descubrimiento.
- **Chat**: panel lateral persistente con acciones pendientes de aprobación.
- Acciones directas: completar tarea, crear tarea en un proyecto, bloquear foco, abrir/crear borrador (abre en Gmail), vincular/desvincular.

### 6.10 Modelo de datos (conceptual)

`accounts` (proveedor, identidad, referencia a credenciales, capacidades), `servers` (tipo de transporte + parámetros), `projects`, `project_documents` (+ `document_snapshots` con hash, mtime, contenido), `project_highlights` (versionado), `people`, `person_projects`, `email_threads`, `emails` (metadatos), `thread_projects` (origen: derivado/sugerido/manual), `calendars`, `events`, `event_projects` (origen), `meeting_briefs`, `task_lists` (→ proyecto), `tasks` (con `created_at`, `completed_at`), `commits` (proyecto, hash, fecha, autor, mensaje), `sync_state` (cursores), `chat_sessions`, `pending_actions`, `discovery_proposals`. Los datos crudos de Google se guardan también en una columna JSONB para no perder campos.

## 7. Seguridad

- Scopes mínimos de Google; sin `mail.google.com`.
- Ninguna herramienta de envío de correo; acciones del chat con aprobación explícita.
- SSH con operaciones con nombre y rutas acotadas; ninguna ejecución arbitraria.
- Contenido de correos y documentos tratado como no confiable en todos los prompts.
- Secretos (OAuth client, tokens, clave SSH, token Claude, token MCP) en `secrets/` fuera de git (`.gitignore`) y montados como Docker secrets; `.env.example` documenta qué hace falta.
- Puertos solo en `127.0.0.1`.

## 8. Pruebas

- **Tests de contrato por puerto**: una suite compartida que todo adaptador de un puerto debe pasar (hoy contra dobles y Google simulado; mañana contra Microsoft), garantizando la sustitución (L de SOLID).
- Unitarias (Vitest) para lógica de `core`: limpieza de correos, cálculo de huecos libres, vinculación, reconstrucción de rutas, validación de rutas SSH, armado de borradores con encabezados de respuesta.
- Integración con APIs de Google y SSH **simuladas** (sin tocar la cuenta real).
- Tests del servidor MCP con el cliente MCP del SDK.
- `claude -p` se abstrae detrás de una interfaz para poder simularlo en tests.

## 9. Analíticas (fase 2) — datos que se guardan desde fase 1

Set inicial acordado: (1) horas por proyecto por semana (reunión vs foco), (4) tareas creadas vs completadas por semana, (5) tareas abiertas por antigüedad, (8) mapa de calor de commits, (9) días desde la última actividad, (12) tiempo de respuesta a clientes / hilos esperando respuesta, (14) semáforo de salud por proyecto. El modelo de §6.10 guarda lo necesario para estas y para el resto del catálogo discutido (burndown, ciclo de tareas, volumen de correos, reuniones por cliente).

## 10. Configuración de Google Cloud (resumen; el detalle va al README)

1. Crear proyecto en Google Cloud Console.
2. Habilitar Gmail API, Google Calendar API y Google Tasks API.
3. Pantalla de consentimiento: tipo *External*, agregar los 4 scopes, agregar el propio correo como usuario de prueba y luego **publicar a producción** (sin verificación, uso personal) para evitar el vencimiento a 7 días.
4. Credenciales → ID de cliente OAuth → *Desktop app*; descargar el JSON a `secrets/google-oauth-client.json`.
5. `pnpm jarvis auth` para generar el token inicial.

## 11. Decisiones tomadas por Claude (revisables)

- **NestJS** para `api`, `mcp-server` y `worker` (capa de entrega: módulos, controladores, inyección de dependencias, `@nestjs/schedule` para jobs). El dominio en `packages/core` es TypeScript puro, sin dependencias de NestJS; los adaptadores se registran en módulos Nest mediante tokens de inyección que apuntan a los puertos.
- **Drizzle** como ORM, usado solo dentro de las clases repositorio que implementan los puertos de persistencia (el dominio no lo ve). Elegido sobre Prisma/MikroORM por ser liviano, tipado y con SQL explícito; cambiarlo afecta solo a los repositorios.
- pnpm workspaces, Vitest.
- Máquina local con `LocalTransport` (rutas montadas), remotos con `SshTransport`.
- Restricción SSH del lado del servidor con `jarvis-remote` (forced command).
- Correos prioritarios por reglas SQL, sin IA.
- Tope diario de 40 invocaciones de IA en segundo plano, debounce de 2 h por proyecto, resúmenes de reunión a las 07:30.
- Listas de Google Tasks: asociar existente o crear al registrar proyecto.
- MCP solo en `127.0.0.1` en fase 1; exposición a sesiones remotas queda preparada, no configurada.
- Jobs recuperables tras apagado/suspensión.
- `.jarvis/` excluido vía `.git/info/exclude`.
- Bloque de foco: 5 días hábiles hacia adelante, L–V 09–19.
- Ventana inicial de Gmail: 90 días; frecuencia de sincronización 5 minutos.
- Aprobación de acciones del chat mediante `propose_action`.
- `api` accede a datos como cliente MCP (práctica de cliente) salvo funciones de administración.

## 12. Lo que queda al builder

Nombres exactos de tablas y herramientas, librerías de UI y de gráficos, formato exacto de `tasks.md`, prompts de resúmenes, estructura interna de cada app, estrategia de migraciones, manejo de paginación y cuotas de Google.
