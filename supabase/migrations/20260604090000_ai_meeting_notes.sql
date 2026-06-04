ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS raw_notes_markdown text,
  ADD COLUMN IF NOT EXISTS ai_notes_markdown text,
  ADD COLUMN IF NOT EXISTS ai_notes_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_notes_model text,
  ADD COLUMN IF NOT EXISTS ai_notes_prompt_version text;

UPDATE public.meetings
SET raw_notes_markdown = notes_markdown
WHERE raw_notes_markdown IS NULL;

ALTER TABLE public.meetings
  ALTER COLUMN raw_notes_markdown SET DEFAULT '';

UPDATE public.meetings
SET raw_notes_markdown = ''
WHERE raw_notes_markdown IS NULL;
