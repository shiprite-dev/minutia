#!/usr/bin/env bash
set -euo pipefail

# Poll a cold self-host stack until its core services are healthy, so the
# cold-start Playwright gate never races a half-booted Kong/Postgres/GoTrue.
# Reads BASE_URL (default http://localhost:3000), MINUTIA_SETUP_TOKEN (required),
# and TIMEOUT_SECONDS (default 420).

BASE_URL="${BASE_URL:-http://localhost:3000}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-420}"

if [[ -z "${MINUTIA_SETUP_TOKEN:-}" ]]; then
  echo "ERROR: MINUTIA_SETUP_TOKEN must be set to poll the cold-start stack." >&2
  exit 1
fi

url="${BASE_URL%/}/api/setup/check-env"
health_url="${BASE_URL%/}/api/admin/health"
start="$(date +%s)"
status="no response"

echo "Waiting for cold-start stack at ${url} (timeout ${TIMEOUT_SECONDS}s)..."

while true; do
  elapsed=$(( $(date +%s) - start ))
  if (( elapsed > TIMEOUT_SECONDS )); then
    echo "ERROR: stack not healthy after ${TIMEOUT_SECONDS}s. Last status: ${status}" >&2
    exit 1
  fi

  body="$(curl -sS -m 10 -H "x-minutia-setup-token: ${MINUTIA_SETUP_TOKEN}" "${url}" 2>/dev/null || true)"
  # requireAdmin accepts the setup token while setup is incomplete, and the
  # health route is the only pre-setup probe that exercises storage-api.
  health="$(curl -sS -m 10 -H "x-minutia-setup-token: ${MINUTIA_SETUP_TOKEN}" "${health_url}" 2>/dev/null || true)"
  status="$(BODY="${body}" HEALTH="${health}" node -e '
    const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
    const d = parse(process.env.BODY);
    const h = parse(process.env.HEALTH);
    const dbOk = d && d.db && d.db.connected === true;
    const authOk = d && d.services && d.services.auth === "healthy";
    const restOk = d && d.services && d.services.rest === "healthy";
    const storageOk = Boolean(
      h && Array.isArray(h.services) &&
      h.services.some((s) => s.service === "storage" && s.status === "ok")
    );
    if (dbOk && authOk && restOk && storageOk) {
      console.log("ready " + (d.db.latency_ms ?? "?"));
    } else {
      const pending = [];
      if (!dbOk) pending.push("db");
      if (!authOk) pending.push("auth");
      if (!restOk) pending.push("rest");
      if (!storageOk) pending.push("storage");
      console.log("pending:" + pending.join(","));
    }
  ' 2>/dev/null || echo "waiting")"

  if [[ "${status}" == ready* ]]; then
    latency="${status#ready }"
    echo "Cold-start stack ready after ${elapsed}s (db latency ${latency}ms)."
    exit 0
  fi

  echo "  [${elapsed}s] not ready yet: ${status}"
  sleep 5
done
