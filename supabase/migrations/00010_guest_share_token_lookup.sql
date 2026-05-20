-- Keep public share lookup token-scoped without allowing anonymous table enumeration.
DROP POLICY IF EXISTS "guest_shares_select_by_token" ON public.guest_shares;

CREATE OR REPLACE FUNCTION public.get_guest_share_by_token(share_token text)
RETURNS SETOF public.guest_shares
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT *
  FROM public.guest_shares
  WHERE token = share_token
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_guest_share_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_share_by_token(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.has_guest_share(
  target_resource_type text,
  target_resource_id uuid
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT target_resource_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.guest_shares
      WHERE resource_type = target_resource_type
        AND resource_id = target_resource_id
    )
$$;

REVOKE ALL ON FUNCTION public.has_guest_share(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_guest_share(text, uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "meetings_select_via_share" ON public.meetings;
DROP POLICY IF EXISTS "series_select_via_share" ON public.meeting_series;
DROP POLICY IF EXISTS "issues_select_via_share" ON public.issues;
DROP POLICY IF EXISTS "decisions_select_via_share" ON public.decisions;
DROP POLICY IF EXISTS "issue_updates_select_via_share" ON public.issue_updates;
DROP POLICY IF EXISTS "meetings_select_via_series_share" ON public.meetings;

CREATE POLICY "meetings_select_via_share"
  ON public.meetings FOR SELECT
  USING (public.has_guest_share('meeting', id));

CREATE POLICY "series_select_via_share"
  ON public.meeting_series FOR SELECT
  USING (public.has_guest_share('series', id));

CREATE POLICY "issues_select_via_share"
  ON public.issues FOR SELECT
  USING (
    public.has_guest_share('issue', id)
    OR public.has_guest_share('series', series_id)
    OR public.has_guest_share('meeting', raised_in_meeting_id)
  );

CREATE POLICY "decisions_select_via_share"
  ON public.decisions FOR SELECT
  USING (public.has_guest_share('meeting', meeting_id));

CREATE POLICY "issue_updates_select_via_share"
  ON public.issue_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.issues i
      WHERE i.id = issue_updates.issue_id
        AND (
          public.has_guest_share('issue', i.id)
          OR public.has_guest_share('series', i.series_id)
          OR public.has_guest_share('meeting', i.raised_in_meeting_id)
        )
    )
  );

CREATE POLICY "meetings_select_via_series_share"
  ON public.meetings FOR SELECT
  USING (public.has_guest_share('series', series_id));
