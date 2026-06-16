import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { callOpenRouter, getOpenRouterApiKey } from "@/lib/ai/openrouter";
import { getTextFromOpenRouter } from "@/lib/ai/ask-series-answer";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getInstanceConfigMap } from "@/lib/instance-config";

export const dynamic = "force-dynamic";

const SYSTEM_PROMPT =
  "You group related retrospective cards into themes. Suggest only; never invent cards. Return valid JSON only.";

// One in-flight suggestion per board at a time (best-effort cooldown; IP rate
// limiting is handled by middleware).
const lastCall = new Map<string, number>();

const groupsSchema = z.object({
  groups: z
    .array(z.object({ label: z.string().trim().min(1).max(60), card_ids: z.array(z.string()).min(2) }))
    .max(8),
});

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const cfg = await getInstanceConfigMap(["retro_enabled"]);
  if (cfg.retro_enabled !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    return NextResponse.json({ error: "AI theme suggestions are not configured" }, { status: 503 });
  }

  const now = Date.now();
  const prev = lastCall.get(token) ?? 0;
  if (now - prev < 5000) {
    return NextResponse.json({ error: "Slow down" }, { status: 429 });
  }
  lastCall.set(token, now);

  const svc = createServiceRoleClient();
  const { data: board } = await svc
    .from("retro_boards")
    .select("id")
    .eq("token", token)
    .single();
  if (!board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  const { data: cards } = await svc
    .from("retro_cards")
    .select("id, text")
    .eq("board_id", board.id);
  if (!cards || cards.length < 3) {
    return NextResponse.json({ groups: [] });
  }

  const prompt = [
    "Group these retrospective cards into 0-5 themes of clearly related cards.",
    "Only group cards that genuinely belong together; leave unrelated cards out.",
    'Return JSON: { "groups": [ { "label": "short theme", "card_ids": ["id", "id"] } ] }.',
    "",
    "Cards:",
    ...cards.map((c) => `- ${c.id}: ${c.text}`),
  ].join("\n");

  try {
    const { data: providerData } = await callOpenRouter({
      apiKey,
      system: SYSTEM_PROMPT,
      prompt,
    });
    const parsed = groupsSchema.parse(JSON.parse(getTextFromOpenRouter(providerData)));
    const valid = new Set(cards.map((c) => c.id));
    const groups = parsed.groups
      .map((g) => ({ label: g.label, card_ids: g.card_ids.filter((id) => valid.has(id)) }))
      .filter((g) => g.card_ids.length >= 2);
    return NextResponse.json({ groups });
  } catch {
    return NextResponse.json({ groups: [] });
  }
}
