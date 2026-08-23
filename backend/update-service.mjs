/**
 * Vendor Tool Update Service
 * 
 * Checks for updates from Vendor-Tool-Release-Management repo
 * Downloads, verifies, and applies updates automatically
 */

import https from 'https';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');

const UPDATE_URL = process.env.VENDOR_UPDATE_URL || 'https://raw.githubusercontent.com/VY-Groups/Vendor-Tool-Release-Management/main/releases/latest.json';
const UPDATE_CHECK_INTERVAL_MS = Number.parseInt(process.env.VENDOR_UPDATE_CHECK_MS || String(24 * 60 * 60 * 1000), 10); // 24h
const UPDATE_DIR = resolve(projectRoot, 'updates');

// Read token lazily
function getUpdateToken() {
  return process.env.VENDOR_UPDATE_TOKEN || process.env.GITHUB_TOKEN || '';
}

let updateCache = null;
let updateFetchedAt = 0;

// Current Vendor Tool version — read dynamically
function getCurrentVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8'));
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

const CURRENT_VERSION = getCurrentVersion();

/**
 * Compare semantic versions
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1, v2) {
  const p1 = String(v1 || '0.0.0').split('.').map(n => Number.parseInt(n, 10) || 0);
  const p2 = String(v2 || '0.0.0').split('.').map(n => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

/**
 * Build fetch options for GitHub Contents API (supports private repos)
 */
