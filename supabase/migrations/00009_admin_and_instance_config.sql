-- ---------------------------------------------------------------------------
-- 00009: Admin role + instance_config table
-- Foundation for self-host setup wizard (E19) and admin panel (E20)
-- ---------------------------------------------------------------------------

-- Add role column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user'
  CHECK (role IN ('user', 'admin'));

-- ---------------------------------------------------------------------------
-- instance_config: key-value store for runtime settings
-- ---------------------------------------------------------------------------
CREATE TABLE public.instance_config (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text        UNIQUE NOT NULL,
  value       text,
  encrypted   boolean     NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid        REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX idx_instance_config_key ON public.instance_config(key);

CREATE TRIGGER set_instance_config_updated_at
  BEFORE UPDATE ON public.instance_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed default rows
INSERT INTO public.instance_config (key, value) VALUES
  ('instance_name', 'Minutia'),
  ('setup_completed', 'false'),
  ('instance_id', gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.instance_config ENABLE ROW LEVEL SECURITY;

-- Admins can read all config
CREATE POLICY "instance_config_select_admin"
  ON public.instance_config FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Admins can insert/update config
CREATE POLICY "instance_config_insert_admin"
  ON public.instance_config FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

CREATE POLICY "instance_config_update_admin"
  ON public.instance_config FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'admin'
    )
  );

-- Service role bypasses RLS (used during setup before any admin exists)

-- Allow service_role full access to instance_config
GRANT ALL ON public.instance_config TO service_role;
GRANT ALL ON public.instance_config TO authenticated;

-- Users can read their own role (already covered by profiles_select_own policy)
-- Admins can update role on any profile
CREATE POLICY "profiles_update_role_admin"
  ON public.profiles FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles AS p
      WHERE p.id = auth.uid()
      AND p.role = 'admin'
    )
  );
