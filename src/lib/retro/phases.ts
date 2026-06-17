import type { RetroPhase } from "./types";

// Single source of truth for the retro ritual's working phases (lobby -> commit).
// The DB CHECK constraint and retro_set_phase RPC must mirror ALL_PHASES exactly;
// scripts/verify-retro-contracts.test.mjs guards against drift.
export const RETRO_PHASES: RetroPhase[] = ["lobby", "reflect", "reveal", "discuss", "commit"];

// Reveal, theming, and dot-voting happen together in one "Reveal & Vote" phase.
export const RETRO_PHASE_LABELS: Record<RetroPhase, string> = {
  lobby: "Lobby",
  reflect: "Reflect",
  reveal: "Reveal & Vote",
  discuss: "Discuss",
  commit: "Commit",
  closed: "Commit",
};

// Every persistable phase value, including terminal "closed".
export const ALL_RETRO_PHASES: RetroPhase[] = [...RETRO_PHASES, "closed"];

export const RETRO_PHASE_LABEL_LIST: string[] = RETRO_PHASES.map((p) => RETRO_PHASE_LABELS[p]);
