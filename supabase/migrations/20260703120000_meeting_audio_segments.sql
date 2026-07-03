-- =============================================================================
-- Fast-lane audio segments: per-segment upload + transcription rows.
-- Segments are cut client-side at WebM cluster boundaries and transcribed
-- independently so a mid-meeting provider hiccup only loses one segment,
-- not the whole recording. RLS mirrors meeting_ai_suggestions via the
-- meeting -> series access predicate. Claim is a single-statement SECURITY
-- DEFINER RPC because self-host PostgREST ignores or=() on UPDATE.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meeting_audio_segments (
  meeting_id      uuid        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  seq             integer     NOT NULL CHECK (seq >= 0),
  storage_path    text        NOT NULL,
  status          text        NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'completed', 'failed')),
  transcript_text text,
  error_code      text,
  size_bytes      bigint,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (meeting_id, seq)
);

-- ---------------------------------------------------------------------------
-- 2. RLS: same predicate as claim_meeting_transcription, joined through
--    meetings since this table has no direct series_id column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.meeting_audio_segments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_audio_segments_select_member" ON public.meeting_audio_segments;
CREATE POLICY "meeting_audio_segments_select_member"
  ON public.meeting_audio_segments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id AND public.user_can_access_series(m.series_id)
    )
  );

DROP POLICY IF EXISTS "meeting_audio_segments_insert_member" ON public.meeting_audio_segments;
CREATE POLICY "meeting_audio_segments_insert_member"
  ON public.meeting_audio_segments FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id AND public.user_can_access_series(m.series_id)
    )
  );

DROP POLICY IF EXISTS "meeting_audio_segments_update_member" ON public.meeting_audio_segments;
CREATE POLICY "meeting_audio_segments_update_member"
  ON public.meeting_audio_segments FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id AND public.user_can_access_series(m.series_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id AND public.user_can_access_series(m.series_id)
    )
  );

DROP POLICY IF EXISTS "meeting_audio_segments_delete_member" ON public.meeting_audio_segments;
CREATE POLICY "meeting_audio_segments_delete_member"
  ON public.meeting_audio_segments FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.meetings m
      WHERE m.id = meeting_id AND public.user_can_access_series(m.series_id)
    )
  );

GRANT ALL ON public.meeting_audio_segments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_audio_segments TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Index for resume/assembly queries scanning by status.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_meeting_audio_segments_status
  ON public.meeting_audio_segments (meeting_id, status);

-- ---------------------------------------------------------------------------
-- 4. Atomic claim: self-host PostgREST (v12.2.3) ignores or=() on UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.claim_segment_transcription(
  p_meeting_id uuid,
  p_seq integer,
  p_stale_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.meeting_audio_segments
     set status = 'processing',
         updated_at = now()
   where meeting_id = p_meeting_id
     and seq = p_seq
     and EXISTS (
       SELECT 1 FROM public.meetings m
       WHERE m.id = p_meeting_id AND public.user_can_access_series(m.series_id)
     )
     and (
       status is distinct from 'processing'
       or updated_at < now() - make_interval(secs => p_stale_seconds)
     );

  return found;
end;
$$;

revoke all on function public.claim_segment_transcription(uuid, integer, integer) from public;
grant execute on function public.claim_segment_transcription(uuid, integer, integer) to authenticated, service_role;
