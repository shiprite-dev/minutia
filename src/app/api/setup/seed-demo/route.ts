import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function POST() {
  const supabase = createServiceRoleClient();

  const { data: admin } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .single();

  if (!admin) {
    return NextResponse.json({ error: "No admin user found" }, { status: 400 });
  }

  const ownerId = admin.id;

  const { data: series, error: seriesError } = await supabase
    .from("meeting_series")
    .insert({
      owner_id: ownerId,
      name: "Weekly Vendor Sync",
      description: "Sample meeting series with demo issues to explore Minutia.",
      cadence: "weekly",
      default_attendees: ["alice@partner.co", "bob@vendor.io"],
    })
    .select()
    .single();

  if (seriesError || !series) {
    return NextResponse.json({ error: seriesError?.message || "Failed to create series" }, { status: 500 });
  }

  const today = new Date();
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .insert({
      series_id: series.id,
      sequence_number: 1,
      title: "Weekly Vendor Sync #1",
      date: lastWeek.toISOString(),
      status: "completed",
      attendees: ["alice@partner.co", "bob@vendor.io"],
      notes_markdown: "First sync. Identified key blockers and assigned owners.",
      completed_at: lastWeek.toISOString(),
    })
    .select()
    .single();

  if (meetingError || !meeting) {
    return NextResponse.json({ error: meetingError?.message || "Failed to create meeting" }, { status: 500 });
  }

  const demoIssues = [
    {
      title: "API credentials not shared yet",
      category: "blocker" as const,
      status: "open" as const,
      priority: "high" as const,
      owner_name: "alice@partner.co",
      description: "Vendor has not provided staging API keys. Blocking integration testing.",
    },
    {
      title: "Data format spec needs review",
      category: "action" as const,
      status: "in_progress" as const,
      priority: "medium" as const,
      owner_name: "bob@vendor.io",
      description: "Draft spec shared, awaiting final review by both teams.",
    },
    {
      title: "Go-live date confirmed for Q3",
      category: "decision" as const,
      status: "resolved" as const,
      priority: "medium" as const,
      owner_name: null,
      description: "Both parties agreed on Q3 launch window.",
    },
    {
      title: "Security review pending",
      category: "risk" as const,
      status: "pending" as const,
      priority: "high" as const,
      owner_name: "alice@partner.co",
      description: "Vendor security team has not started their review.",
    },
    {
      title: "Weekly status email to stakeholders",
      category: "action" as const,
      status: "open" as const,
      priority: "low" as const,
      owner_name: null,
      description: "Send a brief update to the steering committee after each sync.",
    },
  ];

  const issueInserts = demoIssues.map((issue) => ({
    raised_in_meeting_id: meeting.id,
    series_id: series.id,
    title: issue.title,
    description: issue.description,
    category: issue.category,
    status: issue.status,
    priority: issue.priority,
    owner_name: issue.owner_name,
    owner_user_id: null,
    source: "manual" as const,
  }));

  const { error: issuesError } = await supabase.from("issues").insert(issueInserts);

  if (issuesError) {
    return NextResponse.json({ error: issuesError.message }, { status: 500 });
  }

  return NextResponse.json({
    series_id: series.id,
    meeting_id: meeting.id,
    issues_created: demoIssues.length,
  });
}
