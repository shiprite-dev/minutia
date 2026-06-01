CREATE TABLE public.series_participants (
  series_id  uuid        NOT NULL REFERENCES public.meeting_series(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'participant'
                         CHECK (role IN ('owner', 'facilitator', 'participant')),
  invited_by uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (series_id, user_id)
);

CREATE INDEX idx_series_participants_user_id ON public.series_participants(user_id);
CREATE INDEX idx_series_participants_role ON public.series_participants(series_id, role);

ALTER TABLE public.series_participants ENABLE ROW LEVEL SECURITY;

INSERT INTO public.series_participants (series_id, user_id, role)
SELECT id, owner_id, 'owner'
FROM public.meeting_series
ON CONFLICT (series_id, user_id) DO UPDATE
SET role = CASE
  WHEN public.series_participants.role = 'owner' THEN 'owner'
  ELSE EXCLUDED.role
END;

WITH ranked_live_meetings AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY series_id ORDER BY created_at ASC, id ASC) AS live_rank
  FROM public.meetings
  WHERE status = 'live'
)
UPDATE public.meetings
SET status = 'completed',
    completed_at = COALESCE(completed_at, now())
WHERE id IN (
  SELECT id
  FROM ranked_live_meetings
  WHERE live_rank > 1
);

CREATE UNIQUE INDEX meetings_one_live_per_series
  ON public.meetings(series_id)
  WHERE status = 'live';

CREATE OR REPLACE FUNCTION public.user_can_access_series(target_series_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT target_series_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.series_participants sp
        WHERE sp.series_id = target_series_id
          AND sp.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.meeting_series ms
        WHERE ms.id = target_series_id
          AND ms.owner_id = auth.uid()
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage_series(target_series_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT target_series_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.series_participants sp
        WHERE sp.series_id = target_series_id
          AND sp.user_id = auth.uid()
          AND sp.role IN ('owner', 'facilitator')
      )
      OR EXISTS (
        SELECT 1
        FROM public.meeting_series ms
        WHERE ms.id = target_series_id
          AND ms.owner_id = auth.uid()
      )
    )
$$;

CREATE OR REPLACE FUNCTION public.add_series_owner_participant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.series_participants (series_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (series_id, user_id) DO UPDATE
  SET role = CASE
    WHEN public.series_participants.role = 'owner' THEN 'owner'
    ELSE EXCLUDED.role
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS add_series_owner_participant ON public.meeting_series;
CREATE TRIGGER add_series_owner_participant
  AFTER INSERT ON public.meeting_series
  FOR EACH ROW EXECUTE FUNCTION public.add_series_owner_participant();

CREATE OR REPLACE FUNCTION public.enforce_meeting_status_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
    IF OLD.status = 'upcoming'
      AND NEW.status = 'live'
      AND NEW.completed_at IS NOT DISTINCT FROM OLD.completed_at
      AND public.user_can_access_series(OLD.series_id) THEN
      RETURN NEW;
    END IF;

    IF NOT public.user_can_manage_series(OLD.series_id) THEN
      RAISE EXCEPTION 'Only series owners and facilitators can change meeting status'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_meeting_status_permissions ON public.meetings;
CREATE TRIGGER enforce_meeting_status_permissions
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_meeting_status_permissions();

CREATE OR REPLACE FUNCTION public.start_or_join_meeting(target_series_id uuid)
RETURNS public.meetings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  series_row public.meeting_series%ROWTYPE;
  meeting_row public.meetings%ROWTYPE;
  next_sequence integer;
BEGIN
  IF NOT public.user_can_access_series(target_series_id) THEN
    RAISE EXCEPTION 'Series access required'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO series_row
  FROM public.meeting_series
  WHERE id = target_series_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Series not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO meeting_row
  FROM public.meetings
  WHERE series_id = target_series_id
    AND status = 'live'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RETURN meeting_row;
  END IF;

  SELECT *
  INTO meeting_row
  FROM public.meetings
  WHERE series_id = target_series_id
    AND status = 'upcoming'
  ORDER BY date ASC, sequence_number ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.meetings
    SET status = 'live'
    WHERE id = meeting_row.id
    RETURNING * INTO meeting_row;

    RETURN meeting_row;
  END IF;

  SELECT COALESCE(MAX(sequence_number), 0) + 1
  INTO next_sequence
  FROM public.meetings
  WHERE series_id = target_series_id;

  INSERT INTO public.meetings (
    series_id,
    sequence_number,
    title,
    date,
    attendees,
    status,
    notes_markdown
  )
  VALUES (
    target_series_id,
    next_sequence,
    series_row.name || ' #' || next_sequence,
    CURRENT_DATE,
    series_row.default_attendees,
    'live',
    ''
  )
  RETURNING * INTO meeting_row;

  RETURN meeting_row;
END;
$$;

DROP POLICY IF EXISTS "meeting_series_select_org_member" ON public.meeting_series;
DROP POLICY IF EXISTS "meeting_series_insert_org_member" ON public.meeting_series;
DROP POLICY IF EXISTS "meeting_series_update_org_member" ON public.meeting_series;
DROP POLICY IF EXISTS "meeting_series_delete_org_admin_or_owner" ON public.meeting_series;
DROP POLICY IF EXISTS "meetings_select_org_member" ON public.meetings;
DROP POLICY IF EXISTS "meetings_insert_org_member" ON public.meetings;
DROP POLICY IF EXISTS "meetings_update_org_member" ON public.meetings;
DROP POLICY IF EXISTS "meetings_delete_org_admin_or_owner" ON public.meetings;
DROP POLICY IF EXISTS "issues_select_org_member" ON public.issues;
DROP POLICY IF EXISTS "issues_insert_org_member" ON public.issues;
DROP POLICY IF EXISTS "issues_update_org_member" ON public.issues;
DROP POLICY IF EXISTS "issues_delete_org_admin_or_owner" ON public.issues;
DROP POLICY IF EXISTS "issue_updates_select_org_member" ON public.issue_updates;
DROP POLICY IF EXISTS "issue_updates_insert_org_member" ON public.issue_updates;
DROP POLICY IF EXISTS "decisions_select_org_member" ON public.decisions;
DROP POLICY IF EXISTS "decisions_insert_org_member" ON public.decisions;
DROP POLICY IF EXISTS "decisions_update_org_member" ON public.decisions;
DROP POLICY IF EXISTS "decisions_delete_org_admin_or_owner" ON public.decisions;

CREATE POLICY "series_participants_select_series_member"
  ON public.series_participants FOR SELECT
  USING (user_id = auth.uid() OR public.user_can_access_series(series_id));

CREATE POLICY "series_participants_insert_manager"
  ON public.series_participants FOR INSERT
  WITH CHECK (
    public.user_can_manage_series(series_id)
    OR (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.meeting_series ms
        WHERE ms.id = series_id
          AND ms.owner_id = auth.uid()
      )
    )
  );

