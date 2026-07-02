-- =============================================================================
-- Diarized transcript: speaker-labelled segments + resolved speaker map.
-- Additive and backward compatible. transcript_raw stays the flattened text.
-- =============================================================================

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS transcript_segments jsonb,
  ADD COLUMN IF NOT EXISTS transcript_diarized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS speaker_map jsonb;

COMMENT ON COLUMN public.meetings.transcript_segments IS
  'Ordered array of {speaker,start,end,text,confidence}; source of truth for the diarized view.';
COMMENT ON COLUMN public.meetings.speaker_map IS
  'Resolves provider speaker labels to attendee names: { "A": "Sarah Lee", "B": null }.';
