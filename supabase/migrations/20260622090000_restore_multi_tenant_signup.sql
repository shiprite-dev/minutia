-- Restore multi-tenant signup.
--
-- The single-self-host-workspace unique index (20260528071000) prevented more
-- than one organization. The invite-only handle_new_user (20260528120000) left
-- uninvited signups stranded with a NULL current_organization_id. This
-- migration drops the index and rewrites handle_new_user so every uninvited
-- signup gets its own personal organization, restoring the multi-tenant
-- behavior from 20260526061638.

-- 1. Drop the single-org unique index.
DROP INDEX IF EXISTS public.organizations_single_self_host_workspace;

-- 2. Rewrite handle_new_user().
--    Invite-acceptance paths (raw_user_meta_data organization_id and
--    organization_invitations) are unchanged. Uninvited users with no matching
--    invitations get a personal org named "{name}'s workspace" and are made
--    admin of it.
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

-- 3. Backfill: create personal orgs for profiles stranded by the prior
--    invite-only trigger (NULL current_organization_id, no memberships).
DO $$
DECLARE
  profile_row record;
  org_name text;
  org_slug text;
  created_org_id uuid;
BEGIN
  FOR profile_row IN
    SELECT p.id, p.email, p.name
    FROM public.profiles p
    WHERE p.current_organization_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.organization_members om WHERE om.user_id = p.id
      )
  LOOP
    org_name := COALESCE(NULLIF(profile_row.name, ''), split_part(profile_row.email, '@', 1), 'Workspace') || '''s workspace';
    org_slug := COALESCE(NULLIF(public.slugify_organization_name(org_name), ''), 'workspace') || '-' || substr(replace(profile_row.id::text, '-', ''), 1, 8);

    INSERT INTO public.organizations (name, slug, created_by)
    VALUES (org_name, org_slug, profile_row.id)
    RETURNING id INTO created_org_id;

    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (created_org_id, profile_row.id, 'admin')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    UPDATE public.profiles
    SET current_organization_id = created_org_id
    WHERE id = profile_row.id;
  END LOOP;
END;
$$;