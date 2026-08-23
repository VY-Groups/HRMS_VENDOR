/**
 * Customer Data Sync Service
 * Syncs customer data to/from GitHub for backup and multi-instance coordination
 */

import https from 'https';
import { readFile, writeFile } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = resolve(__dirname, '..', 'data');
const dataFile = join(dataDir, 'customers.json');

const config = {
  enabled: process.env.CUSTOMER_SYNC_ENABLED === 'true',
  token: process.env.CUSTOMER_GITHUB_TOKEN || '',
  owner: process.env.CUSTOMER_GITHUB_OWNER || 'VY-Groups',
  repo: process.env.CUSTOMER_GITHUB_REPO || 'HRMS-Release-Management',
  branch: process.env.CUSTOMER_GITHUB_BRANCH || 'vendor-tool',
  path: process.env.CUSTOMER_GITHUB_PATH || 'vendor-data/customers.json',
  autoSyncInterval: parseInt(process.env.CUSTOMER_AUTO_SYNC_INTERVAL_MS || '3600000', 10)
};

let syncTimer = null;
let lastSyncTime = null;
let syncStatus = {
  enabled: config.enabled,
  lastSync: null,
  lastSyncStatus: 'never',
  autoSyncEnabled: config.autoSyncInterval > 0,
  nextSync: null
};

/**
 * Make GitHub API request
 */
function githubRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path,
      method,
      headers: {
        'User-Agent': 'Vendor-Tool-Sync/1.0',
        'Authorization': `token ${config.token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };

    if (data) {
      const body = JSON.stringify(data);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', (chunk) => responseData += chunk);
      res.on('end', () => {
        try {
          const parsed = responseData ? JSON.parse(responseData) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ data: parsed, status: res.statusCode });
          } else {
            reject(new Error(`GitHub API error: ${res.statusCode} - ${parsed.message || responseData}`));
          }
        } catch (err) {
          reject(new Error(`Failed to parse GitHub response: ${err.message}`));
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Push customer data to GitHub
 */
export async function pushCustomersToGitHub() {
  if (!config.enabled || !config.token) {
    throw new Error('Customer sync is not enabled or token is missing');
  }

  console.log('[CUSTOMER-SYNC] Pushing customers to GitHub...');

  try {
    // Read local customer data
    const localData = await readFile(dataFile, 'utf8');
    const customers = JSON.parse(localData);

    // Get current file SHA (if exists)
    const getPath = `/repos/${config.owner}/${config.repo}/contents/${config.path}?ref=${config.branch}`;
    let sha = null;
    
    try {
      const { data: existing } = await githubRequest('GET', getPath);
      sha = existing.sha;
    } catch (err) {
      // File doesn't exist yet, that's okay
      console.log('[CUSTOMER-SYNC] File does not exist yet, will create new');
    }

    // Push to GitHub
    const content = Buffer.from(JSON.stringify(customers, null, 2)).toString('base64');
    const payload = {
      message: `sync: update customer data (${customers.customers?.length || 0} customers)`,
      content,
      branch: config.branch
    };

    if (sha) {
      payload.sha = sha;
    }

    const putPath = `/repos/${config.owner}/${config.repo}/contents/${config.path}`;
    await githubRequest('PUT', putPath, payload);

    lastSyncTime = new Date().toISOString();
    syncStatus.lastSync = lastSyncTime;
    syncStatus.lastSyncStatus = 'success';

    console.log(`[CUSTOMER-SYNC] ✓ Pushed ${customers.customers?.length || 0} customers to GitHub`);
    return { success: true, customerCount: customers.customers?.length || 0, timestamp: lastSyncTime };
  } catch (error) {
    syncStatus.lastSyncStatus = 'error';
    syncStatus.lastSyncError = error.message;
    console.error('[CUSTOMER-SYNC] ✗ Push failed:', error.message);
    throw error;
  }
}

/**
 * Pull customer data from GitHub
 */
export async function pullCustomersFromGitHub() {
  if (!config.enabled || !config.token) {
    throw new Error('Customer sync is not enabled or token is missing');
  }

  console.log('[CUSTOMER-SYNC] Pulling customers from GitHub...');

  try {
    // Fetch from GitHub
    const getPath = `/repos/${config.owner}/${config.repo}/contents/${config.path}?ref=${config.branch}`;
    const { data } = await githubRequest('GET', getPath);

    if (!data.content) {
      throw new Error('No content found in GitHub file');
    }

    // Decode and parse
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    const customers = JSON.parse(content);

    // Write to local file
    await writeFile(dataFile, JSON.stringify(customers, null, 2), 'utf8');

    lastSyncTime = new Date().toISOString();
    syncStatus.lastSync = lastSyncTime;
    syncStatus.lastSyncStatus = 'success';

    console.log(`[CUSTOMER-SYNC] ✓ Pulled ${customers.customers?.length || 0} customers from GitHub`);
    return { success: true, customerCount: customers.customers?.length || 0, timestamp: lastSyncTime };
  } catch (error) {
    syncStatus.lastSyncStatus = 'error';
    syncStatus.lastSyncError = error.message;
    console.error('[CUSTOMER-SYNC] ✗ Pull failed:', error.message);
    throw error;
  }
}

/**
 * Get sync status
 */
export function getSyncStatus() {
  return {
    ...syncStatus,
    config: {
      enabled: config.enabled,
      owner: config.owner,
      repo: config.repo,
      branch: config.branch,
      path: config.path,
      autoSyncInterval: config.autoSyncInterval
    }
  };
}

/**
 * Start auto-sync timer
 */
export function startAutoSync() {
  if (!config.enabled || config.autoSyncInterval <= 0) {
    console.log('[CUSTOMER-SYNC] Auto-sync is disabled');
    return;
  }

  if (syncTimer) {
    clearInterval(syncTimer);
  }

  syncTimer = setInterval(async () => {
    try {
      console.log('[CUSTOMER-SYNC] Running scheduled sync...');
      await pushCustomersToGitHub();
    } catch (error) {
      console.error('[CUSTOMER-SYNC] Auto-sync failed:', error.message);
    }
  }, config.autoSyncInterval);

  const nextSync = new Date(Date.now() + config.autoSyncInterval);
  syncStatus.nextSync = nextSync.toISOString();

  console.log(`[CUSTOMER-SYNC] Auto-sync enabled. Next sync: ${nextSync.toLocaleString()}`);
}

/**
 * Stop auto-sync timer
 */
export function stopAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    syncStatus.nextSync = null;
    console.log('[CUSTOMER-SYNC] Auto-sync stopped');
  }
}

// Start auto-sync on module load
if (config.enabled) {
  startAutoSync();
}
