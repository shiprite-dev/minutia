"use client";

import { useState } from "react";
import { Check, Loader2, Mail, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Decision = "approve" | "reject";

type ReviewClientProps = {
  token: string;
  initialDecision: Decision;
  email: string;
  organizationName: string;
  requestedUrl: string;
  status: "pending" | "approved" | "rejected";
};

type ActionState =
  | { kind: "idle" }
  | { kind: "loading"; decision: Decision }
  | { kind: "done"; status: "approved" | "rejected"; message: string }
  | { kind: "error"; message: string };

export function InviteRequestReviewClient({
  token,
  initialDecision,
  email,
  organizationName,
  requestedUrl,
  status,
}: ReviewClientProps) {
  const [selectedDecision, setSelectedDecision] = useState<Decision>(initialDecision);
  const [state, setState] = useState<ActionState>(() => {
    if (status === "approved") {
      return { kind: "done", status, message: "This request was already approved." };
    }
    if (status === "rejected") {
      return { kind: "done", status, message: "This request was already rejected." };
    }
    return { kind: "idle" };
  });
  const isPending = status === "pending" && state.kind !== "done";

  async function submitDecision(decision: Decision) {
    setSelectedDecision(decision);
    setState({ kind: "loading", decision });

    const res = await fetch("/api/invite-requests/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, decision }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setState({ kind: "error", message: data.error || "Could not update access." });
      return;
    }

    setState({
      kind: "done",
      status: data.status,
      message:
        data.status === "approved"
          ? `${email} has been invited to ${organizationName}.`
          : `${email} was not invited.`,
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-5 p-4 lg:p-6">
      <div className="rounded-xl border border-rule bg-card p-5 shadow-sm">
        <div className="mb-5 flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-ink">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-accent">
              Workspace access
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold leading-tight text-ink">
              Review invite request
            </h1>
            <p className="mt-2 text-sm leading-6 text-ink-3">
              Confirm before changing access. Email previews and link scanners cannot approve
              this request.
            </p>
          </div>
        </div>

        <div className="grid gap-3 rounded-lg border border-rule bg-paper p-4 text-sm">
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 size-4 text-ink-3" />
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-ink-3">Requester</p>
              <p className="mt-1 font-medium text-ink">{email}</p>
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-ink-3">Workspace</p>
            <p className="mt-1 font-medium text-ink">{organizationName}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-ink-3">Requested page</p>
            <a
              href={requestedUrl}
              className="mt-1 block break-all text-sm font-medium text-accent underline underline-offset-4"
            >
              {requestedUrl}
            </a>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={!isPending || state.kind === "loading"}
            onClick={() => setSelectedDecision("approve")}
            className={cn(
              "rounded-lg border p-4 text-left transition",
              selectedDecision === "approve"
                ? "border-ink bg-ink text-white"
                : "border-rule bg-paper text-ink hover:border-rule-strong"
            )}
          >
            <Check className="mb-3 size-4" />
            <span className="block text-sm font-semibold">Approve</span>
            <span className="mt-1 block text-xs leading-5 opacity-75">
              Send an invite and add them as a member.
            </span>
          </button>
          <button
            type="button"
            disabled={!isPending || state.kind === "loading"}
            onClick={() => setSelectedDecision("reject")}
            className={cn(
              "rounded-lg border p-4 text-left transition",
              selectedDecision === "reject"
                ? "border-ink bg-ink text-white"
                : "border-rule bg-paper text-ink hover:border-rule-strong"
            )}
          >
            <X className="mb-3 size-4" />
            <span className="block text-sm font-semibold">Reject</span>
            <span className="mt-1 block text-xs leading-5 opacity-75">
              Close the request without sending an invite.
            </span>
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {state.kind === "error" ? (
            <p className="text-sm text-danger">{state.message}</p>
          ) : state.kind === "done" ? (
            <p
              className={cn(
                "text-sm",
                state.status === "approved" ? "text-success" : "text-ink-3"
              )}
            >
              {state.message}
            </p>
          ) : (
            <p className="text-sm text-ink-3">This action applies to {organizationName}.</p>
          )}
          <Button
            type="button"
            size="lg"
            disabled={!isPending || state.kind === "loading"}
            onClick={() => submitDecision(selectedDecision)}
            className="self-start sm:self-auto"
          >
            {state.kind === "loading" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : selectedDecision === "approve" ? (
              <Check className="size-4" />
            ) : (
              <X className="size-4" />
            )}
            {selectedDecision === "approve" ? "Confirm approval" : "Confirm rejection"}
          </Button>
        </div>
      </div>
    </div>
  );
}
