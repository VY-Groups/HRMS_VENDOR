import crypto from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { atomicWriteJson } from './atomic-write.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dataDir = resolve(__dirname, '..', 'data');
const dataFile = join(dataDir, 'customers.json');

const DEFAULT_STORE = {
  customers: []
};

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeFeatureList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(item => normalizeText(item)).filter(Boolean))];
  }
  return normalizeText(value).split(',').map(item => item.trim()).filter(Boolean);
}

async function ensureStore() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.customers)) {
      return { ...DEFAULT_STORE };
    }
    return parsed;
  } catch (_) {
    await atomicWriteJson(dataFile, DEFAULT_STORE);
    return { ...DEFAULT_STORE };
  }
}

async function saveStore(store) {
  await mkdir(dataDir, { recursive: true });
  // Use atomic write to prevent race conditions (Risk 2 fix)
  await atomicWriteJson(dataFile, store);
}

function summarizeCustomer(customer) {
  const licenses = Array.isArray(customer.licenses) ? customer.licenses : [];
  const latestLicense = licenses[0] || null;
  return {
    ...customer,
    licenses,
    latest_license: latestLicense,
    license_count: licenses.length
  };
}

function buildCustomerRecord(input = {}, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: existing.id || crypto.randomUUID(),
    vendor_id: normalizeText(input.vendor_id || existing.vendor_id),
    legal_name: normalizeText(input.legal_name || input.customer || existing.legal_name),
    workspace_name: normalizeText(input.workspace_name || existing.workspace_name),
    primary_contact: normalizeText(input.primary_contact || existing.primary_contact),
    contact_email: normalizeText(input.contact_email || existing.contact_email).toLowerCase(),
    contact_phone: normalizeText(input.contact_phone || existing.contact_phone),
    billing_contact: normalizeText(input.billing_contact || existing.billing_contact),
    billing_email: normalizeText(input.billing_email || existing.billing_email).toLowerCase(),
    plan: normalizeText(input.plan || existing.plan || 'growth').toLowerCase(),
    status: normalizeText(input.status || existing.status || 'active').toLowerCase(),
    deployment_type: normalizeText(input.deployment_type || existing.deployment_type || 'on-prem'),
    hardware_id: normalizeText(input.hardware_id || input.hw_id || existing.hardware_id).toLowerCase(),
    renewal_date: normalizeText(input.renewal_date || existing.renewal_date),
    duration_days: Number(input.duration_days ?? existing.duration_days ?? (input.plan === 'poc' ? 30 : 365)) || (input.plan === 'poc' ? 30 : 365),
    max_employees: input.max_employees === '' ? null : (Number(input.max_employees ?? existing.max_employees) || 0),
    max_admins: input.max_admins === '' ? null : (Number(input.max_admins ?? existing.max_admins) || 0),
    max_departments: input.max_departments === '' ? null : (Number(input.max_departments ?? existing.max_departments) || 0),
    feature_overrides: normalizeFeatureList(input.feature_overrides ?? input.features ?? existing.feature_overrides),
    notes: normalizeText(input.notes || existing.notes),
    last_license_issued_at: existing.last_license_issued_at || '',
    created_at: existing.created_at || now,
    updated_at: now,
    licenses: Array.isArray(existing.licenses) ? existing.licenses : []
  };
}

