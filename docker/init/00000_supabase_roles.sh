#!/bin/bash
set -euo pipefail

quote_sql_literal() {
  local value=${1//\'/\'\'}
  printf "'%s'" "$value"
}

DB_PASSWORD_SQL=$(quote_sql_literal "$POSTGRES_PASSWORD")

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE SCHEMA IF NOT EXISTS public;
CREATE SCHEMA IF NOT EXISTS extensions;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'postgres') THEN
    EXECUTE format('CREATE ROLE postgres LOGIN SUPERUSER PASSWORD %L', ${DB_PASSWORD_SQL});
  ELSE
    EXECUTE format('ALTER ROLE postgres PASSWORD %L', ${DB_PASSWORD_SQL});
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    EXECUTE format('CREATE ROLE supabase_admin LOGIN SUPERUSER PASSWORD %L', ${DB_PASSWORD_SQL});
  ELSE
    EXECUTE format('ALTER ROLE supabase_admin PASSWORD %L', ${DB_PASSWORD_SQL});
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    EXECUTE format('CREATE ROLE supabase_auth_admin LOGIN PASSWORD %L', ${DB_PASSWORD_SQL});
  ELSE
    EXECUTE format('ALTER ROLE supabase_auth_admin PASSWORD %L', ${DB_PASSWORD_SQL});
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticator') THEN
    EXECUTE format('CREATE ROLE authenticator LOGIN PASSWORD %L', ${DB_PASSWORD_SQL});
  ELSE
    EXECUTE format('ALTER ROLE authenticator PASSWORD %L', ${DB_PASSWORD_SQL});
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    EXECUTE format('CREATE ROLE supabase_storage_admin LOGIN NOINHERIT CREATEROLE PASSWORD %L', ${DB_PASSWORD_SQL});
  ELSE
    EXECUTE format('ALTER ROLE supabase_storage_admin PASSWORD %L', ${DB_PASSWORD_SQL});
  END IF;
END \$\$;

ALTER ROLE postgres SET search_path = public, extensions;
ALTER ROLE supabase_admin SET search_path = public, extensions;
ALTER ROLE supabase_auth_admin SET search_path = auth, public, extensions;
ALTER ROLE authenticator SET search_path = public, extensions;
ALTER ROLE supabase_storage_admin SET search_path = storage, public, extensions;

GRANT anon TO authenticator;
GRANT authenticated TO authenticator;
GRANT service_role TO authenticator;
GRANT supabase_auth_admin TO authenticator;

-- storage-api connects as supabase_storage_admin and SET ROLEs to the request's
-- role per call (anon/authenticated/service_role). Without these memberships it
-- cannot set the role and every storage op fails with 42501 "permission denied
-- to set role" (a 400 on upload). Mirrors the authenticator grants above.
GRANT anon TO supabase_storage_admin;
GRANT authenticated TO supabase_storage_admin;
GRANT service_role TO supabase_storage_admin;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT ALL ON SCHEMA auth TO supabase_auth_admin;
GRANT USAGE ON SCHEMA auth TO authenticated, anon, service_role;

CREATE SCHEMA IF NOT EXISTS storage AUTHORIZATION supabase_storage_admin;
GRANT ALL ON SCHEMA storage TO supabase_storage_admin;
GRANT USAGE ON SCHEMA storage TO authenticated, anon, service_role;

CREATE SCHEMA IF NOT EXISTS _realtime;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
SQL
