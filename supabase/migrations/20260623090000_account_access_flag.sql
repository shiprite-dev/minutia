-- Per-account feature access flag.
--
-- Adds a has_full_access boolean to profiles (defaults to false). When feature
-- gating is enabled, server-side checks consult this column. handle_new_user is
-- rewritten to set has_full_access = false on every signup path so the column
-- is always populated.

-- 1. Add the column with a safe default.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS has_full_access boolean NOT NULL DEFAULT false;

-- 2. Backfill any existing rows.
UPDATE public.profiles
   SET has_full_access = false
 WHERE has_full_access IS NULL;

-- 3. Rewrite handle_new_user() so every signup path sets has_full_access.
--    Mirrors the latest version from 20260622090000_restore_multi_tenant_signup
--    with the single addition of has_full_access = false in the profile insert.
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

  -- Invite-acceptance path 1: organization_id supplied via raw_user_meta_data.
  IF (NEW.raw_user_meta_data->>'organization_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id
    INTO invited_org_id
    FROM public.organizations
    WHERE id = (NEW.raw_user_meta_data->>'organization_id')::uuid;
  END IF;

  INSERT INTO public.profiles (id, email, name, current_organization_id, has_full_access)
  VALUES (NEW.id, NEW.email, profile_name, invited_org_id, false);

  IF invited_org_id IS NOT NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (invited_org_id, NEW.id, CASE WHEN invited_role = 'admin' THEN 'admin' ELSE 'member' END)
    ON CONFLICT (organization_id, user_id) DO NOTHING;
    RETURN NEW;
  END IF;

  -- Invite-acceptance path 2: pending organization_invitations for this email.
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

  -- Uninvited signup with no matching invitations: create a personal org.
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;