CREATE POLICY "series_participants_update_manager"
  ON public.series_participants FOR UPDATE
  USING (public.user_can_manage_series(series_id))
  WITH CHECK (public.user_can_manage_series(series_id));

CREATE POLICY "series_participants_delete_manager"
  ON public.series_participants FOR DELETE
  USING (public.user_can_manage_series(series_id) AND user_id <> auth.uid());

CREATE POLICY "meeting_series_select_participant"
  ON public.meeting_series FOR SELECT
  USING (owner_id = auth.uid() OR public.user_can_access_series(id));

CREATE POLICY "meeting_series_insert_org_member"
  ON public.meeting_series FOR INSERT
  WITH CHECK (
    public.user_is_org_member(organization_id)
    OR (organization_id IS NULL AND owner_id = auth.uid())
  );

CREATE POLICY "meeting_series_update_manager"
  ON public.meeting_series FOR UPDATE
  USING (public.user_can_manage_series(id))
  WITH CHECK (public.user_can_manage_series(id));

CREATE POLICY "meeting_series_delete_manager"
  ON public.meeting_series FOR DELETE
  USING (public.user_can_manage_series(id));

CREATE POLICY "meetings_select_series_participant"
  ON public.meetings FOR SELECT
  USING (public.user_can_access_series(series_id));

CREATE POLICY "meetings_insert_series_manager"
  ON public.meetings FOR INSERT
  WITH CHECK (public.user_can_manage_series(series_id));

CREATE POLICY "meetings_update_series_participant"
  ON public.meetings FOR UPDATE
  USING (public.user_can_access_series(series_id))
  WITH CHECK (public.user_can_access_series(series_id));

CREATE POLICY "meetings_delete_series_manager"
  ON public.meetings FOR DELETE
  USING (public.user_can_manage_series(series_id));

CREATE POLICY "issues_select_series_participant"
  ON public.issues FOR SELECT
  USING (public.user_can_access_series(series_id));

CREATE POLICY "issues_insert_series_participant"
  ON public.issues FOR INSERT
  WITH CHECK (public.user_can_access_series(series_id));

CREATE POLICY "issues_update_series_participant"
  ON public.issues FOR UPDATE
  USING (public.user_can_access_series(series_id))
  WITH CHECK (public.user_can_access_series(series_id));

CREATE POLICY "issues_delete_series_manager"
  ON public.issues FOR DELETE
  USING (public.user_can_manage_series(series_id));

CREATE POLICY "issue_updates_select_series_participant"
  ON public.issue_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.issues i
      WHERE i.id = issue_updates.issue_id
        AND public.user_can_access_series(i.series_id)
    )
  );

CREATE POLICY "issue_updates_insert_series_participant"
  ON public.issue_updates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.issues i
      WHERE i.id = issue_updates.issue_id
        AND public.user_can_access_series(i.series_id)
    )
  );

CREATE POLICY "decisions_select_series_participant"
  ON public.decisions FOR SELECT
  USING (public.user_can_access_series(series_id));

CREATE POLICY "decisions_insert_series_participant"
  ON public.decisions FOR INSERT
  WITH CHECK (public.user_can_access_series(series_id));

CREATE POLICY "decisions_update_series_participant"
  ON public.decisions FOR UPDATE
  USING (public.user_can_access_series(series_id))
  WITH CHECK (public.user_can_access_series(series_id));

CREATE POLICY "decisions_delete_series_manager"
  ON public.decisions FOR DELETE
  USING (public.user_can_manage_series(series_id));

GRANT ALL ON public.series_participants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.series_participants TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_access_series(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_can_manage_series(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_or_join_meeting(uuid) TO authenticated;

ALTER TABLE public.meeting_series REPLICA IDENTITY FULL;
ALTER TABLE public.meetings REPLICA IDENTITY FULL;
ALTER TABLE public.issues REPLICA IDENTITY FULL;
ALTER TABLE public.decisions REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_series;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.meetings;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.issues;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.decisions;
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
