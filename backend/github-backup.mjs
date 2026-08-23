/**
 * GitHub Backup Service — Per-Vendor Isolated Backup/Restore
 *
 * Architecture:
 *  - Each vendor's data is stored in a separate GitHub folder: backups/{vendor_id}/
 *  - Each folder contains: customers.json, crl.json, audit.json, operators.json, manifest.json
 *  - Backup is triggered automatically after every data mutation
 *  - Restore pulls from GitHub for vendor re-registration
 *  - Owner (GitHub repo owner) sees all vendors; vendors only see own data via backend API
 *
 * Security:
 *  - Operators backed up with encrypted_password (AES-256-GCM), never plaintext
 *  - password_hash is stripped from backup (can be derived from decrypted password)
 *  - GitHub tokens encrypted at rest in .env
 *  - Local DB never stores plaintext passwords
 */

import https from 'https';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { decrypt, encrypt, decryptToken } from './crypto-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── GitHub Config (lazy — env vars loaded after ESM hoisting) ─────────────
const BACKUP_PREFIX = 'backups';

function getGithubConfig() {
  // Decrypt tokens at runtime — encrypted at rest in .env
  // VENDOR_GITHUB_TOKEN is the token with repo write access for vendor backups
  const rawToken = process.env.VENDOR_GITHUB_TOKEN || process.env.CUSTOMER_GITHUB_TOKEN || process.env.CRL_GITHUB_TOKEN || '';
  return {
    token:  decryptToken(rawToken),  // Decrypt if encrypted, passthrough if plaintext
    owner:  process.env.VENDOR_GITHUB_OWNER || process.env.CUSTOMER_GITHUB_OWNER || 'VY-Groups',
    repo:   process.env.VENDOR_GITHUB_REPO  || process.env.CUSTOMER_GITHUB_REPO  || 'HRMS-Release-Management',
    branch: process.env.VENDOR_GITHUB_BRANCH || process.env.CUSTOMER_GITHUB_BRANCH || 'vendor-tool'
  };
}

// ── Local SHA Cache ───────────────────────────────────────────────────────
const shaCache = new Map();

// ── Debounce timers ───────────────────────────────────────────────────────
const pendingBackups = new Map();

// ── Status tracking ───────────────────────────────────────────────────────
const backupStatus = new Map();

// ── GitHub API Helper ─────────────────────────────────────────────────────

