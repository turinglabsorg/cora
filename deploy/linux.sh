#!/bin/sh
# Deploy cora from this checkout to a Linux host over SSH and (re)start its user service.
# Nothing here needs root: the service is a systemd --user unit, the desktops use the
# user's docker, and the secrets live in the user's own hush vault.
#
# Usage: CORA_DEPLOY_HOST=user@host deploy/linux.sh [--build-box]
#        CORA_DEPLOY_SSH_OPTS="-F ~/.ssh/customer.conf" picks another SSH configuration
#        (keep the options free of spaces; put ports and ProxyCommand in that file).
set -e
HOST="${CORA_DEPLOY_HOST:?set CORA_DEPLOY_HOST=user@host}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=20 ${CORA_DEPLOY_SSH_OPTS:-}"

$SSH "$HOST" 'mkdir -p "$HOME/Services/cora" "$HOME/.cora" && chmod 700 "$HOME/.cora"'
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude .git --exclude '*.log' --exclude node_modules -e "$SSH" "$SRC/" "$HOST:Services/cora/"
else
  # No local rsync (e.g. a container): ship a tarball and let the host's rsync apply it.
  tar -C "$SRC" --exclude .git --exclude '*.log' --exclude node_modules -cf - . | $SSH "$HOST" 'set -e; rm -rf "$HOME/Services/cora.incoming"; mkdir -p "$HOME/Services/cora.incoming"; tar -xf - -C "$HOME/Services/cora.incoming"; rsync -a --delete --exclude node_modules "$HOME/Services/cora.incoming/" "$HOME/Services/cora/"; rm -rf "$HOME/Services/cora.incoming"'
fi

