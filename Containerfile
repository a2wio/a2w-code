FROM node:22-bookworm-slim AS deps

WORKDIR /app
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

FROM deps AS builder

WORKDIR /app
COPY apps/web ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    A2W_PROJECT_ROOT=/app \
    HOSTNAME=0.0.0.0 \
    PORT=5173

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates git openssh-client podman tini tmux && \
    rm -rf /var/lib/apt/lists/*

RUN npm install -g @openai/codex && codex --version

WORKDIR /app

RUN mkdir -p /app/.data && chown -R node:node /app

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --chown=node:node sandbox ./sandbox

USER node

EXPOSE 5173
VOLUME ["/app/.data"]

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
