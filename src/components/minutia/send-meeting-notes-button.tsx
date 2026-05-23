"use client";

import * as React from "react";
import { Mail, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

function extractEmails(values: string[]) {
  const emails = new Set<string>();
  const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  for (const value of values) {
    for (const match of value.match(regex) ?? []) emails.add(match.toLowerCase());
  }
  return [...emails];
}

type Props = {
  meetingId: string;
  attendees: string[];
};

export function SendMeetingNotesButton({ meetingId, attendees }: Props) {
  const defaultRecipients = React.useMemo(
    () => extractEmails(attendees).join(", "),
    [attendees]
  );
  const [open, setOpen] = React.useState(false);
  const [recipients, setRecipients] = React.useState(defaultRecipients);
  const [status, setStatus] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = React.useState("");

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setRecipients(defaultRecipients);
      setStatus("idle");
      setMessage("");
    }
    setOpen(nextOpen);
  }

  async function sendNotes() {
    const recipientList = recipients
      .split(/[,\s]+/)
      .map((email) => email.trim())
      .filter(Boolean);

    setStatus("sending");
    setMessage("");

    try {
      const res = await fetch(`/api/meetings/${meetingId}/send-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipients: recipientList }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send notes");
      setStatus("sent");
      setMessage(`Sent to ${data.sent} recipient${data.sent === 1 ? "" : "s"}.`);
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Failed to send notes");
    }
  }

  const isSending = status === "sending";
  const canSend = recipients.trim().length > 0 && !isSending;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="border-rule bg-paper text-ink hover:bg-paper-2">
          <Mail className="size-4" />
          Send notes
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send meeting notes</DialogTitle>
          <DialogDescription>
            Recipients get a branded recap with direct issue links back into Minutia.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="meeting-note-recipients" className="text-sm font-medium text-ink">
            Recipients
          </label>
          <Textarea
            id="meeting-note-recipients"
            value={recipients}
            onChange={(event) => setRecipients(event.target.value)}
            placeholder="alex@company.com, sam@company.com"
            className="min-h-24 font-sans text-sm"
          />
          <p className="text-xs text-ink-4">
            Separate emails with commas, spaces, or new lines.
          </p>
        </div>
        {message && (
          <p
            className={
              status === "error"
                ? "text-sm text-danger"
                : "inline-flex items-center gap-2 text-sm text-success"
            }
          >
            {status === "sent" && <CheckCircle2 className="size-4" />}
            {message}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button
            onClick={sendNotes}
            disabled={!canSend}
            className="bg-accent text-white hover:bg-accent-hover"
          >
            {isSending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
