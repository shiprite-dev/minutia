CREATE TABLE public.invite_requests (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        REFERENCES public.organizations(id) ON DELETE SET NULL,
  email           text        NOT NULL,
  requested_path  text        NOT NULL DEFAULT '/',
  status          text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invite_requests_org_status
  ON public.invite_requests(organization_id, status, created_at DESC);

CREATE INDEX idx_invite_requests_email
  ON public.invite_requests(lower(email));

ALTER TABLE public.invite_requests ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.invite_requests TO service_role;

NOTIFY pgrst, 'reload schema';
