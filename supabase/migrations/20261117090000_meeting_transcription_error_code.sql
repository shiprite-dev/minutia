-- Why the last transcription attempt failed (a machine code such as
-- transcription_unconfigured or no_api_key), so a meeting whose recording was
-- never transcribed can tell the viewer whether to retry or ask an administrator.
alter table public.meetings
  add column if not exists transcription_error_code text;
