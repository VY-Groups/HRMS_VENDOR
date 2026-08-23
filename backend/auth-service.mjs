import crypto from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { encrypt, hmacSign, hmacVerify } from './crypto-utils.mjs';
import { getSessionSecret as getSecureSessionSecret } from './secure-config.mjs';
import { atomicWriteJson, withLock } from './atomic-write.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = resolve(__dirname, '..', 'data');
const operatorStoreFile = join(dataDir, 'operators.json');
const sessionSecretFile = join(dataDir, 'session-secret.key');
const SESSION_TTL_SECONDS = 12 * 60 * 60;

const DEFAULT_STORE = {
  operators: []
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64url(value) {
  return Buffer.from(String(value || ''), 'base64url');
}

function getConsoleName() {
  return normalizeText(process.env.VENDOR_CONSOLE_NAME) || 'VY Group Vendor Licensing Console';
}

export function validatePasswordStrength(password) {
  const value = String(password || '');
  if (value.length < 10) {
    return 'Password must be at least 10 characters long.';
  }
  if (!/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    return 'Password must include upper, lower, number, and special characters.';
  }
  return '';
}

export async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(operatorStoreFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.operators)) {
      return { ...DEFAULT_STORE };
    }

    // Verify integrity if signature exists
    if (parsed._integrity && parsed._integrity.signature) {
      const dataToVerify = JSON.stringify(parsed.operators);
      const signatureValid = hmacVerify(dataToVerify, parsed._integrity.signature);
      if (!signatureValid) {
        console.error('[SECURITY] CRITICAL: Operator data integrity check FAILED! Data may have been tampered with.');
        // Log the tampering attempt but still load the data (with warning)
        parsed._tampered = true;
      }
    }

    return parsed;
  } catch (_) {
    await writeFile(operatorStoreFile, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8');
    return { ...DEFAULT_STORE };
  }
}

export async function saveStore(store) {
  await mkdir(dataDir, { recursive: true });

  // Add HMAC integrity signature before saving
  const dataToSign = JSON.stringify(store.operators);
  const signature = hmacSign(dataToSign);

  const storeWithIntegrity = {
    ...store,
    _integrity: {
      signature,
      signed_at: new Date().toISOString(),
      operator_count: store.operators.length
    }
  };

  // Remove _tampered flag if present
  delete storeWithIntegrity._tampered;

  // Use atomic write to prevent race conditions (Risk 2 fix)
  await atomicWriteJson(operatorStoreFile, storeWithIntegrity);
}

