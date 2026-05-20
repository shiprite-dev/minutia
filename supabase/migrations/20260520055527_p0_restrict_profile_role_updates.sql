-- P0 security hardening: prevent authenticated users from changing
-- security-sensitive profile columns through the public Data API.
--
-- RLS decides which rows can be updated, but it does not restrict which
-- columns an UPDATE may change. profiles_update_own allows a user to update
-- their own row, so column privileges must block role changes.

REVOKE UPDATE ON public.profiles FROM authenticated;

GRANT UPDATE (
  name,
  avatar_url,
  settings,
  has_completed_onboarding
) ON public.profiles TO authenticated;

GRANT UPDATE ON public.profiles TO service_role;
