-- Google Calendar push notification channels for request-light agenda sync wakeups.

CREATE TABLE IF NOT EXISTS public.google_calendar_watch_channels (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id          uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  calendar_id              text        NOT NULL,
  channel_id               text        NOT NULL UNIQUE,
  channel_token_hash       text        NOT NULL,
  resource_id              text,
  resource_uri             text,
  status                   text        NOT NULL DEFAULT 'creating'
                                      CHECK (status IN ('creating', 'active', 'failed', 'stopped', 'expired')),
  expiration_at            timestamptz,
  last_message_number      bigint,
  last_resource_state      text,
  last_notification_at     timestamptz,
  last_renewed_at          timestamptz,
  error_message            text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS set_google_calendar_watch_channels_updated_at ON public.google_calendar_watch_channels;
CREATE TRIGGER set_google_calendar_watch_channels_updated_at
  BEFORE UPDATE ON public.google_calendar_watch_channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_google_calendar_watch_channels_user_org_calendar
  ON public.google_calendar_watch_channels(user_id, organization_id, calendar_id, status);

CREATE INDEX IF NOT EXISTS idx_google_calendar_watch_channels_resource
  ON public.google_calendar_watch_channels(resource_id)
  WHERE resource_id IS NOT NULL;

ALTER TABLE public.google_calendar_watch_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_calendar_watch_channels_select_own" ON public.google_calendar_watch_channels;
CREATE POLICY "google_calendar_watch_channels_select_own"
  ON public.google_calendar_watch_channels FOR SELECT
  USING (auth.uid() = user_id);
