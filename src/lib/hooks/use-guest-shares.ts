"use client";

import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { GuestShare, ShareResourceType, SharePermission } from "@/lib/types";

interface CreateGuestShareInput {
  resource_type: ShareResourceType;
  resource_id: string;
  permissions?: SharePermission;
  expires_at?: string;
}

export function useCreateGuestShare() {
  const supabase = createClient();

  return useMutation({
    mutationFn: async (input: CreateGuestShareInput): Promise<GuestShare> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const token = crypto.randomUUID();

      const { data, error } = await supabase
        .from("guest_shares")
        .insert({
          token,
          resource_type: input.resource_type,
          resource_id: input.resource_id,
          permissions: input.permissions ?? "view",
          created_by: user.id,
          expires_at: input.expires_at ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      return data as GuestShare;
    },
  });
}

/**
 * Build the full share URL for a guest share token.
 */
export function getShareUrl(token: string): string {
  if (typeof window !== "undefined") {
    return `${window.location.origin}/share/${token}`;
  }
  return `/share/${token}`;
}
