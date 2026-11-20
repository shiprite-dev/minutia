alter table public.meetings
  add column if not exists suggestions_status text,
  add column if not exists suggestions_reason text,
  add column if not exists suggestions_status_at timestamptz;

alter table public.meetings
  drop constraint if exists meetings_suggestions_status_check;
alter table public.meetings
  add constraint meetings_suggestions_status_check
  check (suggestions_status is null or suggestions_status in ('pending', 'ready', 'failed', 'skipped'));
