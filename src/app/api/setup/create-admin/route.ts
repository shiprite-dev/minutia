import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const createAdminSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required").max(100),
});

export async function POST(request: NextRequest) {
  const supabase = createServiceRoleClient();

  const { data: existingAdmins, error: checkError } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .limit(1);

  if (checkError) {
    return NextResponse.json(
      { error: "Failed to check existing admins" },
      { status: 500 }
    );
  }

  if (existingAdmins && existingAdmins.length > 0) {
    return NextResponse.json(
      { error: "An admin account already exists" },
      { status: 409 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createAdminSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { email, password, name } = parsed.data;

  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

  if (authError) {
    return NextResponse.json(
      { error: authError.message },
      { status: 500 }
    );
  }

  const userId = authData.user.id;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ name, role: "admin" })
    .eq("id", userId);

  if (profileError) {
    return NextResponse.json(
      { error: "User created but failed to set admin role: " + profileError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    user_id: userId,
    email,
    role: "admin",
  });
}
