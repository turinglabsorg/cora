#!/usr/bin/env bash
# Cora's Git launcher; repository hooks and signing stay with Git.
set -u
real_git=${CORA_GIT_REAL:-/usr/bin/git}
if [ "$real_git" = "$0" ]; then real_git=/usr/bin/git; fi
default_enabled=__CORA_ENABLED__
default_email=__CORA_EMAIL__
if [ "${CORA_GIT_ATTRIBUTION:-$default_enabled}" = 0 ] || [ "${CORA_GIT_WRAPPED:-}" = 1 ]; then
  exec "$real_git" "$@"
fi
args=("$@")
prefix=()
index=0
while [ "$index" -lt "${#args[@]}" ]; do
  argument=${args[$index]}
  case "$argument" in
    -C|-c|--git-dir|--work-tree|--namespace|--config-env|--super-prefix|--exec-path)
      if [ "$((index + 1))" -ge "${#args[@]}" ]; then exec "$real_git" "$@"; fi
      prefix+=("$argument" "${args[$((index + 1))]}")
      index=$((index + 2)) ;;
    --) index=$((index + 1)); break ;;
    -*) prefix+=("$argument"); index=$((index + 1)) ;;
    *) break ;;
  esac
done
if [ "${args[$index]:-}" != commit ]; then exec "$real_git" "$@"; fi
if [ "$("$real_git" "${prefix[@]}" config --type=bool --get cora.attribution 2>/dev/null)" = false ]; then
  exec "$real_git" "$@"
fi
email=${CORA_GIT_COAUTHOR_EMAIL:-$default_email}
if [[ ! "$email" =~ ^[^[:space:]\<\>@]+@[^[:space:]\<\>@]+\.[^[:space:]\<\>@]+$ ]]; then
  echo "Cora's Git co-author email is invalid" >&2
  exit 2
fi
CORA_GIT_WRAPPED=1 exec "$real_git" "${prefix[@]}" -c trailer.ifExists=addIfDifferent commit --trailer "Co-authored-by: Cora <$email>" "${args[@]:$((index + 1))}"
