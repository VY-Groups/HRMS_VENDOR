/**
 * Release Service — HRMS Update Distribution
 *
 * Vendor publishes release manifests to HRMS-Release-Management repo.
 * HRMS instances fetch the manifest and auto-update.
 *
 * Manifest structure (releases/latest.json):
 * {
 *   schema: 'hrms-release-v1',
 *   version: '1.1.0',
 *   release_date: '2026-04-29T00:00:00Z',
 *   release_notes: 'Bug fixes and improvements',
 *   min_license_version: '1.0.0',
 *   breaking_changes: false,
 *   download_url: 'https://...',
 *   checksum: 'sha256:...',
 *   size_mb: 12.4,
 *   files: [ { path, checksum, size } ],
 *   signature: 'hmac-sha256 of stable JSON'
 * }
 */

import crypto from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEASES_FILE = join(__dirname, 'data', 'releases.json');

// Vendor Tool Release Configuration (dedicated for vendor tool)
const VENDOR_GITHUB_TOKEN  = process.env.VENDOR_GITHUB_TOKEN  || process.env.CRL_GITHUB_TOKEN || '';
const VENDOR_GITHUB_OWNER  = process.env.VENDOR_GITHUB_OWNER  || 'VY-Groups';
const VENDOR_GITHUB_REPO   = process.env.VENDOR_GITHUB_REPO   || 'HRMS-Release-Management';
const VENDOR_GITHUB_BRANCH = process.env.VENDOR_GITHUB_BRANCH || 'vendor-tool';
const VENDOR_RELEASE_PATH  = 'releases/latest.json';  // Same filename, different branch
const VENDOR_HISTORY_PATH  = 'releases/history.json';

// Legacy: Keep for backward compatibility with CRL
const GITHUB_TOKEN  = VENDOR_GITHUB_TOKEN;
const GITHUB_OWNER  = VENDOR_GITHUB_OWNER;
const GITHUB_REPO   = VENDOR_GITHUB_REPO;
const GITHUB_BRANCH = VENDOR_GITHUB_BRANCH;
const RELEASE_PATH  = VENDOR_RELEASE_PATH;
const HISTORY_PATH  = VENDOR_HISTORY_PATH;

const SIGN_KEY = String(
  process.env.VENDOR_LICENSE_MASTER_KEY ||
  process.env.HRMS_LICENSE_MASTER_KEY   ||
  'HRMS-License-MasterKey-2026-Secure'
);

// ── Helpers ────────────────────────────────────────────────────────────────

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function signRelease(manifest) {
  const { signature: _, ...unsigned } = manifest;
  return crypto.createHmac('sha256', SIGN_KEY).update(stableStringify(unsigned)).digest('hex');
}

