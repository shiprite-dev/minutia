#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"
PUBLIC_URL="${PUBLIC_URL:-http://localhost}"
COMPOSE=(docker compose --env-file "$ENV_FILE" -f "$ROOT/docker-compose.yml" -f "$ROOT/deploy/minutia/***.yml")

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed on this VPS."
  echo "Install Docker Engine, then rerun this script."
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  if command -v node >/dev/null 2>&1; then
    node "$ROOT/scripts/generate-self-host-env.mjs" --out "$ENV_FILE" --url "$PUBLIC_URL"
  else
    docker run --rm -v "$ROOT:/work" -w /work node:22-alpine \
      node scripts/generate-self-host-env.mjs --out .env --url "$PUBLIC_URL"
    sudo chown "$(id -u):$(id -g)" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  fi
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

mkdir -p "$ROOT/.deploy-generated"
awk '{
  gsub(/\$\{ANON_KEY\}/, ENVIRON["ANON_KEY"]);
  gsub(/\$\{SERVICE_ROLE_KEY\}/, ENVIRON["SERVICE_ROLE_KEY"]);
  print;
}' "$ROOT/docker/kong.yml" > "$ROOT/.deploy-generated/kong.yml"
export KONG_CONFIG="$ROOT/.deploy-generated/kong.yml"

"${COMPOSE[@]}" up -d --build supabase-db supabase-auth supabase-rest supabase-realtime
"${COMPOSE[@]}" exec -T supabase-db bash -s < "$ROOT/scripts/run-self-host-migrations.sh"
"${COMPOSE[@]}" up -d --build
"${COMPOSE[@]}" ps

echo
echo "Minutia should be available at $(grep '^PUBLIC_URL=' "$ENV_FILE" | cut -d= -f2-)"
