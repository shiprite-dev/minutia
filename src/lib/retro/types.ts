export type RetroPhase =
  | "lobby"
  | "reflect"
  | "reveal"
  | "discuss"
  | "commit"
  | "closed";

export type PastelColor = "amber" | "rose" | "sage" | "sky" | "lilac" | "sand";

export interface RetroColumn {
  id: string;
  title: string;
}

export interface RetroCard {
  id: string;
  column_id: string;
  author_key: string;
  author_name: string;
  color: PastelColor;
  text: string;
  group_id: string | null;
  sort_order: number;
}

export interface RetroParticipant {
  participant_key: string;
  name: string;
  color: PastelColor;
  is_facilitator: boolean;
}

export interface RetroAction {
  id: string;
  text: string;
  owner_name: string;
  due: string;
  color: PastelColor;
  graduated_issue_id: string | null;
}

export interface RetroCarry {
  id: string;
  text: string;
  done: boolean;
}

export interface RetroSnapshot {
  board: {
    id: string;
    name: string;
    template: string;
    columns: RetroColumn[];
    phase: RetroPhase;
    phase_started_at: string | null;
    settings: Record<string, unknown>;
    saved_to_series_id: string | null;
    expires_at: string;
  };
  participants: RetroParticipant[];
  cards: RetroCard[];
  votes: Record<string, number>;
  my_votes: string[];
  actions: RetroAction[];
  carryover: RetroCarry[];
}

export type RetroBroadcast =
  | { t: "card.added" | "card.updated" | "card.deleted"; key: string }
  | { t: "vote.changed"; card_id: string }
  | { t: "phase.changed"; phase: RetroPhase }
  | { t: "action.changed" }
  | { t: "carry.toggled"; id: string };
