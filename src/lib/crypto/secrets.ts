import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

function key() {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!secret || secret.length < 32) {
    throw new Error("Set INTEGRATION_ENCRYPTION_KEY to a random string of at least 32 characters before saving integration secrets.");
  }
  return scryptSync(secret, "growthpilot-integrations", 32);
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string) {
  if (!payload.startsWith("enc:v1:")) {
    throw new Error("Stored integration secret is in an unknown format.");
  }
  const [iv, tag, encrypted] = payload.slice(7).split(".");
  if (!iv || !tag || !encrypted) throw new Error("Stored integration secret is incomplete.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export function lastFour(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 4) return "";
  return trimmed.slice(-4);
}
