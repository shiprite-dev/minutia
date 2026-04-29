-- =============================================================================
-- Minutia: Seed Data for E2E Testing
-- =============================================================================
-- Seeds a test user plus realistic data across all tables.
-- Run after 00001_initial_schema.sql migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Test user in auth.users (password: password123)
-- ---------------------------------------------------------------------------
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

-- Profile is auto-created by the on_auth_user_created trigger.
-- Ensure it exists in case the trigger didn't fire (idempotent):
INSERT INTO public.profiles (id, email, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'test@example.com', 'Test User')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Meeting series
-- ---------------------------------------------------------------------------
INSERT INTO public.meeting_series (id, name, description, cadence, default_attendees, owner_id)
VALUES
  ('10000000-0000-0000-0000-000000000001', 'Platform Team Standup', 'Weekly sync for platform engineering', 'weekly', ARRAY['Alice', 'Bob', 'Carol'], '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000002', 'Product Review', 'Biweekly product review with stakeholders', 'biweekly', ARRAY['Dana', 'Eve'], '00000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000003', 'Incident Retro', 'Ad-hoc incident retrospectives', 'adhoc', ARRAY['Frank', 'Grace'], '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Meetings
-- ---------------------------------------------------------------------------
INSERT INTO public.meetings (id, series_id, sequence_number, title, date, attendees, status, notes_markdown)
VALUES
  -- Platform Team Standup meetings
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 1, 'Platform Standup #1', '2026-04-01', ARRAY['Alice', 'Bob'], 'completed', 'Discussed CI pipeline improvements.'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 2, 'Platform Standup #2', '2026-04-08', ARRAY['Alice', 'Bob', 'Carol'], 'completed', 'Reviewed deployment strategy.'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 3, 'Platform Standup #3', '2026-04-15', ARRAY['Alice', 'Carol'], 'completed', 'Sprint planning for next quarter.'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 4, 'Platform Standup #4', '2026-04-22', ARRAY['Alice', 'Bob', 'Carol'], 'upcoming', ''),

  -- Product Review meetings
  ('20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', 1, 'Product Review Q2 Kick-off', '2026-04-03', ARRAY['Dana', 'Eve'], 'completed', 'Aligned on Q2 roadmap priorities.'),
  ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000002', 2, 'Product Review Sprint 1', '2026-04-17', ARRAY['Dana', 'Eve'], 'completed', 'Reviewed sprint 1 progress.'),

  -- Incident Retro meetings
  ('20000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000003', 1, 'Retro: API Outage 2026-04-05', '2026-04-06', ARRAY['Frank', 'Grace'], 'completed', 'Root cause: DB connection pool exhaustion.')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Issues (variety of statuses, categories, owners, priorities)
-- ---------------------------------------------------------------------------
INSERT INTO public.issues (id, series_id, raised_in_meeting_id, title, description, category, status, priority, owner_name, owner_user_id, due_date, resolved_in_meeting_id, source)
VALUES
  -- Open issues (assigned to test user for My Actions)
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Migrate CI from Jenkins to GitHub Actions', 'Need to move all pipelines by end of Q2.', 'action', 'open', 'high', 'Test User', '00000000-0000-0000-0000-000000000001', '2026-05-15', NULL, 'manual'),

  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Set up staging environment monitoring', 'Add Datadog dashboards for staging cluster.', 'action', 'in_progress', 'medium', 'Test User', '00000000-0000-0000-0000-000000000001', '2026-05-01', NULL, 'manual'),

  -- Overdue issue (assigned to test user)
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000010', 'Write user research summary for Q2 features', 'Summarize interview findings from 12 sessions.', 'action', 'open', 'critical', 'Test User', '00000000-0000-0000-0000-000000000001', '2026-04-20', NULL, 'manual'),

  -- Pending issue (assigned to test user)
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Evaluate Kubernetes vs ECS for new services', 'Pending cost analysis from infrastructure team.', 'decision', 'pending', 'medium', 'Test User', '00000000-0000-0000-0000-000000000001', NULL, NULL, 'manual'),

  -- Resolved issue (assigned to test user)
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Fix flaky integration tests', 'Tests fail intermittently due to race condition in DB setup.', 'action', 'resolved', 'high', 'Test User', '00000000-0000-0000-0000-000000000001', '2026-04-10', '20000000-0000-0000-0000-000000000003', 'manual'),

  -- Issues NOT owned by test user (should not appear in My Actions)
  ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Update API rate limiting config', 'Increase limits for premium tier users.', 'action', 'open', 'medium', 'Alice', NULL, '2026-05-20', NULL, 'manual'),

  ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000020', 'Increase DB connection pool size', 'Root cause fix for the 2026-04-05 outage.', 'blocker', 'in_progress', 'critical', 'Frank', NULL, '2026-04-30', NULL, 'transcript'),

  -- Risk issue
  ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000010', 'SSL cert expiry risk for api.example.com', 'Certificate expires June 1. Need to set up auto-renewal.', 'risk', 'open', 'high', 'Bob', NULL, '2026-06-01', NULL, 'manual'),

  -- Info issue
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000011', 'Q2 headcount approved: 3 engineers', 'HR confirmed budget for 3 new backend engineers.', 'info', 'resolved', 'low', 'Dana', NULL, NULL, '20000000-0000-0000-0000-000000000011', 'manual'),

  -- Dropped issue
  ('30000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Evaluate GraphQL migration', 'Decided REST is sufficient for current needs.', 'decision', 'dropped', 'low', 'Carol', NULL, NULL, NULL, 'manual')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Issue updates (audit trail for lifecycle timeline)
