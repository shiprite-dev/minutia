-- All functions: SECURITY DEFINER, search_path pinned. Anon calls these; never the tables.

-- Internal helper: resolve a live board by token (raises on missing/expired).
create or replace function public._retro_live_board(p_token text)
returns public.retro_boards language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  select * into b from public.retro_boards where token = p_token;
  if b.id is null then raise exception 'retro: board not found' using errcode = 'P0002'; end if;
  if b.saved_to_series_id is null and b.expires_at <= now() then
    raise exception 'retro: board expired' using errcode = 'P0001';
  end if;
  return b;
end $$;

create or replace function public._retro_assert_member(p_board uuid, p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.retro_participants where board_id = p_board and participant_key = p_key) then
    raise exception 'retro: not a participant' using errcode = '42501';
  end if;
end $$;

create or replace function public._retro_assert_facilitator(p_token text)
returns public.retro_boards language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  select * into b from public.retro_boards where facilitator_token = p_token;
  if b.id is null then raise exception 'retro: bad facilitator token' using errcode = '42501'; end if;
  return b;
end $$;

-- CREATE: returns secrets to the creator only.
create or replace function public.retro_create(
  p_name text, p_template text, p_columns jsonb,
  p_facilitator_name text, p_facilitator_color text, p_participant_key text,
  p_previous_token text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; prev uuid;
begin
  if char_length(coalesce(p_name,'')) = 0 or char_length(p_name) > 120 then
    raise exception 'retro: invalid name' using errcode = '22000';
  end if;
  -- global abuse cap: max boards created in the last minute
  if (select count(*) from public.retro_boards where created_at > now() - interval '1 minute') > 60 then
    raise exception 'retro: rate limited' using errcode = '53400';
  end if;
  if p_previous_token is not null then select id into prev from public.retro_boards where token = p_previous_token; end if;
  insert into public.retro_boards (name, template, columns, previous_board_id)
    values (p_name, p_template, p_columns, prev) returning * into b;
  insert into public.retro_participants (board_id, participant_key, name, color, is_facilitator)
    values (b.id, p_participant_key, p_facilitator_name, p_facilitator_color, true);
  return jsonb_build_object('board_id', b.id, 'token', b.token,
    'facilitator_token', b.facilitator_token, 'participant_key', p_participant_key);
end $$;

-- SNAPSHOT: full board state. Carryover = open actions from previous board chain.
create or replace function public.retro_snapshot(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token);
  return jsonb_build_object(
    'board', jsonb_build_object('id', b.id, 'name', b.name, 'template', b.template,
      'columns', b.columns, 'phase', b.phase, 'phase_started_at', b.phase_started_at,
      'settings', b.settings, 'saved_to_series_id', b.saved_to_series_id, 'expires_at', b.expires_at),
    'participants', coalesce((select jsonb_agg(jsonb_build_object('participant_key', participant_key,
      'name', name, 'color', color, 'is_facilitator', is_facilitator) order by created_at)
      from public.retro_participants where board_id = b.id), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'column_id', column_id,
      'author_key', author_key, 'author_name', author_name, 'color', color, 'text', text,
      'group_id', group_id, 'sort_order', sort_order) order by sort_order, created_at)
      from public.retro_cards where board_id = b.id), '[]'::jsonb),
    'votes', coalesce((select jsonb_object_agg(card_id, n) from (
      select card_id, count(*) n from public.retro_votes where board_id = b.id group by card_id) t), '{}'::jsonb),
    'my_votes', '[]'::jsonb,
    'actions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'text', text, 'owner_name', owner_name,
      'due', due, 'color', color, 'graduated_issue_id', graduated_issue_id) order by sort_order, created_at)
      from public.retro_actions where board_id = b.id), '[]'::jsonb),
    'carryover', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'text', a.text, 'done', false))
      from public.retro_actions a where a.board_id = b.previous_board_id), '[]'::jsonb)
  );
end $$;

