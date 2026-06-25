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

# Self-host only: storage-api connects as supabase_storage_admin and SET ROLEs to
# the request's role per call, so it must be a MEMBER of the API roles or every
# storage op fails with 42501 "permission denied to set role" (HTTP 400 on upload).
# docker/init grants this on a fresh DB; re-assert here (idempotent, as the
# superuser POSTGRES_USER) so volumes initialized before the fix self-heal on
# deploy. This is deliberately NOT a shared supabase/migrations file: on the
# Supabase CLI / Cloud, supabase_storage_admin is a reserved role and a non-super
# migration role cannot modify it (SQLSTATE 42501) -- there the grant is unneeded.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    GRANT anon, authenticated, service_role TO supabase_storage_admin;
  END IF;
END $$;
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -c "NOTIFY pgrst, 'reload schema'"

echo "All migrations applied."
