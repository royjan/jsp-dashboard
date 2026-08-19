#!/usr/bin/env bash
# Trigger a Dokploy deploy of this app and wait for it to finish.
#
# Why a script and not a curl one-liner: the trigger needs the app's refreshToken
# fetched first, so the natural form is `RT=$(curl ...); curl ...` — a compound
# command, which no `Bash(curl:*)` permission rule can match (rules match the
# command prefix). One script = one allowlistable command.
#
# Quirks this encodes (all learned the hard way, see CLAUDE.md § Deployment):
#   - /api/application.deploy returns 200 and does NOTHING for github-sourced apps
#   - the webhook needs a GitHub-shaped request or it answers "Branch Not Match"
#   - polling applicationStatus reads the PREVIOUS deploy's "done" and lies, so
#     we poll deployment.all for a row NEWER than the one we started from
#   - no GitHub webhook is configured on the repo, so `git push` alone deploys nothing
set -euo pipefail

APP_ID="${DOKPLOY_APP_ID:-fS6YxDi2AGcFvYIdaOtAJ}"
HOST="${DOKPLOY_HOST:-http://192.168.0.112:3000}"
TOKEN_FILE="${DOKPLOY_TOKEN_FILE:-$HOME/.config/dokploy/api-token}"
BRANCH="${DOKPLOY_BRANCH:-main}"
TIMEOUT_SECS="${DOKPLOY_TIMEOUT:-900}"

[[ -f "$TOKEN_FILE" ]] || { echo "no Dokploy API token at $TOKEN_FILE" >&2; exit 1; }
KEY="$(cat "$TOKEN_FILE")"

api() { curl -sS -m 30 -H "x-api-key: $KEY" "$HOST/api/$1"; }
latest_created() { api "deployment.all?applicationId=$APP_ID" | python3 -c 'import json,sys; r=json.load(sys.stdin); r=r if isinstance(r,list) else r.get("deployments",[]); print(r[0]["createdAt"] if r else "")'; }

before="$(latest_created)"
echo "latest deployment before trigger: ${before:-<none>}"

RT="$(api "application.one?applicationId=$APP_ID" | python3 -c 'import json,sys; print(json.load(sys.stdin)["refreshToken"])')"
curl -sS -m 60 -X POST -H 'Content-Type: application/json' -H 'X-GitHub-Event: push' \
  -d "{\"ref\":\"refs/heads/$BRANCH\"}" "$HOST/api/deploy/$RT"
echo

deadline=$(( $(date +%s) + TIMEOUT_SECS ))
while :; do
  read -r created status title < <(
    api "deployment.all?applicationId=$APP_ID" | python3 -c 'import json,sys
r=json.load(sys.stdin); r=r if isinstance(r,list) else r.get("deployments",[])
d=r[0] if r else {}
print(d.get("createdAt",""), d.get("status",""), (d.get("title") or "").splitlines()[0][:60] if d.get("title") else "")'
  )
  if [[ "$created" != "$before" ]]; then
    echo "deploy $created: $status  ($title)"
    case "$status" in
      done)  echo "DEPLOY OK"; exit 0 ;;
      error|failed|cancelled) echo "DEPLOY FAILED: $status" >&2; exit 1 ;;
    esac
  fi
  (( $(date +%s) < deadline )) || { echo "timed out after ${TIMEOUT_SECS}s waiting for a new deployment row" >&2; exit 1; }
  sleep 15
done
