import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  decryptConfigSecret,
  encryptConfigSecret,
  isEncryptedConfigSecret,
} from "@/lib/crypto";

export const SECRET_CONFIG_KEYS = new Set([
  "smtp_pass",
  "ai_api_key",
  "google_client_secret",
  "slack_webhook_url",
  "reminder_webhook_url",
]);

type ConfigRow = {
  key: string;
  value: string | null;
  encrypted?: boolean | null;
};

/** The instance_config read failed. Never confuse this with unset config:
 * destructive decisions (audio deletion) must fail closed on it. */
export class InstanceConfigReadError extends Error {
  constructor(cause: unknown) {
    super("Instance configuration is unavailable", { cause });
    this.name = "InstanceConfigReadError";
  }
}

export function prepareInstanceConfigValue(key: string, value: string | null) {
  if (!SECRET_CONFIG_KEYS.has(key) || value === null) return value;
  return encryptConfigSecret(value);
}

export function displayInstanceConfigValue(row: ConfigRow) {
  if (row.encrypted) return row.value ? "configured" : null;
  return row.value;
}

export async function getInstanceConfigMap(keys: string[]) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("instance_config")
    .select("key, value, encrypted")
    .in("key", keys);

  // A failed read must never masquerade as unset config: callers would treat a
  // broken read as "use the default", which is destructive for retention.
  if (error) {
    throw new InstanceConfigReadError(error);
  }

  const configMap: Record<string, string | null> = {};
  const legacyUpdates: Promise<unknown>[] = [];

  for (const row of (data ?? []) as ConfigRow[]) {
    if (!row.encrypted || row.value === null) {
      configMap[row.key] = row.value;
      continue;
    }

    configMap[row.key] = decryptConfigSecret(row.value);

    if (SECRET_CONFIG_KEYS.has(row.key) && !isEncryptedConfigSecret(row.value)) {
      legacyUpdates.push(
        Promise.resolve(
          supabase
            .from("instance_config")
            .update({ value: encryptConfigSecret(row.value), updated_at: new Date().toISOString() })
            .eq("key", row.key)
        )
      );
    }
  }

  if (legacyUpdates.length > 0) {
    await Promise.allSettled(legacyUpdates);
  }

  return configMap;
}
