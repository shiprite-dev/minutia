-- =============================================================================
-- Fix meeting-audio storage RLS so authenticated owners can upload.
-- =============================================================================
-- The original policies (20260624090000) inline an EXISTS subquery against
-- public.meetings / public.meeting_series. PostgREST evaluates that fine, but
-- the storage-api role cannot satisfy those tables' own RLS when the subquery
-- runs inside a storage.objects policy, so the nested read returns nothing and
-- every authenticated upload fails with "new row violates row-level security
-- policy" (a 403), even for the meeting's own owner.
--
-- Move the ownership check into a SECURITY DEFINER helper: it bypasses the
-- nested RLS and depends only on auth.uid(), which does resolve in the storage
-- context. Non-owners are still denied (the join still filters by owner).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.owns_meeting_audio_object(object_name text)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path = ''
  STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meetings m
    JOIN public.meeting_series ms ON ms.id = m.series_id
    WHERE m.id::text = (storage.foldername(object_name))[1]
      AND ms.owner_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.owns_meeting_audio_object(text) TO authenticated;

-- Re-point every meeting-audio policy at the helper (same ownership semantics).
DROP POLICY IF EXISTS "meeting_audio_select_owner" ON storage.objects;
CREATE POLICY "meeting_audio_select_owner"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND public.owns_meeting_audio_object(name)
  );

DROP POLICY IF EXISTS "meeting_audio_insert_owner" ON storage.objects;
CREATE POLICY "meeting_audio_insert_owner"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'meeting-audio'
    AND public.owns_meeting_audio_object(name)
  );

DROP POLICY IF EXISTS "meeting_audio_update_owner" ON storage.objects;
CREATE POLICY "meeting_audio_update_owner"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND public.owns_meeting_audio_object(name)
  )
  WITH CHECK (
    bucket_id = 'meeting-audio'
    AND public.owns_meeting_audio_object(name)
  );

DROP POLICY IF EXISTS "meeting_audio_delete_owner" ON storage.objects;
CREATE POLICY "meeting_audio_delete_owner"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'meeting-audio'
    AND public.owns_meeting_audio_object(name)
  );
