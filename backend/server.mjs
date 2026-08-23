import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { createInitialOperator, getAuthStatus, isOperatorSetupRequired, loginOperator, registerNewOperator, requestPasswordReset, resetPassword, verifyOperatorSession } from './auth-service.mjs';
import { createOpaqueLicense, getPublicPlanCatalog, getVendorSecurityNote } from './license-service.mjs';
import { archiveCustomer, deleteCustomer, extendLicense, getCustomer, getCustomerSummary, listCustomers, recordLicenseIssuance, revokeLicense, upsertCustomer } from './customer-store.mjs';
import { logAuditEvent, getAuditLog, getAuditStats } from './audit-log.mjs';
import { checkAndSendRenewalReminders, getRenewalReminderStats } from './renewal-service.mjs';
import { initWebSocketRelay, broadcastRevocation, broadcastExtension, getRelayStats } from './websocket-relay.mjs';
import { backupVendor, restoreVendor, getBackupStatus, getBackupManifest, listBackupVendors, hasBackup, initGithubBackup } from './github-backup.mjs';
import { listVendors, getVendor, createVendor, updateVendor, deleteVendor, suspendVendor, activateVendor, getVendorSummary } from './vendor-registry.mjs';
import { initSecureConfig } from './secure-config.mjs';
import { getMailConfig, saveMailConfig, testMailConnection, sendMail, sendPasswordResetEmail } from './mail-service.mjs';
import { setup2FA, confirm2FA, disable2FA, verify2FAForLogin, regenerateBackupCodes } from './totp-service.mjs';

// ── Rate Limiting for Login ───────────────────────────────────────────────
// Protects against brute-force password attacks
const loginAttempts = new Map(); // IP -> { count, firstAttemptAt, blockedUntil }
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5; // 5 failed attempts per window
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes lockout

function checkRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  
  if (!record) return { allowed: true, remaining: MAX_ATTEMPTS };
  
  // If blocked, check if lockout expired
  if (record.blockedUntil && now < record.blockedUntil) {
    const waitMinutes = Math.ceil((record.blockedUntil - now) / 60000);
    return { allowed: false, remaining: 0, waitMinutes, blocked: true };
  }
  
  // If window expired, reset
  if (now - record.firstAttemptAt > RATE_LIMIT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { allowed: true, remaining: MAX_ATTEMPTS };
  }
  
  return { allowed: record.count < MAX_ATTEMPTS, remaining: Math.max(0, MAX_ATTEMPTS - record.count) };
}

function recordFailedAttempt(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttemptAt: now };
  record.count++;
  
  if (record.count >= MAX_ATTEMPTS) {
    record.blockedUntil = now + LOCKOUT_DURATION_MS;
    console.log(`[SECURITY] IP ${ip} locked out for ${LOCKOUT_DURATION_MS / 60000} minutes (${record.count} failed attempts)`);
  }
  
  loginAttempts.set(ip, record);
}

function clearAttempts(ip) {
  loginAttempts.delete(ip);
}

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (record.blockedUntil && now > record.blockedUntil) {
      loginAttempts.delete(ip);
    } else if (now - record.firstAttemptAt > RATE_LIMIT_WINDOW_MS * 2) {
      loginAttempts.delete(ip);
    }
  }
}, 5 * 60 * 1000);

