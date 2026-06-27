import { isManagedCloud } from "@/lib/admin/capabilities";

export function shouldPromptSeatBilling(): boolean {
  return isManagedCloud() && process.env.NEXT_PUBLIC_BILLING_LIVE === "true";
}
