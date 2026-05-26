-- Multi-tenant organizations, organization RBAC, and invitations.

CREATE TABLE public.organizations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL CHECK (char_length(trim(name)) > 0),
  slug        text        UNIQUE NOT NULL,
  created_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER set_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.organization_members (
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role            text        NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX idx_organization_members_user_id ON public.organization_members(user_id);
CREATE INDEX idx_organization_members_role ON public.organization_members(organization_id, role);

CREATE TABLE public.organization_invitations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid       NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email           text       NOT NULL,
  role            text       NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  status          text       NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by      uuid       NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  accepted_by     uuid       REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  accepted_at     timestamptz,
  UNIQUE (organization_id, email)
);

CREATE INDEX idx_organization_invitations_email ON public.organization_invitations(lower(email));
CREATE INDEX idx_organization_invitations_org_status ON public.organization_invitations(organization_id, status);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.meeting_series
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.guest_shares
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

INSERT INTO public.instance_config (key, value)
VALUES ('hosted_mode', 'false')
ON CONFLICT (key) DO NOTHING;

CREATE INDEX idx_meeting_series_organization_id ON public.meeting_series(organization_id);
CREATE INDEX idx_guest_shares_organization_id ON public.guest_shares(organization_id);

CREATE OR REPLACE FUNCTION public.slugify_organization_name(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(both '-' FROM regexp_replace(lower(coalesce(input, 'workspace')), '[^a-z0-9]+', '-', 'g'))
$$;

CREATE OR REPLACE FUNCTION public.user_is_org_member(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT target_organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = target_organization_id
        AND om.user_id = auth.uid()
    )
$$;

CREATE OR REPLACE FUNCTION public.user_is_org_admin(target_organization_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT target_organization_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = target_organization_id
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
$$;

CREATE OR REPLACE FUNCTION public.set_series_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  default_org_id uuid;
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.current_organization_id
  INTO default_org_id
  FROM public.profiles p
  WHERE p.id = NEW.owner_id;

  IF default_org_id IS NULL THEN
    SELECT om.organization_id
    INTO default_org_id
    FROM public.organization_members om
    WHERE om.user_id = NEW.owner_id
    ORDER BY om.created_at
    LIMIT 1;
  END IF;

  NEW.organization_id = default_org_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_meeting_series_organization
  BEFORE INSERT ON public.meeting_series
  FOR EACH ROW EXECUTE FUNCTION public.set_series_organization();

CREATE OR REPLACE FUNCTION public.set_guest_share_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.resource_type = 'series' THEN
    SELECT organization_id INTO NEW.organization_id
    FROM public.meeting_series
    WHERE id = NEW.resource_id;
  ELSIF NEW.resource_type = 'meeting' THEN
    SELECT ms.organization_id INTO NEW.organization_id
    FROM public.meetings m
    JOIN public.meeting_series ms ON ms.id = m.series_id
    WHERE m.id = NEW.resource_id;
  ELSIF NEW.resource_type = 'issue' THEN
    SELECT ms.organization_id INTO NEW.organization_id
    FROM public.issues i
    JOIN public.meeting_series ms ON ms.id = i.series_id
    WHERE i.id = NEW.resource_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER set_guest_share_organization
  BEFORE INSERT ON public.guest_shares
  FOR EACH ROW EXECUTE FUNCTION public.set_guest_share_organization();

CREATE OR REPLACE FUNCTION public.protect_profile_authorization_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() = 'service_role'
    OR session_user IN ('postgres', 'supabase_admin', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Cannot update profile role';
  END IF;

  IF NEW.current_organization_id IS DISTINCT FROM OLD.current_organization_id
    AND NOT public.user_is_org_member(NEW.current_organization_id) THEN
    RAISE EXCEPTION 'Cannot switch to an organization you do not belong to';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_profile_authorization_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_authorization_fields();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  profile_name text;
  invited_org_id uuid;
  invited_role text;
  invitation_row record;
  created_org_id uuid;
  accepted_org_id uuid;
  base_slug text;
  final_slug text;
BEGIN
  profile_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
  invited_role := COALESCE(NULLIF(NEW.raw_user_meta_data->>'organization_role', ''), 'member');

  IF (NEW.raw_user_meta_data->>'organization_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id
    INTO invited_org_id
    FROM public.organizations
    WHERE id = (NEW.raw_user_meta_data->>'organization_id')::uuid;
  END IF;

  INSERT INTO public.profiles (id, email, name, current_organization_id)
  VALUES (NEW.id, NEW.email, profile_name, invited_org_id);

  IF invited_org_id IS NOT NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (invited_org_id, NEW.id, CASE WHEN invited_role = 'admin' THEN 'admin' ELSE 'member' END)
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  ELSE
    FOR invitation_row IN
      SELECT id, organization_id, role
      FROM public.organization_invitations
      WHERE lower(email) = lower(NEW.email)
        AND status = 'pending'
      ORDER BY created_at
    LOOP
      INSERT INTO public.organization_members (organization_id, user_id, role)
      VALUES (invitation_row.organization_id, NEW.id, invitation_row.role)
      ON CONFLICT (organization_id, user_id) DO NOTHING;

      UPDATE public.organization_invitations
      SET status = 'accepted',
          accepted_by = NEW.id,
          accepted_at = now()
      WHERE id = invitation_row.id;

      accepted_org_id := COALESCE(accepted_org_id, invitation_row.organization_id);
    END LOOP;

    IF accepted_org_id IS NOT NULL THEN
      UPDATE public.profiles
      SET current_organization_id = accepted_org_id
      WHERE id = NEW.id;
      RETURN NEW;
    END IF;
  END IF;

  IF invited_org_id IS NULL AND accepted_org_id IS NULL AND NOT EXISTS (SELECT 1 FROM public.organizations) THEN
    base_slug := COALESCE(NULLIF(public.slugify_organization_name(profile_name), ''), 'workspace');
    final_slug := base_slug || '-' || substr(replace(NEW.id::text, '-', ''), 1, 8);

    INSERT INTO public.organizations (name, slug, created_by)
    VALUES (profile_name || '''s workspace', final_slug, NEW.id)
    RETURNING id INTO created_org_id;

    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (created_org_id, NEW.id, 'admin');

    UPDATE public.profiles
    SET current_organization_id = created_org_id
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DO $$
DECLARE
  profile_row record;
  created_org_id uuid;
  org_name text;
  org_slug text;
BEGIN
  FOR profile_row IN
    SELECT p.id, p.email, p.name, p.role
    FROM public.profiles p
    WHERE NOT EXISTS (
      SELECT 1 FROM public.organization_members om WHERE om.user_id = p.id
    )
  LOOP
    org_name := COALESCE(NULLIF(profile_row.name, ''), split_part(profile_row.email, '@', 1), 'Workspace') || '''s workspace';
    org_slug := COALESCE(NULLIF(public.slugify_organization_name(org_name), ''), 'workspace') || '-' || substr(replace(profile_row.id::text, '-', ''), 1, 8);

    INSERT INTO public.organizations (name, slug, created_by)
    VALUES (org_name, org_slug, profile_row.id)
    RETURNING id INTO created_org_id;

    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (created_org_id, profile_row.id, CASE WHEN profile_row.role = 'admin' THEN 'admin' ELSE 'member' END);

    UPDATE public.profiles
    SET current_organization_id = created_org_id
    WHERE id = profile_row.id;
  END LOOP;
END;
$$;

UPDATE public.meeting_series ms
SET organization_id = p.current_organization_id
FROM public.profiles p
WHERE ms.owner_id = p.id
  AND ms.organization_id IS NULL;

UPDATE public.guest_shares gs
SET organization_id = ms.organization_id
FROM public.meeting_series ms
WHERE gs.resource_type = 'series'
  AND gs.resource_id = ms.id
  AND gs.organization_id IS NULL;

UPDATE public.guest_shares gs
SET organization_id = ms.organization_id
FROM public.meetings m
JOIN public.meeting_series ms ON ms.id = m.series_id
WHERE gs.resource_type = 'meeting'
  AND gs.resource_id = m.id
  AND gs.organization_id IS NULL;

UPDATE public.guest_shares gs
SET organization_id = ms.organization_id
FROM public.issues i
JOIN public.meeting_series ms ON ms.id = i.series_id
WHERE gs.resource_type = 'issue'
  AND gs.resource_id = i.id
  AND gs.organization_id IS NULL;

ALTER TABLE public.meeting_series
  ALTER COLUMN organization_id SET NOT NULL;

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "meeting_series_select_owner" ON public.meeting_series;
DROP POLICY IF EXISTS "meeting_series_insert_owner" ON public.meeting_series;
DROP POLICY IF EXISTS "meeting_series_update_owner" ON public.meeting_series;
DROP POLICY IF EXISTS "meeting_series_delete_owner" ON public.meeting_series;
DROP POLICY IF EXISTS "meetings_select_owner" ON public.meetings;
DROP POLICY IF EXISTS "meetings_insert_owner" ON public.meetings;
DROP POLICY IF EXISTS "meetings_update_owner" ON public.meetings;
DROP POLICY IF EXISTS "meetings_delete_owner" ON public.meetings;
DROP POLICY IF EXISTS "issues_select_owner" ON public.issues;
DROP POLICY IF EXISTS "issues_insert_owner" ON public.issues;
DROP POLICY IF EXISTS "issues_update_owner" ON public.issues;
DROP POLICY IF EXISTS "issues_delete_owner" ON public.issues;
DROP POLICY IF EXISTS "issue_updates_select_owner" ON public.issue_updates;
DROP POLICY IF EXISTS "issue_updates_insert_owner" ON public.issue_updates;
DROP POLICY IF EXISTS "decisions_select_owner" ON public.decisions;
DROP POLICY IF EXISTS "decisions_insert_owner" ON public.decisions;
DROP POLICY IF EXISTS "decisions_update_owner" ON public.decisions;
DROP POLICY IF EXISTS "decisions_delete_owner" ON public.decisions;
DROP POLICY IF EXISTS "guest_shares_select_creator" ON public.guest_shares;
DROP POLICY IF EXISTS "guest_shares_insert_creator" ON public.guest_shares;
DROP POLICY IF EXISTS "guest_shares_update_creator" ON public.guest_shares;
DROP POLICY IF EXISTS "guest_shares_delete_creator" ON public.guest_shares;

CREATE POLICY "organizations_select_member"
  ON public.organizations FOR SELECT
  USING (public.user_is_org_member(id));

CREATE POLICY "organizations_update_admin"
  ON public.organizations FOR UPDATE
  USING (public.user_is_org_admin(id))
  WITH CHECK (public.user_is_org_admin(id));

CREATE POLICY "organization_members_select_member"
  ON public.organization_members FOR SELECT
  USING (public.user_is_org_member(organization_id));

CREATE POLICY "organization_members_insert_admin"
  ON public.organization_members FOR INSERT
  WITH CHECK (public.user_is_org_admin(organization_id));

CREATE POLICY "organization_members_update_admin"
  ON public.organization_members FOR UPDATE
  USING (public.user_is_org_admin(organization_id))
  WITH CHECK (public.user_is_org_admin(organization_id));

CREATE POLICY "organization_members_delete_admin"
  ON public.organization_members FOR DELETE
  USING (public.user_is_org_admin(organization_id) AND user_id <> auth.uid());

CREATE POLICY "organization_invitations_select_admin"
  ON public.organization_invitations FOR SELECT
  USING (public.user_is_org_admin(organization_id));

CREATE POLICY "organization_invitations_insert_admin"
  ON public.organization_invitations FOR INSERT
  WITH CHECK (public.user_is_org_admin(organization_id));

CREATE POLICY "organization_invitations_update_admin"
  ON public.organization_invitations FOR UPDATE
  USING (public.user_is_org_admin(organization_id))
  WITH CHECK (public.user_is_org_admin(organization_id));

CREATE POLICY "meeting_series_select_org_member"
  ON public.meeting_series FOR SELECT
  USING (public.user_is_org_member(organization_id));

CREATE POLICY "meeting_series_insert_org_member"
  ON public.meeting_series FOR INSERT
  WITH CHECK (public.user_is_org_member(organization_id));

CREATE POLICY "meeting_series_update_org_member"
  ON public.meeting_series FOR UPDATE
  USING (public.user_is_org_member(organization_id))
  WITH CHECK (public.user_is_org_member(organization_id));

CREATE POLICY "meeting_series_delete_org_admin_or_owner"
  ON public.meeting_series FOR DELETE
  USING (public.user_is_org_admin(organization_id) OR auth.uid() = owner_id);

CREATE POLICY "meetings_select_org_member"
  ON public.meetings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = meetings.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "meetings_insert_org_member"
  ON public.meetings FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = meetings.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "meetings_update_org_member"
  ON public.meetings FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = meetings.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = meetings.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "meetings_delete_org_admin_or_owner"
  ON public.meetings FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = meetings.series_id
        AND (public.user_is_org_admin(ms.organization_id) OR auth.uid() = ms.owner_id)
    )
  );

CREATE POLICY "issues_select_org_member"
  ON public.issues FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = issues.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "issues_insert_org_member"
  ON public.issues FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = issues.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "issues_update_org_member"
  ON public.issues FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = issues.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = issues.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "issues_delete_org_admin_or_owner"
  ON public.issues FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = issues.series_id
        AND (public.user_is_org_admin(ms.organization_id) OR auth.uid() = ms.owner_id)
    )
  );

CREATE POLICY "issue_updates_select_org_member"
  ON public.issue_updates FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.issues i
      JOIN public.meeting_series ms ON ms.id = i.series_id
      WHERE i.id = issue_updates.issue_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "issue_updates_insert_org_member"
  ON public.issue_updates FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.issues i
      JOIN public.meeting_series ms ON ms.id = i.series_id
      WHERE i.id = issue_updates.issue_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "decisions_select_org_member"
  ON public.decisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = decisions.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "decisions_insert_org_member"
  ON public.decisions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = decisions.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "decisions_update_org_member"
  ON public.decisions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = decisions.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = decisions.series_id
        AND public.user_is_org_member(ms.organization_id)
    )
  );