-- JOIN
create or replace function public.retro_join(p_token text, p_key text, p_name text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token);
  if (select count(*) from public.retro_participants where board_id = b.id) >= 25
     and not exists (select 1 from public.retro_participants where board_id = b.id and participant_key = p_key) then
    raise exception 'retro: board full' using errcode = '53400';
  end if;
  insert into public.retro_participants (board_id, participant_key, name, color)
    values (b.id, p_key, left(p_name, 40), p_color)
    on conflict (board_id, participant_key) do update set name = excluded.name, color = excluded.color, last_seen_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ADD CARD (caps: 200/board, 12/participant/min)
create or replace function public.retro_add_card(p_token text, p_key text, p_column text, p_text text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; c public.retro_cards; nm text;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_member(b.id, p_key);
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

-- UPDATE / DELETE own card
create or replace function public.retro_update_card(p_token text, p_key text, p_card uuid, p_text text, p_color text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_member(b.id, p_key);
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
  b := public._retro_live_board(p_token); perform public._retro_assert_member(b.id, p_key);
  delete from public.retro_cards where id = p_card and board_id = b.id and author_key = p_key;
  if not found then raise exception 'retro: not your card' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- VOTE (delta +1/-1, per-voter budget: max 6 dots/board)
create or replace function public.retro_vote(p_token text, p_key text, p_card uuid, p_delta int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_live_board(p_token); perform public._retro_assert_member(b.id, p_key);
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

-- THEME clustering (facilitator)
create or replace function public.retro_set_card_group(p_ftoken text, p_card_ids uuid[], p_group uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  update public.retro_cards set group_id = p_group, updated_at = now()
    where board_id = b.id and id = any(p_card_ids);
  return jsonb_build_object('ok', true);
end $$;

-- PHASE (facilitator)
create or replace function public.retro_set_phase(p_ftoken text, p_phase text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  if p_phase not in ('lobby','reflect','reveal','theme','vote','discuss','commit','closed') then
    raise exception 'retro: bad phase' using errcode = '22000'; end if;
  update public.retro_boards set phase = p_phase, phase_started_at = now(), updated_at = now() where id = b.id;
  return jsonb_build_object('ok', true, 'phase', p_phase);
end $$;

-- ACTIONS (facilitator)
create or replace function public.retro_add_action(p_ftoken text, p_text text, p_owner text, p_due text, p_color text, p_source uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards; a public.retro_actions;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  insert into public.retro_actions (board_id, text, owner_name, due, color, source_card_id)
    values (b.id, left(p_text,280), left(coalesce(p_owner,''),80), left(coalesce(p_due,''),40), coalesce(p_color,'sand'), p_source)
    returning * into a;
  return to_jsonb(a);
end $$;

create or replace function public.retro_update_action(p_ftoken text, p_action uuid, p_text text, p_owner text, p_due text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  update public.retro_actions set text = left(p_text,280), owner_name = left(coalesce(p_owner,''),80), due = left(coalesce(p_due,''),40)
    where id = p_action and board_id = b.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retro_delete_action(p_ftoken text, p_action uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.retro_boards;
begin
  b := public._retro_assert_facilitator(p_ftoken);
  delete from public.retro_actions where id = p_action and board_id = b.id;
  return jsonb_build_object('ok', true);
end $$;

-- grants: only EXECUTE on the public RPCs (helpers stay internal).
grant execute on function
  public.retro_create(text,text,jsonb,text,text,text,text),
  public.retro_snapshot(text),
  public.retro_join(text,text,text,text),
  public.retro_add_card(text,text,text,text,text),
  public.retro_update_card(text,text,uuid,text,text),
  public.retro_delete_card(text,text,uuid),
  public.retro_vote(text,text,uuid,int),
  public.retro_set_card_group(text,uuid[],uuid),
  public.retro_set_phase(text,text),
  public.retro_add_action(text,text,text,text,text,uuid),
  public.retro_update_action(text,uuid,text,text,text),
  public.retro_delete_action(text,uuid)
  to anon, authenticated;
