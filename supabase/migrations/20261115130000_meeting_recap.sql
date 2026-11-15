ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS recap_markdown text,
  ADD COLUMN IF NOT EXISTS recap_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS recap_model text;

ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_recap_markdown_length
  CHECK (recap_markdown IS NULL OR char_length(recap_markdown) <= 100000);
