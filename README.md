# Astro SSR application

An Astro 7 application rendered on demand by Node (`output: 'server'`, `@astrojs/node` standalone): archetype `B-admin` of the eSoul
Astro guidelines. The Astro server is the backend: pages, actions, endpoints and middleware run in one process, the data is one
SQLite file, and the admin is part of the application. It is a skeleton, not a design: a plain home page, an admin shell with
sign-in, and everything the guidelines require of the server around them.

Rules for this project are in `docs/project_guidelines/` (rendered by `esoul-guidelines`, see `AGENTS.md`); decisions and the
project profile are in `CONTEXT.md`. The archetype, and so this template, needs an ADR ([architecture](docs/project_guidelines/architecture.md)).

## Requirements

- Node.js 26 (`.nvmrc`, `engines`); `node:sqlite` is built in, there is no native dependency.
- pnpm 12.21.0 (`packageManager`): `npm install --global pnpm@12.21.0`.
- Docker for the production image and `docker compose` (optional locally).

## Start

```bash
cp .env.example .env                       # then set SESSION_SECRET: openssl rand -base64 32
pnpm install                               # commit pnpm-lock.yaml: the image and CI install with --frozen-lockfile
pnpm admin:create you@example.com          # asks for a password (12+ characters); creates the first admin
pnpm dev                                   # http://localhost:4321, admin at /admin
```

| Script                         | What it does                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                     | `pnpm migrate`, then the Astro dev server (the CSP is only active in `build` + `pnpm start`)                   |
| `pnpm build`                   | `astro build` into `dist/` (`dist/server`, `dist/client`)                                                      |
| `pnpm start`                   | Production entry: validates the settings, runs migrations and seeds, starts the built server, stops on SIGTERM |
| `pnpm migrate`                 | Validates the settings, runs migrations and seeds, exits                                                       |
| `pnpm admin:create <email>`    | Creates an admin (password prompt, or stdin when piped); `--reset` sets a new password and ends the sessions   |
| `pnpm check`                   | `astro check` (TypeScript and Astro diagnostics)                                                               |
| `pnpm eslint` / `eslint:fix`   | ESLint (read-only / autofix)                                                                                   |
| `pnpm format:check` / `format` | Prettier (read-only / write)                                                                                   |
| `pnpm test`                    | Vitest: migrations, seeds, settings, passwords, sessions, login throttle (`tests/`)                            |
| `pnpm verify`                  | Checks the build output (`scripts/verify-dist.mjs`)                                                            |
| `pnpm test:e2e`                | Playwright against the built server (`pnpm build` first); every spec file starts its own server                |

The read-only checks, in the order Jenkins runs them: `pnpm audit`, `pnpm eslint`, `pnpm format:check`, `pnpm check`, `pnpm test`,
`pnpm build`, `pnpm verify`; `pnpm test:e2e` runs locally (`pnpm build` first), the pipeline runs it only in a pinned Playwright image
(see the `Jenkinsfile`). `pnpm audit` ignores only the advisories listed with a reason and a review date in
`pnpm-workspace.yaml`, next to `minimumReleaseAge` and the `allowBuilds` list.

## Guidelines

