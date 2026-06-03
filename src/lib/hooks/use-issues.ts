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
import type { CreateIssueInput } from "@/lib/schemas";

// ---------------------------------------------------------------------------
// Query key factory
// ---------------------------------------------------------------------------
export const issueKeys = {
  all: ["issues"] as const,
  list: (seriesId?: string) =>
    seriesId ? (["issues", seriesId] as const) : (["issues"] as const),
  detail: (id: string) => ["issues", "detail", id] as const,
};

type IssueListSnapshot = [readonly unknown[], Issue[] | undefined][];
type IssueListRow = Issue & { issue_updates?: { count: number }[] | null };

function issueListQueriesOnly(query: { state: { data: unknown } }) {
  return Array.isArray(query.state.data);
}

function getIssueListSnapshots(
  queryClient: ReturnType<typeof useQueryClient>
): IssueListSnapshot {
  return queryClient.getQueriesData<Issue[]>({
    queryKey: issueKeys.all,
    predicate: issueListQueriesOnly,
  });
}

function restoreIssueListSnapshots(
  queryClient: ReturnType<typeof useQueryClient>,
  snapshots: IssueListSnapshot
) {
  for (const [queryKey, data] of snapshots) {
    queryClient.setQueryData(queryKey, data);
  }
}

function updateCachedIssueLists(
  queryClient: ReturnType<typeof useQueryClient>,
  updater: (issue: Issue) => Issue
) {
  queryClient.setQueriesData<Issue[]>(
    {
      queryKey: issueKeys.all,
      predicate: issueListQueriesOnly,
    },
    (old) => old?.map(updater)
  );
}

// ---------------------------------------------------------------------------
// useIssues - list issues, optionally filtered by series
// ---------------------------------------------------------------------------
export function useIssues(seriesId?: string, enabled = true) {
  const supabase = createClient();

  return useQuery<Issue[]>({
    queryKey: issueKeys.list(seriesId),
    enabled,
    queryFn: async () => {
      let query = supabase
        .from("issues")
        .select("*, issue_updates(count)")
        .order("created_at", { ascending: false });

      if (seriesId) {
        query = query.eq("series_id", seriesId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row: IssueListRow) => ({
        ...row,
        update_count: row.issue_updates?.[0]?.count ?? 0,
        issue_updates: undefined,
      })) as Issue[];
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
        .select("*, updates:issue_updates(*), raised_in_meeting:meetings!raised_in_meeting_id(*)")
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
          title: input.title,
          description: input.description,
          category: input.category,
          priority: input.priority,
          owner_name: input.owner_name,
          due_date: input.due_date,
          raised_in_meeting_id: input.meeting_id,
          series_id: input.series_id,
          status: "open" as IssueStatus,
          source: "manual",
          owner_user_id: input.owner_name ? null : user.id,
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
      queryClient.invalidateQueries({
        queryKey: ["meetings", "detail", variables.meeting_id],
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
    {
      previousIssueLists: IssueListSnapshot;
      previousDetail: IssueWithUpdates | undefined;
    }
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
          resolved_in_meeting_id:
            newStatus === "resolved" ? meetingId : null,
        })
        .eq("id", issueId)
        .select()
        .single();

      if (issueError) throw issueError;

      const { error: updateError } = await supabase
        .from("issue_updates")
        .insert({
          issue_id: issueId,
          meeting_id: meetingId ?? null,
          updated_by: user?.id ?? "",
          author_type: "human",
          previous_status: oldStatus,
          new_status: newStatus,
          note: note ?? "",
        });

      if (updateError) throw updateError;

      return issue as Issue;
    },

    onMutate: async ({ issueId, newStatus, meetingId }) => {
      await queryClient.cancelQueries({ queryKey: issueKeys.all });
      await queryClient.cancelQueries({ queryKey: issueKeys.detail(issueId) });

      const previousIssueLists = getIssueListSnapshots(queryClient);
      const previousDetail = queryClient.getQueryData<IssueWithUpdates>(
        issueKeys.detail(issueId)
      );
      const resolvedMeetingId = newStatus === "resolved" ? meetingId ?? null : null;

      updateCachedIssueLists(queryClient, (issue) =>
        issue.id === issueId
          ? {
              ...issue,
              status: newStatus,
              resolved_in_meeting_id: resolvedMeetingId,
              update_count: (issue.update_count ?? 0) + 1,
            }
          : issue
      );

      queryClient.setQueryData<IssueWithUpdates>(
        issueKeys.detail(issueId),
        (old) =>
          old
            ? {
                ...old,
                status: newStatus,
                resolved_in_meeting_id: resolvedMeetingId,
              }
            : old
      );

      return { previousIssueLists, previousDetail };
    },

    onError: (_err, vars, context) => {
      if (context) {
        restoreIssueListSnapshots(queryClient, context.previousIssueLists);
        queryClient.setQueryData(
          issueKeys.detail(vars.issueId),
          context.previousDetail
        );
      }
    },

    onSuccess: (data, variables) => {
      updateCachedIssueLists(queryClient, (issue) =>
        issue.id === data.id ? { ...issue, ...data } : issue
      );
      queryClient.setQueryData<IssueWithUpdates>(
        issueKeys.detail(variables.issueId),
        (old) => (old ? { ...old, ...data, updates: old.updates } : old)
      );
    },

    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: issueKeys.detail(variables.issueId),
        refetchType: "inactive",
      });
      if (variables.meetingId) {
        queryClient.invalidateQueries({
          queryKey: ["meetings", "detail", variables.meetingId],
          refetchType: "inactive",
        });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// useUpdateIssue - update arbitrary issue fields (title, description, etc.)
// ---------------------------------------------------------------------------
export function useUpdateIssue() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      issueId,
      ...fields
    }: {
      issueId: string;
      title?: string;
      description?: string | null;
      owner_name?: string | null;
      due_date?: string | null;
      priority?: string;
    }) => {
      const { data, error } = await supabase
        .from("issues")
        .update(fields)
        .eq("id", issueId)
        .select()
        .single();

      if (error) throw error;
      return data as Issue;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: issueKeys.detail(data.id) });
      queryClient.invalidateQueries({ queryKey: issueKeys.all });
    },
  });
}

