-- Companion presence: track when a user's desktop companion app last checked in.
--
-- The companion app POSTs /api/companion/heartbeat with the user's Bearer token;
-- that thin BFF route updates this column on the caller's own profile row using
-- the user JWT (no service role).
--
-- The P0 role-hardening migration (20260520055527) REVOKEd UPDATE on profiles
-- from authenticated and re-granted only a safe column allowlist. A user JWT
-- therefore cannot write companion_last_seen_at until it is added to that
-- allowlist. Grant UPDATE on this single column only; role and every other
-- security-sensitive column stay ungranted, so the role guard is preserved.

alter table public.profiles
  add column companion_last_seen_at timestamptz;

grant update (companion_last_seen_at) on public.profiles to authenticated;
