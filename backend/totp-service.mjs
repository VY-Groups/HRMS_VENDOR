import crypto from 'crypto';
import { ensureStore, saveStore, verifyPassword } from './auth-service.mjs';

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = 'sha1';
const BACKUP_CODE_COUNT = 10;

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let result = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    result += alphabet[parseInt(chunk, 2)];
  }
  return result;
}

function generateSecret(length = 20) {
  return base32Encode(crypto.randomBytes(length));
}

function generateTOTP(secret, time = Date.now()) {
  const key = Buffer.from(secret.replace(/ /g, ''), 'base64');
  const epoch = Math.floor(time / 1000);
  const counter = Math.floor(epoch / TOTP_PERIOD);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac(TOTP_ALGORITHM, key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % Math.pow(10, TOTP_DIGITS);
  return code.toString().padStart(TOTP_DIGITS, '0');
}

function verifyTOTP(secret, token, window = 1) {
  const now = Date.now();
  for (let i = -window; i <= window; i++) {
    const time = now + i * TOTP_PERIOD * 1000;
    if (generateTOTP(secret, time) === token) return true;
  }
  return false;
}

function generateBackupCodes(count = BACKUP_CODE_COUNT) {
  const codes = [];
  const plain = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    const formatted = code.slice(0, 4) + '-' + code.slice(4);
    plain.push(formatted);
    codes.push(hashBackupCode(formatted));
  }
  return { plain, hashed: codes };
}

function hashBackupCode(code) {
  return crypto.createHash('sha256').update(code.replace(/-/g, '').toLowerCase()).digest('hex');
}

function verifyBackupCode(inputCode, hashedCodes) {
  const hash = hashBackupCode(inputCode);
  const index = hashedCodes.indexOf(hash);
  if (index === -1) return false;
  hashedCodes.splice(index, 1);
  return true;
}

function generateQRDataUrl(label, secret, issuer = 'VY Group Vendor Console') {
  const otpauth = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauth)}`;
  return qrUrl;
}

// ── API Functions ────────────────────────────────────────────────

export async function setup2FA(operatorId) {
  const store = await ensureStore();
  const operator = store.operators.find(op => op.id === operatorId);
  if (!operator) throw new Error('Operator not found.');
  if (operator.totp_enabled) throw new Error('2FA is already enabled. Disable it first.');

  const secret = generateSecret();
  const { plain: backupCodesPlain, hashed: backupCodesHashed } = generateBackupCodes();
  const qrDataUrl = generateQRDataUrl(operator.email, secret);

  const index = store.operators.findIndex(op => op.id === operatorId);
  store.operators[index] = {
    ...operator,
    totp_secret_pending: secret,
    totp_backup_codes_pending: backupCodesHashed,
    updated_at: new Date().toISOString()
  };
  await saveStore(store);

  return {
    secret,
    qrCodeDataUrl: qrDataUrl,
    backupCodesPlain,
    backupCodesHashed,
    manualEntryKey: secret,
    label: operator.email,
    issuer: 'VY Group Vendor Console'
  };
}

export async function confirm2FA(operatorId, token, secret, backupCodesHashed) {
  const store = await ensureStore();
  const operator = store.operators.find(op => op.id === operatorId);
  if (!operator) throw new Error('Operator not found.');

  const pendingSecret = secret || operator.totp_secret_pending;
  if (!pendingSecret) throw new Error('No pending 2FA setup. Start setup first.');

  if (!verifyTOTP(pendingSecret, token)) {
    throw new Error('Invalid verification code. Try again.');
  }

  const index = store.operators.findIndex(op => op.id === operatorId);
  store.operators[index] = {
    ...operator,
    totp_enabled: true,
    totp_secret: pendingSecret,
    totp_backup_codes: backupCodesHashed || operator.totp_backup_codes_pending || [],
    totp_secret_pending: null,
    totp_backup_codes_pending: null,
    updated_at: new Date().toISOString()
  };
  await saveStore(store);

  return { enabled: true, message: '2FA has been enabled successfully.' };
}

export async function disable2FA(operatorId, password) {
  const store = await ensureStore();
  const operator = store.operators.find(op => op.id === operatorId);
  if (!operator) throw new Error('Operator not found.');
  if (!operator.totp_enabled) throw new Error('2FA is not enabled.');

  if (!verifyPassword(password, operator.password_hash)) {
    throw new Error('Invalid password. Please confirm your password to disable 2FA.');
  }

  const index = store.operators.findIndex(op => op.id === operatorId);
  store.operators[index] = {
    ...operator,
    totp_enabled: false,
    totp_secret: null,
    totp_backup_codes: null,
    totp_secret_pending: null,
    totp_backup_codes_pending: null,
    updated_at: new Date().toISOString()
  };
  await saveStore(store);

  return { disabled: true, message: '2FA has been disabled.' };
}

export async function verify2FAForLogin(operatorId, token) {
  const store = await ensureStore();
  const operator = store.operators.find(op => op.id === operatorId);
  if (!operator) throw new Error('Operator not found.');
  if (!operator.totp_enabled || !operator.totp_secret) {
    return { verified: true, message: '2FA not enabled.' };
  }

  if (operator.totp_backup_codes && /^[A-F0-9]{4}-[A-F0-9]{4}$/i.test(token.replace(/\s/g, ''))) {
    const backupCodes = [...operator.totp_backup_codes];
    if (verifyBackupCode(token.replace(/\s/g, ''), backupCodes)) {
      const index = store.operators.findIndex(op => op.id === operatorId);
      store.operators[index] = {
        ...operator,
        totp_backup_codes: backupCodes,
        updated_at: new Date().toISOString()
      };
      await saveStore(store);
      return { verified: true, message: 'Backup code accepted.', usedBackup: true };
    }
    return { verified: false, error: 'Invalid backup code.' };
  }

  if (verifyTOTP(operator.totp_secret, token)) {
    return { verified: true, message: 'TOTP verified.' };
  }

  return { verified: false, error: 'Invalid verification code.' };
}

export async function regenerateBackupCodes(operatorId, password) {
  const store = await ensureStore();
  const operator = store.operators.find(op => op.id === operatorId);
  if (!operator) throw new Error('Operator not found.');
  if (!operator.totp_enabled) throw new Error('2FA must be enabled first.');

  if (!verifyPassword(password, operator.password_hash)) {
    throw new Error('Invalid password.');
  }

  const { plain, hashed } = generateBackupCodes();
  const index = store.operators.findIndex(op => op.id === operatorId);
  store.operators[index] = {
    ...operator,
    totp_backup_codes: hashed,
    updated_at: new Date().toISOString()
  };
  await saveStore(store);

  return { backupCodesPlain: plain, message: 'New backup codes generated. Previous codes are now invalid.' };
}

export { verifyTOTP, generateSecret };
