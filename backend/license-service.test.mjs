import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const signing = crypto.generateKeyPairSync('ed25519');
const encryption = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const encodePem = key => Buffer.from(key.export({ type: key.type === 'private' ? 'pkcs8' : 'spki', format: 'pem' })).toString('base64');
const stableJson = value => Array.isArray(value)
  ? `[${value.map(stableJson).join(',')}]`
  : value && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
    : JSON.stringify(value);
process.env.VENDOR_LICENSE_SIGNING_PRIVATE_KEY_B64 = encodePem(signing.privateKey);
process.env.VENDOR_LICENSE_SIGNING_PUBLIC_KEY_B64 = encodePem(signing.publicKey);
process.env.VENDOR_LICENSE_ENCRYPTION_PUBLIC_KEY_B64 = encodePem(encryption.publicKey);
process.env.VENDOR_LICENSE_ENCRYPTION_PRIVATE_KEY_B64 = encodePem(encryption.privateKey);
process.env.VENDOR_LICENSE_MASTER_KEY = 'test-only-master-key';
const { createOpaqueLicense, decodeLicenseKey } = await import('./license-service.mjs');
const { addToCRL, signCRL } = await import('./crl-service.mjs');

test('HRMS3 licenses stay opaque and verify/decrypt with asymmetric keys', () => {
  const { license_key } = createOpaqueLicense({ customer: 'Test Customer', no_bind: true });
  assert.match(license_key, /^HRMS3-/);
  assert.equal(license_key.includes('Test Customer'), false);
  assert.equal(decodeLicenseKey(license_key).customer, 'Test Customer');
});

test('HRMS3 rejects changed payloads and old shared-key formats', () => {
  const { license_key } = createOpaqueLicense({ customer: 'Test Customer', no_bind: true });
  const tampered = license_key.split('.');
  tampered[2] = (tampered[2][0] === 'A' ? 'B' : 'A') + tampered[2].slice(1);
  assert.throws(() => decodeLicenseKey(tampered.join('.')));
  assert.throws(() => decodeLicenseKey('HRMS2-old.shared.key'));
  assert.throws(() => decodeLicenseKey('HRMS1-old.' + '0'.repeat(64)));
});

test('license issuance fails when its asymmetric keys are not configured', () => {
  const privateKey = process.env.VENDOR_LICENSE_SIGNING_PRIVATE_KEY_B64;
  delete process.env.VENDOR_LICENSE_SIGNING_PRIVATE_KEY_B64;
  try {
    assert.throws(() => createOpaqueLicense({ customer: 'Test Customer', no_bind: true }), /signing private key and HRMS encryption public key are required/);
  } finally {
    process.env.VENDOR_LICENSE_SIGNING_PRIVATE_KEY_B64 = privateKey;
  }
});

test('revocation lists use the vendor Ed25519 signing key', () => {
  const entries = [{ license_id: 'revoked', customer: 'Test Customer', plan: 'poc', reason: 'test', revoked_by: 'operator@example.com', revoked_at: '2026-11-07T00:00:00.000Z' }];
  const signature = signCRL(entries);
  const publishedEntries = entries.map(({ license_id, customer, plan, reason, revoked_at }) => ({ license_id, customer, plan, reason, revoked_at }));
  assert.equal(crypto.verify(null, Buffer.from(stableJson(publishedEntries)), signing.publicKey, Buffer.from(signature, 'base64url')), true);
});

test('CRL insertion reports a failed GitHub publish instead of implying success', async () => {
  const previousToken = process.env.CRL_GITHUB_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.CRL_GITHUB_TOKEN = 'ghp_test_only_invalid_token';
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const vendorId = `review-${crypto.randomUUID()}`;
  const crlPath = fileURLToPath(new URL(`./data/crl/vendor-${vendorId}.json`, import.meta.url));
  try {
    const result = await addToCRL({ vendor_id: vendorId, license_id: 'test-license', customer: 'Test Customer', plan: 'poc' });
    assert.equal(result.publication.success, false);
    assert.match(result.publication.error, /GitHub push failed: unauthorized/);
  } finally {
    await rm(crlPath, { force: true });
    if (previousToken === undefined) delete process.env.CRL_GITHUB_TOKEN;
    else process.env.CRL_GITHUB_TOKEN = previousToken;
    globalThis.fetch = previousFetch;
  }
});

test('unknown explicit license plans cannot fall through to enterprise', () => {
  assert.throws(() => createOpaqueLicense({ customer: 'Test Customer', no_bind: true, plan: 'enterpirse' }), /Unknown license plan/);
});
