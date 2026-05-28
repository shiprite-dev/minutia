ALTER TABLE public.issues
  ADD COLUMN issue_number integer;

WITH numbered AS (
  SELECT
    id,
    row_number() OVER (ORDER BY created_at, id)::integer AS issue_number
  FROM public.issues
)
UPDATE public.issues i
SET issue_number = numbered.issue_number
FROM numbered
WHERE numbered.id = i.id;

CREATE SEQUENCE public.issues_issue_number_seq;

SELECT setval(
  'public.issues_issue_number_seq',
  COALESCE((SELECT max(issue_number) FROM public.issues), 0) + 1,
  false
);

ALTER SEQUENCE public.issues_issue_number_seq
  OWNED BY public.issues.issue_number;

ALTER TABLE public.issues
  ALTER COLUMN issue_number SET DEFAULT nextval('public.issues_issue_number_seq'),
  ALTER COLUMN issue_number SET NOT NULL;

CREATE UNIQUE INDEX issues_issue_number_key
  ON public.issues (issue_number);
