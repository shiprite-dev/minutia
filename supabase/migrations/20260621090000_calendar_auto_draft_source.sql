-- issues.source gains 'calendar_auto_draft' for agenda items auto-drafted from a
-- synced Google Calendar event description (FRICTION-001 slice 2).
alter table public.issues drop constraint if exists issues_source_check;
alter table public.issues add constraint issues_source_check
  check (source in ('manual','transcript','email','api','ai_suggested','retro','calendar_auto_draft'));
