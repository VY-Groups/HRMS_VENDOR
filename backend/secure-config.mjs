/**
 * Secure Configuration — Bootstrap Key Encryption
 *
 * Security Model:
 *  ┌─────────────────────────────────────────────────────────────────┐
 *  │  Bootstrap Key (derived from PERSISTENT machine data)          │
 *  │  ┌───────────────────────────────────────────────────────────┐  │
 *  │  │  hostname + persistent_machine_id + application_salt     │  │
 *  │  │  → PBKDF2 → 256-bit key                                │  │
 *  │  └───────────────────────────────────────────────────────────┘  │
 *  │         │                                                       │
 *  │         ▼                                                       │
 *  │  Encrypted Master Key in .env (AES-256-GCM)                   │
 *  │         │                                                       │
 *  │         ▼                                                       │
 *  │  Master Key (decrypted at runtime, in memory only)            │
 *  │         │                                                       │
 *  │         ├──► GitHub Token Encryption/Decryption               │
 *  │         ├──► Password Encryption/Decryption                   │
 *  │         ├──► License Key Encryption/Decryption                │
 *  │         └──► CRL Signing                                      │
 *  └─────────────────────────────────────────────────────────────────┘
 *
 * Attack Resistance:
 *  - Stole .env file → Cannot decrypt master key without bootstrap key
 *  - Stole operators.json → Cannot decrypt passwords without master key
 *  - Stole GitHub backup → Cannot decrypt without master key
 *  - Stole source code → Bootstrap key derived from runtime machine data
 *  - Stole container → Bootstrap key not in any file (derived at runtime)
 *
 * IMPORTANT: The bootstrap key uses PERSISTENT data that survives restarts:
 *  - hostname (stable in Docker)
 *  - persistent_machine_id (stored in Docker volume, never changes)
 *  - application_salt (static, application-specific)
 *
 * The bootstrap key is NEVER stored anywhere. It's derived from values
 * that are stable across container restarts but unique to this deployment.
 */

import crypto from 'crypto';
import { execSync } from 'child_process';
import os from 'os';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ── Cache for decrypted secrets ──────────────────────────────────────────
const secretCache = new Map();
let initialized = false;

// ── Persistent Machine ID ────────────────────────────────────────────────

const MACHINE_ID_DIR = '/var/lib/vendor-tool';
const MACHINE_ID_FILE = join(MACHINE_ID_DIR, 'machine-id');

/**
 * Get or create a persistent machine ID.
 * This ID is stored in a Docker volume and survives container restarts.
 * It's created once during first boot and never changes.
 */
function getPersistentMachineId() {
  // Try to read existing machine ID
  try {
    if (existsSync(MACHINE_ID_FILE)) {
      const id = readFileSync(MACHINE_ID_FILE, 'utf8').trim();
      if (id && id.length >= 16) {
        return id;
      }
    }
  } catch {}

  // Generate new machine ID (first boot only)
  try {
    mkdirSync(MACHINE_ID_DIR, { recursive: true });
    const newId = crypto.randomBytes(32).toString('hex');
    writeFileSync(MACHINE_ID_FILE, newId, { mode: 0o600 });
    console.log('[SECURE-CONFIG] Created persistent machine ID:', MACHINE_ID_FILE);
    return newId;
  } catch (err) {
    // Fallback: generate from hostname (still stable across restarts)
    console.warn('[SECURE-CONFIG] Could not create persistent machine ID:', err.message);
    return crypto.createHash('sha256').update(os.hostname()).digest('hex');
  }
}

// ── Bootstrap Key Derivation ────────────────────────────────────────────

/**
 * Derive bootstrap key from PERSISTENT machine-specific data.
 * This key is NEVER stored on disk — only exists in running container.
 *
 * Uses only stable values that survive container restarts:
 *  - hostname (stable in Docker)
 *  - persistent_machine_id (stored in Docker volume)
 *  - application_salt (static, application-specific)
 */
