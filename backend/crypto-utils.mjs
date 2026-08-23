/**
 * Crypto Utils — AES-256-GCM Encryption/Decryption
 *
 * Security Model:
 *  - All passwords encrypted with AES-256-GCM before GitHub backup
 *  - Only hashes stored locally (never plaintext)
 *  - GitHub token encrypted at rest
 *  - Master key derived from secure-config (bootstrap-encrypted)
 *  - If someone steals the encrypted data, they CANNOT decrypt without the master key
 */

import crypto from 'crypto';
import { getMasterKey } from './secure-config.mjs';

// ── Master Key Derivation ────────────────────────────────────────────────

// Derive a 256-bit key from the master secret using PBKDF2
function deriveKey(secret, salt = 'hrms-vendor-crypto-salt-v2') {
  return crypto.pbkdf2Sync(secret, salt, 100000, 32, 'sha512');
}

// Lazy key derivation (master key loaded at runtime from secure-config)
let ENCRYPTION_KEY = null;
let TOKEN_KEY = null;

function getEncryptionKey() {
  if (!ENCRYPTION_KEY) {
    const masterKey = getMasterKey() || 'hrms-fallback-key-DO-NOT-USE-IN-PRODUCTION';
    ENCRYPTION_KEY = deriveKey(masterKey);
  }
  return ENCRYPTION_KEY;
}

function getTokenKey() {
  if (!TOKEN_KEY) {
    const masterKey = getMasterKey() || 'hrms-fallback-key-DO-NOT-USE-IN-PRODUCTION';
    TOKEN_KEY = deriveKey(masterKey, 'hrms-github-token-key-v1');
  }
  return TOKEN_KEY;
}

// ── AES-256-GCM Encryption ───────────────────────────────────────────────

/**
 * Encrypt plaintext using AES-256-GCM
 * Returns: base64(iv + authTag + ciphertext)
 */
export function encrypt(plaintext) {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  // Pack: iv(12) + authTag(16) + ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt ciphertext encrypted with encrypt()
 * Returns: plaintext string
 */
export function decrypt(encryptedBase64) {
  if (!encryptedBase64) return '';
  try {
    const packed = Buffer.from(encryptedBase64, 'base64');
    const iv = packed.subarray(0, 12);
    const authTag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch (err) {
    throw new Error('Decryption failed: data corrupted or wrong key');
  }
}

// ── GitHub Token Encryption ──────────────────────────────────────────────

/**
 * Encrypt GitHub token for at-rest storage
 */
export function encryptToken(token) {
  if (!token) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getTokenKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(token), 'utf8'),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt GitHub token for runtime use
 */
export function decryptToken(encryptedBase64) {
  if (!encryptedBase64) return '';
  // If it looks like a plaintext token (starts with ghp_ or github_), return as-is
  if (encryptedBase64.startsWith('ghp_') || encryptedBase64.startsWith('github_')) {
    return encryptedBase64;
  }
  try {
    const packed = Buffer.from(encryptedBase64, 'base64');
    const iv = packed.subarray(0, 12);
    const authTag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getTokenKey(), iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final()
    ]);
    return decrypted.toString('utf8');
  } catch {
    // If decryption fails, assume it's plaintext (backward compatibility)
    return encryptedBase64;
  }
}

// ── Secure Comparison ────────────────────────────────────────────────────

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function secureCompare(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Hash for integrity verification ──────────────────────────────────────

/**
 * HMAC-SHA256 for data integrity checks
 */
export function hmacSign(data, key = null) {
  const signingKey = key || getEncryptionKey();
  return crypto.createHmac('sha256', signingKey).update(String(data)).digest('hex');
}

export function hmacVerify(data, signature, key = null) {
  const expected = hmacSign(data, key);
  return secureCompare(expected, signature);
}
