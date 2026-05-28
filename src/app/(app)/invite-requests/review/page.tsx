import { redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import {
  loadInviteRequestFromToken,
  resolveInviteRequestAdminContext,
} from "@/lib/invite-request-actions";
import { createClient } from "@/lib/supabase/server";
import { InviteRequestReviewClient } from "./review-client";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function requestedUrl(path: string) {
  const base = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL;
  if (!base) return path;
  return new URL(path, base).toString();
}

function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center p-4 lg:p-6">
      <div className="rounded-xl border border-rule bg-card p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-danger">
            <AlertCircle className="size-5" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold leading-tight text-ink">
              {title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-ink-3">{body}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function InviteRequestReviewPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = firstParam(params.token);
  const decisionParam = firstParam(params.decision);
  const initialDecision = decisionParam === "reject" ? "reject" : "approve";

  if (!token) {
    return (
      <ErrorState
        title="Request link missing"
        body="Open the approve or reject button from the invite request email."
      />
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=/invite-requests/review?token=${encodeURIComponent(token)}`);
  }

  const loaded = await loadInviteRequestFromToken(token);
  if ("error" in loaded) {
    return (
      <ErrorState
        title="Request unavailable"
        body={loaded.error ?? "This invite request link is not available."}
      />
    );
  }

  const admin = await resolveInviteRequestAdminContext(
    user.id,
    loaded.request.organization_id
  );
  if (!admin.authorized) {
    return <ErrorState title="Admin access required" body={admin.error} />;
  }

  return (
    <InviteRequestReviewClient
      token={token}
      initialDecision={initialDecision}
      email={loaded.request.email}
      organizationName={admin.organizationName}
      requestedUrl={requestedUrl(loaded.request.requested_path)}
      status={loaded.request.status}
    />
  );
}
