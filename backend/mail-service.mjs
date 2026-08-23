import nodemailer from 'nodemailer';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJson } from './atomic-write.mjs';
import { bootstrapDecrypt } from './secure-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = resolve(__dirname, '..', 'data');
const mailConfigFile = join(dataDir, 'mail-config.json');

let cachedTransporter = null;
let cachedConfig = null;

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

export async function getMailConfig() {
  try {
    const raw = await readFile(mailConfigFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {
      smtp_host: '',
      smtp_port: 587,
      smtp_user: '',
      smtp_pass: '',
      smtp_from_name: 'VY Group Vendor Console',
      smtp_from_email: '',
      smtp_secure: false,
      is_active: false
    };
  }
}

export async function saveMailConfig(config) {
  await ensureDataDir();
  cachedTransporter = null;
  cachedConfig = null;
  await atomicWriteJson(mailConfigFile, {
    ...config,
    updated_at: new Date().toISOString()
  });
  return getMailConfig();
}

function createTransporter(config) {
  if (!config.smtp_host || !config.smtp_user) return null;
  
  // Decrypt SMTP password if it's encrypted
  let smtpPass = config.smtp_pass || '';
  if (smtpPass && !smtpPass.startsWith('•')) {
    try {
      smtpPass = bootstrapDecrypt(smtpPass);
    } catch {
      // Not encrypted, use as-is (or already plaintext from old setup)
    }
  }
  
  return nodemailer.createTransport({
    host: config.smtp_host,
    port: config.smtp_port || 587,
    secure: config.smtp_secure || false,
    auth: {
      user: config.smtp_user,
      pass: smtpPass
    },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 5000
  });
}

async function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const config = await getMailConfig();
  if (!config.is_active || !config.smtp_host) return null;
  cachedTransporter = createTransporter(config);
  return cachedTransporter;
}

export async function sendMail({ to, subject, html, text }) {
  const config = await getMailConfig();
  if (!config.is_active || !config.smtp_host) {
    return { sent: false, error: 'SMTP not configured', configured: false };
  }

  const transporter = createTransporter(config);
  if (!transporter) {
    return { sent: false, error: 'Failed to create mail transport', configured: true };
  }

  try {
    const info = await transporter.sendMail({
      from: `"${config.smtp_from_name || 'VY Group'}" <${config.smtp_from_email || config.smtp_user}>`,
      to,
      subject,
      text: text || '',
      html: html || text || ''
    });
    return { sent: true, configured: true, messageId: info.messageId };
  } catch (err) {
    console.error('[MAIL] Send failed:', err.message);
    return { sent: false, configured: true, error: err.message };
  }
}

export async function testMailConnection() {
  const config = await getMailConfig();
  if (!config.smtp_host || !config.smtp_user) {
    return { connected: false, error: 'SMTP not configured' };
  }

  const transporter = createTransporter(config);
  if (!transporter) {
    return { connected: false, error: 'Invalid SMTP configuration' };
  }

  try {
    await transporter.verify();
    return { connected: true, host: config.smtp_host, port: config.smtp_port };
  } catch (err) {
    return { connected: false, error: err.message };
  }
}

export async function sendPasswordResetEmail(to, resetLink, operatorName) {
  const config = await getMailConfig();
  if (!config.is_active || !config.smtp_host) {
    return { sent: false, configured: false };
  }

  const subject = 'Password Reset - VY Group Vendor Console';
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;">
      <div style="text-align:center;margin-bottom:32px;">
        <div style="display:inline-block;background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;font-size:24px;font-weight:800;padding:12px 24px;border-radius:12px;">VY</div>
      </div>
      <h2 style="color:#111827;font-size:22px;margin:0 0 16px;">Password Reset Request</h2>
      <p style="color:#4b5563;font-size:15px;line-height:1.6;">Hi ${operatorName || 'there'},</p>
      <p style="color:#4b5563;font-size:15px;line-height:1.6;">We received a request to reset your password for the VY Group Vendor Console.</p>
      <div style="text-align:center;margin:32px 0;">
        <a href="${resetLink}" style="display:inline-block;background:#6366f1;color:white;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">Reset Password</a>
      </div>
      <p style="color:#9ca3af;font-size:13px;line-height:1.6;">This link expires in 30 minutes. If you didn't request this, ignore this email.</p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0;">
      <p style="color:#9ca3af;font-size:12px;text-align:center;">VY Group Vendor Licensing Console</p>
    </div>
  `;

  return sendMail({ to, subject, html });
}
