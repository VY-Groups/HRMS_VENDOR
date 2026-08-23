// audit-log.mjs - Track all vendor actions for compliance and debugging
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, 'data');
const auditFile = join(dataDir, 'audit-log.json');

// Load audit log from disk
async function loadAuditLog() {
  try {
    const data = await readFile(auditFile, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { entries: [] };
    }
    throw err;
  }
}

// Save audit log to disk
async function saveAuditLog(log) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(auditFile, JSON.stringify(log, null, 2), 'utf8');
}

// Add audit entry
export async function logAuditEvent(action, details = {}) {
  const log = await loadAuditLog();
  
  const entry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action, // 'license_generated', 'license_revoked', 'license_extended', 'customer_created', 'customer_deleted', etc.
    ...details // operator_email, customer_id, license_id, reason, etc.
  };
  
  log.entries.unshift(entry); // newest first
  
  // Keep last 10,000 entries (prevent unbounded growth)
  if (log.entries.length > 10000) {
    log.entries = log.entries.slice(0, 10000);
  }
  
  await saveAuditLog(log);
  return entry;
}

// Get audit log with filters
export async function getAuditLog(filters = {}) {
  const log = await loadAuditLog();
  let entries = log.entries;
  
  // Filter by action type
  if (filters.action) {
    entries = entries.filter(e => e.action === filters.action);
  }
  
  // Filter by customer_id
  if (filters.customer_id) {
    entries = entries.filter(e => e.customer_id === filters.customer_id);
  }
  
  // Filter by operator_email
  if (filters.operator_email) {
    entries = entries.filter(e => e.operator_email === filters.operator_email);
  }
  
  // Filter by date range
  if (filters.start_date) {
    entries = entries.filter(e => new Date(e.timestamp) >= new Date(filters.start_date));
  }
  if (filters.end_date) {
    entries = entries.filter(e => new Date(e.timestamp) <= new Date(filters.end_date));
  }
  
  // Pagination
  const limit = parseInt(filters.limit) || 100;
  const offset = parseInt(filters.offset) || 0;
  
  return {
    total: entries.length,
    limit,
    offset,
    entries: entries.slice(offset, offset + limit)
  };
}

// Get audit statistics
export async function getAuditStats() {
  const log = await loadAuditLog();
  
  const stats = {
    total_events: log.entries.length,
    by_action: {},
    by_operator: {},
    recent_24h: 0,
    recent_7d: 0,
    recent_30d: 0
  };
  
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  
  for (const entry of log.entries) {
    // Count by action
    stats.by_action[entry.action] = (stats.by_action[entry.action] || 0) + 1;
    
    // Count by operator
    if (entry.operator_email) {
      stats.by_operator[entry.operator_email] = (stats.by_operator[entry.operator_email] || 0) + 1;
    }
    
    // Count recent events
    const age = now - new Date(entry.timestamp).getTime();
    if (age < day) stats.recent_24h++;
    if (age < 7 * day) stats.recent_7d++;
    if (age < 30 * day) stats.recent_30d++;
  }
  
  return stats;
}
