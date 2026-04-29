-- =============================================================================
-- Minutia: Initial Schema
-- =============================================================================
-- This migration creates the complete database schema for Minutia,
-- a meeting issue tracker. All tables use text + CHECK constraints
-- instead of enums for easier migration. AI-ready fields (source,
-- author_type, ai_confidence) are included from day one.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Utility: updated_at trigger function
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. Profile creation trigger function (runs on auth.users insert)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- TABLES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- profiles (extends auth.users)
-- ---------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  name        text        NOT NULL DEFAULT '',
  avatar_url  text,
  settings    jsonb       NOT NULL DEFAULT '{"ai_enabled": false, "theme": "system"}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- meeting_series
-- ---------------------------------------------------------------------------
CREATE TABLE public.meeting_series (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text        NOT NULL,
  description         text        NOT NULL DEFAULT '',
  cadence             text        NOT NULL DEFAULT 'weekly'
                                  CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'adhoc')),
  default_attendees   text[]      NOT NULL DEFAULT '{}',
  ai_features_enabled boolean     NOT NULL DEFAULT false,
  owner_id            uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_meeting_series_updated_at
  BEFORE UPDATE ON public.meeting_series
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- meetings
-- ---------------------------------------------------------------------------
CREATE TABLE public.meetings (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id       uuid        NOT NULL REFERENCES public.meeting_series(id) ON DELETE CASCADE,
  sequence_number integer     NOT NULL,
  title           text        NOT NULL,
  date            date        NOT NULL DEFAULT CURRENT_DATE,
  attendees       text[]      NOT NULL DEFAULT '{}',
  status          text        NOT NULL DEFAULT 'upcoming'
                              CHECK (status IN ('upcoming', 'live', 'completed')),
  notes_markdown  text        NOT NULL DEFAULT '',
  transcript_raw  text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,

  UNIQUE (series_id, sequence_number)
);

-- ---------------------------------------------------------------------------
-- issues (the core entity)
-- ---------------------------------------------------------------------------
CREATE TABLE public.issues (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id             uuid        NOT NULL REFERENCES public.meeting_series(id) ON DELETE CASCADE,
  raised_in_meeting_id  uuid        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  title                 text        NOT NULL,
  description           text        NOT NULL DEFAULT '',
  category              text        NOT NULL DEFAULT 'action'
                                    CHECK (category IN ('action', 'decision', 'info', 'risk', 'blocker')),
  status                text        NOT NULL DEFAULT 'open'
                                    CHECK (status IN ('open', 'in_progress', 'pending', 'resolved', 'dropped')),
  priority              text        NOT NULL DEFAULT 'medium'
                                    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  owner_name            text        NOT NULL DEFAULT '',
  owner_user_id         uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_date              date,
  resolved_in_meeting_id uuid       REFERENCES public.meetings(id) ON DELETE SET NULL,
  source                text        NOT NULL DEFAULT 'manual'
                                    CHECK (source IN ('manual', 'transcript', 'email', 'api', 'ai_suggested')),
  ai_confidence         real        CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)),
  sort_order            integer     NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_issues_updated_at
  BEFORE UPDATE ON public.issues
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- issue_updates (audit trail)
-- ---------------------------------------------------------------------------
CREATE TABLE public.issue_updates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id        uuid        NOT NULL REFERENCES public.issues(id) ON DELETE CASCADE,
  meeting_id      uuid        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  previous_status text,
  new_status      text,
  note            text        NOT NULL DEFAULT '',
  author_type     text        NOT NULL DEFAULT 'human'
                              CHECK (author_type IN ('human', 'ai', 'system')),
  updated_by      text        NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- decisions (permanent, non-closeable)
