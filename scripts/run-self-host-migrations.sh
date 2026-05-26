#!/bin/bash
set -euo pipefail

echo "Running Minutia migrations..."

quote_sql_literal() {
  local value=${1//\'/\'\'}
  printf "'%s'" "$value"
}

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE TABLE IF NOT EXISTS public.minutia_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
SQL

for f in /migrations/*.sql; do
  version="$(basename "$f")"
  version_sql="$(quote_sql_literal "$version")"
  applied="$(
    psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -Atc \
      "SELECT 1 FROM public.minutia_migrations WHERE version = $version_sql"
  )"

  if [ "$applied" = "1" ]; then
    echo "  Skipping $version"
    continue
  fi

  echo "  Applying $version..."
  psql -v ON_ERROR_STOP=1 --single-transaction --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f "$f"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c \
    "INSERT INTO public.minutia_migrations(version) VALUES ($version_sql)"
done

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "NOTIFY pgrst, 'reload schema'"

echo "All migrations applied."
