import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "../config/env";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  // Use first 32 bytes of the encryption key
  return Buffer.from(env.ENCRYPTION_KEY.slice(0, 32).padEnd(32, "0"));
}

/**
 * Encrypt a plaintext string
 * Returns: base64(iv + ciphertext + authTag)
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  let encrypted = cipher.update(plaintext, "utf8");
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, encrypted, authTag]).toString("base64");
}

/**
 * Decrypt a base64 encrypted string
 */
export function decrypt(encryptedBase64: string): string {
  const data = Buffer.from(encryptedBase64, "base64");

  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(data.length - TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString("utf8");
}