// ---------------------------------------------------------------------------
// useAddIssueUpdate - add a standalone timeline entry (note/status change)
// ---------------------------------------------------------------------------
export function useAddIssueUpdate() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation<
    IssueUpdate,
    Error,
    {
      issueId: string;
      note?: string;
      newStatus?: IssueStatus;
      oldStatus?: IssueStatus;
    },
    {
      tempUpdateId: string;
      previousIssueLists: IssueListSnapshot;
      previousDetail: IssueWithUpdates | undefined;
    }
  >({
    mutationFn: async ({
      issueId,
      note,
      newStatus,
      oldStatus,
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: update, error: updateError } = await supabase
        .from("issue_updates")
        .insert({
          issue_id: issueId,
          meeting_id: null,
          updated_by: user?.id ?? "",
          author_type: "human",
          previous_status: oldStatus ?? null,
          new_status: newStatus ?? null,
          note: note ?? null,
        })
        .select()
        .single();

      if (updateError) throw updateError;

      if (newStatus && newStatus !== oldStatus) {
        const { error: issueError } = await supabase
          .from("issues")
          .update({ status: newStatus })
          .eq("id", issueId);

        if (issueError) throw issueError;
      }

      return update as IssueUpdate;
    },

    onMutate: async ({ issueId, note, newStatus, oldStatus }) => {
      await queryClient.cancelQueries({ queryKey: issueKeys.all });
      await queryClient.cancelQueries({ queryKey: issueKeys.detail(issueId) });

      const previousIssueLists = getIssueListSnapshots(queryClient);
      const previousDetail = queryClient.getQueryData<IssueWithUpdates>(
        issueKeys.detail(issueId)
      );
      const tempUpdateId =
        globalThis.crypto?.randomUUID?.() ?? `optimistic-${Date.now()}`;
      const optimisticUpdate: IssueUpdate = {
        id: tempUpdateId,
        issue_id: issueId,
        meeting_id: null,
        updated_by: "",
        author_type: "human",
        previous_status: oldStatus ?? null,
        new_status: newStatus ?? null,
        note: note ?? null,
        created_at: new Date(),
      };
      const statusChanged = !!newStatus && newStatus !== oldStatus;

      queryClient.setQueryData<IssueWithUpdates>(
        issueKeys.detail(issueId),
        (old) =>
          old
            ? {
                ...old,
                status: statusChanged ? newStatus : old.status,
                updates: [optimisticUpdate, ...(old.updates ?? [])],
              }
            : old
      );

      updateCachedIssueLists(queryClient, (issue) =>
        issue.id === issueId
          ? {
              ...issue,
              status: statusChanged ? newStatus : issue.status,
              update_count: (issue.update_count ?? 0) + 1,
            }
          : issue
      );

      return { tempUpdateId, previousIssueLists, previousDetail };
    },

    onError: (_err, variables, context) => {
      if (!context) return;
      restoreIssueListSnapshots(queryClient, context.previousIssueLists);
      queryClient.setQueryData(
        issueKeys.detail(variables.issueId),
        context.previousDetail
      );
    },

    onSuccess: (data, variables, context) => {
      queryClient.setQueryData<IssueWithUpdates>(
        issueKeys.detail(variables.issueId),
        (old) =>
          old
            ? {
                ...old,
                updates: (old.updates ?? []).map((update) =>
                  update.id === context?.tempUpdateId ? data : update
                ),
              }
            : old
      );
    },

    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: issueKeys.detail(variables.issueId),
        refetchType: "inactive",
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
