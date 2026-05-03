import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import nodemailer from "nodemailer";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const schema = z.object({
  recipient_email: z.string().email().optional(),
});

async function getSmtpConfig(): Promise<{
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
} | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("instance_config")
    .select("key, value")
    .in("key", ["smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from"]);

  const configMap: Record<string, string | null> = {};
  for (const row of data ?? []) {
    configMap[row.key] = row.value;
  }

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

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = schema.safeParse(body);
  const recipientEmail = parsed.success ? parsed.data.recipient_email : undefined;

  const smtp = await getSmtpConfig();
  if (!smtp) {
    return NextResponse.json(
      { success: false, error: "SMTP is not configured. Set smtp_host in instance settings or SMTP_HOST env var." },
      { status: 400 }
    );
  }

  try {
    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
    });

    await transport.verify();

    const to = recipientEmail || smtp.from;

    await transport.sendMail({
      from: `Minutia <${smtp.from}>`,
      to,
      subject: "Minutia SMTP Test",
      text: "Your SMTP configuration is working correctly. This is a test email from your Minutia instance.",
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
          <h2 style="font-size: 18px; color: #1a1a1a; margin: 0 0 12px;">SMTP Test Successful</h2>
          <p style="font-size: 14px; color: #666; line-height: 1.5; margin: 0;">
            Your Minutia instance can send emails. This test was triggered from the setup wizard or admin settings.
          </p>
        </div>
      `,
    });

    return NextResponse.json({
      success: true,
      message: `Test email sent to ${to}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown SMTP error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
