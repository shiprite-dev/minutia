-- Google Calendar agenda sync: user-owned calendar events linked to Minutia series.

ALTER TABLE public.meeting_series
  ADD COLUMN IF NOT EXISTS gcal_series_key text,
  ADD COLUMN IF NOT EXISTS gcal_series_kind text CHECK (gcal_series_kind IS NULL OR gcal_series_kind IN ('recurring', 'adhoc')),
  ADD COLUMN IF NOT EXISTS gcal_last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_series_gcal_owner_key
  ON public.meeting_series(owner_id, gcal_series_key)
  WHERE gcal_series_key IS NOT NULL;

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS gcal_meeting_key text,
  ADD COLUMN IF NOT EXISTS gcal_calendar_id text,
  ADD COLUMN IF NOT EXISTS gcal_event_id text,
  ADD COLUMN IF NOT EXISTS gcal_original_start_time text,
  ADD COLUMN IF NOT EXISTS gcal_meeting_url text,
  ADD COLUMN IF NOT EXISTS gcal_html_link text,
  ADD COLUMN IF NOT EXISTS gcal_last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_gcal_series_meeting_key
  ON public.meetings(series_id, gcal_meeting_key)
  WHERE gcal_meeting_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.google_calendar_events (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  series_id           uuid        NOT NULL REFERENCES public.meeting_series(id) ON DELETE CASCADE,
  meeting_id          uuid        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  calendar_id         text        NOT NULL,
  event_id            text        NOT NULL,
  i_cal_uid           text,
  recurring_event_id  text,
  original_start_time text,
  series_key          text        NOT NULL,
  meeting_key         text        NOT NULL,
  series_kind         text        NOT NULL CHECK (series_kind IN ('recurring', 'adhoc')),
  summary             text        NOT NULL,
  description         text,
  start_at            timestamptz NOT NULL,
  end_at              timestamptz NOT NULL,
  html_link           text,
  meeting_url         text,
  attendee_emails     text[]      NOT NULL DEFAULT '{}',
  organizer_email     text,
  event_type          text        NOT NULL DEFAULT 'default',
  event_status        text        NOT NULL DEFAULT 'confirmed',
  last_synced_at      timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, calendar_id, event_id)
);

DROP TRIGGER IF EXISTS set_google_calendar_events_updated_at ON public.google_calendar_events;
CREATE TRIGGER set_google_calendar_events_updated_at
  BEFORE UPDATE ON public.google_calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_google_calendar_events_user_start
  ON public.google_calendar_events(user_id, start_at);

CREATE INDEX IF NOT EXISTS idx_google_calendar_events_series
  ON public.google_calendar_events(series_id);

ALTER TABLE public.google_calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_calendar_events_select_own" ON public.google_calendar_events;
CREATE POLICY "google_calendar_events_select_own"
  ON public.google_calendar_events FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "google_calendar_events_delete_own" ON public.google_calendar_events;
CREATE POLICY "google_calendar_events_delete_own"
  ON public.google_calendar_events FOR DELETE
  USING (auth.uid() = user_id);
