-- Add missing columns to decisions table
-- The TypeScript type and insert hook reference created_by and updated_at,
-- but the original schema omitted them.

ALTER TABLE public.decisions
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill created_by from the series owner where possible
UPDATE public.decisions d
SET created_by = ms.owner_id
FROM public.meeting_series ms
WHERE d.series_id = ms.id
  AND d.created_by IS NULL;

-- Now make it NOT NULL (safe after backfill)
ALTER TABLE public.decisions
  ALTER COLUMN created_by SET NOT NULL;
