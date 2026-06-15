/**
 * Tests for Token Encryption Module
 *
 * Tests AES-256-GCM encryption/decryption functionality
 * including backward compatibility with legacy base64 format.
 */

import { assertEquals, assertNotEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encryptToken, decryptToken, decryptTokenSafe, isNewEncryptionFormat, generateEncryptionKey } from "./token-encryption.ts";

// Test constants
const TEST_PLAINTEXT = "ya29.access_token_example_12345";
const TEST_LEGACY_BASE64 = btoa("legacy_token_in_base64");

Deno.test("encryptToken - produces valid base64 output", async () => {
  const encrypted = await encryptToken(TEST_PLAINTEXT);

  // Should be valid base64
  const decoded = atob(encrypted);
  assertEquals(typeof decoded, "string");

  // Should be longer than original (IV + ciphertext + tag)
  assertEquals(encrypted.length > TEST_PLAINTEXT.length, true);
});

Deno.test("encryptToken - produces unique outputs (IV randomness)", async () => {
  const encrypted1 = await encryptToken(TEST_PLAINTEXT);
  const encrypted2 = await encryptToken(TEST_PLAINTEXT);

  // Same input should produce different outputs (unique IV)
  assertNotEquals(encrypted1, encrypted2);
});

Deno.test("encryptToken - handles empty string", async () => {
  const encrypted = await encryptToken("");

  // Should successfully encrypt empty string
  assertEquals(typeof encrypted, "string");
  assertEquals(encrypted.length > 0, true);
});

Deno.test("encryptToken - handles unicode characters", async () => {
  const unicodeText = "Token avec caractères spéciaux: émojis 🔐 et accents éèà";
  const encrypted = await encryptToken(unicodeText);
  const decrypted = await decryptToken(encrypted);

  assertEquals(decrypted, unicodeText);
});

Deno.test("decryptToken - reverses encryptToken", async () => {
  const encrypted = await encryptToken(TEST_PLAINTEXT);
  const decrypted = await decryptToken(encrypted);

  assertEquals(decrypted, TEST_PLAINTEXT);
});

Deno.test("decryptToken - rejects truncated ciphertext", async () => {
  const encrypted = await encryptToken(TEST_PLAINTEXT);
  const truncated = encrypted.substring(0, 20); // Too short

  await assertRejects(
    () => decryptToken(truncated),
    Error,
    "Invalid ciphertext: too short"
  );
});

Deno.test("decryptToken - rejects tampered ciphertext", async () => {
  const encrypted = await encryptToken(TEST_PLAINTEXT);

  // Tamper with the ciphertext (flip a bit)
  const bytes = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  bytes[20] ^= 0xff; // Flip bits in the middle
  const tampered = btoa(String.fromCharCode(...bytes));

  await assertRejects(
    () => decryptToken(tampered),
    Error // GCM authentication will fail
  );
});

Deno.test("decryptTokenSafe - handles AES-256-GCM format", async () => {
  const encrypted = await encryptToken(TEST_PLAINTEXT);
  const decrypted = await decryptTokenSafe(encrypted, "test_token");

  assertEquals(decrypted, TEST_PLAINTEXT);
});

Deno.test("decryptTokenSafe - handles legacy base64 format", async () => {
  const legacyToken = "legacy_plain_token";
  const legacyBase64 = btoa(legacyToken);

  const decrypted = await decryptTokenSafe(legacyBase64, "legacy_token");

  assertEquals(decrypted, legacyToken);
});

Deno.test("decryptTokenSafe - rejects invalid format", async () => {
  const invalidData = "not-valid-base64-!!!@@@";

  await assertRejects(
    () => decryptTokenSafe(invalidData, "invalid_token"),
    Error,
    "Failed to decrypt invalid_token"
  );
});

Deno.test("isNewEncryptionFormat - detects AES-GCM format", async () => {
  const encrypted = await encryptToken(TEST_PLAINTEXT);

  assertEquals(isNewEncryptionFormat(encrypted), true);
});

Deno.test("isNewEncryptionFormat - detects legacy base64 format", () => {
  const shortLegacy = btoa("short");

  // Short base64 should not be detected as new format
  // (less than IV + tag length)
  assertEquals(isNewEncryptionFormat(shortLegacy), false);
});

Deno.test("isNewEncryptionFormat - handles invalid base64", () => {
  const invalid = "not-valid-base64!!!";

  assertEquals(isNewEncryptionFormat(invalid), false);
});

Deno.test("generateEncryptionKey - produces valid 32-byte key", () => {
  const key = generateEncryptionKey();

  // Should be valid base64
  const decoded = atob(key);
  const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));

  assertEquals(bytes.length, 32);
});

Deno.test("generateEncryptionKey - produces unique keys", () => {
  const key1 = generateEncryptionKey();
  const key2 = generateEncryptionKey();

  assertNotEquals(key1, key2);
});

// Integration test: full encrypt-decrypt cycle
Deno.test("Integration - full token lifecycle", async () => {
  const tokens = [
    "ya29.a0AfH6SMBxxxxxxx", // Google-style access token
    "EAADxxxxxxx",           // Facebook-style token
    "sk_live_xxxxxxx",       // Stripe-style key
    "xoxb-xxxxxxx",          // Slack bot token
  ];

  for (const originalToken of tokens) {
    const encrypted = await encryptToken(originalToken);
    const decrypted = await decryptToken(encrypted);

    assertEquals(decrypted, originalToken, `Failed for token type: ${originalToken.substring(0, 5)}`);
  }
});

// Migration scenario test
Deno.test("Migration - handles mixed token formats", async () => {
  // Simulate a migration scenario with both formats
  const newToken = await encryptToken("new_encrypted_token");
  const legacyToken = btoa("old_base64_token");

  // Both should decrypt successfully
  const decryptedNew = await decryptTokenSafe(newToken, "new_token");
  const decryptedLegacy = await decryptTokenSafe(legacyToken, "legacy_token");

  assertEquals(decryptedNew, "new_encrypted_token");
  assertEquals(decryptedLegacy, "old_base64_token");
});
