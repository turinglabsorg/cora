#!/bin/sh
# Start cora with every secret that exists in hush; optional ones that are missing are skipped.
# Secrets are named CORA_<NAME>; the names from before the rename (CORO_<NAME>) still work.
set -e
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.."
# Settings of this installation that are not secret (e.g. CORA_CLOUD_KEY, the public key of usecora.space).
[ -f "$HOME/.cora/env" ] && . "$HOME/.cora/env"
NODE="${CORA_NODE:-$(command -v node)}"
set -- "$NODE" --disable-warning=ExperimentalWarning src/main.js
for pair in \
  ADMIN_PASSWORD:CORA_ADMIN_PASSWORD \
  SESSION_KEY:CORA_SESSION_KEY \
  DISCORD_LISTENER_TOKEN:DISCORD_BOT_TOKEN \
  TELEGRAM_BOT_TOKEN:TELEGRAM_BOT_TOKEN \
  SLACK_BOT_TOKEN:SLACK_BOT_TOKEN \
  SLACK_APP_TOKEN:SLACK_APP_TOKEN \
  OLLAMA_API_KEY:OLLAMA_API_KEY \
  ORCAROUTER_API_KEY:ORCAROUTER_API_KEY \
  VAPID_KEY:VAPID_KEY \
  TYPESAFE_API_KEY:TYPESAFE_API_KEY
do
  name=${pair%%:*}
  var=${pair##*:}
  candidates="CORA_$name CORO_$name"
  # doc's own key, when this machine already has one, serves until the panel stores Cora's.
  [ "$name" = TYPESAFE_API_KEY ] && candidates="$candidates $name"
  for stored in $candidates; do
    if hush info "$stored" >/dev/null 2>&1; then
      set -- hush run --name "$stored" --env "$var" --redact -- "$@"
      break
    fi
  done
done
for name in $(hush list 2>/dev/null | cut -f1 | grep -E '^COR[AO]_(BOT|TG_BOT|SK_BOT|SK_APP)_[A-Z0-9_]*$'); do
  set -- hush run --name "$name" --env "$name" --redact -- "$@"
done
exec "$@"
