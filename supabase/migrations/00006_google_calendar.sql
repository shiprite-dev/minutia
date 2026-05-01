-- Google Calendar integration: OAuth token storage + series calendar linking

CREATE TABLE public.google_oauth_tokens (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token    text        NOT NULL,
  refresh_token   text        NOT NULL,
  token_iv        text        NOT NULL,
  refresh_iv      text        NOT NULL,
  token_expiry    timestamptz NOT NULL,
  google_email    text        NOT NULL,
  scopes          text[]      NOT NULL DEFAULT ARRAY['https://www.googleapis.com/auth/calendar.readonly'],
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_google_oauth_tokens_updated_at
  BEFORE UPDATE ON public.google_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own google token"
  ON public.google_oauth_tokens FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own google token"
  ON public.google_oauth_tokens FOR DELETE
  USING (auth.uid() = user_id);

ALTER TABLE public.meeting_series
  ADD COLUMN gcal_calendar_id  text,
  ADD COLUMN gcal_sync_enabled boolean NOT NULL DEFAULT false;
