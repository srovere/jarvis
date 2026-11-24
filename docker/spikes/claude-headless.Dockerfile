# Spike: does a `claude setup-token` subscription token work headless in a container?
FROM node:22-slim
ARG CLAUDE_CODE_VERSION=2.1.330
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force
USER node
WORKDIR /home/node
CMD ["claude", "-p", "Reply with OK", "--output-format", "json"]