async function ensureSessionSecret() {
  // Try secure-config first (bootstrap-encrypted master key)
  const secureSecret = getSecureSessionSecret();
  if (secureSecret) {
    return secureSecret;
  }

  // Fallback to env var
  const explicit = normalizeText(process.env.VENDOR_CONSOLE_SESSION_SECRET);
  if (explicit) {
    return explicit;
  }

  // Last resort: generate and store a persistent secret
  await mkdir(dataDir, { recursive: true });
  try {
    const existing = await readFile(sessionSecretFile, 'utf8');
    const normalized = normalizeText(existing);
    if (normalized) {
      return normalized;
    }
  } catch (_) {
    // fall through to generating a persistent local secret
  }

  const generated = crypto.randomBytes(48).toString('hex');
  await writeFile(sessionSecretFile, generated, 'utf8');
  return generated;
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, passwordHash) {
  const [salt, storedHash] = String(passwordHash || '').split(':');
  if (!salt || !storedHash) {
    return false;
  }

  const derived = crypto.scryptSync(String(password || ''), salt, 64);
  const expected = Buffer.from(storedHash, 'hex');
  if (derived.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(derived, expected);
}

export function sanitizeOperator(operator) {
  return {
    id: operator.id,
    vendor_id: operator.vendor_id,
    full_name: operator.full_name,
    email: operator.email,
    role: operator.role,
    is_master: Boolean(operator.is_master),
    created_at: operator.created_at,
    last_login_at: operator.last_login_at
  };
}

function signTokenPayload(payload, secret) {
  const header = {
    alg: 'HS256',
    typ: 'VENDOR'
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyTokenPayload(token, secret) {
  const [encodedHeader, encodedPayload, signature] = String(token || '').split('.');
  if (!encodedHeader || !encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  const actualSignature = fromBase64url(signature);

  if (expectedSignature.length !== actualSignature.length || !crypto.timingSafeEqual(expectedSignature, actualSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64url(encodedPayload).toString('utf8'));
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch (_) {
    return null;
  }
}

export async function issueOperatorSession(operator) {
  const secret = await ensureSessionSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = {
    sub: operator.id,
    vendor_id: operator.vendor_id,
    email: operator.email,
    name: operator.full_name,
    role: operator.role,
    token_version: operator.token_version || 0,  // Track token version for invalidation
    iat: issuedAt,
    exp: issuedAt + SESSION_TTL_SECONDS,
    aud: 'vendor-license-tool'
  };
  return signTokenPayload(payload, secret);
}

export async function isOperatorSetupRequired() {
  const store = await ensureStore();
  return !store.operators.length;
}

export async function getAuthStatus(authorizationHeader = '') {
  const setup_required = await isOperatorSetupRequired();
  const session = setup_required ? null : await verifyOperatorSession(authorizationHeader);
  return {
    setup_required,
    authenticated: Boolean(session),
    console_name: getConsoleName(),
    operator: session?.operator || null
  };
}

export async function createInitialOperator({ full_name, email, password, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name }) {
  const store = await ensureStore();
  if (store.operators.length) {
    throw new Error('Vendor operator setup has already been completed.');
  }

  const normalizedName = normalizeText(full_name);
  const normalizedEmail = normalizeEmail(email);
  const passwordError = validatePasswordStrength(password);

  if (!normalizedName) throw new Error('Operator full name is required.');
  if (!normalizedEmail) throw new Error('Operator email is required.');
  if (passwordError) throw new Error(passwordError);

  const now = new Date().toISOString();
  const vendor_id = crypto.randomUUID().split('-')[0];
  
  // Encrypt SMTP password if provided
  let encryptedSmtpPass = '';
  if (smtp_pass) {
    try {
      const { bootstrapEncrypt } = await import('./secure-config.mjs');
      encryptedSmtpPass = bootstrapEncrypt(smtp_pass);
    } catch {
      encryptedSmtpPass = encrypt(smtp_pass);
    }
  }
  
  const operator = {
    id: crypto.randomUUID(),
    vendor_id,
    full_name: normalizedName,
    email: normalizedEmail,
    role: 'platform_admin',
    is_master: true,
    password_hash: hashPassword(password),
    encrypted_password: encrypt(password),
    created_at: now,
    updated_at: now,
    last_login_at: now
  };

  store.operators = [operator];
  await saveStore(store);

  // Save mail config if SMTP details provided
  if (smtp_host && smtp_user) {
    try {
      const { saveMailConfig } = await import('./mail-service.mjs');
      await saveMailConfig({
        smtp_host: smtp_host || '',
        smtp_port: parseInt(smtp_port) || 587,
        smtp_user: smtp_user || normalizedEmail,
        smtp_pass: encryptedSmtpPass,
        smtp_from_name: smtp_from_name || 'VY Group Vendor Console',
        smtp_from_email: normalizedEmail,
        smtp_secure: parseInt(smtp_port) === 465,
        is_active: true
      });
    } catch (e) {
      console.error('[SETUP] Failed to save mail config:', e.message);
    }
  }

  return {
    operator: sanitizeOperator(operator),
    token: await issueOperatorSession(operator)
  };
}

export async function loginOperator({ email, password }) {
  const store = await ensureStore();
  const normalizedEmail = normalizeEmail(email);
  const operatorIndex = store.operators.findIndex(item => item.email === normalizedEmail);

  if (operatorIndex === -1) {
    throw new Error('Operator account not found.');
  }

  const operator = store.operators[operatorIndex];
  if (!verifyPassword(password, operator.password_hash)) {
    throw new Error('Invalid credentials.');
  }

  const now = new Date().toISOString();
  const updatedOperator = {
    ...operator,
    last_login_at: now,
    updated_at: now,
    // Ensure encrypted_password exists for backward compatibility
    encrypted_password: operator.encrypted_password || encrypt(password)
  };
  store.operators[operatorIndex] = updatedOperator;
  await saveStore(store);

  return {
    operator: sanitizeOperator(updatedOperator),
    token: await issueOperatorSession(updatedOperator)
  };
}

export async function verifyOperatorSession(authorizationHeader = '') {
  const token = String(authorizationHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return null;
  }

  const secret = await ensureSessionSecret();
  const payload = verifyTokenPayload(token, secret);
  if (!payload?.sub) {
    return null;
  }

  const store = await ensureStore();
  const operator = store.operators.find(item => item.id === payload.sub);
  if (!operator) {
    return null;
  }

  // Session invalidation: Check if token was issued before password change
  // If token_version in token doesn't match operator's current token_version, reject
  const tokenVersion = payload.token_version || 0;
  const currentVersion = operator.token_version || 0;
  if (tokenVersion !== currentVersion) {
    console.log(`[SECURITY] Session rejected for ${operator.email}: token_version mismatch (token: ${tokenVersion}, current: ${currentVersion})`);
    return null;
  }

  return {
    payload,
    operator: sanitizeOperator(operator)
  };
}



// ==================== PASSWORD RESET ====================

export async function requestPasswordReset(email) {
  const store = await ensureStore();
  const normalizedEmail = normalizeEmail(email);
  
  const operator = store.operators.find(item => item.email === normalizedEmail);
  if (!operator) {
    // Don't reveal if email exists or not for security
    return {
      message: 'If an account with that email exists, a password reset link has been sent.'
    };
  }
  
  // In a real application, you would send an email here
  // For now, we'll just return the token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  
  // Store reset token in operator record
  const operatorIndex = store.operators.findIndex(item => item.email === normalizedEmail);
  store.operators[operatorIndex] = {
    ...operator,
    reset_token: resetToken,
    reset_token_expires: expiresAt.toISOString(),
    updated_at: new Date().toISOString()
  };
  
  await saveStore(store);
  
  // Try to send real email if mail service is configured
  let emailSent = false;
  try {
    const { sendPasswordResetEmail: sendReset } = await import('./mail-service.mjs');
    const resetUrl = `${process.env.VENDOR_PUBLIC_URL || 'http://localhost:3005'}${'/reset-password?token=' + resetToken}`;
    const emailResult = await sendReset(normalizedEmail, resetUrl, operator.full_name);
    emailSent = emailResult.sent;
  } catch (e) {
    console.error('[MAIL] Failed to send reset email:', e.message);
  }

  return {
    message: emailSent
      ? 'Password reset link has been sent to your email.'
      : 'If an account with that email exists, a password reset link has been sent.',
    // In development, return the token. Remove this in production!
    dev_reset_token: resetToken,
    dev_reset_link: `/reset-password?token=${resetToken}`
  };
}

export async function resetPassword({ token, newPassword }) {
  const store = await ensureStore();
  
  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) {
    throw new Error(passwordError);
  }
  
  const operator = store.operators.find(item => 
    item.reset_token === token &&
    item.reset_token_expires &&
    new Date(item.reset_token_expires) > new Date()
  );
  
  if (!operator) {
    throw new Error('Invalid or expired reset token.');
  }
  
  // Update password and clear reset token
  // Increment token_version to invalidate all existing sessions
  const operatorIndex = store.operators.findIndex(item => item.id === operator.id);
  store.operators[operatorIndex] = {
    ...operator,
    password_hash: hashPassword(newPassword),
    encrypted_password: encrypt(newPassword),  // AES-256-GCM encrypted for backup
    token_version: (operator.token_version || 0) + 1,  // Invalidate all existing tokens
    reset_token: null,
    reset_token_expires: null,
    updated_at: new Date().toISOString()
  };
  
  await saveStore(store);
  
  return {
    message: 'Password has been reset successfully.',
    operator: sanitizeOperator(store.operators[operatorIndex])
  };
}

// ==================== MASTER PASSWORD CHANGE ====================

export async function changeMasterPassword(operatorId, { currentPassword, newPassword }) {
  const store = await ensureStore();
  const index = store.operators.findIndex(op => op.id === operatorId);
  if (index === -1) throw new Error('Operator not found.');

  const operator = store.operators[index];
  // Check explicit flag OR fallback to first operator
  const isExplicitMaster = Boolean(operator.is_master);
  const isFallbackMaster = !store.operators.some(op => op.is_master) &&
    operator.id === store.operators.reduce((min, op) =>
      !min || (op.created_at && op.created_at < min.created_at) ? op : min
    , null)?.id;
  
  if (!isExplicitMaster && !isFallbackMaster) {
    throw new Error('Only the master operator can use this endpoint.');
  }

  // Verify current password
  if (!verifyPassword(currentPassword, operator.password_hash)) {
    throw new Error('Current password is incorrect.');
  }

  // Validate new password
  const passwordError = validatePasswordStrength(newPassword);
  if (passwordError) throw new Error(passwordError);

  // Ensure new password is different
  if (verifyPassword(newPassword, operator.password_hash)) {
    throw new Error('New password must be different from current password.');
  }

  // Update password hash + encrypted version (never store plaintext)
  // Increment token_version to invalidate all existing sessions
  store.operators[index] = {
    ...operator,
    password_hash: hashPassword(newPassword),
    encrypted_password: encrypt(newPassword),  // AES-256-GCM encrypted for backup
    token_version: (operator.token_version || 0) + 1,  // Invalidate all existing tokens
    updated_at: new Date().toISOString()
  };

  await saveStore(store);

  return {
    message: 'Master password changed successfully.',
    operator: sanitizeOperator(store.operators[index])
  };
}

// ==================== REGISTER NEW OPERATOR ====================

export async function registerNewOperator({ full_name, email, password }) {
  const store = await ensureStore();
  
  const normalizedName = normalizeText(full_name);
  const normalizedEmail = normalizeEmail(email);
  const passwordError = validatePasswordStrength(password);

  if (!normalizedName) {
    throw new Error('Operator full name is required.');
  }
  if (!normalizedEmail) {
    throw new Error('Operator email is required.');
  }
  if (passwordError) {
    throw new Error(passwordError);
  }
  
  // Check if email already exists
  const existingOperator = store.operators.find(item => item.email === normalizedEmail);
  if (existingOperator) {
    throw new Error('An operator with this email already exists.');
  }

  const now = new Date().toISOString();
  const operator = {
    id: crypto.randomUUID(),
    full_name: normalizedName,
    email: normalizedEmail,
    role: store.operators.length === 0 ? 'platform_admin' : 'operator',
    password_hash: hashPassword(password),
    encrypted_password: encrypt(password),  // AES-256-GCM encrypted for backup only
    created_at: now,
    updated_at: now,
    last_login_at: now
  };

  store.operators.push(operator);
  await saveStore(store);

  return {
    operator: sanitizeOperator(operator),
    token: await issueOperatorSession(operator)
  };
}