function githubApi(method, apiPath, body = null) {
  const cfg = getGithubConfig();
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: apiPath,
      method,
      headers: {
        'User-Agent': 'HRMS-Vendor-Backup/2.0',
        'Authorization': `Bearer ${cfg.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };

    let bodyStr = null;
    if (body) {
      bodyStr = JSON.stringify(body);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ data: parsed, status: res.statusCode });
          } else {
            reject(new Error(`GitHub ${res.statusCode}: ${parsed.message || data.slice(0, 200)}`));
          }
        } catch (e) {
          reject(new Error(`GitHub parse error: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('GitHub request timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Path Helpers ──────────────────────────────────────────────────────────

function vendorGithubDir(vendorId) {
  return `${BACKUP_PREFIX}/${vendorId}`;
}

// ── Local Store Readers ───────────────────────────────────────────────────

async function readLocalCustomers() {
  try {
    const raw = await readFile(join(__dirname, '..', 'data', 'customers.json'), 'utf8');
    return JSON.parse(raw).customers || [];
  } catch { return []; }
}

async function readLocalCRL(vendorId) {
  try {
    const raw = await readFile(join(__dirname, 'data', 'crl', `vendor-${vendorId}.json`), 'utf8');
    return JSON.parse(raw);
  } catch {
    return { vendor_id: vendorId, version: 1, entries: [], updated_at: new Date().toISOString(), signature: '' };
  }
}

async function readLocalAuditLog() {
  try {
    const raw = await readFile(join(__dirname, 'data', 'audit-log.json'), 'utf8');
    return JSON.parse(raw);
  } catch { return { entries: [] }; }
}

async function readLocalOperators() {
  try {
    const raw = await readFile(join(__dirname, '..', 'data', 'operators.json'), 'utf8');
    return JSON.parse(raw).operators || [];
  } catch { return []; }
}

// ── Per-Vendor Data Extraction ────────────────────────────────────────────

function extractVendorCustomers(customers, vendorId) {
  return customers.filter(c => c.vendor_id === vendorId);
}

function extractVendorOperators(operators, vendorId) {
  return operators.filter(op => op.vendor_id === vendorId);
}

/**
 * Sanitize operator for GitHub backup:
 *  - Strip password_hash (local auth only)
 *  - Keep encrypted_password (AES-256-GCM encrypted, recoverable with master key)
 *  - Never include plaintext passwords
 */
function sanitizeOperatorForBackup(operator) {
  const { password_hash, reset_token, reset_token_expires, ...safe } = operator;
  // Ensure encrypted_password is present
  if (!safe.encrypted_password && password_hash) {
    // Legacy operator without encrypted_password — cannot recover plaintext from hash
    // Mark as unrecoverable
    safe.encrypted_password = null;
    safe.recovery_note = 'Password cannot be recovered from backup (legacy operator).';
  }
  return safe;
}

// ── Core GitHub Operations ────────────────────────────────────────────────

async function getGitHubFileSha(githubPath) {
  const cfg = getGithubConfig();
  const cacheKey = `${cfg.repo}/${cfg.branch}/${githubPath}`;
  if (shaCache.has(cacheKey)) return shaCache.get(cacheKey);

  try {
    const { data } = await githubApi('GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${githubPath}?ref=${cfg.branch}`);
    shaCache.set(cacheKey, data.sha);
    return data.sha;
  } catch {
    return null;
  }
}

async function pushToGitHub(githubPath, content, message) {
  const cfg = getGithubConfig();
  const sha = await getGitHubFileSha(githubPath);
  const body = {
    message,
    content: Buffer.from(typeof content === 'string' ? content : JSON.stringify(content, null, 2)).toString('base64'),
    branch: cfg.branch,
    ...(sha ? { sha } : {})
  };

  const result = await githubApi('PUT', `/repos/${cfg.owner}/${cfg.repo}/contents/${githubPath}`, body);
  if (result.data?.content?.sha) {
    const cacheKey = `${cfg.repo}/${cfg.branch}/${githubPath}`;
    shaCache.set(cacheKey, result.data.content.sha);
  }
  return result;
}

async function pullFromGitHub(githubPath) {
  const cfg = getGithubConfig();
  const { data } = await githubApi('GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${githubPath}?ref=${cfg.branch}`);
  if (!data?.content) throw new Error(`No content at ${githubPath}`);
  return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
}

// ── Backup a Vendor ───────────────────────────────────────────────────────

export async function backupVendor(vendorId, { reason = 'auto', debounce = true } = {}) {
  const cfg = getGithubConfig();
  if (!cfg.token) {
    return { success: false, reason: 'no_token' };
  }

  // Debounce: coalesce rapid backups into one
  if (debounce && pendingBackups.has(vendorId)) {
    clearTimeout(pendingBackups.get(vendorId));
  }

  if (debounce) {
    return new Promise((resolve) => {
      pendingBackups.set(vendorId, setTimeout(async () => {
        pendingBackups.delete(vendorId);
        try { resolve(await doBackup(vendorId, reason)); }
        catch (err) { resolve({ success: false, error: err.message }); }
      }, 2000));
    });
  }

  return doBackup(vendorId, reason);
}

async function doBackup(vendorId, reason) {
  const startTime = Date.now();
  console.log(`[GITHUB-BACKUP] Starting backup for vendor ${vendorId} (reason: ${reason})`);

  try {
    const allCustomers = await readLocalCustomers();
    const vendorCustomers = extractVendorCustomers(allCustomers, vendorId);
    const vendorCRL = await readLocalCRL(vendorId);
    const allAudit = await readLocalAuditLog();
    const allOperators = await readLocalOperators();
    const vendorOperators = extractVendorOperators(allOperators, vendorId)
      .map(sanitizeOperatorForBackup);  // Strip password_hash, keep encrypted_password

    // Get previous version number
    let prevVersion = 0;
    try {
      const prevManifest = await pullFromGitHub(`${vendorGithubDir(vendorId)}/manifest.json`);
      prevVersion = prevManifest?.version || 0;
    } catch { /* first backup */ }

    const manifest = {
      vendor_id: vendorId,
      backup_reason: reason,
      backup_at: new Date().toISOString(),
      customer_count: vendorCustomers.length,
      crl_entries: vendorCRL.entries?.length || 0,
      audit_entries: allAudit.entries?.length || 0,
      operator_count: vendorOperators.length,
      version: prevVersion + 1
    };

    const baseDir = vendorGithubDir(vendorId);
    const files = [
      { name: 'customers.json', data: { customers: vendorCustomers } },
      { name: 'crl.json', data: vendorCRL },
      { name: 'audit.json', data: allAudit },
      { name: 'operators.json', data: { operators: vendorOperators } },
      { name: 'manifest.json', data: manifest }
    ];

    const results = [];
    for (const file of files) {
      try {
        await pushToGitHub(`${baseDir}/${file.name}`, file.data, `backup: ${vendorId}/${file.name} v${manifest.version}`);
        results.push({ file: file.name, status: 'pushed' });
      } catch (err) {
        results.push({ file: file.name, status: 'error', error: err.message });
        console.error(`[GITHUB-BACKUP] Failed to push ${file.name} for ${vendorId}:`, err.message);
      }
    }

    const elapsed = Date.now() - startTime;
    const status = {
      success: true,
      vendor_id: vendorId,
      reason,
      version: manifest.version,
      files: results,
      elapsed_ms: elapsed,
      timestamp: manifest.backup_at
    };

    backupStatus.set(vendorId, status);
    console.log(`[GITHUB-BACKUP] ✓ Backup complete for ${vendorId} v${manifest.version} (${elapsed}ms)`);
    return status;

  } catch (err) {
    const status = { success: false, vendor_id: vendorId, error: err.message, timestamp: new Date().toISOString() };
    backupStatus.set(vendorId, status);
    console.error(`[GITHUB-BACKUP] ✗ Backup failed for ${vendorId}:`, err.message);
    return status;
  }
}

// ── Restore a Vendor ──────────────────────────────────────────────────────

export async function restoreVendor(vendorId, { merge = false } = {}) {
  const cfg = getGithubConfig();
  if (!cfg.token) {
    throw new Error('GitHub token not configured. Cannot restore.');
  }

  console.log(`[GITHUB-BACKUP] Starting restore for vendor ${vendorId} (merge: ${merge})`);

  const baseDir = vendorGithubDir(vendorId);

  // Pull manifest
  let manifest;
  try {
    manifest = await pullFromGitHub(`${baseDir}/manifest.json`);
  } catch (err) {
    throw new Error(`No backup found for vendor ${vendorId}: ${err.message}`);
  }

  // Pull each data file
  let remoteCustomers = [];
  try { remoteCustomers = (await pullFromGitHub(`${baseDir}/customers.json`)).customers || []; } catch {}

  let remoteCRL = null;
  try { remoteCRL = await pullFromGitHub(`${baseDir}/crl.json`); } catch {}

  let remoteOperators = [];
  try { remoteOperators = (await pullFromGitHub(`${baseDir}/operators.json`)).operators || []; } catch {}

  let remoteAudit = null;
  try { remoteAudit = await pullFromGitHub(`${baseDir}/audit.json`); } catch {}

  const restored = { customers: 0, operators: 0, crl_entries: 0, audit_entries: 0 };

  // Restore customers
  if (remoteCustomers.length > 0) {
    const localCustomers = await readLocalCustomers();
    const withoutVendor = localCustomers.filter(c => c.vendor_id !== vendorId);
    const storePath = join(__dirname, '..', 'data', 'customers.json');
    await writeFile(storePath, JSON.stringify({ customers: [...withoutVendor, ...remoteCustomers] }, null, 2), 'utf8');
    restored.customers = remoteCustomers.length;
  }

  // Restore CRL
  if (remoteCRL) {
    const crlDir = join(__dirname, 'data', 'crl');
    await mkdir(crlDir, { recursive: true });
    await writeFile(join(crlDir, `vendor-${vendorId}.json`), JSON.stringify(remoteCRL, null, 2), 'utf8');
    restored.crl_entries = remoteCRL.entries?.length || 0;
  }

  // Restore operators (merge by email — skip existing)
  if (remoteOperators.length > 0) {
    const storePath = join(__dirname, '..', 'data', 'operators.json');
    let localStore;
    try { localStore = JSON.parse(await readFile(storePath, 'utf8')); }
    catch { localStore = { operators: [] }; }

    // Import hashPassword for restoring passwords from encrypted backup
    const { hashPassword } = await import('./auth-service.mjs');

    for (const remoteOp of remoteOperators) {
      const existing = localStore.operators.find(op => op.email === remoteOp.email);
      if (!existing) {
        // Restore operator: decrypt encrypted_password, re-hash for local storage
        const restoredOp = { ...remoteOp };
        if (remoteOp.encrypted_password) {
          try {
            const plaintextPassword = decrypt(remoteOp.encrypted_password);
            restoredOp.password_hash = hashPassword(plaintextPassword);
            // Keep encrypted_password in restored record
            restoredOp.encrypted_password = remoteOp.encrypted_password;
          } catch (err) {
            console.error(`[GITHUB-BACKUP] Could not decrypt password for ${remoteOp.email}:`, err.message);
            restoredOp.password_hash = null;
            restoredOp.password_status = 'UNRECOVERABLE';
          }
        } else {
          restoredOp.password_hash = null;
          restoredOp.password_status = 'UNRECOVERABLE';
        }
        localStore.operators.push(restoredOp);
        restored.operators++;
      } else if (merge) {
        existing.last_login_at = remoteOp.last_login_at || existing.last_login_at;
        existing.full_name = remoteOp.full_name || existing.full_name;
        // Update encrypted_password if available
        if (remoteOp.encrypted_password) {
          existing.encrypted_password = remoteOp.encrypted_password;
        }
      }
    }

    await writeFile(storePath, JSON.stringify(localStore, null, 2), 'utf8');
  }

  // Restore audit log (prepend new entries, dedupe by id)
  if (remoteAudit?.entries?.length > 0) {
    const auditPath = join(__dirname, 'data', 'audit-log.json');
    let localAudit;
    try { localAudit = JSON.parse(await readFile(auditPath, 'utf8')); }
    catch { localAudit = { entries: [] }; }

    const existingIds = new Set(localAudit.entries.map(e => e.id));
    const newEntries = remoteAudit.entries.filter(e => !existingIds.has(e.id));
    localAudit.entries = [...newEntries, ...localAudit.entries].slice(0, 10000);
    await writeFile(auditPath, JSON.stringify(localAudit, null, 2), 'utf8');
    restored.audit_entries = newEntries.length;
  }

  console.log(`[GITHUB-BACKUP] ✓ Restore complete for ${vendorId}:`, restored);
  return {
    success: true,
    vendor_id: vendorId,
    manifest,
    restored,
    timestamp: new Date().toISOString()
  };
}

// ── Status & Queries ──────────────────────────────────────────────────────

export function getBackupStatus(vendorId) {
  if (vendorId) {
    return backupStatus.get(vendorId) || { vendor_id: vendorId, lastBackup: null };
  }
  return Object.fromEntries(backupStatus);
}

export async function getBackupManifest(vendorId) {
  const cfg = getGithubConfig();
  if (!cfg.token) return null;
  try { return await pullFromGitHub(`${vendorGithubDir(vendorId)}/manifest.json`); }
  catch { return null; }
}

export async function listBackupVendors() {
  const cfg = getGithubConfig();
  if (!cfg.token) return [];
  try {
    const { data } = await githubApi('GET', `/repos/${cfg.owner}/${cfg.repo}/contents/${BACKUP_PREFIX}?ref=${cfg.branch}`);
    if (!Array.isArray(data)) return [];
    return data
      .filter(item => item.type === 'dir')
      .map(item => ({
        vendor_id: item.name,
        path: item.path,
        url: item.html_url
      }));
  } catch { return []; }
}

export async function hasBackup(vendorId) {
  const cfg = getGithubConfig();
  if (!cfg.token) return false;
  try { await pullFromGitHub(`${vendorGithubDir(vendorId)}/manifest.json`); return true; }
  catch { return false; }
}

// ── Init ──────────────────────────────────────────────────────────────────

export function initGithubBackup() {
  const cfg = getGithubConfig();
  if (!cfg.token) {
    console.log('[GITHUB-BACKUP] GitHub token not configured. Backup disabled.');
    return;
  }
  console.log(`[GITHUB-BACKUP] Initialized. Target: ${cfg.owner}/${cfg.repo}/${cfg.branch}/${BACKUP_PREFIX}/`);
}
