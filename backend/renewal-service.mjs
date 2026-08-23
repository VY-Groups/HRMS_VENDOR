// renewal-service.mjs - Automatic license renewal reminders
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
const reminderLogFile = join(dataDir, 'renewal-reminders.json');

// Email configuration from environment
const EMAIL_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const EMAIL_PORT = parseInt(process.env.SMTP_PORT || '587');
const EMAIL_USER = process.env.SMTP_USER || '';
const EMAIL_PASS = process.env.SMTP_PASS || '';
const EMAIL_FROM = process.env.VENDOR_EMAIL || 'support@vygroup.com';
const VENDOR_NAME = process.env.VENDOR_NAME || 'VY Group';

// Create email transporter
let transporter = null;
function getTransporter() {
  if (!transporter && EMAIL_USER && EMAIL_PASS) {
    transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: EMAIL_PORT,
      secure: EMAIL_PORT === 465,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS
      }
    });
  }
  return transporter;
}

// Load reminder log
async function loadReminderLog() {
  try {
    const data = await readFile(reminderLogFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { reminders: [] };
    }
    throw err;
  }
}

// Save reminder log
async function saveReminderLog(log) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(reminderLogFile, JSON.stringify(log, null, 2), 'utf8');
}

// Check if reminder already sent
async function wasReminderSent(licenseId, daysBeforeExpiry) {
  const log = await loadReminderLog();
  const today = new Date().toISOString().split('T')[0];
  
  return log.reminders.some(r => 
    r.license_id === licenseId && 
    r.days_before === daysBeforeExpiry &&
    r.sent_date === today
  );
}

// Log reminder sent
async function logReminderSent(licenseId, customerEmail, daysBeforeExpiry, success, error = null) {
  const log = await loadReminderLog();
  
  log.reminders.push({
    license_id: licenseId,
    customer_email: customerEmail,
    days_before: daysBeforeExpiry,
    sent_date: new Date().toISOString().split('T')[0],
    sent_at: new Date().toISOString(),
    success,
    error
  });
  
  // Keep last 1000 reminders
  if (log.reminders.length > 1000) {
    log.reminders = log.reminders.slice(-1000);
  }
  
  await saveReminderLog(log);
}

