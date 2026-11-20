const normalize = (value: string) =>
  value.trim().replace(/\s+/g, " ").toLowerCase();

export function matchSeriesMember(
  ownerName: string | null,
  members: { id: string; name: string }[],
): string | null {
  const wanted = normalize(ownerName ?? "");
  if (!wanted) return null;

  const names = members.map((member) => ({
    id: member.id,
    name: normalize(member.name),
  }));
  const unique = (matches: { id: string }[]) =>
    new Set(matches.map((m) => m.id)).size === 1 ? matches[0].id : null;

  const fullMatches = names.filter((member) => member.name === wanted);
  if (fullMatches.length) return unique(fullMatches);
  return unique(names.filter((member) => member.name.split(" ")[0] === wanted));
}
