const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_RE.test(value);

export function parseDevice(body: { device_id?: unknown; device_name?: unknown }) {
  const id = typeof body.device_id === "string" ? body.device_id : "";
  const name =
    typeof body.device_name === "string" ? body.device_name.trim() : "";
  if (!id || id.length > 100 || !name) return null;
  return { id, name: name.slice(0, 80) };
}