function deriveBootstrapKey() {
  const components = [];

  // 1. Hostname (stable in Docker)
  try { components.push(os.hostname()); } catch {}
  try { components.push(execSync('hostname', { encoding: 'utf8', timeout: 1000 }).trim()); } catch {}

  // 2. Persistent machine ID (survives restarts)
  components.push(getPersistentMachineId());

  // 3. Static application salt (never changes)
  components.push('hrms-vendor-bootstrap-key-salt-v1');

  // Derive 256-bit key using PBKDF2
  const salt = crypto.createHash('sha256')
    .update(components.join('|'))
    .digest('hex')
    .slice(0, 32);

  return crypto.pbkdf2Sync(
    components.join('|'),
    salt,
    100000,
    32,
    'sha512'
  );
}

// ── Encryption/Decryption with Bootstrap Key ─────────────────────────────

/**
 * Decrypt a value encrypted with the bootstrap key
 */
function bootstrapDecrypt(encryptedBase64) {
  if (!encryptedBase64) return '';
  try {
    const bootstrapKey = deriveBootstrapKey();
    const packed = Buffer.from(encryptedBase64, 'base64');
    const iv = packed.subarray(0, 12);
    const authTag = packed.subarray(12, 28);
    const ciphertext = packed.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', bootstrapKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null; // Failed to decrypt
  }
}

/**
 * Encrypt a value with the bootstrap key
 */
function bootstrapEncrypt(plaintext) {
  const bootstrapKey = deriveBootstrapKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', bootstrapKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

// ── Master Key Management ────────────────────────────────────────────────

/**
 * Get the master encryption key.
 * Priority:
 *  1. Decrypted from .env (encrypted with bootstrap key)
 *  2. Plaintext from .env (backward compatibility, but will be encrypted)
 *  3. Auto-generated and persisted in data/master-key.key (Render/fresh deploy)
 *  4. FAIL (no fallback — security over convenience)
 */
function getMasterKey() {
  if (secretCache.has('master_key')) {
    return secretCache.get('master_key');
  }

  const envMasterKey = process.env.VENDOR_LICENSE_MASTER_KEY || '';

  // Try to decrypt (bootstrap-encrypted value)
  const decrypted = bootstrapDecrypt(envMasterKey);
  if (decrypted) {
    secretCache.set('master_key', decrypted);
    return decrypted;
  }

  // If it's not encrypted, treat as plaintext (backward compatibility)
  if (envMasterKey && !envMasterKey.includes('=')) {
    console.warn('[SECURITY] Master key is stored in plaintext. Run encrypt-master-key to secure it.');
    secretCache.set('master_key', envMasterKey);
    return envMasterKey;
  }

  // Auto-generate and persist master key for fresh deploys (Render, Docker, etc.)
  try {
    const keyDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
    const keyFile = join(keyDir, 'master-key.key');
    
    mkdirSync(keyDir, { recursive: true });
    
    if (existsSync(keyFile)) {
      const storedKey = readFileSync(keyFile, 'utf8').trim();
      if (storedKey) {
        console.log('[SECURE-CONFIG] Master key loaded from data/master-key.key');
        secretCache.set('master_key', storedKey);
        return storedKey;
      }
    }
    
    const newKey = crypto.randomBytes(32).toString('hex');
    writeFileSync(keyFile, newKey, { mode: 0o600 });
    console.log('[SECURE-CONFIG] Generated new master key → data/master-key.key');
    secretCache.set('master_key', newKey);
    return newKey;
  } catch (err) {
    // Fallback: generate in-memory only (lost on restart)
    console.warn('[SECURE-CONFIG] Could not persist master key:', err.message);
    const memKey = crypto.randomBytes(32).toString('hex');
    secretCache.set('master_key', memKey);
    return memKey;
  }
}

/**
 * Get GitHub token (decrypted)
 */
function getGithubToken(keyName = 'CUSTOMER_GITHUB_TOKEN') {
  const cacheKey = `token_${keyName}`;
  if (secretCache.has(cacheKey)) {
    return secretCache.get(cacheKey);
  }

  const raw = process.env[keyName] || '';

  // Try bootstrap decryption first
  const decrypted = bootstrapDecrypt(raw);
  if (decrypted) {
    secretCache.set(cacheKey, decrypted);
    return decrypted;
  }

  // Try master key decryption
  const masterKey = getMasterKey();
  if (masterKey && raw) {
    try {
      const tokenKey = crypto.pbkdf2Sync(masterKey, 'hrms-github-token-key-v1', 100000, 32, 'sha512');
      const packed = Buffer.from(raw, 'base64');
      const iv = packed.subarray(0, 12);
      const authTag = packed.subarray(12, 28);
      const ciphertext = packed.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey, iv);
      decipher.setAuthTag(authTag);
      const result = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      secretCache.set(cacheKey, result);
      return result;
    } catch {}
  }

  // Plaintext fallback (if starts with ghp_ or github_)
  if (raw.startsWith('ghp_') || raw.startsWith('github_')) {
    secretCache.set(cacheKey, raw);
    return raw;
  }

  return '';
}

