-- Allow anonymous users to read guest_shares by token (for public share pages)
CREATE POLICY "guest_shares_select_by_token"
  ON public.guest_shares FOR SELECT
  USING (true);

-- Allow anonymous read access to meetings referenced by a valid guest share
CREATE POLICY "meetings_select_via_share"
  ON public.meetings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.guest_shares gs
      WHERE gs.resource_type = 'meeting'
        AND gs.resource_id = meetings.id
    )
  );

-- Allow anonymous read access to series referenced by a valid guest share
CREATE POLICY "series_select_via_share"
  ON public.meeting_series FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.guest_shares gs
      WHERE gs.resource_type = 'series'
        AND gs.resource_id = meeting_series.id
    )
  );

-- Allow anonymous read access to issues in a shared series or directly shared
CREATE POLICY "issues_select_via_share"
  ON public.issues FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.guest_shares gs
      WHERE (gs.resource_type = 'issue' AND gs.resource_id = issues.id)
         OR (gs.resource_type = 'series' AND gs.resource_id = issues.series_id)
         OR (gs.resource_type = 'meeting' AND gs.resource_id = issues.raised_in_meeting_id)
    )
  );

-- Allow anonymous read access to decisions in a shared meeting
CREATE POLICY "decisions_select_via_share"
  ON public.decisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.guest_shares gs
      WHERE gs.resource_type = 'meeting'
        AND gs.resource_id = decisions.meeting_id
    )
  );

-- Allow anonymous read access to issue updates for shared issues
CREATE POLICY "issue_updates_select_via_share"
  ON public.issue_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.guest_shares gs
      WHERE (gs.resource_type = 'issue' AND gs.resource_id = issue_updates.issue_id)
         OR (gs.resource_type = 'series' AND gs.resource_id = (
           SELECT series_id FROM public.issues WHERE id = issue_updates.issue_id
         ))
    )
  );

-- Allow anonymous read to meetings that belong to a shared series
CREATE POLICY "meetings_select_via_series_share"
  ON public.meetings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.guest_shares gs
      WHERE gs.resource_type = 'series'
        AND gs.resource_id = meetings.series_id
    )
  );
