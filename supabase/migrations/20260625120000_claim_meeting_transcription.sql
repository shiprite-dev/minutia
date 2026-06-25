-- Atomic, PostgREST-version-independent transcription claim.
--
-- The transcribe route previously claimed a meeting with an optimistic
--   UPDATE meetings ... WHERE id = ? AND or=(status<>'processing', ..., started_at<stale)
-- expressed through PostgREST's `or=()` query operator. The self-host PostgREST
-- (v12.2.3) does NOT apply `or=()` logical filters to UPDATE/DELETE mutations:
-- it silently matches 0 rows (the same filter works for SELECT). The claim
-- therefore never succeeded on self-host and the route returned HTTP 500
-- "Could not start transcription." Managed/CLI PostgREST is newer and applies
-- it, so CI and Supabase Cloud never reproduced the failure.
--
-- Moving the claim into a single SQL statement behind a SECURITY DEFINER RPC
-- makes it identical across PostgREST versions and keeps it atomic (no
-- read-then-write race between concurrent transcribe requests).

create or replace function public.claim_meeting_transcription(
  p_meeting_id uuid,
  p_stale_seconds integer default 900
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed uuid;
begin
  -- SECURITY DEFINER bypasses RLS, so re-assert the same authz the route's
  -- UPDATE policy enforced (any series participant may transcribe). auth.uid()
  -- still reflects the caller inside a definer function.
  update public.meetings
     set transcription_status = 'processing',
         transcription_started_at = now()
   where id = p_meeting_id
     and public.user_can_access_series(series_id)
     and (
       -- Claimable unless a run is actively in progress: not currently
       -- 'processing' (covers null/pending/completed/failed), or a prior
       -- 'processing' run is stale enough to be treated as crashed.
       transcription_status is distinct from 'processing'
       or transcription_started_at < now() - make_interval(secs => p_stale_seconds)
     )
  returning id into v_claimed;

  return v_claimed;
end;
$$;

revoke all on function public.claim_meeting_transcription(uuid, integer) from public;
grant execute on function public.claim_meeting_transcription(uuid, integer) to authenticated, service_role;
