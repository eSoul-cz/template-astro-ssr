#!/bin/sh
# 1. CLIENT_COPY_DIR set: copy the client files (dist/client) there on every start, so a new image never leaves the old
#    files behind for a web server that serves them from the host.
# 2. Started as root: hand the data directory to the app user (a bind-mounted host directory is often root's), then run
#    the app as that user (uid 10001). Started as another user (`user: 1000`), just run the app.
set -e

if [ -n "${CLIENT_COPY_DIR:-}" ]; then
  mkdir -p "$CLIENT_COPY_DIR" && cp -a dist/client/. "$CLIENT_COPY_DIR"/ && chmod -R a+rX "$CLIENT_COPY_DIR"
fi

if [ "$(id -u)" = 0 ]; then
  mkdir -p "${DATA_DIR:-data}"
  find "${DATA_DIR:-data}" ! -user app -exec chown app:app {} + || echo "Warning: can't hand ${DATA_DIR:-data} to the app user (uid 10001)" >&2
  exec setpriv --reuid=app --regid=app --init-groups "$@"
fi

exec "$@"
