# Single image for worker and mcp-server: docker build --build-arg APP=worker|mcp-server
FROM node:22-slim AS build
ARG APP
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm --filter "@jarvis/${APP}" deploy --legacy --prod /out

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out /app
# OAuth token directory (jarvis_tokens volume); must be writable by the node user.
RUN mkdir -p /data/tokens && chown -R node:node /data
USER node
CMD ["node", "dist/main.js"]