// Email templates
function getRenewalEmailTemplate(daysBeforeExpiry, customerName, licenseInfo) {
  const { plan_label, expires_at, license_id } = licenseInfo;
  const expiryDate = new Date(expires_at * 1000).toLocaleDateString();
  
  let subject, urgency, message;
  
  if (daysBeforeExpiry === 30) {
    subject = `License Renewal Reminder - ${plan_label} Plan`;
    urgency = 'Reminder';
    message = `Your ${plan_label} license will expire in 30 days on ${expiryDate}. We wanted to give you advance notice so you can plan for renewal.`;
  } else if (daysBeforeExpiry === 7) {
    subject = `Urgent: License Expiring Soon - ${plan_label} Plan`;
    urgency = 'Urgent';
    message = `Your ${plan_label} license will expire in 7 days on ${expiryDate}. Please renew soon to avoid service interruption.`;
  } else if (daysBeforeExpiry === 1) {
    subject = `Critical: License Expires Tomorrow - ${plan_label} Plan`;
    urgency = 'Critical';
    message = `Your ${plan_label} license will expire tomorrow on ${expiryDate}. Please renew immediately to maintain access.`;
  }
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
    .urgency { display: inline-block; padding: 8px 16px; border-radius: 4px; font-weight: bold; margin-bottom: 20px; }
    .urgency.reminder { background: #3b82f6; color: white; }
    .urgency.urgent { background: #f59e0b; color: white; }
    .urgency.critical { background: #ef4444; color: white; }
    .info-box { background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea; }
    .info-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .info-row:last-child { border-bottom: none; }
    .label { font-weight: bold; color: #6b7280; }
    .value { color: #111827; }
    .cta { text-align: center; margin: 30px 0; }
    .button { display: inline-block; background: #667eea; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: bold; }
    .footer { text-align: center; color: #6b7280; font-size: 14px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>License Renewal Reminder</h1>
    </div>
    <div class="content">
      <span class="urgency ${urgency.toLowerCase()}">${urgency}</span>
      
      <p>Dear ${customerName},</p>
      
      <p>${message}</p>
      
      <div class="info-box">
        <h3 style="margin-top: 0;">License Details</h3>
        <div class="info-row">
          <span class="label">Plan:</span>
          <span class="value">${plan_label}</span>
        </div>
        <div class="info-row">
          <span class="label">Expiry Date:</span>
          <span class="value">${expiryDate}</span>
        </div>
        <div class="info-row">
          <span class="label">Days Remaining:</span>
          <span class="value">${daysBeforeExpiry} day${daysBeforeExpiry !== 1 ? 's' : ''}</span>
        </div>
        <div class="info-row">
          <span class="label">License ID:</span>
          <span class="value" style="font-family: monospace; font-size: 12px;">${license_id}</span>
        </div>
      </div>
      
      <div class="cta">
        <a href="mailto:${EMAIL_FROM}?subject=License Renewal - ${license_id}" class="button">
          Contact Us to Renew
        </a>
      </div>
      
      <p style="color: #6b7280; font-size: 14px;">
        <strong>What happens if I don't renew?</strong><br>
        After expiration, you'll have a 7-day grace period with full access. After that, the system will be locked until renewal.
      </p>
      
      <div class="footer">
        <p>
          <strong>${VENDOR_NAME}</strong><br>
          ${EMAIL_FROM}<br>
          This is an automated reminder. Please do not reply to this email.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `;
  
  const text = `
License Renewal Reminder - ${urgency}

Dear ${customerName},

${message}

License Details:
- Plan: ${plan_label}
- Expiry Date: ${expiryDate}
- Days Remaining: ${daysBeforeExpiry}
- License ID: ${license_id}

To renew your license, please contact us at ${EMAIL_FROM}

What happens if I don't renew?
After expiration, you'll have a 7-day grace period with full access. After that, the system will be locked until renewal.

---
${VENDOR_NAME}
${EMAIL_FROM}
This is an automated reminder.
  `;
  
  return { subject, html, text };
}

// Send renewal reminder email
export async function sendRenewalReminder(customerEmail, customerName, licenseInfo, daysBeforeExpiry) {
  const transport = getTransporter();
  
  if (!transport) {
    console.warn('[RENEWAL] Email not configured. Set SMTP_USER and SMTP_PASS environment variables.');
    return { success: false, error: 'Email not configured' };
  }
  
  // Check if already sent today
  if (await wasReminderSent(licenseInfo.license_id, daysBeforeExpiry)) {
    console.log(`[RENEWAL] Reminder already sent today for license ${licenseInfo.license_id} (${daysBeforeExpiry} days)`);
    return { success: true, skipped: true, reason: 'Already sent today' };
  }
  
  const { subject, html, text } = getRenewalEmailTemplate(daysBeforeExpiry, customerName, licenseInfo);
  
  try {
    await transport.sendMail({
      from: `"${VENDOR_NAME}" <${EMAIL_FROM}>`,
      to: customerEmail,
      subject,
      text,
      html
    });
    
    await logReminderSent(licenseInfo.license_id, customerEmail, daysBeforeExpiry, true);
    
    console.log(`[RENEWAL] Sent ${daysBeforeExpiry}-day reminder to ${customerEmail} for license ${licenseInfo.license_id}`);
    
    return { success: true };
  } catch (error) {
    await logReminderSent(licenseInfo.license_id, customerEmail, daysBeforeExpiry, false, error.message);
    
    console.error(`[RENEWAL] Failed to send reminder to ${customerEmail}:`, error.message);
    
    return { success: false, error: error.message };
  }
}

// Check all customers and send reminders
export async function checkAndSendRenewalReminders(customers) {
  const now = Date.now() / 1000; // Unix timestamp
  const results = {
    checked: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    details: []
  };
  
  for (const customer of customers) {
    if (!customer.licenses || customer.licenses.length === 0) continue;
    if (customer.status === 'archived') continue;
    
    // Check latest license
    const license = customer.licenses[0];
    if (!license || license.revoked) continue;
    
    const expiresAt = license.expires_at_ts;
    const daysUntilExpiry = Math.ceil((expiresAt - now) / 86400);
    
    results.checked++;
    
    // Send reminders at 30, 7, and 1 day before expiry
    const reminderDays = [30, 7, 1];
    
    for (const days of reminderDays) {
      if (daysUntilExpiry === days) {
        const result = await sendRenewalReminder(
          customer.contact_email,
          customer.legal_name,
          license,
          days
        );
        
        if (result.success) {
          if (result.skipped) {
            results.skipped++;
          } else {
            results.sent++;
          }
        } else {
          results.failed++;
        }
        
        results.details.push({
          customer: customer.legal_name,
          email: customer.contact_email,
          license_id: license.license_id,
          days_until_expiry: daysUntilExpiry,
          reminder_sent: days,
          ...result
        });
      }
    }
  }
  
  return results;
}

// Get reminder statistics
export async function getRenewalReminderStats() {
  const log = await loadReminderLog();
  
  const stats = {
    total_reminders: log.reminders.length,
    by_days: { 30: 0, 7: 0, 1: 0 },
    success_rate: 0,
    last_7_days: 0,
    last_30_days: 0
  };
  
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  
  let successCount = 0;
  
  for (const reminder of log.reminders) {
    // Count by days before expiry
    if (reminder.days_before in stats.by_days) {
      stats.by_days[reminder.days_before]++;
    }
    
    // Count successes
    if (reminder.success) successCount++;
    
    // Count recent
    const age = now - new Date(reminder.sent_at).getTime();
    if (age < 7 * day) stats.last_7_days++;
    if (age < 30 * day) stats.last_30_days++;
  }
  
  if (log.reminders.length > 0) {
    stats.success_rate = Math.round((successCount / log.reminders.length) * 100);
  }
  
  return stats;
}
