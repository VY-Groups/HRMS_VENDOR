/**
 * init-crl.mjs
 * Run once to push the initial empty CRL to GitHub.
 * Usage: node vendor-license-tool/scripts/init-crl.mjs
 */

import crypto from 'crypto';

const TOKEN  = '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';
const OWNER  = 'VY-Groups';
const REPO   = 'HRMS-Release-Management';
const BRANCH = 'main';
const PATH   = 'crl/revoked.json';
const SIGN_KEY = 'HRMS-License-MasterKey-2026-Secure';

function stableStringify(value) {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

const entries = [];
const signature = crypto.createHmac('sha256', SIGN_KEY).update(stableStringify(entries)).digest('hex');

const crl = {
  schema:     'hrms-crl-v1',
  issuer:     `${OWNER}/${REPO}`,
  updated_at: new Date().toISOString(),
  version:    1,
  entries,
  signature
};

const apiBase = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`;
const headers = {
  Authorization:          `Bearer ${TOKEN}`,
  Accept:                 'application/vnd.github+json',
  'Content-Type':         'application/json',
  'X-GitHub-Api-Version': '2022-11-28'
};

// Get existing SHA if file exists
let sha = null;
try {
  const getRes = await fetch(`${apiBase}?ref=${BRANCH}`, { headers });
  if (getRes.ok) {
    const existing = await getRes.json();
    sha = existing.sha || null;
    console.log(`Existing file SHA: ${sha}`);
  }
} catch { /* first push */ }

// Push
const body = {
  message: `chore: initialize CRL v1 — 0 revoked licenses`,
  content: Buffer.from(JSON.stringify(crl, null, 2)).toString('base64'),
  branch:  BRANCH,
  ...(sha ? { sha } : {})
};

const putRes = await fetch(apiBase, { method: 'PUT', headers, body: JSON.stringify(body) });
const result = await putRes.json();

if (putRes.ok) {
  console.log('✅ CRL pushed successfully!');
  console.log(`   Commit: ${result.commit?.sha?.slice(0, 7)}`);
  console.log(`   URL:    https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${PATH}`);
  console.log(`   Signature: ${signature}`);
} else {
  console.error('❌ Push failed:', result.message || JSON.stringify(result));
  process.exit(1);
}
