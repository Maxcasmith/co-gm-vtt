import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";

// Validate encryption key at module load
const ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
  throw new Error(
    "TOKEN_ENCRYPTION_KEY must be set in environment and be exactly 32 characters",
  );
}

const ENCRYPTION_KEY_BUFFER = Buffer.from(ENCRYPTION_KEY, "utf8");

export class EncryptionService {
  /**
   * Encrypts a plaintext string
   * Returns format: iv:encryptedData (both hex encoded)
   */
  static encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY_BUFFER, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    return iv.toString("hex") + ":" + encrypted;
  }

  /**
   * Decrypts an encrypted string
   * Expects format: iv:encryptedData (both hex encoded)
   */
  static decrypt(text: string): string {
    const parts = text.split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid encrypted text format");
    }

    const ivHex = parts[0];
    const encryptedHex = parts[1];

    if (!ivHex || !encryptedHex) {
      throw new Error("Invalid encrypted text format");
    }

    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      ENCRYPTION_KEY_BUFFER,
      iv,
    );

    const decrypted =
      decipher.update(encryptedHex, "hex", "utf8") + decipher.final("utf8");

    return decrypted;
  }
}
