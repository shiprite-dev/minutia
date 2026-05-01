import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_CONFIG, STATUS_CONFIG } from "@/lib/constants";
import type {
  GuestShare,
  Meeting,
  MeetingSeries,
  Issue,
  Decision,
  IssueUpdate,
  IssueCategory,
  IssueStatus,
  Priority,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatShortDate(date: string | Date): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatRelative(date: string | Date): string {
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatShortDate(date);
}

const priorityDotColor: Record<Priority, string> = {
  critical: "bg-accent",
  high: "bg-ink",
  medium: "bg-ink-3",
  low: "bg-ink-4",
};

// ---------------------------------------------------------------------------
// Shared UI primitives (server-side, no "use client")
// ---------------------------------------------------------------------------

function expiryLabel(expiresAt: Date | string | null): string | null {
  if (!expiresAt) return null;
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
  return `Expires in ${days} day${days !== 1 ? "s" : ""}`;
}

function ShareLayout({
  children,
  sharedBy,
  expiresAt,
}: {
  children: React.ReactNode;
  sharedBy?: string;
  expiresAt?: Date | string | null;
}) {
  const expiry = expiryLabel(expiresAt ?? null);

  return (
    <div className="min-h-screen bg-paper">
      {/* Share banner */}
      <div className="bg-paper-2 border-b border-rule">
        <div className="mx-auto max-w-2xl px-4 py-2.5 sm:px-6 flex items-center justify-between text-xs text-ink-3">
          <span>
            {sharedBy ? `Shared by ${sharedBy}` : "Shared"} · view-only link
          </span>
          {expiry && (
            <span className="font-mono text-ink-4">{expiry}</span>
          )}
        </div>
      </div>

      {/* Header */}
      <header className="border-b border-rule">
        <div className="mx-auto max-w-2xl px-4 py-4 sm:px-6 text-center">
          <span className="font-display text-lg font-semibold text-ink inline-flex items-center gap-2">
            <span className="size-2 rounded-full bg-accent inline-block" />
            minutia
          </span>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">{children}</main>

      {/* Footer CTAs */}
      <footer className="border-t border-rule">
        <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href="https://github.com/minutia-dev/minutia"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-rule px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-paper-2"
            >
              <svg
                className="size-4"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
              </svg>
              Star on GitHub
            </a>
            <a
              href="/"
              className="inline-flex items-center gap-1 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-2"
            >
              Try Minutia Cloud
              <span aria-hidden="true">&rarr;</span>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ErrorView({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <ShareLayout>
      <div className="py-16 text-center">
        <h1 className="font-display text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-2">{description}</p>
        <a
          href="/"
          className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          Go to Minutia
          <span aria-hidden="true">&rarr;</span>
        </a>
      </div>
    </ShareLayout>
  );
}

function ViewOnlyBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-paper-2 px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-3">
      View only
    </span>
  );
}

function SectionHeading({
  children,
  count,
}: {
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <h2 className="font-display text-base font-medium text-ink">
      {children}
      {count !== undefined && (
        <span className="ml-1.5 font-mono text-ink-3">({count})</span>
      )}
    </h2>
  );
}

// ---------------------------------------------------------------------------
// Meeting share view
// ---------------------------------------------------------------------------

function MeetingShareView({
  meeting,
  series,
  issues,
  decisions,
  share,
  updatedAt,
}: {
  meeting: Meeting & { issues?: Issue[]; decisions?: Decision[] };
  series: MeetingSeries | null;
  issues: Issue[];
  decisions: Decision[];
  share: GuestShare;
  updatedAt: string;
}) {
  return (
    <ShareLayout expiresAt={share.expires_at}>
      {/* Meta */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <span>Shared</span>
          <ViewOnlyBadge />
        </div>
        <div className="mt-3">
          {series && (
            <p className="text-sm text-ink-2">{series.name}</p>
          )}
          <h1 className="font-display text-2xl font-semibold text-ink mt-1">
            {meeting.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-3">
            <span className="font-mono">{formatDate(meeting.date)}</span>
            {meeting.attendees && meeting.attendees.length > 0 && (
              <span>{meeting.attendees.length} attendees</span>
            )}
          </div>
        </div>
      </div>

      {/* Attendees */}
      {meeting.attendees && meeting.attendees.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-8">
          {meeting.attendees.map((a) => (
            <span
              key={a}
              className="text-xs bg-paper-2 text-ink-2 px-2.5 py-1 rounded-full"
            >
              {a}
            </span>
          ))}
        </div>
      )}

      {/* Items Raised */}
      <section className="mb-8">
        <SectionHeading count={issues.length}>Items raised</SectionHeading>
        {issues.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">No items were captured.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {issues.map((issue) => (
              <ShareIssueCard key={issue.id} issue={issue} />
            ))}
          </div>
        )}
      </section>

      {/* Decisions */}
      {decisions.length > 0 && (
        <section className="mb-8">
          <SectionHeading count={decisions.length}>Decisions</SectionHeading>
          <div className="mt-4 space-y-3">
            {decisions.map((decision) => (
              <div
                key={decision.id}
                className="bg-card border border-rule rounded-md p-4"
              >
                <div className="flex items-start gap-2">
                  <span className="text-ink-3 shrink-0" aria-hidden="true">
                    {CATEGORY_CONFIG.decision.glyph}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-ink">
                      {decision.title}
                    </p>
                    {decision.rationale && (
                      <p className="text-xs text-ink-2 mt-1">
                        {decision.rationale}
                      </p>
                    )}
                    {decision.made_by && (
                      <p className="text-xs text-ink-3 mt-1">
                        by {decision.made_by}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Last updated */}
      <p className="text-xs text-ink-4 font-mono">
        Last updated {formatRelative(updatedAt)}
      </p>
    </ShareLayout>
  );
}

// ---------------------------------------------------------------------------
// Series share view
// ---------------------------------------------------------------------------

function SeriesShareView({
  series,
  meetings,
  openIssuesCount,
  openIssues,
  share,
}: {
  series: MeetingSeries;
  meetings: Meeting[];
  openIssuesCount: number;
  openIssues: Issue[];
  share: GuestShare;
}) {
  const sortedMeetings = [...meetings].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  const recentMeetings = sortedMeetings.slice(0, 10);

  return (
    <ShareLayout expiresAt={share.expires_at}>
      {/* Meta */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <span>Shared</span>
          <ViewOnlyBadge />
        </div>
        <h1 className="font-display text-2xl font-semibold text-ink mt-3">
          {series.name}
        </h1>
        {series.description && (
          <p className="mt-2 text-sm text-ink-2 leading-relaxed">
            {series.description}
          </p>
        )}
      </div>

      {/* Open Issues */}
      <section className="mb-8">
        <SectionHeading count={openIssuesCount}>Open issues</SectionHeading>
        {openIssues.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">No open issues.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {openIssues.map((issue) => (
              <div
                key={issue.id}
                className="flex items-center gap-3 bg-card border border-rule rounded-md px-4 py-3"
              >
                <span
                  className={`inline-block size-1.5 rounded-full shrink-0 ${priorityDotColor[issue.priority]}`}
                  aria-label={`Priority: ${issue.priority}`}
                />
                <span className="text-sm text-ink flex-1 min-w-0 truncate">
                  {issue.title}
                </span>
                <span className="text-xs text-ink-3 shrink-0">
                  {CATEGORY_CONFIG[issue.category].glyph}{" "}
                  {CATEGORY_CONFIG[issue.category].label}
                </span>
                <span className="text-xs text-ink-3 shrink-0">
                  {STATUS_CONFIG[issue.status].label}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent Meetings */}
      <section className="mb-8">
        <SectionHeading count={recentMeetings.length}>
          Recent meetings
        </SectionHeading>
        {recentMeetings.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">No meetings yet.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {recentMeetings.map((meeting) => (
              <div
                key={meeting.id}
                className="flex items-center justify-between bg-card border border-rule rounded-md px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink truncate">
                    {meeting.title}
                  </p>
                </div>
                <span className="text-xs font-mono text-ink-3 shrink-0 ml-3">
                  {formatShortDate(meeting.date)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </ShareLayout>
  );
}

// ---------------------------------------------------------------------------
// Issue share view
// ---------------------------------------------------------------------------

function IssueShareView({
  issue,
  updates,
  share,
}: {
  issue: Issue;
  updates: IssueUpdate[];
  share: GuestShare;
}) {
  const sortedUpdates = [...updates].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  return (
    <ShareLayout expiresAt={share.expires_at}>
      {/* Meta */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <span>Shared</span>
          <ViewOnlyBadge />
        </div>
        <h1 className="font-display text-2xl font-semibold text-ink mt-3">
          {issue.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1 text-xs text-ink-2">
            <span aria-hidden="true">
              {CATEGORY_CONFIG[issue.category].glyph}
            </span>
            {CATEGORY_CONFIG[issue.category].label}
          </span>
          <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
            <span
              className={`inline-block size-1.5 rounded-full ${priorityDotColor[issue.priority]}`}
              aria-hidden="true"
            />
            {issue.priority.charAt(0).toUpperCase() + issue.priority.slice(1)}
          </span>
          <span className="text-xs font-medium text-ink-2">
            {STATUS_CONFIG[issue.status].label}
          </span>
        </div>
        {issue.description && (
          <p className="mt-4 text-sm text-ink-2 leading-relaxed">
            {issue.description}
          </p>
        )}
      </div>

      {/* Owner and dates */}
      <div className="mb-8 flex flex-wrap items-center gap-4 text-xs text-ink-3">
        {issue.owner_name && <span className="font-mono">Owner: {issue.owner_name}</span>}
        {issue.due_date && (
          <span className="font-mono">
            Due {formatShortDate(issue.due_date)}
          </span>
        )}
        <span className="font-mono">
          Created {formatShortDate(issue.created_at)}
        </span>
      </div>

      {/* Timeline */}
      {sortedUpdates.length > 0 && (
        <section>
          <SectionHeading>Timeline</SectionHeading>
          <div className="mt-4 space-y-0">
            {sortedUpdates.map((update, i) => {
              const isLast = i === sortedUpdates.length - 1;
              const isResolved = update.new_status === "resolved";

              return (
                <div key={update.id} className="relative flex gap-4">
                  {/* Timeline track */}
                  <div className="relative flex flex-col items-center">
                    {i > 0 ? (
                      <div
                        className="w-px flex-1 bg-rule"
                        aria-hidden="true"
                      />
                    ) : (
                      <div className="flex-1" />
                    )}
                    {isResolved ? (
                      <div className="flex items-center justify-center size-3.5 rounded-full bg-success shrink-0">
                        <svg
                          className="size-2.5 text-white"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </div>
                    ) : (
                      <div
                        className="size-2 rounded-full bg-ink shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    {!isLast ? (
                      <div
                        className="w-px flex-1 bg-rule"
                        aria-hidden="true"
                      />
                    ) : (
                      <div className="flex-1" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="pb-6 pt-0 min-w-0">
                    <span className="text-xs font-mono text-ink-4">
                      {formatShortDate(update.created_at)}
                    </span>
                    {update.previous_status && update.new_status && update.previous_status !== update.new_status && (
                      <p className="text-xs text-ink-2 mt-0.5">
                        {STATUS_CONFIG[update.previous_status].label} &rarr;{" "}
                        {STATUS_CONFIG[update.new_status].label}
                      </p>
                    )}
                    {update.note && (
                      <p className="text-sm text-ink-2 mt-1 leading-relaxed">
                        {update.note}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </ShareLayout>
  );
}

// ---------------------------------------------------------------------------
// Compact issue card for share views
// ---------------------------------------------------------------------------

function ShareIssueCard({ issue }: { issue: Issue }) {
  return (
    <div className="bg-card border border-rule rounded-md p-4">
      <div className="flex items-start gap-3">
        <div className="pt-0.5">
          <span
            className={`inline-block size-1.5 rounded-full ${priorityDotColor[issue.priority]}`}
            aria-label={`Priority: ${issue.priority}`}
          />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-ink">{issue.title}</p>
          <div className="flex flex-wrap items-center gap-3 mt-2">
            <span className="inline-flex items-center gap-1 text-xs text-ink-2">
              <span aria-hidden="true">
                {CATEGORY_CONFIG[issue.category].glyph}
              </span>
              {CATEGORY_CONFIG[issue.category].label}
            </span>
            <span className="text-xs text-ink-3">
              {STATUS_CONFIG[issue.status].label}
            </span>
            {issue.owner_name && (
              <span className="text-xs font-mono text-ink-3">{issue.owner_name}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const supabase = await createClient();
  const { data: share } = await supabase
    .from("guest_shares")
    .select("resource_type")
    .eq("token", token)
    .single();

  const type = share?.resource_type ?? "resource";
  return {
    title: `Shared ${type} | Minutia`,
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function GuestSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  // 0. If the visitor is a registered user, create a notification and redirect to inbox
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: existingShare } = await supabase
      .from("guest_shares")
      .select("id, resource_type, resource_id")
      .eq("token", token)
      .single();

    if (existingShare) {
      // Check if notification already exists for this share to avoid duplicates
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("type", "share_received")
        .contains("metadata", { share_token: token });

      if (!count || count === 0) {
        await supabase.from("notifications").insert({
          user_id: user.id,
          type: "share_received" as const,
          title: `Someone shared a ${existingShare.resource_type} with you`,
          body: `View the shared ${existingShare.resource_type}`,
          link: `/share/${token}`,
          metadata: { share_token: token, resource_type: existingShare.resource_type, resource_id: existingShare.resource_id },
        });
      }

      // Redirect to the actual resource in-app
      let resourceUrl = `/issues/${existingShare.resource_id}`;
      if (existingShare.resource_type === "series") {
        resourceUrl = `/series/${existingShare.resource_id}`;
      } else if (existingShare.resource_type === "meeting") {
        const { data: mtg } = await supabase
          .from("meetings")
          .select("series_id")
          .eq("id", existingShare.resource_id)
          .single();
        resourceUrl = mtg
          ? `/series/${mtg.series_id}/meetings/${existingShare.resource_id}`
          : `/`;
      }

      redirect(resourceUrl);
    }
  }

  // 1. Look up the guest share by token.
  //    NOTE: This runs as anon role. The guest_shares table needs an RLS policy
  //    allowing SELECT when token matches: (token = $1) for anonymous users.
  //    If that policy is missing, this query will return no rows.
  const { data: share, error: shareError } = await supabase
    .from("guest_shares")
    .select("*")
    .eq("token", token)
    .single();

  if (shareError || !share) {
    return (
      <ErrorView
        title="Invalid share link"
        description="This share link is invalid or has been removed."
      />
    );
  }

  const guestShare = share as GuestShare;

  // 2. Check expiration
  if (guestShare.expires_at && new Date(guestShare.expires_at) < new Date()) {
    return (
      <ErrorView
        title="Share link expired"
        description="This share link has expired."
      />
    );
  }

  // 3. Fetch resource based on type
  if (guestShare.resource_type === "meeting") {
    // Fetch meeting with issues and decisions
    const { data: meeting, error: meetingError } = await supabase
      .from("meetings")
      .select("*, issues!issues_raised_in_meeting_id_fkey(*), decisions(*)")
      .eq("id", guestShare.resource_id)
      .single();

    if (meetingError || !meeting) {
      return (
        <ErrorView
          title="Meeting not found"
          description="The shared meeting could not be found."
        />
      );
    }

    // Fetch series info
    const { data: series } = await supabase
      .from("meeting_series")
      .select("*")
      .eq("id", meeting.series_id)
      .single();

    const issues = (meeting as any).issues ?? [];
    const decisions = (meeting as any).decisions ?? [];

    return (
      <MeetingShareView
        meeting={meeting as any}
        series={series as MeetingSeries | null}
        issues={issues}
        decisions={decisions}
        share={guestShare}
        updatedAt={meeting.completed_at ?? meeting.created_at}
      />
    );
  }

  if (guestShare.resource_type === "series") {
    // Fetch series with meetings
    const { data: series, error: seriesError } = await supabase
      .from("meeting_series")
      .select("*, meetings(*)")
      .eq("id", guestShare.resource_id)
      .single();

    if (seriesError || !series) {
      return (
        <ErrorView
          title="Series not found"
          description="The shared series could not be found."
        />
      );
    }

    // Fetch open issues for this series
    const { data: openIssues, count } = await supabase
      .from("issues")
      .select("*", { count: "exact" })
      .eq("series_id", guestShare.resource_id)
      .not("status", "in", '("resolved","dropped")');

    return (
      <SeriesShareView
        series={series as unknown as MeetingSeries}
        meetings={(series as any).meetings ?? []}
        openIssuesCount={count ?? 0}
        openIssues={(openIssues as Issue[]) ?? []}
        share={guestShare}
      />
    );
  }

  if (guestShare.resource_type === "issue") {
    // Fetch issue with updates
    const { data: issue, error: issueError } = await supabase
      .from("issues")
      .select("*, issue_updates(*)")
      .eq("id", guestShare.resource_id)
      .single();

    if (issueError || !issue) {
      return (
        <ErrorView
          title="Issue not found"
          description="The shared issue could not be found."
        />
      );
    }

    return (
      <IssueShareView
        issue={issue as unknown as Issue}
        updates={((issue as any).issue_updates ?? []) as IssueUpdate[]}
        share={guestShare}
      />
    );
  }

  // Fallback for unknown resource types
  return (
    <ErrorView
      title="Unknown share type"
      description="This share link references an unsupported resource type."
    />
  );
}
