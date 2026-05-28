import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { absoluteAppUrl } from "@/lib/app-url";
import { escapeHtml, sendMail } from "@/lib/email";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const schema = z.object({
  email: z.string().email(),
});

function emailNotConfiguredMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("Email is not configured")
    ? "Email is not configured for this workspace."
    : message || "Failed to send password reset email";
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const email = parsed.data.email.toLowerCase();
  const supabase = createServiceRoleClient();
  const redirectTo = absoluteAppUrl(request.url, "/auth/callback?next=/reset-password");
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("not found") || message.includes("user")) {
      return NextResponse.json({ sent: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const resetUrl = data.properties?.action_link;
  if (!resetUrl) {
    return NextResponse.json(
      { error: "Failed to create password reset link" },
      { status: 500 }
    );
  }

  const escapedResetUrl = escapeHtml(resetUrl);
  try {
    await sendMail({
      to: email,
      subject: "Reset your Minutia password",
      text: `Reset your Minutia password: ${resetUrl}`,
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#171717;">
          <p style="margin:0 0 18px;color:#d4572a;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">minutia</p>
          <h1 style="margin:0 0 12px;font-size:24px;line-height:30px;">Reset your password</h1>
          <p style="margin:0 0 20px;color:#6b665f;font-size:14px;line-height:22px;">Use this secure link to choose a new Minutia password.</p>
          <a href="${escapedResetUrl}" style="display:inline-block;border-radius:10px;background:#d4572a;color:#fff;padding:10px 14px;text-decoration:none;font-size:14px;font-weight:700;">Reset password</a>
          <p style="margin:20px 0 0;color:#6b665f;font-size:12px;line-height:18px;">If you did not request this, you can ignore this email.</p>
          <p style="margin:14px 0 0;color:#6b665f;font-size:12px;line-height:18px;word-break:break-all;">${escapedResetUrl}</p>
        </div>
      `,
    });
  } catch (err) {
    return NextResponse.json(
      { error: emailNotConfiguredMessage(err) },
      { status: 500 }
    );
  }

  return NextResponse.json({ sent: true });
}