async function ensureDataDir() {
  const dir = join(__dirname, 'data');
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function githubPut(path, content, message) {
  if (!VENDOR_GITHUB_TOKEN) throw new Error('VENDOR_GITHUB_TOKEN not configured in vendor-license-tool/backend/.env');

  const apiBase = `https://api.github.com/repos/${VENDOR_GITHUB_OWNER}/${VENDOR_GITHUB_REPO}/contents/${path}`;
  const encoded = Buffer.from(content).toString('base64');

  // Get current SHA if file exists
  let sha = null;
  try {
    const getRes = await fetch(`${apiBase}?ref=${VENDOR_GITHUB_BRANCH}`, {
      headers: {
        Authorization: `Bearer ${VENDOR_GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha || null;
    }
  } catch { /* new file */ }

  const putRes = await fetch(apiBase, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${VENDOR_GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    body: JSON.stringify({
      message,
      content: encoded,
      branch: VENDOR_GITHUB_BRANCH,
      ...(sha ? { sha } : {})
    })
  });

  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(`GitHub push failed: ${err.message || putRes.status}`);
  }

  return await putRes.json();
}

// ── Local release store ────────────────────────────────────────────────────

export async function loadReleases() {
  await ensureDataDir();
  if (!existsSync(RELEASES_FILE)) return { releases: [] };
  try {
    return JSON.parse(await readFile(RELEASES_FILE, 'utf8'));
  } catch {
    return { releases: [] };
  }
}

export async function saveRelease(manifest) {
  await ensureDataDir();
  const store = await loadReleases();

  // Avoid duplicate versions
  store.releases = store.releases.filter(r => r.version !== manifest.version);
  store.releases.unshift(manifest); // newest first
  store.releases = store.releases.slice(0, 50); // keep last 50

  await writeFile(RELEASES_FILE, JSON.stringify(store, null, 2), 'utf8');
  return store;
}

// ── Publish release ────────────────────────────────────────────────────────

export async function publishRelease({
  version,
  release_notes,
  breaking_changes = false,
  min_license_version = '1.0.0',
  download_url = '',
  checksum = '',
  size_mb = 0,
  files = []
}) {
  if (!version) throw new Error('Version is required (e.g. 1.1.0)');
  if (!release_notes) throw new Error('Release notes are required');

  const manifest = {
    schema:              'hrms-release-v1',
    version,
    release_date:        new Date().toISOString(),
    release_notes,
    breaking_changes:    Boolean(breaking_changes),
    min_license_version: min_license_version || '1.0.0',
    download_url:        download_url || '',
    checksum:            checksum || '',
    size_mb:             Number(size_mb) || 0,
    files:               Array.isArray(files) ? files : [],
    published_by:        'vendor-operator',
    published_at:        new Date().toISOString()
  };

  // Sign the manifest
  manifest.signature = signRelease(manifest);

  // Save locally
  await saveRelease(manifest);

  // Push latest.json to GitHub
  const latestResult = await githubPut(
    RELEASE_PATH,
    JSON.stringify(manifest, null, 2),
    `release: HRMS v${version} — ${breaking_changes ? 'BREAKING' : 'update'}`
  );

  // Update history.json
  const store = await loadReleases();
  const historyContent = JSON.stringify({
    schema: 'hrms-release-history-v1',
    updated_at: new Date().toISOString(),
    releases: store.releases.map(r => ({
      version: r.version,
      release_date: r.release_date,
      release_notes: r.release_notes,
      breaking_changes: r.breaking_changes
    }))
  }, null, 2);

  await githubPut(
    HISTORY_PATH,
    historyContent,
    `chore: update release history — v${version}`
  ).catch(() => { /* non-fatal */ });

  return {
    success: true,
    version,
    commit_sha: latestResult.commit?.sha || '',
    commit_url: latestResult.commit?.html_url || '',
    raw_url: `https://raw.githubusercontent.com/${VENDOR_GITHUB_OWNER}/${VENDOR_GITHUB_REPO}/${VENDOR_GITHUB_BRANCH}/${VENDOR_RELEASE_PATH}`,
    manifest
  };
}

export async function getLatestRelease() {
  const store = await loadReleases();
  return store.releases[0] || null;
}

export async function getLatestVendorToolRelease() {
  // Fetch vendor tool release from vendor-tool branch
  try {
    const url = `https://raw.githubusercontent.com/${VENDOR_GITHUB_OWNER}/${VENDOR_GITHUB_REPO}/${VENDOR_GITHUB_BRANCH}/${VENDOR_RELEASE_PATH}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('[Release Service] Failed to fetch vendor tool release:', error.message);
    return null;
  }
}

export async function getReleaseHistory() {
  const store = await loadReleases();
  return store.releases;
}

export function getReleaseConfig() {
  return {
    configured: Boolean(VENDOR_GITHUB_TOKEN),
    owner:      VENDOR_GITHUB_OWNER,
    repo:       VENDOR_GITHUB_REPO,
    branch:     VENDOR_GITHUB_BRANCH,
    latest_url: `https://raw.githubusercontent.com/${VENDOR_GITHUB_OWNER}/${VENDOR_GITHUB_REPO}/${VENDOR_GITHUB_BRANCH}/${VENDOR_RELEASE_PATH}`,
    history_url:`https://raw.githubusercontent.com/${VENDOR_GITHUB_OWNER}/${VENDOR_GITHUB_REPO}/${VENDOR_GITHUB_BRANCH}/${VENDOR_HISTORY_PATH}`
  };
}