The rules in `docs/project_guidelines/` and the block in `AGENTS.md` are rendered by `esoul-guidelines` (`esoul-guidelines.json` holds the layers,
`esoul-guidelines.lock` what was written). The project has no PHP and no Composer dependency, so `vendor/bin/esoul-guidelines` does not exist:
install the command in one of three ways (the same code, the commands of [eSoul-cz/guidelines](https://github.com/eSoul-cz/guidelines#repositories-without-php),
release 0.3.x). Use **Docker in CI** (the `Guidelines` stage of the `Jenkinsfile` does) and **Composer global or the PHAR on your machine**.

```sh
# 1. Composer global (PHP 8.4+ and Composer)
composer global require esoul-cz/guidelines
export PATH="$(composer global config bin-dir --absolute):$PATH"   # once, e.g. in ~/.zshrc
esoul-guidelines sync        # after a new guidelines release: composer global update esoul-cz/guidelines, then sync
esoul-guidelines check       # read-only: exit 1 on drift (a generated block was edited) or outdated content

# 2. PHAR (PHP 8.4+, no Composer)
VERSION=0.3.2                # the release without the leading "v"
BASE="https://github.com/eSoul-cz/guidelines/releases/download/v${VERSION}"
curl -fsSL -O "$BASE/esoul-guidelines.phar" -O "$BASE/esoul-guidelines.phar.sha256"
sha256sum -c esoul-guidelines.phar.sha256     # macOS: shasum -a 256 -c esoul-guidelines.phar.sha256
chmod +x esoul-guidelines.phar
sudo mv esoul-guidelines.phar /usr/local/bin/esoul-guidelines   # or run it without installing: php esoul-guidelines.phar sync

# 3. Docker (no PHP; log in first: docker login rg.fr-par.scw.cloud); the tag is one release line, a newer tag is the update
docker run --rm -v "$PWD:/app" -w /app --user "$(id -u):$(id -g)" rg.fr-par.scw.cloud/testing-images/esoul-guidelines:0.3 sync
docker run --rm -v "$PWD:/app" -w /app --user "$(id -u):$(id -g)" rg.fr-par.scw.cloud/testing-images/esoul-guidelines:0.3 check
```

Run `sync` after a guidelines update and commit the result (`docs/project_guidelines/`, `AGENTS.md`, `esoul-guidelines.lock`); never edit the generated
blocks by hand. Jenkins runs `esoul-guidelines check` and fails the build on drift or outdated content.

## Settings

All settings are environment variables ([`.env.example`](.env.example) lists them with their defaults). They are validated with Zod
(`src/server/Settings.ts`) when the migrations run and when the server starts, so an invalid value exits non-zero with a message that
names the variable, before anything listens.

| Variable                                     | Meaning                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `SITE_URL`                                   | Public origin (https in production). **Also a build argument**, see _allowed domains_ below       |
| `HOST`, `PORT`                               | Where the server listens (the image sets `0.0.0.0` and `4321`, the port of the `node-http` shape) |
| `DATA_DIR`                                   | Directory with `app.db`; `/app/data` in the image                                                 |
| `SESSION_SECRET`                             | Required, 32+ characters. Keys the stored session ids and the login throttle                      |
| `SESSION_TTL_DAYS`                           | Session lifetime, default 30                                                                      |
| `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MINUTES` | Login limit per client address and account, default 5 per 15 minutes                              |
| `PUBLIC_NOINDEX`                             | `true` on staging: every page `noindex`, `robots.txt` disallows everything, the sitemap is empty  |
| `CLIENT_COPY_DIR`                            | Docker only, optional: copy `dist/client` there on every start (see _Deployment_)                 |

A new variable goes to `Settings.ts` (the schema and the `Settings` type), to `.env.example` and to the deploy notes of the pull
request, so that devops add it to the stack before the deploy.

## Data and backups

The only state is `DATA_DIR/app.db` (SQLite in WAL mode: `app.db`, `app.db-wal` and `app.db-shm` belong together). It is created on
the first start. In production `DATA_DIR` is `/app/data`, the `./data` bind mount of the stack's run directory, which the
infrastructure's daily backups cover; nothing else is written to disk. For a copy at a known moment use SQLite's online backup, never
a plain `cp` of a live database:

```bash
sqlite3 data/app.db ".backup 'backup.db'"
```

Restoring is stopping the app, putting the file back (without stale `-wal`/`-shm` files) and starting it. Sessions live in the same
database, so a restore signs out whoever signed in after the backup.

## Admin accounts

There is no seeded account and no default password. The first admin is created in the environment itself and the password goes to
1Password ([security and data](docs/project_guidelines/security-and-data.md)):

```bash
pnpm admin:create you@example.com                                    # locally
docker compose exec -u app app node src/server/admin-create.ts you@example.com   # in the container (`-u app`: the database files belong to it)
```

The password is read from the terminal without echo (or from stdin: `printf '%s' "$PASSWORD" | pnpm admin:create ...`), never from an
argument. `--reset` sets a new password for an existing admin and ends their sessions.

How sign-in works: passwords are hashed with scrypt (`node:crypto`, a random salt per password, parameters stored in the hash) and
compared in constant time; an unknown e-mail costs the same time as a wrong password and gets the same answer. A login creates a
server-side session (a random token in an `HttpOnly`, `SameSite=Lax` cookie, `Secure` whenever `SITE_URL` is https; only an HMAC of the
token is stored). Failed logins are limited per client address and account, in memory (one container runs the app; a restart resets
the counters). Logout deletes the session. Every `/admin` page is guarded by the middleware, and **every action except `login` starts
with `requireAdmin(context)`** (`src/lib/session.ts`); a server island (`server:defer`) must check the session itself, because it is
fetched outside the middleware.

## Migrations and seeds

Both live in `src/server/` and run before the server listens; a failure exits the process (the container) instead of serving errors.

- **Migrations**: `src/server/migrations/<id>_<name>.ts`, registered in `migrations/index.ts`, the one place. Forward-only, each in a
  transaction with its row in `migrations`. **The start fails when a registered migration has an id below the latest applied one and
  never ran** (two branches picked ids in parallel): a migration from a parallel branch takes an id **above everything merged**, and
  once a migration is merged it is never edited, only followed by a new one. Migrations must be safe while the previous release still
  serves requests, because only then can a deploy roll back.
- **Seeds**: `src/server/seeds/<0001_name>.ts`, registered in `seeds/index.ts`. A seed runs **once per database**, in id order, in a
  transaction together with its row in `seeds`, and never again, even when the client later edits or deletes the data. A changed
  starting value is a **new seed** that replaces the old one only where it is still unedited. A seed never creates an account.

`src/server/` is plain Node TypeScript with no `astro:*` imports, so `node src/server/migrate.ts` and the other scripts run it directly
(Node strips the types; only erasable syntax and relative imports with the `.ts` extension, enforced by `tsconfig.json`).

## Pages, actions, middleware

- `src/pages/index.astro` home, `404.astro`, `500.astro`, `admin/index.astro` (admin shell: `AdminLayout` with navigation and sign-out),
  `admin/login.astro`. All pages are rendered on demand, the error pages too: the adapter serves a prerendered page without the
  middleware, so it would miss the security headers.
- `src/actions/index.ts`: `login` and `logout` are Astro Actions with `accept: 'form'`, so a plain `<form method="post">` works without
  JavaScript and the page renders the result from `Astro.getActionResult()`. Login and logout post to `/admin/login`.
- `src/middleware.ts`: security headers (`nosniff`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`), a 64 KB body limit
  (`413`, `411` for a body of unknown length; the adapter and `security.actionBodySizeLimit` use the same limit), `Cache-Control:
private, no-store` on `/admin` and on action responses, the session lookup into `Astro.locals.admin` and the guard of `/admin`.
- The **Content-Security-Policy** is Astro's `security.csp` (`astro.config.mjs`): on-demand pages get it as a header with hashes for
  their scripts and styles and `frame-ancestors 'none'`, so no `unsafe-inline` is needed. A page with `prerender = true` gets a `<meta>`
  tag instead, where `frame-ancestors` is ignored (the browser logs a notice), and the adapter serves such a file without the
  middleware: the web server then has to send the security headers for it.
- `robots.txt` (honours `PUBLIC_NOINDEX`, disallows `/admin/`), `llms.txt` and `sitemap.xml` are endpoints that read the runtime
  settings, so one image serves staging and production. The sitemap lists `publicPaths` of `src/lib/routes.ts`: add a public page
  there. (`@astrojs/sitemap` only knows build-time pages, and the site origin is a runtime setting.)
- `/healthz`: `200 {"status":"ok"}` after a `SELECT 1`, `503` otherwise; `Cache-Control: no-store`, no session, no CSRF.

## Deployment

The image (`Dockerfile`) is the `node-http` shape of the infrastructure repository: Node serves plain HTTP on port **4321**, `./data` is
bind-mounted at `/app/data`, and the host NGINX proxies to it.

- Multi-stage build: `pnpm install --frozen-lockfile`, `pnpm build` and `pnpm verify`; the runtime stage holds production
  `node_modules`, `dist/`, `src/server/` and `package.json` only, no source, no `.env`, no secrets.
- `tini` is the init process (`ENTRYPOINT ["tini", "-g", ...]`). The entrypoint starts as root only to hand `DATA_DIR` to the `app` user
  (uid 10001; a bind-mounted host directory is usually root's) and then runs `node src/server/start.ts` as that user.
- `HEALTHCHECK` requests `/healthz` with Node (no curl in the image).
- **Graceful stop.** `@astrojs/node` does not handle stop signals (its `standalone.js` only listens), so `src/server/start.ts` switches
  the adapter's autostart off (`ASTRO_NODE_AUTOSTART=disabled`), starts the server itself and on `SIGTERM`/`SIGINT` stops accepting,
  lets in-flight requests finish (idle connections are closed at once, the rest after 8 s), closes the database and exits **0**
  (`e2e/app.spec.ts` checks the exit code; `docker stop` returns within a second on an idle container).
- **Settings, migrations and seeds run before the server listens**; an invalid setting or a failing migration exits the container.
- **Client files.** The deploy hook of the stack copies `/app/dist/client` out of the image into `./client` for NGINX
  (`docker cp`). Where there is no such hook, set `CLIENT_COPY_DIR` (for example `/app/client-out`, bind-mounted from the host): the
  entrypoint copies `dist/client` there on every start, so a new image never leaves the old files behind.
- **Build argument `SITE_URL`.** `security.allowedDomains` is baked into the server build, so `SITE_URL` is passed to
  `docker build --build-arg SITE_URL=https://example.com` (the `Jenkinsfile` does, as `buildArgs`) and stays the runtime default.
  `pnpm verify` fails when the baked domain does not match `SITE_URL`. Secrets are never build arguments.
- `docker-compose.yml` is for a local smoke test of the image (`docker compose up --build`); the deployed stack is rendered from the
  manifest `apps/<client>/<name>.yaml` (`shape: node-http`) of the infrastructure repository, with `SESSION_SECRET` as a secret.
- `Jenkinsfile`: one call of `astroPipeline` in image mode with `useVerifiedBuild: false` (this image builds from source): the checks
  (install, `pnpm audit`, ESLint, Prettier, `astro check`, Vitest, build, `pnpm verify`, `esoul-guidelines check` in the Docker image of the guidelines), then `dockerBuildMultiArch` and
  `deployKomodoStack` for the deploy branches. One origin (`SITE_URL`), one tag set and one stack per job.

### Host NGINX

TLS ends at the load balancer; NGINX proxies plain HTTP to the container. The proxy replaces the forwarded headers (it never passes
on what a client sent), and the application trusts them only for the domain in `security.allowedDomains`, so `Astro.url` is the
public https address (needed by the origin check of form posts) and `Astro.clientAddress` is the visitor (login limits depend on it):

```nginx
upstream app_http { server 127.0.0.1:4321; keepalive 16; }

server {
    listen 80;
    server_name example.com;
    client_max_body_size 1m;

    location / {
        proxy_pass http://app_http;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;   # https behind the load balancer: use the scheme it reports
        proxy_set_header X-Forwarded-For $remote_addr; # replaced, not appended
    }
}
```

The generated site of the `node-http` shape already does this (and serves `shared_dirs` such as `_astro` from `./client`, with
`Cache-Control: public, max-age=31536000, immutable`); the snippet documents what the application expects. Metrics and the
database are never routed, `/healthz` MAY be public.

## Structure

```
astro.config.mjs        adapter, CSP, allowed domains, body limits
src/server/             plain Node TypeScript, no astro:* imports: Settings, Database, Migrator, Seeds, Auth, Sessions,
                        LoginThrottle, Password, runtime (+ start.ts, migrate.ts, admin-create.ts scripts)
src/server/migrations/  numbered migrations and their index      src/server/seeds/  run-once seeds and their index
src/middleware.ts       headers, body limit, session lookup, admin guard
src/actions/            login, logout                             src/lib/  routes, session cookie helpers (use astro:*)
src/pages/              pages, endpoints (healthz, robots.txt, sitemap.xml, llms.txt)
tests/                  Vitest                                    e2e/      Playwright (starts the built server itself)
scripts/verify-dist.mjs build output checks                       Dockerfile, docker-entrypoint.sh, docker-compose.yml, Jenkinsfile
```
