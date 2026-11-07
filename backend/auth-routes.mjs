import { timingSafeEqual } from 'node:crypto';

export function isPublicApiRoute(method, pathname) {
  return (
    (method === 'GET' && pathname === '/api/plans') ||
    (method === 'GET' && pathname === '/api/security-note') ||
    (method === 'GET' && pathname === '/api/auth/status') ||
    (method === 'POST' && pathname === '/api/auth/setup') ||
    (method === 'POST' && pathname === '/api/auth/login') ||
    (method === 'POST' && pathname === '/api/auth/logout') ||
    (method === 'POST' && pathname === '/api/auth/forgot-password') ||
    (method === 'POST' && pathname === '/api/auth/reset-password') ||
    (method === 'POST' && pathname === '/api/auth/2fa/verify') ||
    (method === 'POST' && pathname === '/api/auth/send-otp') ||
    (method === 'POST' && pathname === '/api/auth/verify-otp')
  );
}

export function initialSetupError(setupRequired, configuredToken, providedToken) {
  if (!setupRequired) return { status: 409, error: 'Vendor operator setup is already complete.' };
  const expected = Buffer.from(String(configuredToken || ''), 'utf8');
  const provided = Buffer.from(String(providedToken || ''), 'utf8');
  if (expected.length < 32) return { status: 503, error: 'VENDOR_SETUP_TOKEN must be configured with at least 32 characters.' };
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { status: 403, error: 'Valid vendor setup token required.' };
  }
  return null;
}

export function operatorRegistrationError(setupRequired, session) {
  if (setupRequired) return { status: 428, error: 'Vendor operator setup is required before sign-in.' };
  if (!session) return { status: 401, error: 'Vendor authentication required.' };
  return null;
}
