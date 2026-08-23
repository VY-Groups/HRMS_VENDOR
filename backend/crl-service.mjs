/**
 * CRL Service — Certificate Revocation List (Multi-Vendor)
 *
 * Flow:
 *  1. Vendor revokes a license → CRL entry added + auto-published to GitHub
 *  2. Vendor extends a revoked license → removed from CRL + auto-published
 *  3. Each vendor has their own CRL file: crl/vendor-{vendor_id}.json
 *  4. HRMS backend fetches only its vendor's CRL from GitHub every 6 hours
 *  5. If current license_id is in CRL → HRMS blocks access immediately
 */

import crypto from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getMasterKey, getGithubToken } from './secure-config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CRL_DIR = join(__dirname, 'data', 'crl');

// GitHub config — decrypted at runtime from secure-config
function getGithubConfig() {
  return {
    token: getGithubToken('CRL_GITHUB_TOKEN'),
    owner: process.env.CRL_GITHUB_OWNER || 'VY-Groups',
    repo: process.env.CRL_GITHUB_REPO || 'HRMS-Release-Management',
    branch: process.env.CRL_GITHUB_BRANCH || 'main'
  };
}

// Signing key — from secure-config (bootstrap-encrypted master key)
function getCrlSignKey() {
  return getMasterKey() || '';
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Produce a deterministic JSON string for signing.
 * Keys are sorted at every level so the signature is stable
 * regardless of insertion order.
 */
function stableStringify(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function signCRL(entries) {
  return crypto.createHmac('sha256', getCrlSignKey()).update(stableStringify(entries)).digest('hex');
}

async function ensureDataDir() {
  if (!existsSync(CRL_DIR)) await mkdir(CRL_DIR, { recursive: true });
}

function getCRLFilePath(vendor_id) {
  return join(CRL_DIR, `vendor-${vendor_id}.json`);
}

function getGitHubCRLPath(vendor_id) {
  return `crl/vendor-${vendor_id}.json`;
}

// ── Local CRL store (per vendor) ───────────────────────────────────────────

export async function loadCRL(vendor_id) {
  await ensureDataDir();
  const filePath = getCRLFilePath(vendor_id);
  
  if (!existsSync(filePath)) {
    return { 
      vendor_id,
      version: 1, 
      updated_at: new Date().toISOString(), 
      entries: [], 
      signature: '' 
    };
  }
  
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { 
      vendor_id,
      version: 1, 
      updated_at: new Date().toISOString(), 
      entries: [], 
      signature: '' 
    };
  }
}

export async function saveCRL(crl) {
  await ensureDataDir();
  const filePath = getCRLFilePath(crl.vendor_id);
  await writeFile(filePath, JSON.stringify(crl, null, 2), 'utf8');
}

export async function addToCRL({ vendor_id, license_id, customer, plan, reason, revoked_by }) {
  const crl = await loadCRL(vendor_id);

  // Avoid duplicates
  if (crl.entries.some(e => e.license_id === license_id)) return crl;

  crl.entries.push({
    license_id,
    customer:    customer   || 'Unknown',
    plan:        plan       || 'unknown',
    reason:      reason     || 'Revoked by vendor',
    revoked_by:  revoked_by || 'vendor',
    revoked_at:  new Date().toISOString()
  });

  crl.updated_at = new Date().toISOString();
  crl.version    = (crl.version || 1) + 1;
  crl.signature  = signCRL(crl.entries);

  await saveCRL(crl);
  
  // Auto-publish to GitHub
  try {
    await publishCRLToGitHub(vendor_id);
  } catch (err) {
    console.error(`[CRL] Auto-publish failed for vendor ${vendor_id}:`, err.message);
    // Don't throw - CRL is saved locally, publish can be retried
  }
  
  return crl;
}

export async function removeFromCRL(vendor_id, license_id) {
  const crl = await loadCRL(vendor_id);
  const hadEntry = crl.entries.some(e => e.license_id === license_id);
  
  crl.entries   = crl.entries.filter(e => e.license_id !== license_id);
  crl.updated_at = new Date().toISOString();
  crl.version    = (crl.version || 1) + 1;
  crl.signature  = signCRL(crl.entries);
  
  await saveCRL(crl);
  
  // Auto-publish to GitHub if entry was removed
  if (hadEntry) {
    try {
      await publishCRLToGitHub(vendor_id);
    } catch (err) {
      console.error(`[CRL] Auto-publish failed for vendor ${vendor_id}:`, err.message);
    }
  }
  
  return crl;
}

// ── GitHub push (per vendor) ───────────────────────────────────────────────

export async function publishCRLToGitHub(vendor_id) {
  const cfg = getGithubConfig();
  if (!cfg.token) {
    throw new Error(
      'GitHub token not configured. Set CRL_GITHUB_TOKEN in vendor-license-tool/backend/.env\n' +
      'Create a token at: https://github.com/settings/tokens (needs repo write access)'
    );
  }

  const crl = await loadCRL(vendor_id);
  const crlPath = getGitHubCRLPath(vendor_id);

  // Build the public CRL document (no internal fields)
  const publicCRL = {
    schema:     'hrms-crl-v1',
    vendor_id:  vendor_id,
    issuer:     `${cfg.owner}/${cfg.repo}`,
    updated_at: crl.updated_at,
    version:    crl.version,
    entries:    crl.entries.map(e => ({
      license_id: e.license_id,
      customer:   e.customer,
      plan:       e.plan,
      reason:     e.reason,
      revoked_at: e.revoked_at
    })),
    signature:  crl.signature
  };

  const content = Buffer.from(JSON.stringify(publicCRL, null, 2)).toString('base64');
  const apiBase = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${crlPath}`;

  // Get current file SHA (needed for update)
  let sha = null;
  try {
    const getRes = await fetch(`${apiBase}?ref=${cfg.branch}`, {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha || null;
    }
  } catch { /* file doesn't exist yet — first push */ }

  // Push to GitHub
  const body = {
    message: `chore: update CRL for vendor ${vendor_id} v${crl.version} — ${crl.entries.length} revoked license(s)`,
    content,
    branch: cfg.branch,
    ...(sha ? { sha } : {})
  };

  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify(body)
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(`GitHub push failed: ${err.message || putRes.status}`);
  }

  const result = await putRes.json();
  return {
    success:    true,
    vendor_id:  vendor_id,
    version:    crl.version,
    entries:    crl.entries.length,
    commit_sha: result.commit?.sha || '',
    commit_url: result.commit?.html_url || '',
    raw_url:    `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${crlPath}`
  };
}

// ── GitHub config status ───────────────────────────────────────────────────

export function getCRLConfig(vendor_id = 'default') {
  const cfg = getGithubConfig();
  const crlPath = getGitHubCRLPath(vendor_id);
  return {
    configured: Boolean(cfg.token),
    vendor_id:  vendor_id,
    owner:      cfg.owner,
    repo:       cfg.repo,
    branch:     cfg.branch,
    path:       crlPath,
    raw_url:    `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch}/${crlPath}`,
    token_set:  Boolean(cfg.token)
  };
}
