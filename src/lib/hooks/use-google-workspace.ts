"use client";

import { useQuery } from "@tanstack/react-query";
import type { WorkspaceDirectoryPerson } from "@/lib/google-workspace-directory";

export const workspaceKeys = {
  directory: (query: string) => ["workspace", "directory", query] as const,
};

export function useWorkspaceDirectorySearch(query: string, enabled: boolean) {
  const trimmedQuery = query.trim();

  return useQuery<WorkspaceDirectoryPerson[]>({
    queryKey: workspaceKeys.directory(trimmedQuery),
    queryFn: async () => {
      const res = await fetch(
        `/api/workspace/directory?q=${encodeURIComponent(trimmedQuery)}`
      );
      if (!res.ok) throw new Error("Failed to search Workspace Directory");
      const data = await res.json();
      return data.people;
    },
    enabled: enabled && trimmedQuery.length >= 2,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
