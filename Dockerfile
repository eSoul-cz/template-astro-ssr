# syntax=docker/dockerfile:1

# The production image of the `node-http` shape: Node serves HTTP on 4321, the host NGINX is the only thing in front of it,
# `./data` is bind-mounted at /app/data, and the deploy hook copies /app/dist/client out for NGINX.
FROM node:26-trixie-slim AS base
RUN npm install --global pnpm@12.21.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

FROM base AS build
# The public origin is baked into `security.allowedDomains` (and stays the default of the runtime SITE_URL below).
# A build argument, never a secret: it is passed by the Jenkinsfile.
ARG SITE_URL
ENV SITE_URL=${SITE_URL}
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=shared \
    pnpm install --frozen-lockfile
COPY . .
# `pnpm verify` checks the output, so the image never holds a build the Checks stage did not see.
RUN pnpm build && pnpm verify

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store,sharing=shared \
    pnpm install --frozen-lockfile --prod --ignore-scripts

FROM node:26-trixie-slim AS production
# tini is the init process: it forwards SIGTERM to Node and reaps children.
RUN apt-get update \
    && apt-get install --yes --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
ARG SITE_URL
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321 SITE_URL=${SITE_URL}
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# The scripts of `src/server/` run directly on Node (no build step): start, migrate, admin:create.
COPY package.json ./
COPY src/server ./src/server
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/
# Copied files keep the build context's modes, and a CI checkout can be owner-only: the app user must read them.
RUN chmod -R a+rX package.json src/server dist && mkdir data && chown app:app data
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# `-g`: stop signals reach the whole process group. The container starts as root only for the entrypoint (see there).
ENTRYPOINT ["tini", "-g", "--", "docker-entrypoint.sh"]
# Validates the settings, runs migrations and seeds, then listens; any failure exits the container.
CMD ["node", "src/server/start.ts"]
