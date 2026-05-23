-- Harden guest sharing so the token is the access boundary.
-- Anonymous users may execute token-scoped RPCs, but may not enumerate shared
-- resources through table SELECT policies.

DROP POLICY IF EXISTS "meetings_select_via_share" ON public.meetings;
DROP POLICY IF EXISTS "series_select_via_share" ON public.meeting_series;
DROP POLICY IF EXISTS "issues_select_via_share" ON public.issues;
DROP POLICY IF EXISTS "decisions_select_via_share" ON public.decisions;
DROP POLICY IF EXISTS "issue_updates_select_via_share" ON public.issue_updates;
DROP POLICY IF EXISTS "meetings_select_via_series_share" ON public.meetings;

DROP FUNCTION IF EXISTS public.has_guest_share(text, uuid);

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
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_guest_share_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_share_by_token(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_guest_share_payload(share_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  share_row public.guest_shares%ROWTYPE;
  payload jsonb;
BEGIN
  SELECT *
  INTO share_row
  FROM public.guest_shares
  WHERE token = share_token
    AND (expires_at IS NULL OR expires_at > now())
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF share_row.resource_type = 'meeting' THEN
    SELECT jsonb_build_object(
      'share', to_jsonb(share_row),
      'resource_type', 'meeting',
      'meeting', jsonb_build_object(
        'id', m.id,
        'series_id', m.series_id,
        'sequence_number', m.sequence_number,
        'title', m.title,
        'date', m.date,
        'attendees', m.attendees,
        'status', m.status,
        'notes_markdown', m.notes_markdown,
        'created_at', m.created_at,
        'completed_at', m.completed_at
      ),
      'series', CASE WHEN ms.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', ms.id,
        'name', ms.name,
        'description', ms.description,
        'cadence', ms.cadence,
        'default_attendees', ms.default_attendees,
        'ai_features_enabled', ms.ai_features_enabled,
        'owner_id', ms.owner_id,
        'created_at', ms.created_at,
        'updated_at', ms.updated_at
      ) END,
      'issues', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', i.id,
          'series_id', i.series_id,
          'raised_in_meeting_id', i.raised_in_meeting_id,
          'title', i.title,
          'description', i.description,
          'category', i.category,
          'status', i.status,
          'priority', i.priority,
          'owner_name', i.owner_name,
          'owner_user_id', NULL,
          'due_date', i.due_date,
          'resolved_in_meeting_id', i.resolved_in_meeting_id,
          'source', i.source,
          'ai_confidence', i.ai_confidence,
          'sort_order', i.sort_order,
          'created_at', i.created_at,
          'updated_at', i.updated_at
        ) ORDER BY i.sort_order, i.created_at)
        FROM public.issues i
        WHERE i.raised_in_meeting_id = m.id
      ), '[]'::jsonb),
      'decisions', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', d.id,
          'meeting_id', d.meeting_id,
          'series_id', d.series_id,
          'title', d.title,
          'rationale', d.rationale,
          'made_by', d.made_by,
          'created_by', d.created_by,
          'created_at', d.created_at,
          'updated_at', d.updated_at
        ) ORDER BY d.created_at)
        FROM public.decisions d
        WHERE d.meeting_id = m.id
      ), '[]'::jsonb),
      'updated_at', COALESCE(m.completed_at, m.created_at)
    )
    INTO payload
    FROM public.meetings m
    LEFT JOIN public.meeting_series ms ON ms.id = m.series_id
    WHERE m.id = share_row.resource_id;

    RETURN payload;
  END IF;

  IF share_row.resource_type = 'series' THEN
    SELECT jsonb_build_object(
      'share', to_jsonb(share_row),
      'resource_type', 'series',
      'series', jsonb_build_object(
        'id', ms.id,
        'name', ms.name,
        'description', ms.description,
        'cadence', ms.cadence,
        'default_attendees', ms.default_attendees,
        'ai_features_enabled', ms.ai_features_enabled,
        'owner_id', ms.owner_id,
        'created_at', ms.created_at,
        'updated_at', ms.updated_at
      ),
      'meetings', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', m.id,
          'series_id', m.series_id,
          'sequence_number', m.sequence_number,
          'title', m.title,
          'date', m.date,
          'attendees', m.attendees,
          'status', m.status,
          'notes_markdown', m.notes_markdown,
          'created_at', m.created_at,
          'completed_at', m.completed_at
        ) ORDER BY m.date DESC, m.sequence_number DESC)
        FROM public.meetings m
        WHERE m.series_id = ms.id
      ), '[]'::jsonb),
      'open_issues', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', i.id,
          'series_id', i.series_id,
          'raised_in_meeting_id', i.raised_in_meeting_id,
          'title', i.title,
          'description', i.description,
          'category', i.category,
          'status', i.status,
          'priority', i.priority,
          'owner_name', i.owner_name,
          'owner_user_id', NULL,
          'due_date', i.due_date,
          'resolved_in_meeting_id', i.resolved_in_meeting_id,
          'source', i.source,
          'ai_confidence', i.ai_confidence,
          'sort_order', i.sort_order,
          'created_at', i.created_at,
          'updated_at', i.updated_at
        ) ORDER BY i.sort_order, i.created_at)
        FROM public.issues i
        WHERE i.series_id = ms.id
          AND i.status NOT IN ('resolved', 'dropped')
      ), '[]'::jsonb),
      'open_issues_count', (
        SELECT count(*)
        FROM public.issues i
        WHERE i.series_id = ms.id
          AND i.status NOT IN ('resolved', 'dropped')
      )
    )
    INTO payload
    FROM public.meeting_series ms
    WHERE ms.id = share_row.resource_id;

    RETURN payload;
  END IF;

  IF share_row.resource_type = 'issue' THEN
    SELECT jsonb_build_object(
      'share', to_jsonb(share_row),
      'resource_type', 'issue',
      'issue', jsonb_build_object(
        'id', i.id,
        'series_id', i.series_id,
        'raised_in_meeting_id', i.raised_in_meeting_id,
        'title', i.title,
        'description', i.description,
        'category', i.category,
        'status', i.status,
        'priority', i.priority,
        'owner_name', i.owner_name,
        'owner_user_id', NULL,
        'due_date', i.due_date,
        'resolved_in_meeting_id', i.resolved_in_meeting_id,
        'source', i.source,
        'ai_confidence', i.ai_confidence,
        'sort_order', i.sort_order,
        'created_at', i.created_at,
        'updated_at', i.updated_at
      ),
      'updates', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', iu.id,
          'issue_id', iu.issue_id,
          'meeting_id', iu.meeting_id,
          'previous_status', iu.previous_status,
          'new_status', iu.new_status,
          'note', iu.note,
          'author_type', iu.author_type,
          'updated_by', '',
          'created_at', iu.created_at
        ) ORDER BY iu.created_at)
        FROM public.issue_updates iu
        WHERE iu.issue_id = i.id
      ), '[]'::jsonb)
    )
    INTO payload
    FROM public.issues i
    WHERE i.id = share_row.resource_id;

    RETURN payload;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_guest_share_payload(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_share_payload(text) TO anon, authenticated;
