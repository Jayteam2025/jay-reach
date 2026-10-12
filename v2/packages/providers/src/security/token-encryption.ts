/**
 * Token Encryption Helper
 *
 * Provides AES-256-GCM encryption for sensitive data (OAuth tokens, passwords).
 * Uses Web Crypto API available in Deno runtime.
 *
 * SECURITY:
 * - AES-256-GCM provides authenticated encryption
 * - Each encryption uses a unique IV (Initialization Vector)
 * - Encryption key must be set via TOKEN_ENCRYPTION_KEY env variable
 * - Key must be 32 bytes (256 bits), either hex (64 chars) or base64 (44 chars)
 *
 * To generate a new key (hex format):
 * ```
 * openssl rand -hex 32
 * ```
 * Or base64 format:
 * ```
 * const key = crypto.getRandomValues(new Uint8Array(32));
 * console.log(btoa(String.fromCharCode(...key)));
 * ```
 */

import { chiffrer, dechiffrer } from '@jay-reach/core/chiffrement.js';

/** Implémentation unique dans `@jay-reach/core` (clé `ENCRYPTION_KEY`, repli `TOKEN_ENCRYPTION_KEY`). */
export const encryptToken = chiffrer;
export const decryptToken = dechiffrer;

/**
 * Check if a string appears to be encrypted with the new format.
 * Old base64-only "encryption" will be shorter and won't have the IV prefix structure.
 *
 * This helps during migration to identify which tokens need re-encryption.
 */
export function isNewEncryptionFormat(data: string): boolean {
  try {
    const decoded = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    // New format has at least IV (12 bytes) + auth tag (16 bytes) + some data
    return decoded.length >= 12 + 16;
  } catch {
    return false;
  }
}

/**
 * Safely decrypt a token, handling both old (base64) and new (AES-GCM) formats.
 * During migration period, this allows gradual transition.
 *
 * @param encryptedData - Either base64-encoded plaintext (old) or AES-GCM encrypted (new)
 * @param fieldName - Name of the field for logging purposes
 * @returns Decrypted plaintext
 */
export async function decryptTokenSafe(
  encryptedData: string,
  fieldName = 'token'
): Promise<string> {
  // Try new encryption first
  try {
    const decrypted = await decryptToken(encryptedData);
    return decrypted;
  } catch (newFormatError) {
    const errorMsg = newFormatError instanceof Error ? newFormatError.message : String(newFormatError);
    console.warn(`Warning: AES-GCM decryption failed for ${fieldName}: ${errorMsg}`);

    // Fall back to old base64 "encryption"
    try {
      const decoded = atob(encryptedData);

      // Verify the decoded result is printable text (a real token), not binary garbage.
      // If AES-GCM encrypted data is decoded with atob(), it produces raw bytes (IV + ciphertext)
      // which are NOT valid token characters. Detect this to avoid sending garbage to APIs.
      const isDecodedPlaintext = /^[\x20-\x7E]+$/.test(decoded);
      if (isDecodedPlaintext) {
        console.warn(
          `Warning: ${fieldName} using legacy base64 encoding. Should be migrated to AES-256-GCM.`
        );
        return decoded;
      }

      // Base64 decoded to binary — the original data might be stored as raw plaintext
      // (e.g. Odoo API keys created before encryption was introduced in Jan 2026).
      const isOriginalPlaintext = /^[\x20-\x7E]+$/.test(encryptedData);
      if (isOriginalPlaintext) {
        console.warn(
          `Warning: ${fieldName} stored as plaintext (not encrypted). Should be migrated to AES-256-GCM.`
        );
        return encryptedData;
      }

      console.error(
        `[ERROR] ${fieldName}: AES-GCM decryption failed (${errorMsg}) and data is not valid base64 or plaintext. ` +
        `Check TOKEN_ENCRYPTION_KEY.`
      );
      throw new Error(
        `Failed to decrypt ${fieldName}: AES-GCM decryption failed and data is not recoverable.`
      );
    } catch (base64Error) {
      // atob() itself failed — check if the original data is plaintext
      const isOriginalPlaintext = /^[\x20-\x7E]+$/.test(encryptedData);
      if (isOriginalPlaintext) {
        console.warn(
          `Warning: ${fieldName} stored as plaintext (not base64, not encrypted). Should be migrated to AES-256-GCM.`
        );
        return encryptedData;
      }

      throw new Error(
        `Failed to decrypt ${fieldName}: not valid AES-GCM, base64, or plaintext format. AES-GCM error: ${errorMsg}`
      );
    }
  }
}

/**
 * Generate a new encryption key for initial setup.
 * Run this once to create TOKEN_ENCRYPTION_KEY value.
 *
 * Usage: Call this function and set the output as TOKEN_ENCRYPTION_KEY env var
 */
export function generateEncryptionKey(): string {
  const key = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...key));
}
