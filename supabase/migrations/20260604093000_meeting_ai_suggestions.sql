CREATE TABLE public.meeting_ai_suggestions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id          uuid        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  series_id           uuid        NOT NULL REFERENCES public.meeting_series(id) ON DELETE CASCADE,
  category            text        NOT NULL CHECK (category IN ('action', 'decision', 'info', 'risk', 'blocker')),
  title               text        NOT NULL,
  details             text        NOT NULL DEFAULT '',
  owner_name          text        NOT NULL DEFAULT '',
  due_date            date,
  confidence          real        NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  source_excerpt      text        NOT NULL DEFAULT '',
  status              text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  ai_model            text        NOT NULL DEFAULT '',
  ai_prompt_version   text        NOT NULL DEFAULT '',
  created_issue_id    uuid        REFERENCES public.issues(id) ON DELETE SET NULL,
  created_decision_id uuid        REFERENCES public.decisions(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  reviewed_at         timestamptz
);

CREATE INDEX idx_meeting_ai_suggestions_meeting_id
  ON public.meeting_ai_suggestions(meeting_id);

CREATE INDEX idx_meeting_ai_suggestions_series_status
  ON public.meeting_ai_suggestions(series_id, status);

ALTER TABLE public.meeting_ai_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "meeting_ai_suggestions_select_series_participant"
  ON public.meeting_ai_suggestions FOR SELECT
  USING (public.user_can_access_series(series_id));

CREATE POLICY "meeting_ai_suggestions_insert_series_participant"
  ON public.meeting_ai_suggestions FOR INSERT
  WITH CHECK (public.user_can_access_series(series_id));

CREATE POLICY "meeting_ai_suggestions_update_series_participant"
  ON public.meeting_ai_suggestions FOR UPDATE
  USING (public.user_can_access_series(series_id))
  WITH CHECK (public.user_can_access_series(series_id));

CREATE POLICY "meeting_ai_suggestions_delete_series_manager"
  ON public.meeting_ai_suggestions FOR DELETE
  USING (public.user_can_manage_series(series_id));

GRANT ALL ON public.meeting_ai_suggestions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meeting_ai_suggestions TO authenticated;