function buildUpdateFetchOptions() {
  const urlObj = new URL(UPDATE_URL);
  const UPDATE_TOKEN = getUpdateToken();
  
  if (UPDATE_TOKEN && urlObj.hostname === 'raw.githubusercontent.com') {
    // Convert raw URL → GitHub Contents API
    const parts = urlObj.pathname.replace(/^\//, '').split('/');
    if (parts.length >= 4) {
      const [owner, repo, branch, ...rest] = parts;
      const apiPath = `/repos/${owner}/${repo}/contents/${rest.join('/')}?ref=${branch}`;
      return {
        useGitHubApi: true,
        hostname: 'api.github.com',
        path: apiPath,
        headers: {
          'User-Agent': 'Vendor-Tool-Update-Service/1.0',
          Authorization: `Bearer ${UPDATE_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      };
    }
  }

  return {
    useGitHubApi: false,
    hostname: urlObj.hostname,
    path: urlObj.pathname + (urlObj.search || ''),
    headers: {
      'User-Agent': 'Vendor-Tool-Update-Service/1.0',
      ...(UPDATE_TOKEN ? { Authorization: `Bearer ${UPDATE_TOKEN}` } : {})
    }
  };
}

/**
 * Fetch update manifest from GitHub
 */
function fetchUpdateManifest() {
  if (!UPDATE_URL) return Promise.resolve(null);
  const now = Date.now();
  if (updateCache && (now - updateFetchedAt) < UPDATE_CHECK_INTERVAL_MS) {
    return Promise.resolve(updateCache);
  }

  return new Promise((resolve) => {
    try {
      const opts = buildUpdateFetchOptions();
      const req = https.request({ hostname: opts.hostname, path: opts.path, method: 'GET', headers: opts.headers }, (res) => {
        if (res.statusCode !== 200) {
          console.warn(`[VENDOR-UPDATE] Fetch returned HTTP ${res.statusCode}`);
          resolve(updateCache);
          return;
        }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            let manifest;
            if (opts.useGitHubApi) {
              const apiResp = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              const decoded = Buffer.from(apiResp.content, 'base64').toString('utf8');
              manifest = JSON.parse(decoded);
            } else {
              manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            }
            updateCache = manifest;
            updateFetchedAt = Date.now();
            console.log(`[VENDOR-UPDATE] Manifest fetched: v${manifest.version} (current: v${CURRENT_VERSION})`);
            resolve(manifest);
          } catch (parseErr) {
            console.warn('[VENDOR-UPDATE] Manifest parse error:', parseErr.message);
            resolve(updateCache);
          }
        });
      });
      req.setTimeout(8000, () => {
        req.destroy();
        console.warn('[VENDOR-UPDATE] Fetch timeout');
        resolve(updateCache);
      });
      req.on('error', (err) => {
        console.warn('[VENDOR-UPDATE] Fetch error:', err.message);
        resolve(updateCache);
      });
      req.end();
    } catch (err) {
      console.warn('[VENDOR-UPDATE] Fetch failed:', err.message);
      resolve(updateCache);
    }
  });
}

/**
 * Check if an update is available
 */
export async function checkForUpdates() {
  updateFetchedAt = 0; // Force fresh fetch
  const manifest = await fetchUpdateManifest();
  const currentVersion = getCurrentVersion();

  if (!manifest || !manifest.version) {
    return {
      available: false,
      current_version: currentVersion,
      latest_version: null,
      message: 'No update manifest available'
    };
  }

  const comparison = compareVersions(manifest.version, currentVersion);
  const available = comparison > 0;

  return {
    available,
    current_version: currentVersion,
    latest_version: manifest.version,
    release_date: manifest.release_date,
    release_notes: manifest.release_notes,
    download_url: manifest.download_url,
    checksum: manifest.checksum,
    size_mb: manifest.size_mb,
    breaking_changes: manifest.breaking_changes || false,
    message: available
      ? `Update available: v${currentVersion} → v${manifest.version}`
      : `You are running the latest version (v${currentVersion})`
  };
}

/**
 * Download and verify update package
 */
export async function downloadUpdate(downloadUrl, expectedChecksum) {
  return new Promise((resolve, reject) => {
    if (!existsSync(UPDATE_DIR)) mkdirSync(UPDATE_DIR, { recursive: true });
    
    const filename = `vendor-tool-${Date.now()}.tar.gz`;
    const filepath = join(UPDATE_DIR, filename);
    
    // Handle GitHub Contents API URLs
    const urlObj = new URL(downloadUrl);
    const UPDATE_TOKEN = getUpdateToken();
    let requestOptions;

    if (UPDATE_TOKEN && urlObj.hostname === 'api.github.com') {
      // GitHub Contents API
      requestOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: {
          'User-Agent': 'Vendor-Tool-Update-Service/1.0',
          Authorization: `Bearer ${UPDATE_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      };
    } else {
      // Regular URL
      requestOptions = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: {
          'User-Agent': 'Vendor-Tool-Update-Service/1.0',
          ...(UPDATE_TOKEN ? { Authorization: `Bearer ${UPDATE_TOKEN}` } : {})
        }
      };
    }

    https.get(requestOptions, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode}`));
        return;
      }
      
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          let buffer;
          
          // Check if response is GitHub Contents API format
          const contentType = res.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            const apiResp = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (apiResp.content && apiResp.encoding === 'base64') {
              buffer = Buffer.from(apiResp.content, 'base64');
            } else {
              buffer = Buffer.concat(chunks);
            }
          } else {
            buffer = Buffer.concat(chunks);
          }
          
          // Verify checksum
          const actualChecksum = crypto.createHash('sha256').update(buffer).digest('hex');
          if (expectedChecksum && actualChecksum !== expectedChecksum) {
            reject(new Error('Checksum mismatch — update package may be tampered'));
            return;
          }
          
          writeFileSync(filepath, buffer);
          resolve({ filepath, size: buffer.length, checksum: actualChecksum });
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

/**
 * Get update status
 */
export function getUpdateStatus() {
  return {
    current_version: getCurrentVersion(),
    update_url: UPDATE_URL,
    update_check_interval_hours: UPDATE_CHECK_INTERVAL_MS / (60 * 60 * 1000),
    last_check: updateFetchedAt ? new Date(updateFetchedAt).toISOString() : null,
    cache_valid: updateCache && (Date.now() - updateFetchedAt) < UPDATE_CHECK_INTERVAL_MS
  };
}

/**
 * Clear the update cache
 */
export function clearUpdateCache() {
  updateCache = null;
  updateFetchedAt = 0;
}

/**
 * Get release history
 */
export async function getReleaseHistory() {
  const UPDATE_TOKEN = getUpdateToken();
  const historyUrl = UPDATE_URL.replace('/latest.json', '/history.json');
  
  return new Promise((resolve, reject) => {
    const urlObj = new URL(historyUrl);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      headers: {
        'User-Agent': 'Vendor-Tool-Update-Service/1.0',
        ...(UPDATE_TOKEN ? { Authorization: `Bearer ${UPDATE_TOKEN}` } : {})
      }
    };

    https.get(opts, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to fetch history: HTTP ${res.statusCode}`));
        return;
      }
      
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const history = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(history);
        } catch (err) {
          reject(err);
        }
      });
    }).on('error', reject);
  });
}

// Auto-check on startup + periodic refresh
if (UPDATE_URL) {
  // Delay initial check by 2 seconds to ensure env vars are loaded
  setTimeout(() => {
    fetchUpdateManifest();
    setInterval(fetchUpdateManifest, UPDATE_CHECK_INTERVAL_MS);
    console.log(`[VENDOR-UPDATE] Auto-update enabled. Current: v${CURRENT_VERSION} | Check interval: ${UPDATE_CHECK_INTERVAL_MS / 3600000}h`);
  }, 2000);
}
