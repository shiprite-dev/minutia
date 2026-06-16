export const VOTE_BUDGET = 6;

/** Dots a voter has left, given how many they have used. Never negative, never over budget. */
export const remainingVotes = (used: number) =>
  Math.max(0, VOTE_BUDGET - Math.max(0, used));