# The desktop image is rebuilt only when box/ changed; cora then recreates every desktop
# built from an older image when it starts, keeping their volumes. A build is minutes of
# the other machine's CPU, so it can be skipped, forced, or done here and shipped over.
#   --skip-box   leave the image alone: the desktops keep the one they have
#   --build-box  build it there even if box/ did not change
#   --ship-box   build it here and send it: the customer's machine only loads it
BOX_HASH=$(cat "$SRC"/box/* | { sha256sum 2>/dev/null || shasum -a 256; } | cut -c1-16)
BOX_MODE=auto
for argument in "$@"; do
  case "$argument" in
    --skip-box) BOX_MODE=skip ;;
    --build-box) BOX_MODE=force ;;
    --ship-box) BOX_MODE=ship ;;
  esac
done

if [ "$BOX_MODE" = ship ]; then
  HERE=$(docker version --format '{{.Server.Arch}}' 2>/dev/null || echo unknown)
  THERE=$($SSH "$HOST" "docker version --format '{{.Server.Arch}}' 2>/dev/null || echo unknown")
  if [ "$HERE" != "$THERE" ]; then
    echo "this machine builds $HERE images and that one runs $THERE: build it there, or cross-build with buildx"
    exit 1
  fi
  echo "building the desktop image here ($BOX_HASH) and sending it…"
  docker build -q --label "cora.box=$BOX_HASH" -t cora-box:latest "$SRC/box" >/dev/null
  docker save cora-box:latest | gzip | $SSH "$HOST" 'gunzip | docker load'
  BOX_MODE=skip
fi

$SSH "$HOST" BOX_MODE="$BOX_MODE" BOX_HASH="$BOX_HASH" BRAIN_PORT="${CORA_BRAIN_PORT:-5442}" sh -s <<'REMOTE'
set -e
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DIR="$HOME/Services/cora"

command -v hush >/dev/null 2>&1 || { echo "hush is not installed for this user: install it first"; exit 1; }
hush list >/dev/null 2>&1 || { echo "the hush vault is not ready: run hush init && hush box init"; exit 1; }

# Node 22 or newer, wherever this machine keeps it; run.sh honours CORA_NODE.
NODE=$(command -v node || true)
for candidate in $(ls -d "$HOME"/.nvm/versions/node/* 2>/dev/null | sort -V -r); do
  [ -x "$candidate/bin/node" ] || continue
  MAJOR=$("$candidate/bin/node" -p 'process.versions.node.split(".")[0]')
  [ "$MAJOR" -ge 22 ] && NODE="$candidate/bin/node" && break
done
[ -n "$NODE" ] || { echo "no node found"; exit 1; }
MAJOR=$("$NODE" -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 22 ] || { echo "cora needs node 22 or newer, found $($NODE -v)"; exit 1; }
touch "$HOME/.cora/env"
chmod 600 "$HOME/.cora/env"
grep -q '^CORA_NODE=' "$HOME/.cora/env" 2>/dev/null \
  && sed -i "s#^CORA_NODE=.*#CORA_NODE=$NODE#" "$HOME/.cora/env" \
  || printf 'CORA_NODE=%s\n' "$NODE" >> "$HOME/.cora/env"

# Secrets are generated only when missing under both the new and the old (CORO_) name.
for pair in ADMIN_PASSWORD:16 SESSION_KEY:32 VAPID_KEY:32; do
  name=${pair%%:*}
  hush info "CORA_$name" >/dev/null 2>&1 || hush info "CORO_$name" >/dev/null 2>&1 || hush generate "CORA_$name" --bytes "${pair##*:}" >/dev/null
done

# Cora's npm dependencies (pg for the company brain), from the lockfile, without the test-only ones.
export PATH="$(dirname "$NODE"):$PATH"
(cd "$DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null) || { echo "npm ci failed"; exit 1; }

# The company brain: Postgres with pgvector in a container of its own, reachable only from this
# machine. Its password and its URL are generated straight into hush; nothing prints them.
if command -v docker >/dev/null 2>&1; then
  hush info CORA_BRAIN_DB_PASSWORD >/dev/null 2>&1 || hush generate CORA_BRAIN_DB_PASSWORD --bytes 24 >/dev/null
  if ! docker inspect cora-brain-db >/dev/null 2>&1; then
    hush run --name CORA_BRAIN_DB_PASSWORD --env POSTGRES_PASSWORD --redact -- docker run -d --name cora-brain-db --restart unless-stopped \
      -e POSTGRES_USER=cora -e POSTGRES_DB=cora_brain -e POSTGRES_PASSWORD -p "127.0.0.1:$BRAIN_PORT:5432" \
      -v cora-brain-db:/var/lib/postgresql/data pgvector/pgvector:0.8.6-pg17 >/dev/null
  fi
  docker start cora-brain-db >/dev/null 2>&1 || true
  for i in $(seq 1 60); do docker exec cora-brain-db pg_isready -U cora -d cora_brain >/dev/null 2>&1 && break; sleep 1; done
  hush info CORA_BRAIN_DATABASE_URL >/dev/null 2>&1 || hush run --name CORA_BRAIN_DB_PASSWORD --env PW --redact -- \
    sh -c 'printf "postgres://cora:%s@127.0.0.1:%s/cora_brain" "$PW" "$0" | hush box seal --to self --uses 1 --pubkey-file "$HOME/.hush/box.pub" | hush box open CORA_BRAIN_DATABASE_URL >/dev/null' "$BRAIN_PORT"
fi

CURRENT_BOX=$(docker image inspect cora-box:latest --format '{{index .Config.Labels "cora.box"}}' 2>/dev/null || true)
if [ "$BOX_MODE" != skip ] && { [ "$BOX_MODE" = force ] || [ "$CURRENT_BOX" != "$BOX_HASH" ]; }; then
  echo "building the desktop image ($BOX_HASH)…"
  docker build -q --label "cora.box=$BOX_HASH" -t cora-box:latest "$DIR/box" > "$HOME/.cora/box-build.log" 2>&1 || { tail -20 "$HOME/.cora/box-build.log"; exit 1; }
fi

mkdir -p "$HOME/.config/systemd/user"
cp "$DIR/deploy/cora.service" "$HOME/.config/systemd/user/cora.service"
# Without lingering the service would stop at logout, which is the whole point of an always-on agent.
loginctl enable-linger "$(id -un)" 2>/dev/null || true
systemctl --user daemon-reload
systemctl --user enable cora.service >/dev/null 2>&1 || true
systemctl --user restart cora.service
PORT=$(sed -n 's/^Environment=PORT=//p' "$DIR/deploy/cora.service" | tail -1)
for i in $(seq 1 60); do curl -fsS "http://127.0.0.1:${PORT:-4370}/healthz" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:${PORT:-4370}/healthz" && echo " <- cora healthz"
REMOTE
