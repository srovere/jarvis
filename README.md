# Jarvis

Asistente personal para el trabajo diario. La fase 1 sincroniza Gmail, Google Calendar y Google Tasks a una base
PostgreSQL local y los expone a Claude (Claude Code, Claude Desktop, MCP Inspector) mediante un servidor MCP sobre
HTTP. Jarvis no llama a ningún modelo ni usa API keys de Anthropic: el modelo es el cliente MCP que tú uses.

**Jarvis nunca envía correos.** No existe ninguna herramienta ni método de envío; sólo puede crear borradores
(`create_gmail_draft`) que revisas y envías tú desde Gmail.

## Arquitectura

- `db`: PostgreSQL 17 (volumen `pgdata`, sin puertos publicados).
- `migrate`: aplica las migraciones y termina.
- `worker`: sincroniza cada cuenta cada 5 minutos (configurable).
- `mcp-server`: herramientas MCP en `http://127.0.0.1:3002/mcp` (sólo escucha en `127.0.0.1` del host; exige
  `Authorization: Bearer <token>`).

Los secretos viven en `secrets/` (git-ignorado) y se montan como Docker secrets. Los tokens OAuth de Google se guardan
(permisos `0600`) en el volumen `jarvis_tokens`.

## Requisitos

- Docker y Docker Compose v2.
- Una cuenta de Google (Gmail, Calendar, Tasks).
- `openssl` (para generar secretos) y, para desarrollo, Node.js 22+ y pnpm.
- Opcional: Claude Code (`claude`) y `npx` para MCP Inspector.

## 1. Google Cloud Console

1. Entra en <https://console.cloud.google.com/> y crea un proyecto (p. ej. `jarvis`).
2. En *APIs y servicios > Biblioteca* habilita: **Gmail API**, **Google Calendar API** y **Google Tasks API**.
3. En *APIs y servicios > Pantalla de consentimiento de OAuth* (o *Google Auth Platform*):
   - Tipo de usuario: **Externo**.
   - Agrega estos 4 scopes exactos (y ningún otro; nunca `https://mail.google.com/`):
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.compose`
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/tasks`
   - Agrega tu propio correo como **usuario de prueba**.
4. **Publica la app a producción** (botón *Publicar aplicación*). Mientras la app está en modo *Testing*, Google hace
   vencer el refresh token a los 7 días y tendrías que autorizar de nuevo cada semana. En producción no vence.
   Como no pasarás la verificación de Google (es una app personal), al autorizar verás el aviso **"Google no ha
   verificado esta aplicación"**: significa únicamente que Google no revisó la app porque tú mismo eres su autor y su
   único usuario. Pulsa *Configuración avanzada > Ir a Jarvis (no seguro)* y acepta los permisos. Gmail
   (`gmail.readonly`/`gmail.compose`) son scopes restringidos; el límite de 100 usuarios de apps sin verificar no te
   afecta.
5. En *Credenciales > Crear credenciales > ID de cliente de OAuth*, tipo **Aplicación de escritorio**. Descarga el
   JSON y guárdalo como `secrets/google-oauth-client.json`.

## 2. Secretos y configuración

```bash
mkdir -p secrets
openssl rand -hex 32 > secrets/mcp_token && chmod 600 secrets/mcp_token
openssl rand -hex 24 > secrets/pg_password && chmod 600 secrets/pg_password
chmod 600 secrets/google-oauth-client.json
cp jarvis.config.example.yaml jarvis.config.yaml
```

Edita `jarvis.config.yaml` y declara tus cuentas (el `id` en minúsculas, único):

```yaml
accounts:
  - id: personal
    provider: google
    email: tu@correo.com
    calendars: [primary]
```

Cualquier clave se puede sobrescribir por entorno con `JARVIS__SECCION__CLAVE`. Los archivos de `secrets/` nunca se
commitean.

## 3. Autorizar la cuenta de Google

El flujo OAuth abre un servidor loopback en el puerto fijo `53682` (configurable con `JARVIS_OAUTH_PORT`; la
dirección con `JARVIS_OAUTH_BIND`, por defecto `127.0.0.1`). Dentro de Docker debe escuchar en `0.0.0.0`, publicado
sólo al loopback del host:

```bash
docker compose up -d db
docker compose run --rm migrate
docker compose run --rm -p 127.0.0.1:53682:53682 -e JARVIS_OAUTH_BIND=0.0.0.0 \
  worker node dist/cli/jarvis.js auth --account personal
```

Abre en el navegador la URL que imprime el comando, acepta los permisos y espera el mensaje de éxito. El token queda
en el volumen `jarvis_tokens`. Repite con otro `--account <id>` por cada cuenta.

## 4. Levantar todo

```bash
docker compose up -d --build
docker compose ps          # db y mcp-server healthy; migrate "exited (0)"
curl -s 127.0.0.1:3002/health   # {"status":"ok"}
docker compose logs -f worker   # debe mostrar un sync completo sin errores
```

Para forzar una sincronización puntual (desarrollo, con `DATABASE_URL` apuntando a la base):

```bash
pnpm jarvis sync --once
```

o, en Docker: `docker compose run --rm worker node dist/cli/jarvis.js sync --once`.

## 5. Conectar Claude

### Claude Code

```bash
claude mcp add --transport http jarvis http://127.0.0.1:3002/mcp \
  --header "Authorization: Bearer $(cat secrets/mcp_token)"
```

Dentro de Claude Code, `/mcp` debe listar `jarvis` como conectado.

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector
```

Transporte **Streamable HTTP**, URL `http://127.0.0.1:3002/mcp`, y en *Authentication* el header `Authorization` con
valor `Bearer <contenido de secrets/mcp_token>`. Prueba `get_daily_briefing`.

### Herramientas

`get_daily_briefing`, `search_emails`, `read_thread`, `create_gmail_draft`, `list_events`, `find_free_slot`,
`block_focus_time`, `list_tasks`, `create_task`, `complete_task`.

## Desarrollo

```bash
pnpm install
pnpm build        # compila todos los paquetes en orden topológico
pnpm test
pnpm typecheck    # después de build
pnpm lint:deps    # reglas de arquitectura (dependency-cruiser)
```

## Solución de problemas

- **`needs_reauth` en los logs o en el briefing:** el token de la cuenta fue revocado o venció. Repite el paso 3 para
  esa cuenta (`auth --account <id>`).
- **Puerto 53682 ocupado:** libera el puerto, o usa otro con `-e JARVIS_OAUTH_PORT=53700` y publica ese mismo puerto
  (`-p 127.0.0.1:53700:53700`).
- **El token vence a los 7 días:** la app sigue en modo *Testing*; publícala a producción (paso 1.4) y reautoriza.
- **`mcp-server` no pasa a healthy:** revisa `docker compose logs mcp-server`; suele faltar `secrets/mcp_token` o
  `jarvis.config.yaml`. Compose exige que existan los tres archivos de `secrets/` y el config antes de `up`.
- **Permiso denegado leyendo secretos:** en hosts Linux donde tu usuario no es uid 1000, el usuario `node` del
  contenedor no puede leer archivos `0600` ajenos; usa `chmod 644` en `secrets/*` (el directorio sigue siendo
  git-ignorado) o ajusta el propietario.
- **401 desde el cliente MCP:** el header debe ser `Authorization: Bearer <contenido exacto de secrets/mcp_token>`.
- Los logs son JSON estructurado por stderr y nunca incluyen cuerpos de correo ni tokens.
