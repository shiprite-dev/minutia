"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildCompanionAuthCallbackUrl } from "@/lib/companion-links";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

export function CompanionAuthorizeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Rendered as React text content, so it is escaped; never interpolated into markup.
  const device = searchParams.get("device")?.trim() || "this device";
  const state = searchParams.get("state")?.trim() || null;

  const [status, setStatus] = React.useState<"idle" | "authorizing" | "done">(
    "idle"
  );
  const [error, setError] = React.useState<string | null>(null);
  const [callbackUrl, setCallbackUrl] = React.useState<string | null>(null);

  async function handleApprove() {
    setStatus("authorizing");
    setError(null);
    try {
      const res = await fetch("/api/companion/authorize", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "Could not authorize the companion app.");
        setStatus("idle");
        return;
      }
      const { token_hash } = (await res.json()) as { token_hash: string };
      const url = buildCompanionAuthCallbackUrl(token_hash, state);
      setCallbackUrl(url);
      setStatus("done");
      // Hand off to the desktop app's registered URL scheme. If no handler is
      // registered the browser may reject the navigation; the visible anchor is
      // the reliable fallback, so a failed assign must not break the flow.
      try {
        window.location.assign(url);
      } catch {
        // Fall back to the "Open the Minutia app" anchor below.
      }
    } catch {
      setError("Could not authorize the companion app.");
      setStatus("idle");
    }
  }

  return (
    <div className="min-h-full bg-paper flex items-center justify-center px-6 py-16">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-ink">
            Authorize the Minutia companion app on {device}?
          </CardTitle>
          <CardDescription className="text-ink-3">
            This signs the desktop companion app into your account so it can
            capture and transcribe your meetings.
          </CardDescription>
        </CardHeader>

        {status === "done" ? (
          <CardContent className="space-y-3">
            <p className="text-sm text-ink-2" role="status">
              Approved. Opening the Minutia app.
            </p>
            {callbackUrl && (
              <a
                href={callbackUrl}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Open the Minutia app
              </a>
            )}
          </CardContent>
        ) : (
          <CardFooter className="gap-3">
            <Button variant="accent"
              onClick={handleApprove}
              disabled={status === "authorizing"}
              className="h-9"
            >
              {status === "authorizing" ? "Authorizing..." : "Approve"}
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push("/")}
              disabled={status === "authorizing"}
              className="h-9 border-rule text-ink hover:bg-paper-2"
            >
              Cancel
            </Button>
          </CardFooter>
        )}

        {error && (
          <CardContent>
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
