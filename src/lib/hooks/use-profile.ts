"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import type { UpdateProfileInput } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------
export const profileKeys = {
  current: ["profile"] as const,
};

// ---------------------------------------------------------------------------
// useProfile - fetch the current user's profile
// ---------------------------------------------------------------------------
export function useProfile() {
  const supabase = createClient();

  return useQuery<Profile>({
    queryKey: profileKeys.current,
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (error) throw error;
      return data as Profile;
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateProfile - update name and optionally user_settings
// ---------------------------------------------------------------------------
export function useUpdateProfile() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateProfileInput) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Update profile name
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .update({ name: input.name })
        .eq("id", user.id)
        .select()
        .single();

      if (profileError) throw profileError;

      // Update settings if provided
      if (input.settings) {
        const { error: settingsError } = await supabase
          .from("user_settings")
          .update(input.settings)
          .eq("user_id", user.id);

        if (settingsError) throw settingsError;
      }

      return profile as Profile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: profileKeys.current });
    },
  });
}