CREATE POLICY "decisions_delete_org_admin_or_owner"
  ON public.decisions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.meeting_series ms
      WHERE ms.id = decisions.series_id
        AND (public.user_is_org_admin(ms.organization_id) OR auth.uid() = ms.owner_id)
    )
  );

CREATE POLICY "guest_shares_select_org_member"
  ON public.guest_shares FOR SELECT
  USING (public.user_is_org_member(organization_id));

CREATE POLICY "guest_shares_insert_org_member"
  ON public.guest_shares FOR INSERT
  WITH CHECK (auth.uid() = created_by AND public.user_is_org_member(organization_id));

CREATE POLICY "guest_shares_update_org_member"
  ON public.guest_shares FOR UPDATE
  USING (auth.uid() = created_by AND public.user_is_org_member(organization_id))
  WITH CHECK (auth.uid() = created_by AND public.user_is_org_member(organization_id));

CREATE POLICY "guest_shares_delete_org_member"
  ON public.guest_shares FOR DELETE
  USING ((auth.uid() = created_by OR public.user_is_org_admin(organization_id)) AND public.user_is_org_member(organization_id));

CREATE POLICY "profiles_select_org_member"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1
      FROM public.organization_members mine
      JOIN public.organization_members theirs ON theirs.organization_id = mine.organization_id
      WHERE mine.user_id = auth.uid()
        AND theirs.user_id = profiles.id
    )
  );

GRANT ALL ON public.organizations TO service_role;
GRANT SELECT, UPDATE ON public.organizations TO authenticated;
GRANT ALL ON public.organization_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_members TO authenticated;
GRANT ALL ON public.organization_invitations TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.organization_invitations TO authenticated;
