create table public.companion_web_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  handoff_digest text not null unique,
  nonce_digest text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index companion_web_handoffs_user_id_idx on public.companion_web_handoffs (user_id);

alter table public.companion_web_handoffs enable row level security;

revoke all on table public.companion_web_handoffs from public, anon, authenticated;
grant select, insert, update, delete on table public.companion_web_handoffs to service_role;

-- Spends a handoff exactly once: concurrent redemptions race on used_at is null and only one sees true.
create or replace function public.claim_companion_web_handoff(p_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  with claimed as (
    update public.companion_web_handoffs
       set used_at = now()
     where id = p_id
       and used_at is null
       and created_at > now() - interval '10 minutes'
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.claim_companion_web_handoff(uuid) from public, anon, authenticated;
grant execute on function public.claim_companion_web_handoff(uuid) to service_role;