-- ---------------------------------------------------------------------------
INSERT INTO public.issue_updates (id, issue_id, meeting_id, previous_status, new_status, note, author_type, updated_by, created_at)
VALUES
  -- CI Migration issue: opened in standup #1, discussed in standup #2
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', NULL, 'open', 'Raised during standup. Bob to scope the migration.', 'human', '00000000-0000-0000-0000-000000000001', '2026-04-01T10:00:00Z'),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'open', 'open', 'Migration plan drafted. Need approval from security team.', 'human', '00000000-0000-0000-0000-000000000001', '2026-04-08T10:00:00Z'),

  -- Monitoring issue: opened in standup #2, in_progress in standup #3
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', NULL, 'open', 'Need Datadog dashboards for staging.', 'human', '00000000-0000-0000-0000-000000000001', '2026-04-08T10:15:00Z'),
  ('40000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', 'open', 'in_progress', 'Started implementing. 40% done.', 'human', '00000000-0000-0000-0000-000000000001', '2026-04-15T10:00:00Z'),

  -- Flaky tests: opened in standup #1, in_progress #2, resolved #3
  ('40000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000001', NULL, 'open', 'Tests failing intermittently.', 'human', '00000000-0000-0000-0000-000000000001', '2026-04-01T10:30:00Z'),
  ('40000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002', 'open', 'in_progress', 'Found the race condition. Working on fix.', 'human', '00000000-0000-0000-0000-000000000001', '2026-04-08T10:30:00Z'),
  ('40000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000003', 'in_progress', 'resolved', 'Fixed with proper test isolation. All green for 3 days.', 'human', '00000000-0000-0000-0000-000000000001', '2026-04-15T10:30:00Z'),

  -- DB connection pool: from retro
  ('40000000-0000-0000-0000-000000000008', '30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000020', NULL, 'open', 'Identified as root cause of the 4/5 outage.', 'human', '00000000-0000-0000-0000-000000000001', '2026-04-06T14:00:00Z'),

  -- GraphQL dropped
  ('40000000-0000-0000-0000-000000000009', '30000000-0000-0000-0000-000000000010', '20000000-0000-0000-0000-000000000002', 'open', 'dropped', 'Team decided REST is sufficient. No migration needed.', 'human', '00000000-0000-0000-0000-000000000001', '2026-04-08T11:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Decisions
-- ---------------------------------------------------------------------------
INSERT INTO public.decisions (id, meeting_id, series_id, title, rationale, made_by)
VALUES
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Use GitHub Actions for CI/CD', 'Better integration with our existing GitHub workflow. Jenkins maintenance overhead too high.', 'Bob'),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000002', 'Prioritize mobile app over desktop', 'User research shows 72% of target users prefer mobile. Desktop can wait for v2.', 'Dana'),
  ('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000020', '10000000-0000-0000-0000-000000000003', 'Implement circuit breaker for DB connections', 'Prevent cascading failures during connection pool exhaustion.', 'Frank')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Guest shares (for testing the share flow)
-- ---------------------------------------------------------------------------
INSERT INTO public.guest_shares (id, resource_type, resource_id, token, expires_at, permissions, created_by)
VALUES
  ('60000000-0000-0000-0000-000000000001', 'meeting', '20000000-0000-0000-0000-000000000002', 'test-share-meeting-abc123', '2027-12-31T23:59:59Z', 'view', '00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002', 'series', '10000000-0000-0000-0000-000000000001', 'test-share-series-def456', NULL, 'view', '00000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000003', 'issue', '30000000-0000-0000-0000-000000000001', 'test-share-issue-ghi789', NULL, 'view', '00000000-0000-0000-0000-000000000001'),
  -- Expired share for testing expiry handling
  ('60000000-0000-0000-0000-000000000004', 'meeting', '20000000-0000-0000-0000-000000000001', 'test-share-expired-xyz000', '2025-01-01T00:00:00Z', 'view', '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;
