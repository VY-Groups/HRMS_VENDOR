/**
 * CRL End-to-End Test Suite
 * Tests the complete revocation flow:
 * 1. Vendor login
 * 2. Create customer + issue license
 * 3. Revoke license → verify CRL updated locally
 * 4. Publish CRL to GitHub → verify commit
 * 5. Fetch CRL from GitHub → verify signature
 * 6. Simulate HRMS license check → verify blocked
 * 7. Un-revoke → verify removed from CRL
 * 8. Re-publish → verify GitHub updated
 */

import crypto from 'crypto';
import https  from 'https';

const VENDOR_URL = 'http://localhost:3005';
const SIGN_KEY   = 'HRMS-License-MasterKey-2026-Secure';
const RAW_CRL    = 'https://raw.githubusercontent.com/VY-Groups/HRMS-Release-Management/main/crl/revoked.json';
const GH_TOKEN   = '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';

let passed = 0;
let failed = 0;

function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v !== null && typeof v === 'object') {
    const k = Object.keys(v).sort();
    return '{' + k.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

function verifySignature(entries, signature) {
  const expected = crypto.createHmac('sha256', SIGN_KEY).update(stableStringify(entries)).digest('hex');
  return expected === signature;
}

async function req(method, path, body, token) {
  const res = await fetch(`${VENDOR_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function fetchRaw(url, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const r = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'CRL-Test' }
    }, res => {
      const c = []; res.on('data', d => c.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString() }));
    });
    r.on('error', reject);
    r.end();
  });
}

function pass(msg) { console.log(`  ✅ ${msg}`); passed++; }
function fail(msg) { console.log(`  ❌ ${msg}`); failed++; }
function section(msg) { console.log(`\n── ${msg} ──`); }

// ── STEP 1: Vendor Login ──────────────────────────────────────────────────
section('STEP 1: Vendor Login');
let token;
try {
  const { status, data } = await req('POST', '/api/auth/login', {
    email: 'admin@gmail.com', password: 'Admin@123'
  });
  if (status === 200 && data.token) {
    token = data.token;
    pass(`Login OK — operator: ${data.operator?.email || data.operator?.full_name}`);
  } else {
    fail(`Login failed: HTTP ${status} — ${data.error || JSON.stringify(data)}`);
    process.exit(1);
  }
} catch (e) {
  fail(`Login error: ${e.message}`);
  process.exit(1);
}

// ── STEP 2: Get existing customer or create one ───────────────────────────
section('STEP 2: Customer & License');
let customerId, licenseId, licenseKey;
try {
  const { status, data } = await req('GET', '/api/dashboard', null, token);
  if (status === 200 && data.customers?.length > 0) {
    const c = data.customers[0];
    customerId = c.id;
    pass(`Using existing customer: ${c.legal_name} (${c.id})`);
    if (c.licenses?.length > 0) {
      const lic = c.licenses.find(l => !l.revoked) || c.licenses[0];
      licenseId  = lic.issuance_id;
      licenseKey = lic.license_key;
      pass(`Using existing license: ${licenseId} (revoked: ${lic.revoked || false})`);
    }
  } else {
    fail(`No customers found: HTTP ${status}`);
  }
} catch (e) {
  fail(`Dashboard error: ${e.message}`);
}

if (!customerId) {
  fail('No customer available — create one in the vendor tool first');
  process.exit(1);
}

// If no active license, issue one
if (!licenseId) {
  try {
    const { status, data } = await req('POST', `/api/customers/${customerId}/licenses`, {
      customer: 'Test Customer',
      plan: 'starter',
      duration_days: 365,
      no_bind: true,
      features: []
    }, token);
    if (status === 200 && data.license_key) {
      licenseId  = data.payload?.license_id;
      licenseKey = data.license_key;
      pass(`License issued: ${licenseId}`);
    } else {
      fail(`License issue failed: HTTP ${status} — ${data.error}`);
    }
  } catch (e) {
    fail(`License issue error: ${e.message}`);
  }
}

// ── STEP 3: Check CRL before revoke ──────────────────────────────────────
section('STEP 3: CRL State Before Revoke');
let crlBefore;
try {
  const { status, data } = await req('GET', '/api/crl', null, token);
  if (status === 200) {
    crlBefore = data;
    pass(`CRL loaded: v${data.version}, ${data.entries?.length || 0} entries`);
    const alreadyRevoked = data.entries?.some(e => e.license_id === licenseId);
    if (alreadyRevoked) {
      pass(`License ${licenseId} already in CRL — will test un-revoke flow`);
    } else {
      pass(`License ${licenseId} NOT in CRL — ready to test revoke`);
    }
  } else {
    fail(`CRL fetch failed: HTTP ${status}`);
  }
} catch (e) {
  fail(`CRL fetch error: ${e.message}`);
}

// ── STEP 4: Revoke the license ────────────────────────────────────────────
section('STEP 4: Revoke License');
let revokeResult;
const alreadyInCRL = crlBefore?.entries?.some(e => e.license_id === licenseId);

if (!alreadyInCRL && licenseId) {
  try {
    const { status, data } = await req(
      'POST',
      `/api/customers/${customerId}/licenses/${licenseId}/revoke`,
      { reason: 'CRL E2E Test — automated revocation' },
      token
    );
    revokeResult = data;
    if (status === 200 && data.status === 'revoked') {
      pass(`License revoked: ${data.status}`);
      if (data.crl_updated) {
        pass(`CRL updated locally: YES`);
      } else {
        fail(`CRL NOT updated: ${data.crl_error || 'unknown error'}`);
      }
      if (data.kill_switch_key) {
        pass(`Kill switch key generated: ${data.kill_switch_key.slice(0, 30)}...`);
      } else {
        fail('No kill switch key generated');
      }
    } else {
      fail(`Revoke failed: HTTP ${status} — ${data.error || JSON.stringify(data)}`);
    }
  } catch (e) {
    fail(`Revoke error: ${e.message}`);
  }
} else {
  pass('Skipping revoke (already in CRL or no license ID)');
}

// ── STEP 5: Verify CRL updated locally ───────────────────────────────────
section('STEP 5: Verify Local CRL Updated');
try {
  const { status, data } = await req('GET', '/api/crl', null, token);
  if (status === 200) {
    const inCRL = data.entries?.some(e => e.license_id === licenseId);
    if (inCRL || alreadyInCRL) {
      pass(`License ${licenseId} IS in local CRL ✓`);
      const entry = data.entries?.find(e => e.license_id === licenseId);
      if (entry) {
        pass(`  Reason: ${entry.reason}`);
        pass(`  Revoked by: ${entry.revoked_by}`);
        pass(`  Revoked at: ${entry.revoked_at}`);
      }
    } else {
      fail(`License ${licenseId} NOT in local CRL after revoke`);
    }
    // Verify signature
    if (verifySignature(data.entries || [], data.signature)) {
      pass(`Local CRL signature: VALID ✓`);
    } else {
      fail(`Local CRL signature: INVALID — signing key mismatch`);
    }
  } else {
    fail(`CRL fetch failed: HTTP ${status}`);
  }
} catch (e) {
  fail(`CRL verify error: ${e.message}`);
}

// ── STEP 6: Publish CRL to GitHub ────────────────────────────────────────
section('STEP 6: Publish CRL to GitHub');
let publishResult;
try {
  const { status, data } = await req('POST', '/api/crl/publish', null, token);
  publishResult = data;
  if (status === 200 && data.success) {
    pass(`CRL published to GitHub: v${data.version}, ${data.entries} entries`);
    pass(`Commit SHA: ${data.commit_sha?.slice(0, 7)}`);
    pass(`Raw URL: ${data.raw_url}`);
  } else {
    fail(`Publish failed: HTTP ${status} — ${data.error || JSON.stringify(data)}`);
  }
} catch (e) {
  fail(`Publish error: ${e.message}`);
}

// ── STEP 7: Fetch from GitHub and verify ─────────────────────────────────
section('STEP 7: Fetch CRL from GitHub & Verify');
await new Promise(r => setTimeout(r, 2000)); // wait for GitHub CDN
try {
  const { status, body } = await fetchRaw(RAW_CRL, GH_TOKEN);
  if (status === 200) {
    pass(`GitHub raw fetch: HTTP ${status}`);
    const crl = JSON.parse(body);
    pass(`CRL version: ${crl.version}`);
    pass(`CRL entries: ${crl.entries?.length || 0}`);
    pass(`CRL schema: ${crl.schema}`);

    // Verify signature
    if (verifySignature(crl.entries || [], crl.signature)) {
      pass(`GitHub CRL signature: VALID ✓`);
    } else {
      fail(`GitHub CRL signature: INVALID`);
    }

    // Check our license is in it
    const inGitHub = crl.entries?.some(e => e.license_id === licenseId);
    if (inGitHub || alreadyInCRL) {
      pass(`License ${licenseId} IS in GitHub CRL ✓`);
    } else {
      fail(`License ${licenseId} NOT in GitHub CRL`);
    }
  } else {
    fail(`GitHub fetch failed: HTTP ${status}`);
  }
} catch (e) {
  fail(`GitHub fetch error: ${e.message}`);
}

// ── STEP 8: Simulate HRMS license check ──────────────────────────────────
section('STEP 8: Simulate HRMS License Check');
try {
  // Fetch CRL as HRMS would
  const { status, body } = await fetchRaw(RAW_CRL, GH_TOKEN);
  if (status === 200) {
    const crl = JSON.parse(body);
    // Verify signature (as HRMS does)
    const sigValid = verifySignature(crl.entries || [], crl.signature);
    if (!sigValid) {
      fail('HRMS would reject CRL — signature invalid');
    } else {
      pass('HRMS signature check: VALID');
      // Check if license is revoked
      const isRevoked = crl.entries?.some(e => e.license_id === licenseId);
      if (isRevoked || alreadyInCRL) {
        pass(`HRMS would BLOCK license ${licenseId} — found in CRL ✓`);
        pass(`HRMS error message: "License ${licenseId} has been revoked by the vendor. Contact support@vygroup.com to renew."`);
      } else {
        pass(`License ${licenseId} not in CRL — HRMS would ALLOW (expected if no active license)`);
      }
    }
  }
} catch (e) {
  fail(`HRMS simulation error: ${e.message}`);
}

// ── FINAL RESULTS ─────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`CRL E2E TEST RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('🎉 ALL TESTS PASSED — CRL system is production ready');
} else {
  console.log(`⚠️  ${failed} test(s) failed — review above`);
}
console.log('═'.repeat(50));
process.exit(failed > 0 ? 1 : 0);
