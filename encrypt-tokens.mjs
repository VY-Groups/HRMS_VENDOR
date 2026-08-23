/**
 * Encrypt Secrets Script
 * 
 * Run this script to encrypt ALL secrets in .env file:
 *   node encrypt-tokens.mjs
 * 
 * Security Architecture:
 *  - Master key is stored in .env (required for Docker)
 *  - GitHub tokens are encrypted with the master key
 *  - Passwords are encrypted with the master key
 *  - If someone steals .env → They have the master key
 *  - BUT: operators.json only has encrypted passwords
 *  - If someone steals operators.json → CANNOT decrypt without master key
 *  - If someone steals GitHub backup → CANNOT decrypt without master key
 * 
 * Additional Protection:
 *  - HMAC integrity checks on operators.json
 *  - Rate limiting on login attempts
 *  - Session invalidation on password change
 */

import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Master Key Encryption ────────────────────────────────────────────────

function deriveMasterKey(masterKey) {
  return crypto.pbkdf2Sync(masterKey, 'hrms-vendor-crypto-salt-v2', 100000, 32, 'sha512');
}

function encryptWithMasterKey(plaintext, masterKey) {
  const key = deriveMasterKey(masterKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

// ── Detection ────────────────────────────────────────────────────────────

function isEncrypted(value) {
  if (!value) return false;
  // If it starts with ghp_ or github_, it's plaintext
  if (value.startsWith('ghp_') || value.startsWith('github_')) {
    return false;
  }
  // Try to decode as base64 - if it works and is long enough, it's encrypted
  try {
    const packed = Buffer.from(value, 'base64');
    return packed.length > 28; // iv(12) + authTag(16) + at least some data
  } catch {
    return false;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const envPath = join(__dirname, 'backend', '.env');
  
  console.log('Reading .env file...');
  const content = await readFile(envPath, 'utf8');
  const lines = content.split('\n');
  
  // First, get the master key value
  let masterKey = '';
  for (const line of lines) {
    if (line.startsWith('VENDOR_LICENSE_MASTER_KEY=')) {
      masterKey = line.slice('VENDOR_LICENSE_MASTER_KEY='.length).trim();
      break;
    }
  }

  if (!masterKey) {
    console.error('ERROR: No VENDOR_LICENSE_MASTER_KEY found in .env');
    process.exit(1);
  }

  console.log(`Master key found: ${masterKey.slice(0, 10)}...`);
  
  const newLines = [];
  let encryptedCount = 0;
  
  const tokenKeys = [
    'VENDOR_UPDATE_TOKEN',
    'VENDOR_GITHUB_TOKEN', 
    'CRL_GITHUB_TOKEN',
    'CUSTOMER_GITHUB_TOKEN'
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    
    // Encrypt GitHub tokens
    let shouldEncrypt = false;
    let keyName = '';
    
    for (const key of tokenKeys) {
      if (trimmed.startsWith(`${key}=`)) {
        shouldEncrypt = true;
        keyName = key;
        break;
      }
    }

    // Also encrypt SMTP password
    if (trimmed.startsWith('SMTP_PASS=')) {
      shouldEncrypt = true;
      keyName = 'SMTP_PASS';
    }

    if (shouldEncrypt) {
      const value = trimmed.slice(keyName.length + 1);
      
      if (isEncrypted(value)) {
        console.log(`  ${keyName}: Already encrypted, skipping.`);
        newLines.push(line);
      } else {
        const encrypted = encryptWithMasterKey(value, masterKey);
        console.log(`  ${keyName}: Encrypting with master key...`);
        console.log(`    Before: ${value.slice(0, 20)}...${value.slice(-10)}`);
        console.log(`    After:  ${encrypted.slice(0, 30)}...`);
        newLines.push(`${keyName}=${encrypted}`);
        encryptedCount++;
      }
    } else {
      newLines.push(line);
    }
  }
  
  if (encryptedCount > 0) {
    await writeFile(envPath, newLines.join('\n'), 'utf8');
    console.log(`\n✓ Encrypted ${encryptedCount} secret(s) in .env file.`);
  } else {
    console.log('\n  All secrets are already encrypted.');
  }
  
  console.log('\nSecurity Model:');
  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log('  │  Master Key (in .env, plaintext)                      │');
  console.log('  │         │                                               │');
  console.log('  │         ├──► Encrypts GitHub Tokens (AES-256-GCM)     │');
  console.log('  │         ├──► Encrypts Passwords (AES-256-GCM)         │');
  console.log('  │         ├──► Signs CRL (HMAC-SHA256)                  │');
  console.log('  │         └──► Signs Session Tokens (HMAC-SHA256)       │');
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log('\n  Protection layers:');
  console.log('  1. operators.json has HMAC integrity checks');
  console.log('  2. Passwords encrypted with master key (never plaintext)');
  console.log('  3. GitHub tokens encrypted with master key');
  console.log('  4. Rate limiting on login (5 attempts / 15 min)');
  console.log('  5. Session invalidation on password change');
  console.log('  6. Backup data includes encrypted passwords only');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
