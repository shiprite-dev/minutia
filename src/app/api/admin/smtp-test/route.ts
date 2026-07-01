import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/supabase/admin-auth";
import { rejectCrossOrigin } from "@/lib/request-origin";
import { createMailTransport, getSmtpConfig } from "@/lib/email";

const schema = z.object({
  recipient_email: z.string().email().optional(),
});

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
    const transport = createMailTransport(smtp);

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