-- ---------------------------------------------------------------------------
CREATE TABLE public.decisions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id  uuid        NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  series_id   uuid        NOT NULL REFERENCES public.meeting_series(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  rationale   text        NOT NULL DEFAULT '',
  made_by     text        NOT NULL DEFAULT '',
  source      text        NOT NULL DEFAULT 'manual'
                          CHECK (source IN ('manual', 'transcript', 'ai_suggested')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- guest_shares (read-only external access)
-- ---------------------------------------------------------------------------
CREATE TABLE public.guest_shares (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type  text        NOT NULL CHECK (resource_type IN ('meeting', 'series', 'issue')),
  resource_id    uuid        NOT NULL,
  token          text        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at     timestamptz,
  permissions    text        NOT NULL DEFAULT 'view'
                             CHECK (permissions IN ('view', 'comment')),
  accessed_count integer     NOT NULL DEFAULT 0,
  created_by     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- issues
CREATE INDEX idx_issues_series_id            ON public.issues (series_id);
CREATE INDEX idx_issues_status               ON public.issues (status);
CREATE INDEX idx_issues_owner_user_id        ON public.issues (owner_user_id);
CREATE INDEX idx_issues_raised_in_meeting_id ON public.issues (raised_in_meeting_id);

-- issue_updates
CREATE INDEX idx_issue_updates_issue_id   ON public.issue_updates (issue_id);
CREATE INDEX idx_issue_updates_meeting_id ON public.issue_updates (meeting_id);

-- meetings
CREATE INDEX idx_meetings_series_id ON public.meetings (series_id);
CREATE INDEX idx_meetings_status    ON public.meetings (status);

-- decisions
CREATE INDEX idx_decisions_meeting_id ON public.decisions (meeting_id);
CREATE INDEX idx_decisions_series_id  ON public.decisions (series_id);

-- guest_shares
CREATE INDEX idx_guest_shares_token    ON public.guest_shares (token);
CREATE INDEX idx_guest_shares_resource ON public.guest_shares (resource_type, resource_id);

-- =============================================================================
-- AUTH TRIGGER: auto-create profile on signup
-- =============================================================================

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issues         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issue_updates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decisions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_shares   ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- profiles: users can read and update their own profile
-- ---------------------------------------------------------------------------
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Insert is handled by the handle_new_user trigger (SECURITY DEFINER),
-- so no INSERT policy is needed for regular users.

-- ---------------------------------------------------------------------------
-- meeting_series: owner can CRUD
-- ---------------------------------------------------------------------------
CREATE POLICY "meeting_series_select_owner"
  ON public.meeting_series FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "meeting_series_insert_owner"
  ON public.meeting_series FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "meeting_series_update_owner"
  ON public.meeting_series FOR UPDATE
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "meeting_series_delete_owner"
  ON public.meeting_series FOR DELETE
  USING (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- meetings: user can CRUD meetings in series they own
-- ---------------------------------------------------------------------------
CREATE POLICY "meetings_select_owner"
  ON public.meetings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = meetings.series_id
        AND ms.owner_id = auth.uid()
    )
  );

CREATE POLICY "meetings_insert_owner"
  ON public.meetings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = meetings.series_id
        AND ms.owner_id = auth.uid()
    )
  );

CREATE POLICY "meetings_update_owner"
  ON public.meetings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = meetings.series_id
        AND ms.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = meetings.series_id
        AND ms.owner_id = auth.uid()
    )
  );

CREATE POLICY "meetings_delete_owner"
  ON public.meetings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = meetings.series_id
        AND ms.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- issues: user can CRUD issues in series they own
-- ---------------------------------------------------------------------------
CREATE POLICY "issues_select_owner"
  ON public.issues FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = issues.series_id
        AND ms.owner_id = auth.uid()
    )
  );

CREATE POLICY "issues_insert_owner"
  ON public.issues FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = issues.series_id
        AND ms.owner_id = auth.uid()
    )
  );

CREATE POLICY "issues_update_owner"
  ON public.issues FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = issues.series_id
        AND ms.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = issues.series_id
        AND ms.owner_id = auth.uid()
    )
  );

CREATE POLICY "issues_delete_owner"
  ON public.issues FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = issues.series_id
        AND ms.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- issue_updates: user can read and insert updates for issues in series they own
-- ---------------------------------------------------------------------------
CREATE POLICY "issue_updates_select_owner"
  ON public.issue_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.issues i
      JOIN public.meeting_series ms ON ms.id = i.series_id
      WHERE i.id = issue_updates.issue_id
        AND ms.owner_id = auth.uid()
    )
  );

CREATE POLICY "issue_updates_insert_owner"
  ON public.issue_updates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.issues i
      JOIN public.meeting_series ms ON ms.id = i.series_id
      WHERE i.id = issue_updates.issue_id
        AND ms.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- decisions: user can CRUD decisions in meetings they own (via series)
-- ---------------------------------------------------------------------------
CREATE POLICY "decisions_select_owner"
  ON public.decisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = decisions.series_id
        AND ms.owner_id = auth.uid()
    )
  );

CREATE POLICY "decisions_insert_owner"
  ON public.decisions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = decisions.series_id
        AND ms.owner_id = auth.uid()
    )
  );

CREATE POLICY "decisions_update_owner"
  ON public.decisions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = decisions.series_id
        AND ms.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = decisions.series_id
        AND ms.owner_id = auth.uid()
    )
  );

CREATE POLICY "decisions_delete_owner"
  ON public.decisions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = decisions.series_id
        AND ms.owner_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- guest_shares: creator can CRUD (token-based access handled at API level)
-- ---------------------------------------------------------------------------
CREATE POLICY "guest_shares_select_creator"
  ON public.guest_shares FOR SELECT
  USING (auth.uid() = created_by);

CREATE POLICY "guest_shares_insert_creator"
  ON public.guest_shares FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "guest_shares_update_creator"
  ON public.guest_shares FOR UPDATE
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "guest_shares_delete_creator"
  ON public.guest_shares FOR DELETE
  USING (auth.uid() = created_by);
