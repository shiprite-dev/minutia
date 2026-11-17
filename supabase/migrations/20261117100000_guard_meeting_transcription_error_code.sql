-- Only the people who run a series (or the service role) may record why a
-- meeting's transcription failed. Any other participant's write to the column
-- is reset, so a participant cannot fake or hide a configuration failure.
create or replace function public.guard_meeting_transcription_error_code()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon')
     and new.transcription_error_code is distinct from old.transcription_error_code
     and not public.user_can_manage_series(new.series_id) then
    new.transcription_error_code := old.transcription_error_code;
  end if;
  return new;
end;
$$;

create trigger guard_meeting_transcription_error_code
  before update on public.meetings
  for each row execute function public.guard_meeting_transcription_error_code();
