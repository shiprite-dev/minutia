import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

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
