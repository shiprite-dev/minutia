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
-- Internal ledger: created before the default privileges below, so it is never
-- granted to the API roles; RLS-on/no-policy keeps it default-deny either way.
ALTER TABLE public.minutia_migrations ENABLE ROW LEVEL SECURITY;

-- Self-host only: grant the API roles PostgREST SET ROLEs into (anon, authenticated,
-- service_role) so migration-created tables are reachable; without this most tables
-- return 42501 permission denied and setup fails. docker/init/00000_supabase_roles.sh
-- sets the same defaults at cluster init, BUT ALTER DEFAULT PRIVILEGES is keyed to the
-- role that creates the object, and these migrations run as POSTGRES_USER (a different
-- role than init's), so init's defaults do not cover them -- observed as only a handful
-- of the app tables being granted. Re-assert the defaults for POSTGRES_USER here.
-- It MUST run before the migration loop, never as a blanket GRANT ... ON ALL after it:
-- setting defaults up front lets each migration's own REVOKE stay the final word (the
-- profiles role-column lockdown, the retro facilitator-token helpers). Row access stays
-- governed by RLS, enabled on every table; service_role bypasses RLS by design.
-- (ON ROUTINES in init == ON FUNCTIONS here for EXECUTE; not a divergence.)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
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
