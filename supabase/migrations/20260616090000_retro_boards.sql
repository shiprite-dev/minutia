-- Minutia Retro: anonymous ephemeral retro boards.
-- Tables are DEFAULT-DENY to anon/authenticated; all access is via SECURITY DEFINER
-- RPCs in 20260616091000_retro_rpcs.sql. Liveness is Realtime broadcast/presence (no table reads).

create table public.retro_boards (
  id                 uuid primary key default gen_random_uuid(),
  token              text not null unique default encode(gen_random_bytes(18), 'hex'),
  facilitator_token  text not null unique default encode(gen_random_bytes(18), 'hex'),
  name               text not null,
  template           text not null check (template in ('msg','ssc','4ls','fire')),
  columns            jsonb not null,
  phase              text not null default 'lobby'
                       check (phase in ('lobby','reflect','reveal','theme','vote','discuss','commit','closed')),
  phase_started_at   timestamptz,
  settings           jsonb not null default '{}'::jsonb,
  previous_board_id  uuid references public.retro_boards(id) on delete set null,
  saved_to_series_id uuid references public.meeting_series(id) on delete set null,
  claimed_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  expires_at         timestamptz not null default now() + interval '30 days'
);

create table public.retro_participants (
  id              uuid primary key default gen_random_uuid(),
  board_id        uuid not null references public.retro_boards(id) on delete cascade,
  participant_key text not null,
  name            text not null,
  color           text not null,
  is_facilitator  boolean not null default false,
  user_id         uuid references public.profiles(id) on delete set null,
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (board_id, participant_key)
);

create table public.retro_cards (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references public.retro_boards(id) on delete cascade,
  column_id   text not null,
  author_key  text not null,
  author_name text not null default '',
  color       text not null default 'sand',
  text        text not null check (char_length(text) <= 280),
  group_id    uuid,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.retro_votes (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references public.retro_boards(id) on delete cascade,
  card_id    uuid not null references public.retro_cards(id) on delete cascade,
  voter_key  text not null,
  created_at timestamptz not null default now(),
  unique (board_id, card_id, voter_key)
);

create table public.retro_actions (
  id                 uuid primary key default gen_random_uuid(),
  board_id           uuid not null references public.retro_boards(id) on delete cascade,
  text               text not null check (char_length(text) <= 280),
  owner_name         text not null default '',
  due                text not null default '',
  color              text not null default 'sand',
  source_card_id     uuid references public.retro_cards(id) on delete set null,
  graduated_issue_id uuid references public.issues(id) on delete set null,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now()
);

create index retro_boards_expires_idx on public.retro_boards (expires_at) where saved_to_series_id is null;
create index retro_participants_board_idx on public.retro_participants (board_id);
create index retro_cards_board_idx on public.retro_cards (board_id);
create index retro_votes_board_idx on public.retro_votes (board_id);
create index retro_actions_board_idx on public.retro_actions (board_id);

-- DEFAULT-DENY: enable RLS, add NO permissive policies. Only SECURITY DEFINER RPCs touch these.
alter table public.retro_boards       enable row level security;
alter table public.retro_participants enable row level security;
alter table public.retro_cards        enable row level security;
alter table public.retro_votes        enable row level security;
alter table public.retro_actions      enable row level security;

revoke all on public.retro_boards, public.retro_participants, public.retro_cards,
  public.retro_votes, public.retro_actions from anon, authenticated;

-- issues.source gains 'retro'
alter table public.issues drop constraint if exists issues_source_check;
alter table public.issues add constraint issues_source_check
  check (source in ('manual','transcript','email','api','ai_suggested','retro'));

-- availability flag (default off; cloud turns on). instance_config is key/value.
insert into public.instance_config (key, value)
  values ('retro_enabled', 'false')
  on conflict (key) do nothing;
