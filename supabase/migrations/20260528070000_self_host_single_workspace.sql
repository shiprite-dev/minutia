CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
  profile_name text;
  invitation_row record;
  workspace_org_id uuid;
  created_org_id uuid;
  accepted_org_id uuid;
  base_slug text;
  final_slug text;
BEGIN
  profile_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));

  INSERT INTO public.profiles (id, email, name, current_organization_id)
  VALUES (NEW.id, NEW.email, profile_name, NULL);

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

  SELECT id
  INTO workspace_org_id
  FROM public.organizations
  ORDER BY created_at ASC
  LIMIT 1;

  IF workspace_org_id IS NOT NULL THEN
    INSERT INTO public.organization_members (organization_id, user_id, role)
    VALUES (workspace_org_id, NEW.id, 'member')
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    UPDATE public.profiles
    SET current_organization_id = workspace_org_id
    WHERE id = NEW.id;
    RETURN NEW;
  END IF;

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

DO $$
DECLARE
  workspace_org_id uuid;
BEGIN
  SELECT id
  INTO workspace_org_id
  FROM public.organizations
  ORDER BY created_at ASC
  LIMIT 1;

  IF workspace_org_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  SELECT
    workspace_org_id,
    p.id,
    CASE WHEN p.role = 'admin' THEN 'admin' ELSE 'member' END
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.user_id = p.id
  )
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  UPDATE public.profiles p
  SET current_organization_id = workspace_org_id
  WHERE p.current_organization_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = workspace_org_id
        AND om.user_id = p.id
    );
END;
$$;
