/**
 * Vendor Registry — Manage vendor entities
 *
 * Provides CRUD for vendor records. Each vendor has:
 *  - vendor_id: unique identifier (first 8 chars of UUID)
 *  - name, email, status, plan limits
 *  - created_at, updated_at
 *
 * Used by the platform owner to add/manage vendors.
 */

import crypto from 'crypto';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logAuditEvent } from './audit-log.mjs';
import { backupVendor } from './github-backup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const registryFile = join(dataDir, 'vendor-registry.json');

const DEFAULT_REGISTRY = { vendors: [] };

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

async function loadRegistry() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(registryFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.vendors)) return parsed;
    return { ...DEFAULT_REGISTRY };
  } catch {
    await writeFile(registryFile, JSON.stringify(DEFAULT_REGISTRY, null, 2), 'utf8');
    return { ...DEFAULT_REGISTRY };
  }
}

async function saveRegistry(store) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(registryFile, JSON.stringify(store, null, 2), 'utf8');
}

// ── CRUD ──────────────────────────────────────────────────────────────────

export async function listVendors() {
  const store = await loadRegistry();
  return store.vendors.map(v => ({
    ...v,
    // Don't expose internal fields
    _internal: undefined
  }));
}

export async function getVendor(vendorId) {
  const store = await loadRegistry();
  return store.vendors.find(v => v.vendor_id === vendorId) || null;
}

export async function createVendor({
  name, email, company = '', plan = 'growth',
  max_employees = 0, max_admins = 0, max_departments = 0,
  features = [], notes = ''
}) {
  const store = await loadRegistry();

  const normalizedName = normalizeText(name);
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedName) throw new Error('Vendor name is required.');
  if (!normalizedEmail) throw new Error('Vendor email is required.');

  // Check duplicate email
  if (store.vendors.find(v => v.email === normalizedEmail)) {
    throw new Error('A vendor with this email already exists.');
  }

  const now = new Date().toISOString();
  const vendorId = crypto.randomUUID().split('-')[0];

  const vendor = {
    id: crypto.randomUUID(),
    vendor_id: vendorId,
    name: normalizedName,
    email: normalizedEmail,
    company: normalizeText(company),
    plan,
    status: 'active',
    max_employees: Number(max_employees) || 0,
    max_admins: Number(max_admins) || 0,
    max_departments: Number(max_departments) || 0,
    features: Array.isArray(features) ? features : normalizeText(features).split(',').map(f => f.trim()).filter(Boolean),
    notes: normalizeText(notes),
    created_at: now,
    updated_at: now,
    last_backup_at: null,
    backup_enabled: true
  };

  store.vendors.unshift(vendor);
  await saveRegistry(store);

  await logAuditEvent('vendor_created', {
    operator_email: 'platform-owner',
    vendor_id: vendorId,
    vendor_name: normalizedName,
    vendor_email: normalizedEmail,
    plan
  });

  // Auto-backup the new vendor (empty data)
  try { await backupVendor(vendorId, { reason: 'vendor_created', debounce: false }); }
  catch (err) { console.error(`[VENDOR-REGISTRY] Auto-backup failed for new vendor ${vendorId}:`, err.message); }

  return vendor;
}

export async function updateVendor(vendorId, updates = {}) {
  const store = await loadRegistry();
  const index = store.vendors.findIndex(v => v.vendor_id === vendorId);
  if (index === -1) throw new Error('Vendor not found.');

  const vendor = store.vendors[index];
  const now = new Date().toISOString();

  // Only update provided fields
  if (updates.name !== undefined) vendor.name = normalizeText(updates.name);
  if (updates.email !== undefined) vendor.email = normalizeEmail(updates.email);
  if (updates.company !== undefined) vendor.company = normalizeText(updates.company);
  if (updates.plan !== undefined) vendor.plan = updates.plan;
  if (updates.status !== undefined) vendor.status = updates.status;
  if (updates.max_employees !== undefined) vendor.max_employees = Number(updates.max_employees) || 0;
  if (updates.max_admins !== undefined) vendor.max_admins = Number(updates.max_admins) || 0;
  if (updates.max_departments !== undefined) vendor.max_departments = Number(updates.max_departments) || 0;
  if (updates.features !== undefined) {
    vendor.features = Array.isArray(updates.features) ? updates.features : normalizeText(updates.features).split(',').map(f => f.trim()).filter(Boolean);
  }
  if (updates.notes !== undefined) vendor.notes = normalizeText(updates.notes);
  if (updates.backup_enabled !== undefined) vendor.backup_enabled = Boolean(updates.backup_enabled);

  vendor.updated_at = now;
  store.vendors[index] = vendor;
  await saveRegistry(store);

  await logAuditEvent('vendor_updated', {
    operator_email: 'platform-owner',
    vendor_id: vendorId,
    vendor_name: vendor.name,
    updated_fields: Object.keys(updates).join(', ')
  });

  return vendor;
}

export async function deleteVendor(vendorId) {
  const store = await loadRegistry();
  const index = store.vendors.findIndex(v => v.vendor_id === vendorId);
  if (index === -1) throw new Error('Vendor not found.');

  const vendor = store.vendors[index];

  // Final backup before deletion
  try { await backupVendor(vendorId, { reason: 'vendor_deleted', debounce: false }); }
  catch (err) { console.error(`[VENDOR-REGISTRY] Pre-delete backup failed for ${vendorId}:`, err.message); }

  store.vendors.splice(index, 1);
  await saveRegistry(store);

  await logAuditEvent('vendor_deleted', {
    operator_email: 'platform-owner',
    vendor_id: vendorId,
    vendor_name: vendor.name,
    vendor_email: vendor.email
  });

  return { deleted: true, vendor };
}

export async function suspendVendor(vendorId) {
  return updateVendor(vendorId, { status: 'suspended' });
}

export async function activateVendor(vendorId) {
  return updateVendor(vendorId, { status: 'active' });
}

// ── Query Helpers ─────────────────────────────────────────────────────────

export async function getVendorSummary() {
  const vendors = await listVendors();
  return {
    total: vendors.length,
    active: vendors.filter(v => v.status === 'active').length,
    suspended: vendors.filter(v => v.status === 'suspended').length,
    plans: vendors.reduce((acc, v) => { acc[v.plan] = (acc[v.plan] || 0) + 1; return acc; }, {})
  };
}

export async function findVendorByEmail(email) {
  const store = await loadRegistry();
  return store.vendors.find(v => v.email === normalizeEmail(email)) || null;
}
