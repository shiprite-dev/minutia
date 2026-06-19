-- Minutia Retro: the terminal "ended" state. Distinct from "sealed" (phase='closed').
-- ended_at freezes the board: timer stops, presence/polling tear down, live
-- mutation is rejected for everyone, and the link resolves to a static summary.
-- A column (not a phase value) avoids the phases.ts <-> CHECK <-> verifier mirror.

alter table public.retro_boards add column ended_at timestamptz;

-- Internal guard: reject live mutation once the board is ended. Non-retryable.
-- retro_snapshot deliberately does NOT call this (the summary still loads).
create or replace function public._retro_assert_live(b public.retro_boards)
returns void language plpgsql security definer set search_path = public as $$
begin
  if b.ended_at is not null then
    raise exception 'retro: board ended' using errcode = '42501';
  end if;
end $$;

-- END (facilitator). Must seal first (phase='closed'). Idempotent: a second call
-- is a no-op that reports already_ended without re-writing ended_at.
create or replace function public.retro_end(p_ftoken text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  if b.phase <> 'closed' then
    raise exception 'retro: not sealed' using errcode = '22000';
  end if;
  if b.ended_at is not null then
    return jsonb_build_object('ok', true, 'already_ended', true, 'ended_at', b.ended_at);
  end if;
  update public.retro_boards set ended_at = now(), updated_at = now() where id = b.id
    returning ended_at into b.ended_at;
  return jsonb_build_object('ok', true, 'ended_at', b.ended_at);
end $$;

-- SNAPSHOT: add ended_at to the board object. Still returns ended boards so the
-- summary can load. (Redefined verbatim from 20260616091000 plus 'ended_at'.)
create or replace function public.retro_snapshot(p_token text, p_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; hide boolean;
begin
  b := public._retro_live_board(p_token);
  hide := (b.phase = 'reflect');
  return jsonb_build_object(
    'board', jsonb_build_object('id', b.id, 'name', b.name, 'template', b.template,
      'columns', b.columns, 'phase', b.phase, 'phase_started_at', b.phase_started_at,
      'settings', b.settings, 'saved_to_series_id', b.saved_to_series_id,
      'expires_at', b.expires_at, 'ended_at', b.ended_at),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('participant_key', participant_key,
      'name', name, 'color', color, 'is_facilitator', is_facilitator) order by created_at)
      from public.retro_participants where board_id = b.id), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'column_id', column_id,
      'author_key', case when hide and author_key is distinct from p_key then null else author_key end,
      'author_name', case when hide and author_key is distinct from p_key then '' else author_name end,
      'color', color,
      'text', case when hide and author_key is distinct from p_key then '' else text end,
      'group_id', group_id, 'sort_order', sort_order) order by sort_order, created_at)
      from public.retro_cards where board_id = b.id), '[]'::jsonb),
    'votes', coalesce((select jsonb_object_agg(card_id, n) from (
      select card_id, count(*) n from public.retro_votes where board_id = b.id group by card_id) t), '{}'::jsonb),
    'my_votes', coalesce((select jsonb_agg(card_id) from public.retro_votes
      where board_id = b.id and voter_key = p_key), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'text', text, 'owner_name', owner_name,
      'due', due, 'color', color, 'graduated_issue_id', graduated_issue_id) order by sort_order, created_at)
      from public.retro_actions where board_id = b.id), '[]'::jsonb),
    'carryover', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text, 'done', false))
      from public.retro_actions a where a.board_id = b.previous_board_id and a.graduated_issue_id is null), '[]'::jsonb)
  );
end $$;

-- Re-define every live-mutation RPC to assert the board is live after loading it.
-- (Bodies copied from 20260616091000_retro_rpcs.sql / 20260617090000 with one
--  added _retro_assert_live(b) call; create or replace preserves grants.)