// ── Load .env file (no external dependency needed) ────────────────────────
(function loadEnv() {
  const envPath = resolve(dirname(fileURLToPath(import.meta.url)), '.env');
  if (!existsSync(envPath)) return;
  try {
    const lines = readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx < 1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch (_) { /* non-fatal */ }
})();

// Initialize secure configuration (bootstrap-encrypted secrets)
initSecureConfig();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const frontendRoot = join(projectRoot, 'frontend');
const port = Number.parseInt(process.env.VENDOR_LICENSE_PORT || '3005', 10) || 3005;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJsonBody(req) {
  const text = await readBody(req);
  return JSON.parse(text || '{}');
}

// ── Backup Trigger Helper ─────────────────────────────────────────────────
function triggerBackup(vendorId, reason) {
  if (!vendorId || vendorId === 'default') return;
  // Non-blocking — fire and forget with debounce
  backupVendor(vendorId, { reason }).catch(err => {
    console.error(`[BACKUP] Trigger failed for ${vendorId}:`, err.message);
  });
}

async function serveStatic(res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const filePath = resolve(frontendRoot, `.${safePath}`);
  if (!filePath.startsWith(frontendRoot)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }

  try {
    const content = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(content);
  } catch (_) {
    sendJson(res, 404, { error: 'File not found.' });
  }
}

function isPublicApiRoute(method, pathname) {
  return (
    (method === 'GET' && pathname === '/api/plans') ||
    (method === 'GET' && pathname === '/api/security-note') ||
    (method === 'GET' && pathname === '/api/auth/status') ||
    (method === 'POST' && pathname === '/api/auth/setup') ||
    (method === 'POST' && pathname === '/api/auth/register') ||
    (method === 'POST' && pathname === '/api/auth/login') ||
    (method === 'POST' && pathname === '/api/auth/logout') ||
    (method === 'POST' && pathname === '/api/auth/forgot-password') ||
    (method === 'POST' && pathname === '/api/auth/reset-password') ||
    (method === 'POST' && pathname === '/api/auth/2fa/verify') ||
    (method === 'POST' && pathname === '/api/auth/send-otp') ||
    (method === 'POST' && pathname === '/api/auth/verify-otp')
  );
}

// ── OTP Store (in-memory for setup flow) ────────────────────────────────────
const otpStore = new Map(); // email -> { code, expiresAt, smtpConfig }

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendSetupOTP(email, smtpConfig) {
  const code = generateOTP();
  const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes
  otpStore.set(email, { code, expiresAt, smtpConfig });
  
  try {
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.default.createTransport({
      host: smtpConfig.smtp_host,
      port: parseInt(smtpConfig.smtp_port) || 587,
      secure: parseInt(smtpConfig.smtp_port) === 465,
      auth: { user: smtpConfig.smtp_user, pass: smtpConfig.smtp_pass },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 10000
    });
    
    await transporter.sendMail({
      from: `"VY Group" <${smtpConfig.smtp_from_email || smtpConfig.smtp_user}>`,
      to: email,
      subject: 'VY Group Vendor Console - Email Verification OTP',
      html: `<div style="font-family:system-ui,sans-serif;max-width:400px;margin:40px auto;padding:40px;text-align:center;">
        <div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;font-size:20px;font-weight:800;padding:10px 20px;border-radius:10px;margin-bottom:24px;">VY</div>
        <h2 style="color:#111827;margin:0 0 12px;">Verify Your Email</h2>
        <p style="color:#6b7280;margin:0 0 24px;">Enter this 6-digit code to verify your email address:</p>
        <div style="font-size:36px;font-weight:800;letter-spacing:12px;color:#6366f1;font-family:monospace;background:#f3f4f6;padding:16px;border-radius:12px;">${code}</div>
        <p style="color:#9ca3af;font-size:12px;margin-top:24px;">This code expires in 10 minutes.</p>
      </div>`
    });
    
    return { sent: true };
  } catch (err) {
    console.error('[OTP] Failed to send:', err.message);
    return { sent: false, error: err.message };
  }
}

function verifyOTP(email, code) {
  const record = otpStore.get(email);
  if (!record) return { valid: false, error: 'No OTP request found. Please request a new code.' };
  if (Date.now() > record.expiresAt) { otpStore.delete(email); return { valid: false, error: 'OTP expired. Please request a new code.' }; }
  if (record.code !== code) return { valid: false, error: 'Invalid OTP code.' };
  otpStore.delete(email);
  return { valid: true, smtpConfig: record.smtpConfig };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${port}`}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, {
      status: 'ok',
      service: 'vendor-license-tool',
      timestamp: new Date().toISOString()
    });
    return;
  }

  // Verify session for all API routes (defined here so it's available to all endpoints)
  const setupRequired = await isOperatorSetupRequired();
  const session = await verifyOperatorSession(req.headers.authorization || '');

  if (pathname.startsWith('/api/')) {

    if (req.method === 'GET' && pathname === '/api/auth/status') {
      sendJson(res, 200, await getAuthStatus(req.headers.authorization || ''));
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/setup') {
      try {
        const result = await createInitialOperator(await readJsonBody(req));
        sendJson(res, 200, {
          status: 'ready',
          ...result
        });
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : 'Failed to create the vendor operator.'
        });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      if (setupRequired) {
        sendJson(res, 428, {
          error: 'Vendor operator setup is required before sign-in.'
        });
        return;
      }

      // Rate limiting — prevent brute-force attacks
      const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
      const rateCheck = checkRateLimit(clientIp);
      
      if (!rateCheck.allowed) {
        console.log(`[SECURITY] Login blocked for IP ${clientIp}: ${rateCheck.blocked ? 'locked out' : 'too many attempts'}`);
        sendJson(res, 429, {
          error: `Too many failed login attempts. ${rateCheck.blocked ? `Account locked for ${rateCheck.waitMinutes} minutes.` : `Try again later.`}`,
          retry_after_seconds: rateCheck.blocked ? rateCheck.waitMinutes * 60 : 300
        });
        return;
      }

      try {
        const body = await readJsonBody(req);
        const { ensureStore } = await import('./auth-service.mjs');
        const store = await ensureStore();
        const normalizedEmail = String(body.email || '').toLowerCase().trim();
        const operator = store.operators.find(op => op.email === normalizedEmail);

        if (operator && operator.totp_enabled && operator.totp_secret) {
          const { verifyPassword } = await import('./auth-service.mjs');
          if (!verifyPassword(body.password, operator.password_hash)) {
            recordFailedAttempt(clientIp);
            sendJson(res, 401, { error: 'Invalid credentials.', remaining_attempts: rateCheck.remaining - 1 });
            return;
          }
          clearAttempts(clientIp);
          sendJson(res, 200, { requires_2fa: true, operator_id: operator.id, message: 'Enter your 2FA code.' });
          return;
        }

        const result = await loginOperator(body);
        clearAttempts(clientIp);
        sendJson(res, 200, { status: 'authenticated', ...result });
      } catch (error) {
        recordFailedAttempt(clientIp);
        console.log(`[SECURITY] Failed login from IP ${clientIp}: ${error.message}`);
        sendJson(res, 401, {
          error: error instanceof Error ? error.message : 'Failed to authenticate operator.',
          remaining_attempts: rateCheck.remaining - 1
        });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      sendJson(res, 200, { status: 'signed_out' });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/register') {
      try {
        const result = await registerNewOperator(await readJsonBody(req));
        sendJson(res, 200, {
          status: 'registered',
          ...result
        });
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : 'Failed to register operator.'
        });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/forgot-password') {
      try {
        const { email } = await readJsonBody(req);
        const result = await requestPasswordReset(email);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : 'Failed to process password reset request.'
        });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/reset-password') {
      try {
        const result = await resetPassword(await readJsonBody(req));
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, {
          error: error instanceof Error ? error.message : 'Failed to reset password.'
        });
      }
      return;
    }

    // ── 2FA Routes ──────────────────────────────────────────────
    if (req.method === 'POST' && pathname === '/api/auth/2fa/verify') {
      try {
        const { operator_id, token } = await readJsonBody(req);
        const result = await verify2FAForLogin(operator_id, token);
        if (result.verified) {
          const auth = await import('./auth-service.mjs');
          const store = await auth.ensureStore();
          const operator = store.operators.find(op => op.id === operator_id);
          if (!operator) { sendJson(res, 404, { error: 'Operator not found.' }); return; }
          const newToken = await auth.issueOperatorSession(operator);
          sendJson(res, 200, { status: 'authenticated', token: newToken, operator: { id: operator.id, email: operator.email, full_name: operator.full_name, role: operator.role } });
        } else {
          sendJson(res, 401, { error: result.error || 'Invalid code.' });
        }
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (req.method === 'GET' && pathname === '/api/auth/2fa/status') {
      if (!session) { sendJson(res, 401, { error: 'Auth required.' }); return; }
      sendJson(res, 200, { enabled: Boolean(session.operator.totp_enabled) });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/auth/2fa/setup') {
      if (!session) { sendJson(res, 401, { error: 'Auth required.' }); return; }
      try {
        const result = await setup2FA(session.operator.id);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/2fa/confirm') {
      if (!session) { sendJson(res, 401, { error: 'Auth required.' }); return; }
      try {
        const { token, secret, backup_codes } = await readJsonBody(req);
        const result = await confirm2FA(session.operator.id, token, secret, backup_codes);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/2fa/disable') {
      if (!session) { sendJson(res, 401, { error: 'Auth required.' }); return; }
      try {
        const { password } = await readJsonBody(req);
        const result = await disable2FA(session.operator.id, password);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/2fa/regenerate-backup-codes') {
      if (!session) { sendJson(res, 401, { error: 'Auth required.' }); return; }
      try {
        const { password } = await readJsonBody(req);
        const result = await regenerateBackupCodes(session.operator.id, password);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    // ── OTP Routes (Setup Flow) ─────────────────────────────────
    if (req.method === 'POST' && pathname === '/api/auth/send-otp') {
      try {
        const { email, smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from_name } = await readJsonBody(req);
        if (!email) { sendJson(res, 400, { error: 'Email is required.' }); return; }
        if (!smtp_host) { sendJson(res, 400, { error: 'SMTP host is required.' }); return; }
        if (!smtp_pass) { sendJson(res, 400, { error: 'SMTP password is required.' }); return; }
        
        const result = await sendSetupOTP(email, {
          smtp_host,
          smtp_port: smtp_port || '587',
          smtp_user: smtp_user || email,
          smtp_pass,
          smtp_from_email: email,
          smtp_from_name: smtp_from_name || 'VY Group Vendor Console'
        });
        
        if (result.sent) {
          sendJson(res, 200, { success: true, message: 'OTP sent to your email.' });
        } else {
          sendJson(res, 400, { error: `Failed to send OTP: ${result.error}` });
        }
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/verify-otp') {
      try {
        const { email, code } = await readJsonBody(req);
        if (!email || !code) { sendJson(res, 400, { error: 'Email and code are required.' }); return; }
        
        const result = verifyOTP(email, code);
        if (result.valid) {
          sendJson(res, 200, { success: true, smtpConfig: result.smtpConfig, message: 'Email verified successfully.' });
        } else {
          sendJson(res, 400, { error: result.error });
        }
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    // ── Mail Settings Routes ────────────────────────────────────
    if (req.method === 'GET' && pathname === '/api/mail/config') {
      if (!session) { sendJson(res, 401, { error: 'Auth required.' }); return; }
      const config = await getMailConfig();
      sendJson(res, 200, { ...config, smtp_pass: config.smtp_pass ? '••••••••' : '' });
      return;
    }

    if (req.method === 'PUT' && pathname === '/api/mail/config') {
      if (!session) { sendJson(res, 401, { error: 'Auth required.' }); return; }
      const data = await readJsonBody(req);
      const current = await getMailConfig();
      const updated = {
        smtp_host: data.smtp_host ?? current.smtp_host,
        smtp_port: data.smtp_port ?? current.smtp_port,
        smtp_user: data.smtp_user ?? current.smtp_user,
        smtp_pass: data.smtp_pass && data.smtp_pass !== '••••••••' ? data.smtp_pass : current.smtp_pass,
        smtp_from_name: data.smtp_from_name ?? current.smtp_from_name,
        smtp_from_email: data.smtp_from_email ?? current.smtp_from_email,
        smtp_secure: data.smtp_secure ?? current.smtp_secure,
        is_active: data.is_active ?? current.is_active
      };
      const result = await saveMailConfig(updated);
      sendJson(res, 200, { ...result, smtp_pass: result.smtp_pass ? '••••••••' : '' });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/mail/test') {
      if (!session) { sendJson(res, 401, { error: 'Auth required.' }); return; }
      try {
        const { to } = await readJsonBody(req);
        const connTest = await testMailConnection();
        if (!connTest.connected) {
          sendJson(res, 400, { error: connTest.error || 'SMTP connection failed.' });
          return;
        }
        if (!to) {
          sendJson(res, 200, { connected: true, message: 'SMTP connection verified.' });
          return;
        }
        const result = await sendMail({
          to,
          subject: 'VY Group Vendor Console - Test Email',
          html: '<div style="font-family:system-ui,sans-serif;padding:40px;text-align:center;"><h2 style="color:#6366f1;">Mail Service Connected</h2><p style="color:#4b5563;">Your vendor console mail service is working correctly.</p><p style="color:#9ca3af;font-size:12px;">Sent at: ' + new Date().toLocaleString() + '</p></div>'
        });
        sendJson(res, result.sent ? 200 : 400, { sent: result.sent, error: result.error, messageId: result.messageId });
      } catch (error) {
        sendJson(res, 400, { error: error.message });
      }
      return;
    }

    if (!isPublicApiRoute(req.method || 'GET', pathname)) {
      if (setupRequired) {
        sendJson(res, 428, {
          error: 'Vendor operator setup is required before using the console.'
        });
        return;
      }

      if (!session) {
        sendJson(res, 401, {
          error: 'Vendor authentication required.'
        });
        return;
      }
    }
  }

  if (req.method === 'GET' && pathname === '/api/plans') {
    sendJson(res, 200, getPublicPlanCatalog());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/security-note') {
    sendJson(res, 200, getVendorSecurityNote());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    const [summary, customers] = await Promise.all([
      getCustomerSummary(),
      listCustomers()
    ]);
    sendJson(res, 200, {
      summary,
      customers
    });
    return;
  }

  // Analytics Dashboard
  if (req.method === 'GET' && pathname === '/api/analytics/dashboard') {
    const customers = await listCustomers();
    const now = Date.now();
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
    
    const pocCustomers = customers.filter(c => c.status === 'poc' || c.plan === 'poc');
    const activeCustomers = customers.filter(c => c.status === 'active');
    const expiringLicenses = customers.filter(customer => {
      const latest = customer.latest_license;
      if (!latest || !latest.expires_at) return false;
      const expiresTs = new Date(latest.expires_at).getTime();
      return expiresTs > now && expiresTs <= now + (30 * 24 * 60 * 60 * 1000);
    });
    
    const recentActivity = customers
      .filter(c => c.last_license_issued_at)
      .map(c => ({
        customer_name: c.legal_name,
        action: 'license_generated',
        timestamp: c.last_license_issued_at,
        plan: c.plan
      }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, 10);

    sendJson(res, 200, {
      total_customers: customers.length,
      active_customers: activeCustomers.length,
      poc_customers: pocCustomers.length,
      expiring_this_week: expiringLicenses.filter(c => {
        const latest = c.latest_license;
        const expiresTs = new Date(latest.expires_at).getTime();
        return expiresTs <= now + (7 * 24 * 60 * 60 * 1000);
      }).length,
      expiring_this_month: expiringLicenses.length,
      conversion_rate: pocCustomers.length > 0 
        ? Math.round((activeCustomers.length / (activeCustomers.length + pocCustomers.length)) * 100)
        : 0,
      expiring_licenses: expiringLicenses.map(c => ({
        customer_id: c.id,
        customer_name: c.legal_name,
        plan: c.plan,
        expires_at: c.latest_license?.expires_at,
        days_remaining: Math.ceil((new Date(c.latest_license?.expires_at).getTime() - now) / (24 * 60 * 60 * 1000))
      })),
      recent_activity: recentActivity
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/customers') {
    sendJson(res, 200, await listCustomers());
    return;
  }

  if (req.method === 'POST' && pathname === '/api/customers') {
    try {
      const customerData = await readJsonBody(req);
      // Attach vendor_id from session if not provided
      if (!customerData.vendor_id && session?.operator?.vendor_id) {
        customerData.vendor_id = session.operator.vendor_id;
      }
      const customer = await upsertCustomer(customerData);
      
      // Audit log
      await logAuditEvent('customer_created', {
        operator_email: session?.operator?.email,
        customer_id: customer.id,
        customer_name: customer.legal_name,
        plan: customer.plan,
        vendor_id: customer.vendor_id
      });
      
      triggerBackup(customer.vendor_id, 'customer_created');
      
      sendJson(res, 200, {
        status: 'saved',
        customer
      });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Failed to save customer.'
      });
    }
    return;
  }

  const customerMatch = pathname.match(/^\/api\/customers\/([A-Za-z0-9-]+)$/);
  if (customerMatch && req.method === 'PUT') {
    try {
      const body = await readJsonBody(req);
      if (!body.vendor_id && session?.operator?.vendor_id) {
        body.vendor_id = session.operator.vendor_id;
      }
      const customer = await upsertCustomer({
        ...body,
        id: customerMatch[1]
      });
      triggerBackup(customer.vendor_id, 'customer_updated');
      sendJson(res, 200, {
        status: 'saved',
        customer
      });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Failed to update customer.'
      });
    }
    return;
  }

  const customerArchiveMatch = pathname.match(/^\/api\/customers\/([A-Za-z0-9-]+)\/archive$/);
  if (customerArchiveMatch && req.method === 'POST') {
    try {
      const customer = await archiveCustomer(customerArchiveMatch[1]);
      triggerBackup(session?.operator?.vendor_id || customer.vendor_id, 'customer_archived');
      sendJson(res, 200, { status: 'archived', customer });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'Failed to archive customer.' });
    }
    return;
  }

  // ── DELETE customer — hard delete + cascade all active licenses into CRL ──
  const customerDeleteMatch = pathname.match(/^\/api\/customers\/([A-Za-z0-9-]+)\/delete$/);
  if (customerDeleteMatch && req.method === 'DELETE') {
    try {
      const { reason } = await readJsonBody(req).catch(() => ({}));
      const { deleted, customer, activeLicenseIds } = await deleteCustomer(customerDeleteMatch[1]);

      const { addToCRL } = await import('./crl-service.mjs');
      const { decodeLicenseKey } = await import('./license-service.mjs');
      const crlResults = [];

      // Cascade every active license into CRL immediately
      if (activeLicenseIds.length > 0) {
        for (const lic of activeLicenseIds) {
          try {
            // Extract vendor_id from the license key payload
            let licVendorId = session?.operator?.vendor_id || 'default';
            if (lic.license_key) {
              try {
                const decoded = decodeLicenseKey(lic.license_key);
                if (decoded?.vendor_id) licVendorId = decoded.vendor_id;
              } catch (_) {}
            }
            await addToCRL({
              vendor_id: licVendorId,
              license_id: lic.license_id,
              customer:   customer.legal_name,
              plan:       lic.plan,
              reason:     reason || `Customer deleted by ${session?.operator?.email || 'vendor'}`,
              revoked_by: session?.operator?.email || 'vendor-operator'
            });
            crlResults.push({ license_id: lic.license_id, status: 'revoked' });
          } catch (e) {
            crlResults.push({ license_id: lic.license_id, status: 'error', error: e.message });
          }
        }
      }

      // Audit log
      await logAuditEvent('customer_deleted', {
        operator_email: session?.operator?.email,
        customer_id: customerDeleteMatch[1],
        customer_name: customer.legal_name,
        licenses_revoked: crlResults.length,
        reason: reason || 'Customer deleted'
      });

      triggerBackup(session?.operator?.vendor_id || customer.vendor_id, 'customer_deleted');

      sendJson(res, 200, {
        status:           'deleted',
        customer_name:    customer.legal_name,
        licenses_revoked: crlResults.length,
        crl_results:      crlResults,
        message: activeLicenseIds.length > 0
          ? `Customer deleted. ${crlResults.length} license(s) revoked and CRL published to GitHub. HRMS will block access within 6 hours.`
          : 'Customer deleted. No active licenses to revoke.'
      });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'Failed to delete customer.' });
    }
    return;
  }

  // POC/Trial License Quick Generation
  const customerTrialMatch = pathname.match(/^\/api\/customers\/([A-Za-z0-9-]+)\/licenses\/trial$/);
  if (customerTrialMatch && req.method === 'POST') {
    try {
      const customerId = customerTrialMatch[1];
      const customer = await listCustomers().then(customers => customers.find(c => c.id === customerId));
      if (!customer) { sendJson(res, 404, { error: 'Customer not found.' }); return; }

      const vendor_id = session?.operator?.vendor_id || 'default';
      const result = createOpaqueLicense({
        vendor_id,
        vendor_name:    process.env.VENDOR_CONSOLE_NAME || 'VY Group',
        vendor_email:   process.env.VENDOR_SUPPORT_EMAIL || 'support@vygroup.com',
        vendor_support: process.env.VENDOR_SUPPORT_URL   || 'https://vygroup.com/support',
        issued_by:      session?.operator?.full_name || 'VY Group',
        customer:       customer.legal_name,
        customer_email: customer.contact_email || '',
        plan:           'poc',
        duration_days:  30,
        no_bind:        !customer.hardware_id,
        hw_id:          customer.hardware_id || '',
        max_employees:  0,
        max_admins:     0,
        max_departments:0,
        features:       []
      });

      const generatedAt = new Date().toISOString();
      const updatedCustomer = await recordLicenseIssuance(customerId, { ...result, generated_at: generatedAt });
      if (customer.status !== 'poc') await upsertCustomer({ ...customer, status: 'poc', plan: 'poc' });

      // Audit log
      await logAuditEvent('license_generated', {
        operator_email: session?.operator?.email,
        customer_id: customerId,
        customer_name: customer.legal_name,
        license_id: result.payload.license_id,
        plan: 'poc',
        duration_days: 30,
        license_type: 'trial'
      });

      triggerBackup(vendor_id, 'trial_license_generated');

      sendJson(res, 200, {
        status: 'trial_generated', generated_at: generatedAt,
        vendor_id, ...result, customer: updatedCustomer,
        security_note: getVendorSecurityNote(),
        message: '30-day POC license generated with full enterprise features'
      });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'Failed to generate trial license.' });
    }
    return;
  }

  const customerLicenseMatch = pathname.match(/^\/api\/customers\/([A-Za-z0-9-]+)\/licenses$/);
  if (customerLicenseMatch && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const cust = await getCustomer(customerLicenseMatch[1]);
      const vendor_id = session?.operator?.vendor_id || 'default';
      const result = createOpaqueLicense({
        vendor_id,
        vendor_name:    process.env.VENDOR_CONSOLE_NAME  || 'VY Group',
        vendor_email:   process.env.VENDOR_SUPPORT_EMAIL || 'support@vygroup.com',
        vendor_support: process.env.VENDOR_SUPPORT_URL   || 'https://vygroup.com/support',
        issued_by:      session?.operator?.full_name || 'VY Group',
        customer:       body.customer || cust?.legal_name,
        customer_email: cust?.contact_email || '',
        plan:           body.plan,
        duration_days:  body.duration_days,
        no_bind:        Boolean(body.no_bind),
        hw_id:          body.hw_id,
        max_employees:  body.max_employees,
        max_admins:     body.max_admins,
        max_departments:body.max_departments,
        features:       Array.isArray(body.features)
          ? body.features
          : String(body.features || '').split(',').map(item => item.trim()).filter(Boolean)
      });

      const generatedAt = new Date().toISOString();
      const customer = await recordLicenseIssuance(customerLicenseMatch[1], { ...result, generated_at: generatedAt });

      triggerBackup(vendor_id, 'license_generated');

      sendJson(res, 200, {
        status: 'generated', generated_at: generatedAt,
        license_key: result.license_key,
        license_id:  result.payload.license_id,
        vendor_id:   result.payload.vendor_id,
        customer_name: result.payload.customer,
        plan: result.payload.plan, plan_label: result.payload.plan_label,
        issued_at:   new Date(result.payload.iat * 1000).toISOString(),
        expires_at:  new Date(result.payload.exp * 1000).toISOString(),
        days_valid:  Math.ceil((result.payload.exp - result.payload.iat) / 86400),
        no_bind: result.payload.no_bind, hw_id: result.payload.hw_id,
        max_employees: result.payload.max_employees,
        max_admins: result.payload.max_admins,
        max_departments: result.payload.max_departments,
        features: result.payload.features,
        payload: result.payload, customer,
        security_note: getVendorSecurityNote()
      });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'Failed to generate customer license.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/licenses/generate') {
    try {
      const body = await readJsonBody(req);
      const vendor_id = session?.operator?.vendor_id || 'default';
      const result = createOpaqueLicense({
        vendor_id,
        vendor_name:    process.env.VENDOR_CONSOLE_NAME  || 'VY Group',
        vendor_email:   process.env.VENDOR_SUPPORT_EMAIL || 'support@vygroup.com',
        vendor_support: process.env.VENDOR_SUPPORT_URL   || 'https://vygroup.com/support',
        issued_by:      session?.operator?.full_name || 'VY Group',
        customer:       body.customer,
        customer_email: body.customer_email || '',
        plan:           body.plan,
        duration_days:  body.duration_days,
        no_bind:        Boolean(body.no_bind),
        hw_id:          body.hw_id,
        max_employees:  body.max_employees,
        max_admins:     body.max_admins,
        max_departments:body.max_departments,
        features:       Array.isArray(body.features)
          ? body.features
          : String(body.features || '').split(',').map(item => item.trim()).filter(Boolean)
      });

      const generatedAt = new Date().toISOString();
      triggerBackup(vendor_id, 'license_generated');

      sendJson(res, 200, {
        status: 'generated',
        generated_at: generatedAt,
        license_key: result.license_key,
        license_id: result.payload.license_id,
        vendor_id: result.payload.vendor_id,
        customer: result.payload.customer,
        plan: result.payload.plan,
        plan_label: result.payload.plan_label,
        issued_at: new Date(result.payload.iat * 1000).toISOString(),
        expires_at: new Date(result.payload.exp * 1000).toISOString(),
        days_valid: Math.ceil((result.payload.exp - result.payload.iat) / 86400),
        no_bind: result.payload.no_bind,
        hw_id: result.payload.hw_id,
        max_employees: result.payload.max_employees,
        max_admins: result.payload.max_admins,
        max_departments: result.payload.max_departments,
        features: result.payload.features,
        payload: result.payload,
        security_note: getVendorSecurityNote()
      });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Failed to generate license.'
      });
    }
    return;
  }

  // License Validation
  if (req.method === 'POST' && pathname === '/api/licenses/validate') {
    try {
      const { license_key } = await readJsonBody(req);
      if (!license_key) {
        sendJson(res, 400, { error: 'License key is required.' });
        return;
      }

      // Import decode function from license service
      const { decodeLicenseKey } = await import('./license-service.mjs');
      
      try {
        const decoded = decodeLicenseKey(license_key);
        const now = Date.now() / 1000;
        const isExpired = decoded.exp && decoded.exp < now;
        const daysRemaining = decoded.exp ? Math.ceil((decoded.exp - now) / (24 * 60 * 60)) : null;

        sendJson(res, 200, {
          valid: true,
          expired: isExpired,
          days_remaining: daysRemaining,
          payload: decoded,
          message: isExpired ? 'License is expired' : 'License is valid'
        });
      } catch (decodeError) {
        sendJson(res, 200, {
          valid: false,
          error: decodeError instanceof Error ? decodeError.message : 'Invalid license key'
        });
      }
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Failed to validate license.'
      });
    }
    return;
  }

  // License Revocation
  const revokeMatch = pathname.match(/^\/api\/customers\/([A-Za-z0-9-]+)\/licenses\/([A-Za-z0-9-]+)\/revoke$/);
  if (revokeMatch && req.method === 'POST') {
    try {
      const [, customerId, issuanceId] = revokeMatch;
      const { reason } = await readJsonBody(req);
      const customer = await revokeLicense(customerId, issuanceId, reason);
      const revokedLicense = customer.licenses?.find(l => l.issuance_id === issuanceId);

      // Auto-add to CRL and auto-publish to GitHub
      let crlAdded = false;
      let crlPublished = false;
      let crlError = null;
      if (revokedLicense?.license_id) {
        try {
          const { addToCRL } = await import('./crl-service.mjs');
          const { decodeLicenseKey } = await import('./license-service.mjs');
          // Extract vendor_id from the license key payload (not from the operator)
          let vendor_id = session?.operator?.vendor_id || 'default';
          if (revokedLicense.license_key) {
            try {
              const decoded = decodeLicenseKey(revokedLicense.license_key);
              if (decoded?.vendor_id) vendor_id = decoded.vendor_id;
            } catch (_) { /* use operator's vendor_id as fallback */ }
          }
          await addToCRL({
            vendor_id:  vendor_id,
            license_id: revokedLicense.license_id,
            customer:   customer.legal_name,
            plan:       revokedLicense.plan,
            reason:     reason || 'Revoked by vendor',
            revoked_by: session?.operator?.email || session?.operator?.full_name || 'vendor-operator'
          });
          crlAdded = true;
          crlPublished = true;  // addToCRL now auto-publishes
        } catch (crlErr) {
          crlError = crlErr.message;
          console.error('[CRL] Failed to add to CRL or publish:', crlErr.message);
        }
      }

      // Generate a "kill switch" license — already expired, so HRMS will reject it immediately
      let kill_switch_key = null;
      if (revokedLicense) {
        try {
          const { createOpaqueLicense } = await import('./license-service.mjs');
          const result = createOpaqueLicense({
            vendor_id:     session?.operator?.vendor_id || 'default',
            customer:      customer.legal_name,
            plan:          revokedLicense.plan || 'starter',
            duration_days: -1,
            no_bind:       true,
            max_employees: 0,
            max_admins:    0,
            max_departments: 0,
            features:      [],
          });
          kill_switch_key = result.license_key;
        } catch (_) { /* non-fatal */ }
      }

      // Audit log
      await logAuditEvent('license_revoked', {
        operator_email: session?.operator?.email,
        customer_id: customerId,
        customer_name: customer.legal_name,
        license_id: revokedLicense.license_id,
        issuance_id: issuanceId,
        plan: revokedLicense.plan,
        reason: reason || 'Revoked by vendor',
        crl_published: crlPublished
      });

      // WebSocket broadcast for instant revocation
      const wsResult = broadcastRevocation(revokedLicense.license_id, reason || 'Revoked by vendor');

      triggerBackup(session?.operator?.vendor_id || 'default', 'license_revoked');

      sendJson(res, 200, {
        status:          'revoked',
        customer,
        kill_switch_key,
        crl_updated:     crlAdded,
        crl_published:   crlPublished,
        crl_error:       crlError || undefined,
        ws_broadcast:    wsResult.sent > 0,
        ws_clients:      wsResult.sent,
        message:         crlPublished
          ? 'License revoked and CRL automatically published to GitHub. HRMS will block access within 6 hours.'
          : `License revoked. WARNING: CRL publish failed (${crlError}) — customer may still have access.`,
        instructions: crlPublished ? [
          '✓ CRL automatically published to GitHub',
          '✓ HRMS instances will block this license within 6 hours',
          '✓ For immediate block: replace license.key with kill_switch_key below',
        ] : [
          '⚠ CRL publish failed - check GitHub token configuration',
          '⚠ Customer may still have access until CRL is published',
          '⚠ Use kill_switch_key for immediate revocation',
        ]
      });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Failed to revoke license.'
      });
    }
    return;
  }

  // License Extension
  const extendMatch = pathname.match(/^\/api\/customers\/([A-Za-z0-9-]+)\/licenses\/([A-Za-z0-9-]+)\/extend$/);
  if (extendMatch && req.method === 'POST') {
    try {
      const [, customerId, issuanceId] = extendMatch;
      const { additional_days } = await readJsonBody(req);
      if (!additional_days || additional_days <= 0) {
        sendJson(res, 400, { error: 'Additional days must be a positive number.' });
        return;
      }
      const customer = await extendLicense(customerId, issuanceId, additional_days);
      const extendedLicense = customer.licenses?.find(l => l.issuance_id === issuanceId);
      
      // Auto-remove from CRL if it was revoked (extending = un-revoking)
      let crlRemoved = false;
      let crlError = null;
      if (extendedLicense?.license_id) {
        try {
          const { removeFromCRL } = await import('./crl-service.mjs');
          const vendor_id = session?.operator?.vendor_id || 'default';
          await removeFromCRL(vendor_id, extendedLicense.license_id);
          crlRemoved = true;
        } catch (crlErr) {
          crlError = crlErr.message;
          console.error('[CRL] Failed to remove from CRL:', crlErr.message);
        }
      }
      
      // Audit log
      await logAuditEvent('license_extended', {
        operator_email: session?.operator?.email,
        customer_id: customerId,
        customer_name: customer.legal_name,
        license_id: extendedLicense?.license_id,
        issuance_id: issuanceId,
        plan: extendedLicense?.plan,
        additional_days,
        crl_removed: crlRemoved
      });
      
      // WebSocket broadcast for instant un-revocation
      const wsResult = broadcastExtension(extendedLicense?.license_id, additional_days);
      
      triggerBackup(session?.operator?.vendor_id || 'default', 'license_extended');

      sendJson(res, 200, {
        status: 'extended',
        customer,
        additional_days,
        crl_removed: crlRemoved,
        crl_error: crlError || undefined,
        ws_broadcast: wsResult.sent > 0,
        ws_clients: wsResult.sent,
        message: crlRemoved
          ? `License extended by ${additional_days} days and removed from CRL. HRMS will regain access within 6 hours.`
          : `License extended by ${additional_days} days. ${crlError ? `WARNING: CRL removal failed (${crlError})` : ''}`
      });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Failed to extend license.'
      });
    }
    return;
  }

  // Hardware ID Generator
  if (req.method === 'GET' && pathname === '/api/tools/generate-hardware-id') {
    const testHardwareId = crypto.randomBytes(12).toString('hex');
    sendJson(res, 200, {
      hardware_id: testHardwareId,
      format: 'hex',
      note: 'This is a test hardware ID for development purposes only'
    });
    return;
  }

  // ── CRL Endpoints ──────────────────────────────────────────────────────

  // GET /api/crl — fetch current CRL
  if (req.method === 'GET' && pathname === '/api/crl') {
    try {
      const { loadCRL, getCRLConfig } = await import('./crl-service.mjs');
      const vendor_id = session?.operator?.vendor_id || 'default';
      const crl = await loadCRL(vendor_id);
      const config = getCRLConfig(vendor_id);
      sendJson(res, 200, { ...crl, github: config });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/crl/publish — sign and push CRL to GitHub
  if (req.method === 'POST' && pathname === '/api/crl/publish') {
    try {
      const { publishCRLToGitHub } = await import('./crl-service.mjs');
      const vendor_id = session?.operator?.vendor_id || 'default';
      const result = await publishCRLToGitHub(vendor_id);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // DELETE /api/crl/:license_id — remove from CRL (un-revoke)
  const crlRemoveMatch = pathname.match(/^\/api\/crl\/([A-Za-z0-9-]+)$/);
  if (crlRemoveMatch && req.method === 'DELETE') {
    try {
      const [, licenseId] = crlRemoveMatch;
      const { removeFromCRL } = await import('./crl-service.mjs');
      const vendor_id = session?.operator?.vendor_id || 'default';
      const crl = await removeFromCRL(vendor_id, licenseId);
      sendJson(res, 200, {
        success: true,
        crl,
        warning: 'License removed from local CRL. You MUST click "Publish CRL to GitHub" for HRMS instances to unblock this license. Until published, HRMS will still block access based on the previously fetched CRL.'
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // GET /api/crl/config — get GitHub config status
  if (req.method === 'GET' && pathname === '/api/crl/config') {
    try {
      const { getCRLConfig } = await import('./crl-service.mjs');
      sendJson(res, 200, getCRLConfig());
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // ── End CRL Endpoints ──────────────────────────────────────────────────

  // ── Audit Log Endpoints ────────────────────────────────────────────────

  // GET /api/audit — get audit log with filters
  if (req.method === 'GET' && pathname === '/api/audit') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {
        action: url.searchParams.get('action'),
        customer_id: url.searchParams.get('customer_id'),
        operator_email: url.searchParams.get('operator_email'),
        start_date: url.searchParams.get('start_date'),
        end_date: url.searchParams.get('end_date'),
        limit: url.searchParams.get('limit') || '100',
        offset: url.searchParams.get('offset') || '0'
      };
      
      const result = await getAuditLog(filters);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/audit-logs — alias for /api/audit (frontend compatibility)
  if (req.method === 'GET' && pathname === '/api/audit-logs') {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const filters = {
        action: url.searchParams.get('action'),
        customer_id: url.searchParams.get('customer_id'),
        operator_email: url.searchParams.get('operator_email'),
        start_date: url.searchParams.get('start_date'),
        end_date: url.searchParams.get('end_date'),
        limit: url.searchParams.get('limit') || '100',
        offset: url.searchParams.get('offset') || '0'
      };
      
      const result = await getAuditLog(filters);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/audit/stats — get audit statistics
  if (req.method === 'GET' && pathname === '/api/audit/stats') {
    try {
      const stats = await getAuditStats();
      sendJson(res, 200, stats);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // ── End Audit Log Endpoints ────────────────────────────────────────────

  // ── Operator Management Endpoints ──────────────────────────────────────

  // GET /api/operators — list all operators (master hidden)
  if (req.method === 'GET' && pathname === '/api/operators') {
    try {
      const { listOperators } = await import('./lib/routes/operator-routes.mjs');
      const operators = await listOperators();
      sendJson(res, 200, { operators });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/operators/master — get master operator info (for current session)
  if (req.method === 'GET' && pathname === '/api/operators/master') {
    try {
      const { getMasterOperator } = await import('./lib/routes/operator-routes.mjs');
      const master = await getMasterOperator();
      sendJson(res, 200, { master });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/operators — create new operator
  if (req.method === 'POST' && pathname === '/api/operators') {
    try {
      const { createOperator } = await import('./lib/routes/operator-routes.mjs');
      const data = await readJsonBody(req);
      const operator = await createOperator(data, session.operator);
      sendJson(res, 201, { operator });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // PUT /api/operators/:id — update operator
  const updateOperatorMatch = pathname.match(/^\/api\/operators\/([a-f0-9-]+)$/);
  if (req.method === 'PUT' && updateOperatorMatch) {
    try {
      const { updateOperator } = await import('./lib/routes/operator-routes.mjs');
      const id = updateOperatorMatch[1];
      const data = await readJsonBody(req);
      const operator = await updateOperator(id, data, session.operator);
      sendJson(res, 200, { operator });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // POST /api/operators/:id/change-password — change own password (master only)
  const changePasswordMatch = pathname.match(/^\/api\/operators\/([a-f0-9-]+)\/change-password$/);
  if (changePasswordMatch && req.method === 'POST') {
    try {
      const { changePassword } = await import('./lib/routes/operator-routes.mjs');
      const id = changePasswordMatch[1];
      const data = await readJsonBody(req);
      const result = await changePassword(id, data, session.operator);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // DELETE /api/operators/:id — delete operator
  const deleteOperatorMatch = pathname.match(/^\/api\/operators\/([a-f0-9-]+)$/);
  if (req.method === 'DELETE' && deleteOperatorMatch) {
    try {
      const { deleteOperator } = await import('./lib/routes/operator-routes.mjs');
      const id = deleteOperatorMatch[1];
      await deleteOperator(id, session.operator);
      sendJson(res, 200, { success: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // POST /api/operators/:id/suspend — suspend operator
  const suspendOperatorMatch = pathname.match(/^\/api\/operators\/([a-f0-9-]+)\/suspend$/);
  if (req.method === 'POST' && suspendOperatorMatch) {
    try {
      const { setOperatorStatus } = await import('./lib/routes/operator-routes.mjs');
      const id = suspendOperatorMatch[1];
      const operator = await setOperatorStatus(id, false, session.operator);
      sendJson(res, 200, { operator });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // POST /api/operators/:id/reactivate — reactivate operator
  const reactivateOperatorMatch = pathname.match(/^\/api\/operators\/([a-f0-9-]+)\/reactivate$/);
  if (req.method === 'POST' && reactivateOperatorMatch) {
    try {
      const { setOperatorStatus } = await import('./lib/routes/operator-routes.mjs');
      const id = reactivateOperatorMatch[1];
      const operator = await setOperatorStatus(id, true, session.operator);
      sendJson(res, 200, { operator });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // ── End Operator Management Endpoints ──────────────────────────────────

  // ── Renewal Reminder Endpoints ─────────────────────────────────────────

  // POST /api/renewals/check — manually trigger renewal check
  if (req.method === 'POST' && pathname === '/api/renewals/check') {
    try {
      const customers = await listCustomers();
      const results = await checkAndSendRenewalReminders(customers);
      sendJson(res, 200, results);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/renewals/stats — get renewal reminder statistics
  if (req.method === 'GET' && pathname === '/api/renewals/stats') {
    try {
      const stats = await getRenewalReminderStats();
      sendJson(res, 200, stats);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // ── End Renewal Reminder Endpoints ─────────────────────────────────────

  // ── WebSocket Relay Endpoints ──────────────────────────────────────────

  // GET /api/ws/stats — get WebSocket relay statistics
  if (req.method === 'GET' && pathname === '/api/ws/stats') {
    try {
      const stats = getRelayStats();
      sendJson(res, 200, stats);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // ── End WebSocket Relay Endpoints ──────────────────────────────────────

  // ── Release / Update Endpoints ─────────────────────────────────────────

  // GET /api/releases — list all published releases
  if (req.method === 'GET' && pathname === '/api/releases') {
    try {
      const { getReleaseHistory, getReleaseConfig } = await import('./release-service.mjs');
      const [history, config] = await Promise.all([getReleaseHistory(), getReleaseConfig()]);
      sendJson(res, 200, { releases: history, config });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/releases/latest — get latest release manifest
  if (req.method === 'GET' && pathname === '/api/releases/latest') {
    try {
      const { getLatestRelease, getReleaseConfig } = await import('./release-service.mjs');
      const [latest, config] = await Promise.all([getLatestRelease(), getReleaseConfig()]);
      sendJson(res, 200, { release: latest, config });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/releases/publish — publish a new release to GitHub
  if (req.method === 'POST' && pathname === '/api/releases/publish') {
    try {
      const body = await readJsonBody(req);
      const { publishRelease } = await import('./release-service.mjs');
      const result = await publishRelease({
        version:             body.version,
        release_notes:       body.release_notes,
        breaking_changes:    Boolean(body.breaking_changes),
        min_license_version: body.min_license_version || '1.0.0',
        download_url:        body.download_url || '',
        checksum:            body.checksum || '',
        size_mb:             body.size_mb || 0,
        files:               body.files || []
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // GET /api/releases/config — get GitHub config status
  if (req.method === 'GET' && pathname === '/api/releases/config') {
    try {
      const { getReleaseConfig } = await import('./release-service.mjs');
      sendJson(res, 200, getReleaseConfig());
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/updates/status — check for vendor tool updates
  if (req.method === 'GET' && pathname === '/api/updates/status') {
    try {
      const { getLatestVendorToolRelease } = await import('./release-service.mjs');
      const { getUpdateStatus } = await import('./update-service.mjs');
      const latest = await getLatestVendorToolRelease();
      const updateStatus = getUpdateStatus();
      const currentVersion = updateStatus.current_version;
      
      if (latest && latest.version !== currentVersion) {
        sendJson(res, 200, {
          available: true,
          current_version: currentVersion,
          latest_version: latest.version,
          release_date: latest.published_at || latest.release_date,
          size_mb: latest.size_mb || null,
          release_notes: latest.release_notes || '',
          breaking_changes: latest.breaking_changes || false,
          update_check_interval_hours: updateStatus.update_check_interval_hours,
          last_check: updateStatus.last_check
        });
      } else {
        sendJson(res, 200, {
          available: false,
          current_version: currentVersion,
          latest_version: currentVersion,
          message: 'You are running the latest version',
          update_check_interval_hours: updateStatus.update_check_interval_hours,
          last_check: updateStatus.last_check
        });
      }
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // ── End Release Endpoints ───────────────────────────────────────────────

  // Bulk License Generation
  if (req.method === 'POST' && pathname === '/api/licenses/bulk-generate') {
    try {
      const { customers } = await readJsonBody(req);
      if (!Array.isArray(customers) || customers.length === 0) {
        sendJson(res, 400, { error: 'Customers array is required.' });
        return;
      }

      const results = [];
      const errors = [];

      for (const customerData of customers) {
        try {
          const result = createOpaqueLicense({
            customer: customerData.customer,
            plan: customerData.plan || 'growth',
            duration_days: customerData.duration_days || 365,
            no_bind: Boolean(customerData.no_bind),
            hw_id: customerData.hw_id || '',
            max_employees: customerData.max_employees,
            max_admins: customerData.max_admins,
            max_departments: customerData.max_departments,
            features: customerData.features || []
          });
          results.push({
            customer: customerData.customer,
            success: true,
            license_key: result.license_key
          });
        } catch (error) {
          errors.push({
            customer: customerData.customer,
            success: false,
            error: error instanceof Error ? error.message : 'Failed to generate license'
          });
        }
      }

      // Backup after bulk generation
      const bulkVendorId = session?.operator?.vendor_id;
      if (bulkVendorId) triggerBackup(bulkVendorId, 'bulk_license_generated');

      sendJson(res, 200, {
        status: 'completed',
        total: customers.length,
        successful: results.length,
        failed: errors.length,
        results,
        errors
      });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Failed to process bulk generation.'
      });
    }
    return;
  }

  // Export Customers
  if (req.method === 'GET' && pathname === '/api/customers/export') {
    try {
      const customers = await listCustomers();
      const csvHeader = 'ID,Legal Name,Contact Email,Plan,Status,Hardware ID,Renewal Date,Licenses Issued\n';
      const csvRows = customers.map(c => 
        `${c.id},"${c.legal_name}","${c.contact_email}",${c.plan},${c.status},"${c.hardware_id || ''}","${c.renewal_date || ''}",${c.license_count || 0}`
      ).join('\n');
      
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="customers-export.csv"',
        'Cache-Control': 'no-store'
      });
      res.end(csvHeader + csvRows);
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Failed to export customers.'
      });
    }
    return;
  }

  // Get Expiring Licenses
  if (req.method === 'GET' && pathname === '/api/licenses/expiring') {
    try {
      const customers = await listCustomers();
      const now = Date.now();
      const thirtyDaysFromNow = now + (30 * 24 * 60 * 60 * 1000);

      const expiringLicenses = customers
        .filter(customer => {
          const latest = customer.latest_license;
          if (!latest || !latest.expires_at || latest.revoked) return false;
          const expiresTs = new Date(latest.expires_at).getTime();
          return expiresTs > now && expiresTs <= thirtyDaysFromNow;
        })
        .map(customer => ({
          customer_id: customer.id,
          customer_name: customer.legal_name,
          contact_email: customer.contact_email,
          plan: customer.plan,
          license_id: customer.latest_license.license_id,
          expires_at: customer.latest_license.expires_at,
          days_remaining: Math.ceil((new Date(customer.latest_license.expires_at).getTime() - now) / (24 * 60 * 60 * 1000)),
          hardware_id: customer.hardware_id
        }))
        .sort((a, b) => a.days_remaining - b.days_remaining);

      sendJson(res, 200, {
        total: expiringLicenses.length,
        licenses: expiringLicenses
      });
    } catch (error) {
      sendJson(res, 400, {
        error: error instanceof Error ? error.message : 'Failed to get expiring licenses.'
      });
    }
    return;
  }

  // ── GitHub Backup Endpoints ────────────────────────────────────────────

  // POST /api/backup/:vendor_id — trigger backup for a vendor
  const backupMatch = pathname.match(/^\/api\/backup\/([A-Za-z0-9-]+)$/);
  if (backupMatch && req.method === 'POST') {
    try {
      const vendorId = backupMatch[1];
      const body = await readJsonBody(req).catch(() => ({}));
      const result = await backupVendor(vendorId, {
        reason: body.reason || 'manual',
        debounce: false
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // GET /api/backup/status — get backup status for all or one vendor
  if (req.method === 'GET' && pathname === '/api/backup/status') {
    try {
      const url2 = new URL(req.url, `http://${req.headers.host}`);
      const vendorId = url2.searchParams.get('vendor_id');
      const status = getBackupStatus(vendorId || undefined);
      sendJson(res, 200, { status });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/backup/vendors — list all backed-up vendors on GitHub
  if (req.method === 'GET' && pathname === '/api/backup/vendors') {
    try {
      const vendors = await listBackupVendors();
      sendJson(res, 200, { vendors });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/backup/:vendor_id/manifest — get backup manifest for a vendor
  const manifestMatch = pathname.match(/^\/api\/backup\/([A-Za-z0-9-]+)\/manifest$/);
  if (manifestMatch && req.method === 'GET') {
    try {
      const manifest = await getBackupManifest(manifestMatch[1]);
      sendJson(res, 200, { manifest });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/restore/:vendor_id — restore vendor from GitHub backup
  const restoreMatch = pathname.match(/^\/api\/restore\/([A-Za-z0-9-]+)$/);
  if (restoreMatch && req.method === 'POST') {
    try {
      const body = await readJsonBody(req).catch(() => ({}));
      const result = await restoreVendor(restoreMatch[1], { merge: Boolean(body.merge) });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // ── Vendor Management Endpoints ────────────────────────────────────────

  // GET /api/vendors — list all vendors
  if (req.method === 'GET' && pathname === '/api/vendors') {
    try {
      const vendors = await listVendors();
      sendJson(res, 200, { vendors });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // GET /api/vendors/summary — get vendor summary stats
  if (req.method === 'GET' && pathname === '/api/vendors/summary') {
    try {
      const summary = await getVendorSummary();
      sendJson(res, 200, summary);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  // POST /api/vendors — create a new vendor
  if (req.method === 'POST' && pathname === '/api/vendors') {
    try {
      const data = await readJsonBody(req);
      const vendor = await createVendor(data);
      sendJson(res, 201, { vendor });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // PUT /api/vendors/:id — update vendor
  const updateVendorMatch = pathname.match(/^\/api\/vendors\/([A-Za-z0-9-]+)$/);
  if (updateVendorMatch && req.method === 'PUT') {
    try {
      const data = await readJsonBody(req);
      const vendor = await updateVendor(updateVendorMatch[1], data);
      sendJson(res, 200, { vendor });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // DELETE /api/vendors/:id — delete vendor
  const deleteVendorMatch = pathname.match(/^\/api\/vendors\/([A-Za-z0-9-]+)$/);
  if (deleteVendorMatch && req.method === 'DELETE') {
    try {
      const result = await deleteVendor(deleteVendorMatch[1]);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // POST /api/vendors/:id/suspend — suspend vendor
  const suspendVendorMatch = pathname.match(/^\/api\/vendors\/([A-Za-z0-9-]+)\/suspend$/);
  if (suspendVendorMatch && req.method === 'POST') {
    try {
      const vendor = await suspendVendor(suspendVendorMatch[1]);
      sendJson(res, 200, { vendor });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // POST /api/vendors/:id/activate — activate vendor
  const activateVendorMatch = pathname.match(/^\/api\/vendors\/([A-Za-z0-9-]+)\/activate$/);
  if (activateVendorMatch && req.method === 'POST') {
    try {
      const vendor = await activateVendor(activateVendorMatch[1]);
      sendJson(res, 200, { vendor });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  // ── End Backup & Vendor Endpoints ─────────────────────────────────────

  if (req.method === 'GET') {
    await serveStatic(res, pathname);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, () => {
  console.log(`Vendor License Tool running on http://localhost:${port}`);
  
  // Initialize GitHub Backup
  initGithubBackup();
  
  // Initialize WebSocket relay
  initWebSocketRelay(server);
  
  // Start daily renewal reminder cron job (runs at 9 AM every day)
  const runRenewalCheck = async () => {
    console.log('[RENEWAL] Running daily renewal reminder check...');
    try {
      const customers = await listCustomers();
      const results = await checkAndSendRenewalReminders(customers);
      console.log(`[RENEWAL] Check complete: ${results.sent} sent, ${results.skipped} skipped, ${results.failed} failed`);
    } catch (error) {
      console.error('[RENEWAL] Error during renewal check:', error.message);
    }
  };
  
  // Schedule daily at 9 AM
  const scheduleNextRun = () => {
    const now = new Date();
    const next9AM = new Date(now);
    next9AM.setHours(9, 0, 0, 0);
    
    // If it's past 9 AM today, schedule for tomorrow
    if (now.getHours() >= 9) {
      next9AM.setDate(next9AM.getDate() + 1);
    }
    
    const msUntilNext = next9AM.getTime() - now.getTime();
    
    setTimeout(() => {
      runRenewalCheck();
      // Schedule next run (24 hours later)
      setInterval(runRenewalCheck, 24 * 60 * 60 * 1000);
    }, msUntilNext);
    
    console.log(`[RENEWAL] Next renewal check scheduled for ${next9AM.toLocaleString()}`);
  };
  
  scheduleNextRun();
});


// ============================================
