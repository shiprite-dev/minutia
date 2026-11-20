create or replace function public.user_manages_suggestion_series(p_series_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.meeting_series
     where id = p_series_id and owner_id = auth.uid()
  ) or exists (
    select 1 from public.series_participants
     where series_id = p_series_id
       and user_id = auth.uid()
       and role in ('owner', 'facilitator')
  );
$$;

-- Keeping a suggestion is one transaction: the row lock makes a second keep wait and then see it reviewed,
-- and any failure after the board write rolls the board write back.
create or replace function public.keep_ai_suggestion(
  p_suggestion_id uuid,
  p_meeting_id uuid,
  p_title text,
  p_details text,
  p_category text,
  p_owner_name text,
  p_issue_owner_name text,
  p_owner_user_id uuid,
  p_due_date date,
  p_target_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_suggestion public.meeting_ai_suggestions%rowtype;
  v_existing public.issues%rowtype;
  v_target text;
  v_note text;
  v_created_issue uuid;
  v_created_decision uuid;
begin
  select * into v_suggestion
    from public.meeting_ai_suggestions
   where id = p_suggestion_id
     and meeting_id = p_meeting_id
     and status = 'pending'
   for update;
  if not found then
    return jsonb_build_object('code', 'already_reviewed');
  end if;

  if not public.user_manages_suggestion_series(v_suggestion.series_id) then
    return jsonb_build_object('code', 'not_reviewer');
  end if;

  if v_suggestion.type = 'duplicate_warning' then
    return jsonb_build_object('code', 'cannot_keep_duplicate');
  end if;

  v_note := coalesce(nullif(p_details, ''), nullif(v_suggestion.source_excerpt, ''), '');

  if v_suggestion.type = 'status_update' then
    v_target := coalesce(p_target_status, v_suggestion.suggested_status);
    if v_suggestion.related_issue_number is null then
      return jsonb_build_object('code', 'not_linked');
    end if;
    if v_target is null then
      return jsonb_build_object('code', 'no_target_status');
    end if;

    select * into v_existing
      from public.issues
     where series_id = v_suggestion.series_id
       and issue_number = v_suggestion.related_issue_number
     for update;
    if not found then
      return jsonb_build_object('code', 'item_gone');
    end if;
    if v_existing.status = v_target then
      return jsonb_build_object('code', 'already_in_state');
    end if;

    update public.issues
       set status = v_target,
           resolved_in_meeting_id = case when v_target = 'resolved' then p_meeting_id else null end
     where id = v_existing.id;

    insert into public.issue_updates (issue_id, meeting_id, updated_by, author_type, previous_status, new_status, note)
    values (v_existing.id, p_meeting_id, auth.uid(), 'ai', v_existing.status, v_target, v_note);

    v_created_issue := v_existing.id;
  elsif p_category = 'decision' then
    insert into public.decisions (meeting_id, series_id, title, rationale, made_by, source, created_by)
    values (p_meeting_id, v_suggestion.series_id, p_title, v_note, p_owner_name, 'ai_suggested', auth.uid())
    returning id into v_created_decision;
  else
    insert into public.issues (
      series_id, raised_in_meeting_id, title, description, category, priority,
      owner_name, owner_user_id, due_date, status, source, ai_confidence
    )
    values (
      v_suggestion.series_id, p_meeting_id, p_title, v_note, p_category, 'medium',
      p_issue_owner_name, p_owner_user_id, p_due_date, 'open', 'ai_suggested', v_suggestion.confidence
    )
    returning id into v_created_issue;
  end if;

  update public.meeting_ai_suggestions
     set title = p_title,
         details = p_details,
         category = p_category,
         owner_name = p_owner_name,
         due_date = p_due_date,
         suggested_status = case when v_suggestion.type = 'status_update' then v_target else suggested_status end,
         status = 'accepted',
         reviewed_at = now(),
         created_issue_id = v_created_issue,
         created_decision_id = v_created_decision
   where id = p_suggestion_id
  returning * into v_suggestion;

  return jsonb_build_object('code', 'saved', 'suggestion', to_jsonb(v_suggestion));
end;
$$;

revoke all on function public.user_manages_suggestion_series(uuid) from public, anon;
revoke all on function public.keep_ai_suggestion(uuid, uuid, text, text, text, text, text, uuid, date, text) from public, anon;
grant execute on function public.user_manages_suggestion_series(uuid) to authenticated;
grant execute on function public.keep_ai_suggestion(uuid, uuid, text, text, text, text, text, uuid, date, text) to authenticated;
