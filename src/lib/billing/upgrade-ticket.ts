import { createHmac } from "node:crypto";

export function mintUpgradeTicket(input: {
  userId: string;
  organizationId: string;
  organizationName: string;
  email: string;
  secret: string;
  ttlSeconds?: number;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const exp = Math.floor(now.getTime() / 1000) + (input.ttlSeconds ?? 600);
  const payload = {
    u: input.userId,
    o: input.organizationId,
    n: input.organizationName,
    e: input.email,
    exp,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", input.secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}
