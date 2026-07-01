import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { rejectCrossOrigin } from "@/lib/request-origin";
import { validateAiBaseUrl } from "@/lib/ai/validate-url";
import { callOpenAiCompatible } from "@/lib/ai/providers/openai-compatible";
import { callAnthropic } from "@/lib/ai/providers/anthropic";
import { getInstanceConfigMap } from "@/lib/instance-config";

export async function POST(request: NextRequest) {
  const crossOrigin = rejectCrossOrigin(request);
  if (crossOrigin) return crossOrigin;

  const auth = await requireAdmin(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null
  ) {
    return NextResponse.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const { provider, baseUrl, apiKey: bodyApiKey, model } = body as Record<string, unknown>;

  if (provider !== "openai-compatible" && provider !== "anthropic") {
    return NextResponse.json(
      { ok: false, error: 'provider must be "openai-compatible" or "anthropic"' },
      { status: 400 }
    );
  }

  // Resolve API key: prefer the body value; fall back to the stored (decrypted) key.
  let resolvedApiKey: string | null =
    typeof bodyApiKey === "string" && bodyApiKey.trim() !== "" ? bodyApiKey.trim() : null;
  if (resolvedApiKey === null) {
    const stored = await getInstanceConfigMap(["ai_api_key"]);
    const storedKey = stored.ai_api_key;
    if (typeof storedKey === "string" && storedKey.trim() !== "") {
      resolvedApiKey = storedKey.trim();
    }
  }
  if (resolvedApiKey === null) {
    return NextResponse.json({ ok: false, error: "apiKey is required" }, { status: 400 });
  }
  const apiKey = resolvedApiKey;

  if (!model || typeof model !== "string" || model.trim() === "") {
    return NextResponse.json({ ok: false, error: "model is required" }, { status: 400 });
  }

  if (provider === "openai-compatible") {
    if (!baseUrl || typeof baseUrl !== "string" || baseUrl.trim() === "") {
      return NextResponse.json({ ok: false, error: "baseUrl is required for openai-compatible" }, { status: 400 });
    }

    const urlResult = validateAiBaseUrl(baseUrl);
    if (!urlResult.ok) {
      return NextResponse.json(
        { ok: false, error: `Invalid base URL: ${urlResult.reason}` },
        { status: 400 }
      );
    }

    try {
      await callOpenAiCompatible({
        baseUrl,
        apiKey,
        model,
        system: "ping",
        prompt: 'Reply with {"ok":true} as JSON.',
        timeoutMs: 10000,
      });
      return NextResponse.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ ok: false, error: message }, { status: 200 });
    }
  }

  // anthropic
  try {
    await callAnthropic({
      apiKey,
      model,
      system: "ping",
      prompt: 'Reply with {"ok":true} as JSON.',
      timeoutMs: 10000,
      maxTokens: 16,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
