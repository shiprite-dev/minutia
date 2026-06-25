-- =============================================================================
-- Storage uploads fail with 42501 "permission denied to set role" -> HTTP 400
-- =============================================================================
-- storage-api connects to Postgres as `supabase_storage_admin` and, per request,
-- runs `set_config('role', <jwt role>, ...)` to assume anon / authenticated /
-- service_role so RLS applies as the caller. That SET ROLE requires
-- supabase_storage_admin to be a MEMBER of those roles.
--
-- The role bootstrap (docker/init/00000_supabase_roles.sh) granted anon /
-- authenticated / service_role to `authenticator` (PostgREST) but not to
-- `supabase_storage_admin`, so every storage operation failed with
-- "permission denied to set role" (SQLSTATE 42501) -> storage-api returns 400.
-- docker/init only runs on a fresh DB volume, so already-initialized self-host
-- instances (staging, prod) need this migration to self-heal; fresh installs now
-- get the grant from docker/init directly.
--
-- Idempotent and guarded: GRANT ROLE is a no-op if already granted, and the role
-- only exists where Storage is provisioned (the Supabase CLI used in CI has it).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin') THEN
    GRANT anon, authenticated, service_role TO supabase_storage_admin;
  END IF;
END $$;
