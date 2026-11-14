-- ---------------------------------------------------------------------------
-- Meeting-level transcription outcome: distinguish confirmed silence from
-- unknown emptiness.
--
-- Per-segment outcomes exist, but the meeting had no meeting-level signal, so a
-- committed empty transcript could not be told apart from a recording whose
-- emptiness was never explained. Additive only: there is no backfill, so every
-- existing row stays null (unknown).
-- ---------------------------------------------------------------------------

alter table public.meetings
  add column transcription_outcome text
  check (transcription_outcome in ('speech', 'no_speech'));

comment on column public.meetings.transcription_outcome is
  'Meeting-level transcription outcome. null means unknown and must never be rendered as silence.';
