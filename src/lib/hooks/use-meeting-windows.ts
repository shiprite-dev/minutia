import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export function useMeetingWindows(meetingId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["meetings", "windows", meetingId],
    enabled: enabled && !!meetingId,
    refetchInterval: 2000,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("meeting_audio_segments")
        .select("seq, status, transcript_text")
        .eq("meeting_id", meetingId)
        .order("seq", { ascending: true });
      if (error) throw error;
      return (data ?? [])
        .filter((row) => row.status === "completed" && row.transcript_text?.trim())
        .map((row) => row.transcript_text as string);
    },
  });
}
