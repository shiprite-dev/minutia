ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS companion_notes_markdown text NOT NULL DEFAULT '';

ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_companion_notes_length CHECK (char_length(companion_notes_markdown) <= 100000);
