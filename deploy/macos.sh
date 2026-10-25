#!/bin/sh
# Deploy cora from this checkout to a Mac over SSH and (re)start its LaunchAgent.
# Usage: CORA_DEPLOY_HOST=user@host deploy/macos.sh [--build-box]
set -e
HOST="${CORA_DEPLOY_HOST:?set CORA_DEPLOY_HOST=user@host}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=10"

if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete --exclude .git --exclude '*.log' -e "$SSH" "$SRC/" "$HOST:Services/cora/"
else
  # No local rsync (e.g. a Linux sandbox): ship a tarball and let the host's rsync apply it.
  tar -C "$SRC" --exclude .git --exclude '*.log' -cf - . | $SSH "$HOST" 'set -e; rm -rf "$HOME/Services/cora.incoming"; mkdir -p "$HOME/Services/cora.incoming" "$HOME/Services/cora"; tar -xf - -C "$HOME/Services/cora.incoming"; rsync -a --delete "$HOME/Services/cora.incoming/" "$HOME/Services/cora/"; rm -rf "$HOME/Services/cora.incoming"'
fi

# The desktop image is rebuilt only when box/ changed (or with --build-box); cora then
# recreates every desktop built from an older image when it starts, keeping their volumes.
BOX_HASH=$(cat "$SRC"/box/* | { sha256sum 2>/dev/null || shasum -a 256; } | cut -c1-16)

$SSH "$HOST" BUILD_BOX="$1" BOX_HASH="$BOX_HASH" sh -s <<'REMOTE'
set -e
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
DIR="$HOME/Services/cora"
mkdir -p "$HOME/.cora" "$HOME/Library/LaunchAgents"
chmod 700 "$HOME/.cora"
# Secrets are generated only when missing under both the new and the old (CORO_) name.
for pair in ADMIN_PASSWORD:16 SESSION_KEY:32 VAPID_KEY:32; do
  name=${pair%%:*}
  hush info "CORA_$name" >/dev/null 2>&1 || hush info "CORO_$name" >/dev/null 2>&1 || hush generate "CORA_$name" --bytes "${pair##*:}" >/dev/null
done
CURRENT_BOX=$(docker image inspect cora-box:latest --format '{{index .Config.Labels "cora.box"}}' 2>/dev/null || true)
if [ "$BUILD_BOX" = "--build-box" ] || [ "$CURRENT_BOX" != "$BOX_HASH" ]; then
  echo "building the desktop image ($BOX_HASH)…"
  docker build -q --label "cora.box=$BOX_HASH" -t cora-box:latest "$DIR/box" > "$HOME/.cora/box-build.log" 2>&1 || { tail -20 "$HOME/.cora/box-build.log"; exit 1; }
fi
PLIST="$HOME/Library/LaunchAgents/org.turinglabs.cora.plist"
sed -e "s#__CORA_DIR__#$DIR#g" -e "s#__HOME__#$HOME#g" "$DIR/deploy/org.turinglabs.cora.plist" > "$PLIST"
# bootout returns before the old process is gone: wait for it, then load (retrying) and wait for health.
launchctl bootout "gui/$(id -u)/org.turinglabs.cora" 2>/dev/null || true
for i in $(seq 1 30); do launchctl print "gui/$(id -u)/org.turinglabs.cora" >/dev/null 2>&1 || break; sleep 1; done
for i in 1 2 3 4 5; do launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break; sleep 2; done
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:4370/healthz >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:4370/healthz && echo " <- cora healthz"
REMOTE
