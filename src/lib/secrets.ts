import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { EncryptedSecret } from "./types";

const ALGORITHM = "aes-256-gcm";

export function encryptSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);

  return {
    algorithm: ALGORITHM,
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    createdAt: new Date().toISOString()
  };
}

export function decryptSecret(secret: EncryptedSecret): string {
  if (secret.algorithm !== ALGORITHM) throw new Error(`Unsupported secret algorithm: ${secret.algorithm}`);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(secret.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function encryptionKey() {
  const source = process.env.A2W_ENCRYPTION_KEY || process.env.AUTH_SECRET || "dev-only-change-me";
  return createHash("sha256").update(source).digest();
}
