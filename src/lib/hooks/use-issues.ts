"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type {
  Issue,
  IssueWithUpdates,
  IssueStatus,
  IssueUpdate,
} from "@/lib/types";
import type {
  CreateIssueInput,
  UpdateIssueStatusInput,
} from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------
export const issueKeys = {
  all: ["issues"] as const,
  list: (seriesId?: string) =>
    seriesId ? (["issues", seriesId] as const) : (["issues"] as const),
  detail: (id: string) => ["issues", "detail", id] as const,
};

// ---------------------------------------------------------------------------
// useIssues - list issues, optionally filtered by series
// ---------------------------------------------------------------------------
export function useIssues(seriesId?: string) {
  const supabase = createClient();

  return useQuery<Issue[]>({
    queryKey: issueKeys.list(seriesId),
    queryFn: async () => {
      let query = supabase
        .from("issues")
        .select("*")
        .order("created_at", { ascending: false });

      if (seriesId) {
        query = query.eq("series_id", seriesId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Issue[];
    },
  });
}

// ---------------------------------------------------------------------------
// useIssue - single issue with updates and meeting context
// ---------------------------------------------------------------------------
export function useIssue(id: string) {
  const supabase = createClient();

  return useQuery<IssueWithUpdates>({
    queryKey: issueKeys.detail(id),
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("issues")
        .select("*, updates:issue_updates(*), raised_in_meeting:meetings!meeting_id(*)")
        .eq("id", id)
        .single();

      if (error) throw error;
      return data as unknown as IssueWithUpdates;
    },
  });
}

// ---------------------------------------------------------------------------
// useCreateIssue
// ---------------------------------------------------------------------------
export function useCreateIssue() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: CreateIssueInput & { meeting_id: string; series_id: string }
    ) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("issues")
        .insert({
          ...input,
          status: "open" as IssueStatus,
          source: "manual",
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Issue;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: issueKeys.all });
      queryClient.invalidateQueries({
        queryKey: issueKeys.list(variables.series_id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateIssueStatus - optimistic update + creates IssueUpdate record
// ---------------------------------------------------------------------------
export function useUpdateIssueStatus() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation<
    Issue,
    Error,
    {
      issueId: string;
      seriesId: string;
      oldStatus: IssueStatus;
      newStatus: IssueStatus;
      note?: string;
      meetingId?: string;
    },
    { previousIssues: Issue[] | undefined; seriesId: string }
  >({
    mutationFn: async ({ issueId, oldStatus, newStatus, note, meetingId }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Update the issue status
      const { data: issue, error: issueError } = await supabase
        .from("issues")
        .update({
          status: newStatus,
          resolved_at:
            newStatus === "resolved" ? new Date().toISOString() : null,
        })
        .eq("id", issueId)
        .select()
        .single();

      if (issueError) throw issueError;

      // Create the IssueUpdate record
      const { error: updateError } = await supabase
        .from("issue_updates")
        .insert({
          issue_id: issueId,
          meeting_id: meetingId ?? null,
          author_id: user?.id ?? null,
          author_type: "human",
          old_status: oldStatus,
          new_status: newStatus,
          note: note ?? null,
        });

      if (updateError) throw updateError;

      return issue as Issue;
    },

    // Optimistic update
    onMutate: async ({ issueId, newStatus, seriesId }) => {
      await queryClient.cancelQueries({ queryKey: issueKeys.list(seriesId) });

      const previousIssues = queryClient.getQueryData<Issue[]>(
        issueKeys.list(seriesId)
      );

      queryClient.setQueryData<Issue[]>(
        issueKeys.list(seriesId),
        (old) =>
          old?.map((issue) =>
            issue.id === issueId ? { ...issue, status: newStatus } : issue
          )
      );

      return { previousIssues, seriesId };
    },

    onError: (_err, _vars, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(
          issueKeys.list(context.seriesId),
          context.previousIssues
        );
      }
    },

    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: issueKeys.all });
      queryClient.invalidateQueries({
        queryKey: issueKeys.detail(variables.issueId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// useDeleteIssue
// ---------------------------------------------------------------------------
export function useDeleteIssue() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (issueId: string) => {
      const { error } = await supabase
        .from("issues")
        .delete()
        .eq("id", issueId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: issueKeys.all });
    },
  });
}
