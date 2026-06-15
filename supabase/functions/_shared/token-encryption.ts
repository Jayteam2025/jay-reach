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

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits recommended for GCM
const TAG_LENGTH = 128; // Authentication tag length in bits

/**
 * Decode a hex string to Uint8Array.
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Get the encryption key from environment variable.
 * Accepts both hex (64 chars) and base64 (44 chars) formats.
 * Throws if not configured.
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  const keyValue = Deno.env.get('TOKEN_ENCRYPTION_KEY');

  if (!keyValue) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY not configured. Set a 32-byte key in hex (64 chars) or base64 (44 chars) format.'
    );
  }

  let keyBytes: Uint8Array;

  // Detect format: hex is 64 chars of [0-9a-fA-F], base64 is ~44 chars with [A-Za-z0-9+/=]
  if (/^[0-9a-fA-F]{64}$/.test(keyValue)) {
    // Hex format
    keyBytes = hexToBytes(keyValue);
  } else {
    // Base64 format
    try {
      keyBytes = Uint8Array.from(atob(keyValue), (c) => c.charCodeAt(0));
    } catch {
      throw new Error(
        'TOKEN_ENCRYPTION_KEY is not valid hex (64 chars) or base64. Check the format.'
      );
    }
  }

  if (keyBytes.length !== 32) {
    throw new Error(`Invalid key length: expected 32 bytes, got ${keyBytes.length}`);
  }

  return await crypto.subtle.importKey('raw', keyBytes, { name: ALGORITHM }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Encrypt sensitive data using AES-256-GCM.
 *
 * @param plaintext - The string to encrypt
 * @returns Base64-encoded ciphertext with IV prepended (format: IV || ciphertext)
 */
export async function encryptToken(plaintext: string): Promise<string> {
  const key = await getEncryptionKey();

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Encode plaintext to bytes
  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(plaintext);

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    plaintextBytes
  );

  // Combine IV + ciphertext
  const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), IV_LENGTH);

  // Return as base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt data that was encrypted with encryptToken.
 *
 * @param ciphertext - Base64-encoded ciphertext (IV || encrypted data)
 * @returns The original plaintext string
 */
export async function decryptToken(ciphertext: string): Promise<string> {
  const key = await getEncryptionKey();

  // Decode from base64 with error handling
  let combined: Uint8Array;
  try {
    combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  } catch {
    throw new Error('Invalid ciphertext: not valid base64');
  }

  if (combined.length < IV_LENGTH + 16) {
    throw new Error('Invalid ciphertext: too short');
  }

  // Extract IV and ciphertext
  const iv = combined.slice(0, IV_LENGTH);
  const encryptedData = combined.slice(IV_LENGTH);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    encryptedData
  );

  // Decode to string
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

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
    return decoded.length >= IV_LENGTH + 16;
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
    console.warn(`⚠️ AES-GCM decryption failed for ${fieldName}: ${errorMsg}`);

    // Fall back to old base64 "encryption"
    try {
      const decoded = atob(encryptedData);

      // Verify the decoded result is printable text (a real token), not binary garbage.
      // If AES-GCM encrypted data is decoded with atob(), it produces raw bytes (IV + ciphertext)
      // which are NOT valid token characters. Detect this to avoid sending garbage to APIs.
      const isDecodedPlaintext = /^[\x20-\x7E]+$/.test(decoded);
      if (isDecodedPlaintext) {
        console.warn(
          `⚠️ ${fieldName} using legacy base64 encoding. Should be migrated to AES-256-GCM.`
        );
        return decoded;
      }

      // Base64 decoded to binary — the original data might be stored as raw plaintext
      // (e.g. Odoo API keys created before encryption was introduced in Jan 2026).
      const isOriginalPlaintext = /^[\x20-\x7E]+$/.test(encryptedData);
      if (isOriginalPlaintext) {
        console.warn(
          `⚠️ ${fieldName} stored as plaintext (not encrypted). Should be migrated to AES-256-GCM.`
        );
        return encryptedData;
      }

      console.error(
        `❌ ${fieldName}: AES-GCM decryption failed (${errorMsg}) and data is not valid base64 or plaintext. ` +
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
          `⚠️ ${fieldName} stored as plaintext (not base64, not encrypted). Should be migrated to AES-256-GCM.`
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
