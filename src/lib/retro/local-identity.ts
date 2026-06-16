"use client";

// Anonymous identity for a guest on a single board, persisted in localStorage.
// participant_key authorizes that guest's own card/vote writes in the RPCs.
// facilitator_token is the creator-only secret that grants ritual control.

const rand = () => crypto.randomUUID().replace(/-/g, "");

export function participantKey(boardToken: string): string {
  const k = `retro:pk:${boardToken}`;
  let v = localStorage.getItem(k);
  if (!v) {
    v = rand();
    localStorage.setItem(k, v);
  }
  return v;
}

export function saveFacilitatorToken(boardToken: string, ft: string): void {
  localStorage.setItem(`retro:ft:${boardToken}`, ft);
}

export function facilitatorToken(boardToken: string): string | null {
  return localStorage.getItem(`retro:ft:${boardToken}`);
}

const NAME_KEY = "retro:name";
const COLOR_KEY = "retro:color";

export function savedName(): string {
  return localStorage.getItem(NAME_KEY) ?? "";
}

export function rememberName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

export function savedColor(): string {
  return localStorage.getItem(COLOR_KEY) ?? "";
}

export function rememberColor(color: string): void {
  localStorage.setItem(COLOR_KEY, color);
}
