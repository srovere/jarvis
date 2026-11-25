# API + dashboard + Claude Code CLI. Build context: repository root.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm --filter "@jarvis/api" deploy --legacy --prod /out \
 && cp -r apps/web/dist /out/web

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    JARVIS_WEB_DIST=/app/web
# The agent runs the `claude` CLI inside this container (subscription token, never an API key). Pinned exactly;
# the token itself is not baked in: the app reads it from /data/agent/claude-token at run time.
RUN npm install -g @anthropic-ai/claude-code@2.1.330 && npm cache clean --force
WORKDIR /app
COPY --from=build --chown=node:node /out /app
# Data volume (jarvis_data): tokens/, google/oauth-client.json, agent/claude-token. Writable by the node user.
RUN mkdir -p /data/tokens /data/google /data/agent && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{headers:{host:'127.0.0.1:3000'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/main.js"]
