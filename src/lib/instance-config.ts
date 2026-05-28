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
]);

type ConfigRow = {
  key: string;
  value: string | null;
  encrypted?: boolean | null;
};

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
  const { data } = await supabase
    .from("instance_config")
    .select("key, value, encrypted")
    .in("key", keys);

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
