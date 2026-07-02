import nodemailer from "nodemailer";
import { getInstanceConfigMap } from "@/lib/instance-config";
import {
  resolveSenderFrom,
  isDeliverableSender,
  formatSender,
  SENDER_NOT_CONFIGURED_MESSAGE,
} from "@/lib/email-sender";

export { escapeHtml } from "@/lib/escape-html";

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
};

export type MailMessage = {
  from?: string;
  to: string | string[];
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
};

export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const configMap = await getInstanceConfigMap([
    "smtp_host",
    "smtp_port",
    "smtp_user",
    "smtp_pass",
    "smtp_from",
  ]);

  const host = configMap.smtp_host || process.env.SMTP_HOST;
  const port = configMap.smtp_port || process.env.SMTP_PORT;
  const user = configMap.smtp_user || process.env.SMTP_USER;
  const pass = configMap.smtp_pass || process.env.SMTP_PASS;
  const from = configMap.smtp_from || process.env.EMAIL_FROM || process.env.SMTP_ADMIN_EMAIL;

  if (!host) return null;

  return {
    host,
    port: parseInt(port || "587", 10),
    user: user || "",
    pass: pass || "",
    from: from || "noreply@localhost",
  };
}

export function createMailTransport(smtp: SmtpConfig) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });
}

export async function sendMail(message: MailMessage) {
  const apiKey = process.env.RESEND_API_KEY;
  const testOutbox = process.env.MINUTIA_TEST_EMAIL_OUTBOX;

  // Resolve the sender once, honoring the Admin -> Settings value (smtp_from)
  // for BOTH the Resend and SMTP paths. Previously the Resend path consulted
  // only env vars, so a UI-configured sender was ignored and delivery fell back
  // to an invalid `noreply@localhost`, which providers reject.
  const { smtp_from } = await getInstanceConfigMap(["smtp_from"]);
  const resolved = resolveSenderFrom(
    message.from,
    smtp_from,
    process.env.EMAIL_FROM,
    process.env.SMTP_ADMIN_EMAIL
  );

  if (testOutbox) {
    const { appendFile, mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");

    const from = resolved ?? "Minutia <noreply@localhost>";
    await mkdir(dirname(testOutbox), { recursive: true });
    await appendFile(
      testOutbox,
      `${JSON.stringify({ ...message, from, sentAt: new Date().toISOString() })}\n`
    );
    return;
  }

  if (apiKey) {
    if (!isDeliverableSender(resolved)) {
      throw new Error(SENDER_NOT_CONFIGURED_MESSAGE);
    }
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "minutia/0.2.0",
      },
      body: JSON.stringify({
        from: formatSender(resolved!),
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        reply_to: message.replyTo,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.message || data?.error?.message || "Resend delivery failed");
    }

    return;
  }

  const smtp = await getSmtpConfig();
  if (!smtp) {
    throw new Error("Email is not configured. Set RESEND_API_KEY or SMTP settings.");
  }

  const from = resolved ?? smtp.from;
  if (!isDeliverableSender(from)) {
    throw new Error(SENDER_NOT_CONFIGURED_MESSAGE);
  }

  const transport = createMailTransport(smtp);
  await transport.sendMail({
    from: formatSender(from),
    to: message.to,
    replyTo: message.replyTo,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

export function absoluteAppUrl(requestUrl: string, path = "/"): string {
  const requestOrigin = new URL(requestUrl).origin;
  const base = process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || requestOrigin;
  return new URL(path, base).toString();
}
