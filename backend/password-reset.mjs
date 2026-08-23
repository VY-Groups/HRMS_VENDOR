import crypto from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = resolve(__dirname, '..', 'data');
const resetTokensFile = join(dataDir, 'reset-tokens.json');
const RESET_TOKEN_TTL_SECONDS = 30 * 60; // 30 minutes

const DEFAULT_TOKENS_STORE = {
  tokens: []
};

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function ensureTokensStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(resetTokensFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.tokens)) {
      return { ...DEFAULT_TOKENS_STORE };
    }
    return parsed;
  } catch (_) {
    await writeFile(resetTokensFile, JSON.stringify(DEFAULT_TOKENS_STORE, null, 2), 'utf8');
    return { ...DEFAULT_TOKENS_STORE };
  }
}

async function saveTokensStore(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(resetTokensFile, JSON.stringify(store, null, 2), 'utf8');
}

function generateResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function createPasswordResetToken(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error('Email is required.');
  }

  const store = await ensureTokensStore();
  const now = Math.floor(Date.now() / 1000);
  
  // Remove expired tokens
  store.tokens = store.tokens.filter(t => t.expires_at > now);
  
  // Remove any existing tokens for this email
  store.tokens = store.tokens.filter(t => t.email !== normalizedEmail);
  
  // Create new token
  const token = generateResetToken();
  const resetToken = {
    token,
    email: normalizedEmail,
    created_at: now,
    expires_at: now + RESET_TOKEN_TTL_SECONDS,
    used: false
  };
  
  store.tokens.push(resetToken);
  await saveTokensStore(store);
  
  return {
    token,
    expires_in: RESET_TOKEN_TTL_SECONDS,
    reset_link: `/reset-password?token=${token}`
  };
}

export async function verifyResetToken(token) {
  const store = await ensureTokensStore();
  const now = Math.floor(Date.now() / 1000);
  
  const resetToken = store.tokens.find(t => 
    t.token === token && 
    !t.used && 
    t.expires_at > now
  );
  
  if (!resetToken) {
    return null;
  }
  
  return {
    email: resetToken.email,
    expires_at: resetToken.expires_at
  };
}

export async function markTokenAsUsed(token) {
  const store = await ensureTokensStore();
  const resetToken = store.tokens.find(t => t.token === token);
  
  if (resetToken) {
    resetToken.used = true;
    await saveTokensStore(store);
  }
}

export async function cleanupExpiredTokens() {
  const store = await ensureTokensStore();
  const now = Math.floor(Date.now() / 1000);
  
  const originalLength = store.tokens.length;
  store.tokens = store.tokens.filter(t => t.expires_at > now && !t.used);
  
  if (store.tokens.length !== originalLength) {
    await saveTokensStore(store);
  }
  
  return originalLength - store.tokens.length;
}
