"use client";

import { useQuery } from "@tanstack/react-query";

export type OrgMemberOption = {
  id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
};

export const orgMemberKeys = {
  all: ["org-members"] as const,
};

export function useOrgMembers() {
  return useQuery<OrgMemberOption[]>({
    queryKey: orgMemberKeys.all,
    queryFn: async () => {
      const res = await fetch("/api/workspace/members");
      if (!res.ok) throw new Error("Failed to load workspace members");
      const data = await res.json();
      return data.members ?? [];
    },
    staleTime: 60_000,
  });
}
