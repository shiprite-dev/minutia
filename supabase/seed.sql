-- Seed a test user for E2E testing
-- The on_auth_user_created trigger auto-creates a profile row.

INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  role,
  aud,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'test@example.com',
  '$2b$10$urth1SNKTl.KoeMOfPBimOSJNkQ7UxQCrQRzWGHPvwHGqqJtpGE/e',
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"name": "Test User"}'::jsonb,
  now(),
  now(),
  'authenticated',
  'authenticated',
  '',
  '',
  '',
  ''
)
ON CONFLICT (id) DO NOTHING;
