#!/bin/sh
# Start usecora.space with its secrets from hush: the seed (sessions and the signing key)
# and the Google and GitHub client secrets. The client ids are not secret: pass them as
# GOOGLE_CLIENT_ID and GITHUB_CLIENT_ID. Missing secrets are skipped (that sign-in stays off).
set -e
export PATH="$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd "$(dirname "$0")/.."
NODE="${CORA_NODE:-$(command -v node)}"
set -- "$NODE" --disable-warning=ExperimentalWarning server.js
for pair in \
  CORA_CLOUD_SEED:CORA_CLOUD_SEED \
  CORA_CLOUD_GOOGLE_SECRET:GOOGLE_CLIENT_SECRET \
  CORA_CLOUD_GITHUB_SECRET:GITHUB_CLIENT_SECRET \
  CORA_WAITLIST_WEBHOOK_URL:CORA_WAITLIST_WEBHOOK_URL
do
  name=${pair%%:*}
  var=${pair##*:}
  if hush info "$name" >/dev/null 2>&1; then
    set -- hush run --name "$name" --env "$var" --redact -- "$@"
  fi
done
exec "$@"
