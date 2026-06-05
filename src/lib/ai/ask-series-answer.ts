import { z } from "zod";

export const ASK_SERIES_UNSUPPORTED_ANSWER = "The source context does not prove the answer.";

const uuidLikeSchema = z.string().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
);

const providerCitationSchema = z.object({
  type: z.enum(["meeting", "issue", "decision", "notes"]).optional(),
  source_id: uuidLikeSchema,
  title: z.string().min(1).max(300).optional(),
  meeting_id: uuidLikeSchema.nullable().optional(),
  meeting_title: z.string().nullable().optional(),
  quote: z.string().optional(),
});

const providerAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(4000),
  citations: z.array(providerCitationSchema).default([]),
  unsupported: z.boolean().default(false),
});

const openRouterTextSchema = z
  .object({
    choices: z.array(
      z.object({
        message: z.object({
          content: z.union([
            z.string(),
            z.array(z.object({ text: z.string().optional() }).passthrough()),
          ]),
        }),
      }).passthrough()
    ).min(1),
  })
  .passthrough();

type ProviderCitation = z.infer<typeof providerCitationSchema>;

type SourceSummary = {
  id: string;
  title: string;
  meeting_id?: string | null;
  meeting_title?: string | null;
};

export type AskSeriesCitation = {
  type: "meeting" | "issue" | "decision" | "notes";
  source_id: string;
  title: string;
  meeting_id: string | null;
  meeting_title: string | null;
  href: string;
  label: string;
};

export type AskSeriesParsedAnswer = {
  answer: string;
  citations: AskSeriesCitation[];
  unsupported: boolean;
};

export function getTextFromOpenRouter(data: unknown) {
  const parsed = openRouterTextSchema.safeParse(data);
  if (!parsed.success) return "";

  const content = parsed.data.choices[0].message.content;
  if (typeof content === "string") return content;
  return content.map((part) => part.text ?? "").filter(Boolean).join("\n");
}

function citationHref(input: {
  type: AskSeriesCitation["type"];
  sourceId: string;
  meetingId: string | null;
}) {
  if (input.type === "issue") return `/issues/${input.sourceId}`;
  const meetingId = input.type === "meeting" || input.type === "notes"
    ? input.sourceId
    : input.meetingId;
  return meetingId ? `meetings/${meetingId}` : "";
}

function citationLabel(citation: Pick<AskSeriesCitation, "type" | "title" | "meeting_title">) {
  const sourceLabel = citation.meeting_title || citation.title;
  return citation.type === "notes" ? `Notes: ${sourceLabel}` : sourceLabel;
}

function resolveCitation(input: {
  citation: ProviderCitation;
  seriesId: string;
  meetings: Map<string, SourceSummary>;
  issues: Map<string, SourceSummary>;
  decisions: Map<string, SourceSummary>;
}): AskSeriesCitation | null {
  const inferredType =
    input.citation.type ??
    (input.meetings.has(input.citation.source_id)
      ? "notes"
      : input.issues.has(input.citation.source_id)
        ? "issue"
        : input.decisions.has(input.citation.source_id)
          ? "decision"
          : null);
  if (!inferredType) return null;

  const source =
    inferredType === "meeting" || inferredType === "notes"
      ? input.meetings.get(input.citation.source_id)
      : inferredType === "issue"
        ? input.issues.get(input.citation.source_id)
        : input.decisions.get(input.citation.source_id);
  if (!source) return null;

  const title = input.citation.title || source.title;
  const meeting_id = input.citation.meeting_id ?? source.meeting_id ?? null;
  const meeting_title = input.citation.meeting_title ?? source.meeting_title ?? null;
  const relativeHref = citationHref({
    type: inferredType,
    sourceId: input.citation.source_id,
    meetingId: meeting_id,
  });
  if (!relativeHref) return null;

  const citation: AskSeriesCitation = {
    type: inferredType,
    source_id: input.citation.source_id,
    title,
    meeting_id,
    meeting_title,
    href: relativeHref.startsWith("/issues")
      ? relativeHref
      : `/series/${input.seriesId}/${relativeHref}`,
    label: citationLabel({ type: inferredType, title, meeting_title }),
  };

  return citation;
}

export function parseAskSeriesAnswer(input: {
  providerData: unknown;
  seriesId: string;
  meetings: SourceSummary[];
  issues: SourceSummary[];
  decisions: SourceSummary[];
}): AskSeriesParsedAnswer {
  const parsed = providerAnswerSchema.parse(JSON.parse(getTextFromOpenRouter(input.providerData)));
  const meetings = new Map(input.meetings.map((source) => [source.id, source]));
  const issues = new Map(input.issues.map((source) => [source.id, source]));
  const decisions = new Map(input.decisions.map((source) => [source.id, source]));

  const citations = parsed.citations
    .map((citation) =>
      resolveCitation({
        citation,
        seriesId: input.seriesId,
        meetings,
        issues,
        decisions,
      })
    )
    .filter((citation): citation is AskSeriesCitation => citation !== null);

  if (parsed.unsupported || citations.length === 0) {
    return {
      answer: ASK_SERIES_UNSUPPORTED_ANSWER,
      citations: [],
      unsupported: true,
    };
  }

  return {
    answer: parsed.answer,
    citations,
    unsupported: false,
  };
}
