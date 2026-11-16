alter table public.meetings
  add column if not exists transcript_language text,
  add column if not exists transcription_source jsonb;
