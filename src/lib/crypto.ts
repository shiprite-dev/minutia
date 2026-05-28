import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const CONFIG_SECRET_PREFIX = "minutia:v1:";

function getKey(): Buffer {
  const key = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is not set");
  return Buffer.from(key, "base64");
}

export function encrypt(plaintext: string): { ciphertext: string; iv: string } {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return {
    ciphertext: encrypted + ":" + tag,
    iv: iv.toString("hex"),
  };
}

export function decrypt(ciphertext: string, iv: string): string {
  const [encrypted, tag] = ciphertext.split(":");
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function getConfigSecretKey(): Buffer {
  const key =
    process.env.INSTANCE_CONFIG_ENCRYPTION_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.JWT_SECRET;
  if (!key) throw new Error("INSTANCE_CONFIG_ENCRYPTION_KEY, SUPABASE_SERVICE_ROLE_KEY, or JWT_SECRET is required");
  return createHash("sha256").update(key).digest();
}

export function isEncryptedConfigSecret(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith(CONFIG_SECRET_PREFIX));
}

export function encryptConfigSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getConfigSecretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CONFIG_SECRET_PREFIX}${iv.toString("base64url")}:${tag.toString("base64url")}:${ciphertext.toString("base64url")}`;
}

export function decryptConfigSecret(value: string): string {
  if (!isEncryptedConfigSecret(value)) return value;

  const [iv, tag, ciphertext] = value.slice(CONFIG_SECRET_PREFIX.length).split(":");
  if (!iv || !tag || !ciphertext) {
    throw new Error("Invalid encrypted config value");
  }

  const decipher = createDecipheriv(ALGORITHM, getConfigSecretKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
