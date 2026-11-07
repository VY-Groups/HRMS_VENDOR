import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSetupError, isPublicApiRoute, operatorRegistrationError } from './auth-routes.mjs';

test('operator registration is private after initial setup', () => {
  assert.equal(isPublicApiRoute('POST', '/api/auth/setup'), true);
  assert.equal(isPublicApiRoute('POST', '/api/auth/login'), true);
  assert.equal(isPublicApiRoute('POST', '/api/auth/register'), false);
});

test('registration is blocked until setup completes and requires an operator session', () => {
  assert.deepEqual(operatorRegistrationError(true, null), {
    status: 428,
    error: 'Vendor operator setup is required before sign-in.'
  });
  assert.deepEqual(operatorRegistrationError(false, null), {
    status: 401,
    error: 'Vendor authentication required.'
  });
  assert.equal(operatorRegistrationError(false, { operator: { id: 'operator-1' } }), null);
});

test('first operator setup requires a configured 32-character bootstrap token', () => {
  assert.deepEqual(initialSetupError(true, '', 'anything'), {
    status: 503,
    error: 'VENDOR_SETUP_TOKEN must be configured with at least 32 characters.'
  });
  assert.deepEqual(initialSetupError(true, 'x'.repeat(32), 'wrong'), {
    status: 403,
    error: 'Valid vendor setup token required.'
  });
  assert.equal(initialSetupError(true, 'x'.repeat(32), 'x'.repeat(32)), null);
  assert.equal(initialSetupError(false, 'x'.repeat(32), 'x'.repeat(32)).status, 409);
});