export async function listCustomers() {
  const store = await ensureStore();
  return store.customers
    .map(customer => summarizeCustomer(customer))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export async function listCustomersByVendor(vendorId) {
  const store = await ensureStore();
  return store.customers
    .filter(customer => customer.vendor_id === vendorId)
    .map(customer => summarizeCustomer(customer))
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export async function getCustomer(id) {
  const store = await ensureStore();
  const customer = store.customers.find(item => item.id === id);
  return customer ? summarizeCustomer(customer) : null;
}

export async function upsertCustomer(input = {}) {
  const store = await ensureStore();
  const existingIndex = input.id ? store.customers.findIndex(item => item.id === input.id) : -1;
  const existing = existingIndex >= 0 ? store.customers[existingIndex] : {};
  const record = buildCustomerRecord(input, existing);

  if (!record.legal_name) {
    throw new Error('Customer legal name is required.');
  }

  if (existingIndex >= 0) {
    store.customers[existingIndex] = record;
  } else {
    store.customers.unshift(record);
  }

  await saveStore(store);
  return summarizeCustomer(record);
}

export async function archiveCustomer(id) {
  const store = await ensureStore();
  const index = store.customers.findIndex(item => item.id === id);
  if (index === -1) {
    throw new Error('Customer not found.');
  }
  store.customers[index] = {
    ...store.customers[index],
    status: 'archived',
    updated_at: new Date().toISOString()
  };
  await saveStore(store);
  return summarizeCustomer(store.customers[index]);
}

export async function recordLicenseIssuance(customerId, issuance = {}) {
  const store = await ensureStore();
  const index = store.customers.findIndex(item => item.id === customerId);
  if (index === -1) {
    throw new Error('Customer not found.');
  }

  const customer = store.customers[index];
  const issuedAt = issuance.generated_at || new Date().toISOString();
  const licenses = Array.isArray(customer.licenses) ? customer.licenses : [];
  const entry = {
    issuance_id: crypto.randomUUID(),
    generated_at: issuedAt,
    license_id: issuance.payload?.license_id || '',
    license_key: issuance.license_key || '',
    plan: issuance.payload?.plan || customer.plan || '',
    plan_label: issuance.payload?.plan_label || customer.plan || '',
    expires_at_ts: issuance.payload?.exp || null,
    expires_at: issuance.payload?.exp ? new Date(Number(issuance.payload.exp) * 1000).toISOString() : '',
    hardware_id: issuance.payload?.hw_id || customer.hardware_id || '',
    no_bind: Boolean(issuance.payload?.no_bind),
    max_employees: issuance.payload?.max_employees ?? customer.max_employees ?? 0,
    max_admins: issuance.payload?.max_admins ?? customer.max_admins ?? 0,
    max_departments: issuance.payload?.max_departments ?? customer.max_departments ?? 0,
    features: Array.isArray(issuance.payload?.features) ? issuance.payload.features : [],
    revoked: false,
    revoked_at: null,
    revoked_reason: null
  };

  store.customers[index] = {
    ...customer,
    last_license_issued_at: issuedAt,
    updated_at: issuedAt,
    licenses: [entry, ...licenses]
  };

  await saveStore(store);
  return summarizeCustomer(store.customers[index]);
}

export async function revokeLicense(customerId, issuanceId, reason = '') {
  const store = await ensureStore();
  const customerIndex = store.customers.findIndex(item => item.id === customerId);
  if (customerIndex === -1) {
    throw new Error('Customer not found.');
  }

  const customer = store.customers[customerIndex];
  const licenses = Array.isArray(customer.licenses) ? customer.licenses : [];
  const licenseIndex = licenses.findIndex(lic => lic.issuance_id === issuanceId);
  
  if (licenseIndex === -1) {
    throw new Error('License not found.');
  }

  licenses[licenseIndex] = {
    ...licenses[licenseIndex],
    revoked: true,
    revoked_at: new Date().toISOString(),
    revoked_reason: normalizeText(reason) || 'Revoked by vendor'
  };

  store.customers[customerIndex] = {
    ...customer,
    licenses,
    updated_at: new Date().toISOString()
  };

  await saveStore(store);
  return summarizeCustomer(store.customers[customerIndex]);
}

export async function extendLicense(customerId, issuanceId, additionalDays) {
  const store = await ensureStore();
  const customerIndex = store.customers.findIndex(item => item.id === customerId);
  if (customerIndex === -1) {
    throw new Error('Customer not found.');
  }

  const customer = store.customers[customerIndex];
  const licenses = Array.isArray(customer.licenses) ? customer.licenses : [];
  const licenseIndex = licenses.findIndex(lic => lic.issuance_id === issuanceId);
  
  if (licenseIndex === -1) {
    throw new Error('License not found.');
  }

  const license = licenses[licenseIndex];
  const currentExpiry = license.expires_at_ts || Math.floor(Date.now() / 1000);
  const newExpiry = currentExpiry + (Number(additionalDays) * 24 * 60 * 60);

  licenses[licenseIndex] = {
    ...license,
    expires_at_ts: newExpiry,
    expires_at: new Date(newExpiry * 1000).toISOString(),
    extended: true,
    extended_at: new Date().toISOString(),
    extension_days: Number(additionalDays)
  };

  store.customers[customerIndex] = {
    ...customer,
    licenses,
    updated_at: new Date().toISOString()
  };

  await saveStore(store);
  return summarizeCustomer(store.customers[customerIndex]);
}

/**
 * Hard-delete a customer and return all their active (non-revoked) license_ids
 * so the caller can cascade them into the CRL before removing the record.
 */
export async function deleteCustomer(id) {
  const store = await ensureStore();
  const index = store.customers.findIndex(item => item.id === id);
  if (index === -1) throw new Error('Customer not found.');

  const customer = store.customers[index];
  // Collect every license_id that is NOT already revoked
  const activeLicenseIds = (Array.isArray(customer.licenses) ? customer.licenses : [])
    .filter(l => !l.revoked && l.license_id)
    .map(l => ({ license_id: l.license_id, plan: l.plan, issuance_id: l.issuance_id }));

  store.customers.splice(index, 1);
  await saveStore(store);

  return { deleted: true, customer: summarizeCustomer(customer), activeLicenseIds };
}

export async function getCustomerSummary() {
  const customers = await listCustomers();
  const now = Date.now();
  return {
    total_customers: customers.length,
    active_customers: customers.filter(customer => customer.status === 'active').length,
    archived_customers: customers.filter(customer => customer.status === 'archived').length,
    renewals_due: customers.filter(customer => {
      if (!customer.renewal_date) return false;
      const renewalTs = new Date(customer.renewal_date).getTime();
      return Number.isFinite(renewalTs) && renewalTs <= now + (30 * 24 * 60 * 60 * 1000);
    }).length,
    licenses_issued: customers.reduce((count, customer) => count + (customer.license_count || 0), 0)
  };
}
