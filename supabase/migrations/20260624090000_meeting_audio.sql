-- =============================================================================
-- Browser-based audio capture for meeting recording
-- =============================================================================
-- Adds audio + transcription metadata to meetings, a private storage bucket for
-- the raw recordings, and ownership-scoped RLS on the stored objects. Objects
-- are keyed as '{meeting_id}/recording.{ext}', so the first path segment is the
-- meeting id used to authorize access via meetings -> meeting_series.owner_id.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Audio + transcription columns on meetings
-- ---------------------------------------------------------------------------
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS audio_file_path            text,
  ADD COLUMN IF NOT EXISTS audio_duration_seconds     integer,
  ADD COLUMN IF NOT EXISTS audio_file_size_bytes      bigint,
  ADD COLUMN IF NOT EXISTS transcription_status       text
    CHECK (transcription_status IS NULL
           OR transcription_status IN ('pending', 'processing', 'completed', 'failed')),
  ADD COLUMN IF NOT EXISTS transcription_model        text,
  ADD COLUMN IF NOT EXISTS transcription_provider     text,
  ADD COLUMN IF NOT EXISTS transcription_completed_at timestamptz;

-- Lets a transcription worker cheaply find queued recordings.
CREATE INDEX IF NOT EXISTS idx_meetings_transcription_status
  ON public.meetings (transcription_status)
  WHERE transcription_status IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Private storage bucket for meeting audio (100 MB cap)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'meeting-audio',
  'meeting-audio',
  false,
  104857600,
  ARRAY['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. RLS on storage.objects, scoped to the owner of the recording's series.
--    Compare the meeting id as text to avoid a hard uuid cast on stray keys.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "meeting_audio_select_owner" ON storage.objects;
CREATE POLICY "meeting_audio_select_owner"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.meeting_series ms ON ms.id = m.series_id
      WHERE m.id::text = (storage.foldername(name))[1]
        AND ms.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "meeting_audio_insert_owner" ON storage.objects;
CREATE POLICY "meeting_audio_insert_owner"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.meeting_series ms ON ms.id = m.series_id
      WHERE m.id::text = (storage.foldername(name))[1]
        AND ms.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "meeting_audio_update_owner" ON storage.objects;
CREATE POLICY "meeting_audio_update_owner"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.meeting_series ms ON ms.id = m.series_id
      WHERE m.id::text = (storage.foldername(name))[1]
        AND ms.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.meeting_series ms ON ms.id = m.series_id
      WHERE m.id::text = (storage.foldername(name))[1]
        AND ms.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "meeting_audio_delete_owner" ON storage.objects;
CREATE POLICY "meeting_audio_delete_owner"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND EXISTS (
      SELECT 1 FROM public.meetings m
      JOIN public.meeting_series ms ON ms.id = m.series_id
      WHERE m.id::text = (storage.foldername(name))[1]
        AND ms.owner_id = auth.uid()
    )
  );
