import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

// Symmetric encryption for Xero tokens at rest (AES-256-GCM). The key is derived
// from XERO_TOKEN_KEY (preferred) or NEXTAUTH_SECRET. Stored format:
//   base64(iv).base64(authTag).base64(ciphertext)
// Rotate by setting a new XERO_TOKEN_KEY and re-connecting Xero.

function key(): Buffer {
  const secret = process.env.XERO_TOKEN_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("XERO_TOKEN_KEY or NEXTAUTH_SECRET required to encrypt Xero tokens");
  return createHash("sha256").update(secret).digest(); // 32 bytes
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, ctB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed encrypted token");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
