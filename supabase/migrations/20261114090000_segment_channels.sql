alter table public.meeting_audio_segments
  add column if not exists them_storage_path text,
  add column if not exists offset_seconds double precision,
  add column if not exists transcript_segments jsonb,
  add column if not exists recorded_by uuid default auth.uid() references auth.users(id) on delete set null;