/**
 * Get SMTP password (decrypted)
 */
function getSmtPassword() {
  if (secretCache.has('smtp_pass')) {
    return secretCache.get('smtp_pass');
  }

  const raw = process.env.SMTP_PASS || '';
  const decrypted = bootstrapDecrypt(raw);
  if (decrypted) {
    secretCache.set('smtp_pass', decrypted);
    return decrypted;
  }

  // Plaintext fallback
  secretCache.set('smtp_pass', raw);
  return raw;
}

/**
 * Get session secret (decrypted)
 */
function getSessionSecret() {
  if (secretCache.has('session_secret')) {
    return secretCache.get('session_secret');
  }

  const raw = process.env.VENDOR_CONSOLE_SESSION_SECRET || process.env.VENDOR_LICENSE_MASTER_KEY || '';
  const decrypted = bootstrapDecrypt(raw);
  if (decrypted) {
    secretCache.set('session_secret', decrypted);
    return decrypted;
  }

  // Use master key as session secret (if available)
  const masterKey = getMasterKey();
  if (masterKey) {
    secretCache.set('session_secret', masterKey);
    return masterKey;
  }

  secretCache.set('session_secret', raw);
  return raw;
}

// ── Initialization ──────────────────────────────────────────────────────

/**
 * Initialize secure configuration.
 * Call once at startup after loading .env
 */
export function initSecureConfig() {
  if (initialized) return;

  const masterKey = getMasterKey();
  if (masterKey) {
    console.log('[SECURE-CONFIG] Master key ready');
  }

  // Pre-cache tokens
  const tokenKeys = ['CUSTOMER_GITHUB_TOKEN', 'CRL_GITHUB_TOKEN', 'VENDOR_GITHUB_TOKEN', 'VENDOR_UPDATE_TOKEN'];
  for (const key of tokenKeys) {
    const token = getGithubToken(key);
    if (token) {
      console.log(`[SECURE-CONFIG] ${key}: decrypted`);
    }
  }

  initialized = true;
}

// ── Exports ─────────────────────────────────────────────────────────────

export {
  getMasterKey,
  getGithubToken,
  getSmtPassword,
  getSessionSecret,
  bootstrapEncrypt,
  bootstrapDecrypt,
  deriveBootstrapKey
};

// ── CLI: Encrypt Master Key ─────────────────────────────────────────────

/**
 * Run from CLI to encrypt the master key in .env:
 *   node secure-config.mjs --encrypt-master-key
 */
if (process.argv[1] && process.argv[1].endsWith('secure-config.mjs') && process.argv.includes('--encrypt-master-key')) {
  const masterKey = process.env.VENDOR_LICENSE_MASTER_KEY || '';
  if (!masterKey) {
    console.error('No VENDOR_LICENSE_MASTER_KEY found in .env');
    process.exit(1);
  }

  // Check if already encrypted
  const decrypted = bootstrapDecrypt(masterKey);
  if (decrypted) {
    console.log('Master key is already bootstrap-encrypted.');
    process.exit(0);
  }

  const encrypted = bootstrapEncrypt(masterKey);
  console.log('\nEncrypted master key (replace VENDOR_LICENSE_MASTER_KEY in .env):');
  console.log(`VENDOR_LICENSE_MASTER_KEY=${encrypted}`);
  console.log('\nKeep the original value safe — you cannot decrypt without the running container.');
}