create or replace function public.retro_join(p_token text, p_key text, p_name text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_live(b);
  if (select count(*) from public.retro_participants where board_id = b.id) >= 25
     and not exists (select 1 from public.retro_participants where board_id = b.id and participant_key = p_key) then
    raise exception 'retro: board full' using errcode = '53400';
  end if;
  insert into public.retro_participants (board_id, participant_key, name, color)
    values (b.id, p_key, left(p_name, 40), p_color)
    on conflict (board_id, participant_key) do update set name = excluded.name, color = excluded.color, last_seen_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_add_card(p_token text, p_key text, p_column text, p_text text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; c public.retro_cards; nm text;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_live(b); perform public._retro_assert_member(b.id, p_key);
  if char_length(coalesce(p_text,'')) = 0 or char_length(p_text) > 280 then
    raise exception 'retro: invalid card text' using errcode = '22000'; end if;
  if (select count(*) from public.retro_cards where board_id = b.id) >= 200 then
    raise exception 'retro: card limit' using errcode = '53400'; end if;
  if (select count(*) from public.retro_cards where board_id = b.id and author_key = p_key
      and created_at > now() - interval '1 minute') >= 12 then
    raise exception 'retro: slow down' using errcode = '53400'; end if;
  select name into nm from public.retro_participants where board_id = b.id and participant_key = p_key;
  insert into public.retro_cards (board_id, column_id, author_key, author_name, color, text)
    values (b.id, p_column, p_key, coalesce(nm,''), p_color, p_text) returning * into c;
  return to_jsonb(c);
end $$;

create or replace function public.retro_update_card(p_token text, p_key text, p_card uuid, p_text text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_live(b); perform public._retro_assert_member(b.id, p_key);
  if char_length(coalesce(p_text,'')) = 0 or char_length(p_text) > 280 then
    raise exception 'retro: invalid card text' using errcode = '22000'; end if;
  update public.retro_cards set text = p_text, color = p_color, updated_at = now()
    where id = p_card and board_id = b.id and author_key = p_key;
  if not found then raise exception 'retro: not your card' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_delete_card(p_token text, p_key text, p_card uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_live(b); perform public._retro_assert_member(b.id, p_key);
  delete from public.retro_cards where id = p_card and board_id = b.id and author_key = p_key;
  if not found then raise exception 'retro: not your card' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_vote(p_token text, p_key text, p_card uuid, p_delta int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_live(b); perform public._retro_assert_member(b.id, p_key);
  if p_delta not in (1, -1) then raise exception 'retro: invalid delta' using errcode = '22000'; end if;
  if p_delta > 0 then
    if (select count(*) from public.retro_votes where board_id = b.id and voter_key = p_key) >= 6 then
      raise exception 'retro: out of votes' using errcode = '53400'; end if;
    insert into public.retro_votes (board_id, card_id, voter_key) values (b.id, p_card, p_key)
      on conflict (board_id, card_id, voter_key) do nothing;
  else
    delete from public.retro_votes where board_id = b.id and card_id = p_card and voter_key = p_key;
  end if;
  return jsonb_build_object('count', (select count(*) from public.retro_votes where board_id = b.id and card_id = p_card));
end $$;

create or replace function public.retro_set_card_group(p_ftoken text, p_card_ids uuid[], p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken); perform public._retro_assert_live(b);
  if coalesce(array_length(p_card_ids, 1), 0) > 200 then
    raise exception 'retro: too many cards' using errcode = '22000'; end if;
  update public.retro_cards set group_id = p_group, updated_at = now()
    where board_id = b.id and id = any(p_card_ids);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_set_phase(p_ftoken text, p_phase text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.retro_boards;
  -- Ordered ritual (mirror of src/lib/retro/phases.ts ALL_RETRO_PHASES). The
  -- retro only ever moves forward: lobby -> reflect -> reveal -> discuss ->
  -- commit -> closed. verify-retro-contracts guards this array against drift.
  ord text[] := array['lobby', 'reflect', 'reveal', 'discuss', 'commit', 'closed'];
  new_idx int; cur_idx int;
begin
  b := public._retro_assert_facilitator(p_ftoken); perform public._retro_assert_live(b);
  new_idx := array_position(ord, p_phase);
  if new_idx is null then raise exception 'retro: bad phase' using errcode = '22000'; end if;
  cur_idx := array_position(ord, b.phase);
  -- Monotonic forward only. Rapid or double "Advance" clicks fire concurrent
  -- set_phase RPCs that can commit out of order; without this guard a late
  -- "set discuss" could overwrite an earlier "set commit" and strand the board a
  -- phase behind (the symptom). Ignoring any earlier-or-equal target makes the
  -- board converge on the highest requested phase regardless of commit order.
  if new_idx <= cur_idx then
    return jsonb_build_object('ok', true, 'phase', b.phase, 'noop', true);
  end if;
  update public.retro_boards set phase = p_phase, phase_started_at = now(), updated_at = now() where id = b.id;
  return jsonb_build_object('ok', true, 'phase', p_phase);
end $$;

create or replace function public.retro_add_action(p_ftoken text, p_text text, p_owner text, p_due text, p_color text, p_source uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; a public.retro_actions;
begin
  b := public._retro_assert_facilitator(p_ftoken); perform public._retro_assert_live(b);
  insert into public.retro_actions (board_id, text, owner_name, due, color, source_card_id)
    values (b.id, left(p_text,280), left(coalesce(p_owner,''),80), left(coalesce(p_due,''),40), coalesce(p_color,'sand'), p_source)
    returning * into a;
  return to_jsonb(a);
end $$;

create or replace function public.retro_update_action(p_ftoken text, p_action uuid, p_text text, p_owner text, p_due text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken); perform public._retro_assert_live(b);
  update public.retro_actions set text = left(p_text,280), owner_name = left(coalesce(p_owner,''),80), due = left(coalesce(p_due,''),40)
    where id = p_action and board_id = b.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_delete_action(p_ftoken text, p_action uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken); perform public._retro_assert_live(b);
  delete from public.retro_actions where id = p_action and board_id = b.id;
  return jsonb_build_object('ok', true);
end $$;

-- New helper is internal only; new public RPC is granted to clients.
revoke all on function public._retro_assert_live(public.retro_boards) from public, anon, authenticated;
grant execute on function public.retro_end(text) to anon, authenticated;
