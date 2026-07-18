// Hermetic authz env. Import this FIRST (before identity.mjs / any bundle) so the
// Supabase cookie name derives to sb-fixture-auth-token at import time and every
// bundled client resolves the fixture Supabase origin. ESM evaluates imports in
// source order depth-first, so a leading `import "./env.mjs"` runs these side
// effects before identity.mjs computes COOKIE_NAME.
process.env.NEXT_PUBLIC_SUPABASE_URL = "http://fixture.supabase.local:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-fixture-key";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-fixture-key";
delete process.env.SUPABASE_INTERNAL_URL;
delete process.env.NODE_ENV;
