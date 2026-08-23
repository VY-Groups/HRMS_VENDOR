import crypto from 'crypto';
import { getMasterKey } from './secure-config.mjs';

const LICENSE_PREFIX = 'HRMS2-';
const LICENSE_AAD = 'HRMS-LICENSE-V2';
const LICENSE_CIPHER = 'aes-256-gcm';
const LICENSE_IV_BYTES = 12;

const CORE_HR_FEATURES = [
  'dashboard',
  'employees',
  'orgchart',
  'attendance',
  'leave',
  'documents',
  'notifications'
];

const OPERATIONS_FEATURES = [
  'tickets',
  'inventory',
  'devices',
  'analytics',
  'performance',
  'exports',
  'smtp'
];

export const ALL_LICENSED_FEATURES = [
  ...CORE_HR_FEATURES,
  ...OPERATIONS_FEATURES,
  'payroll',
  'ldap',
  'advanced_security'
];

export const PLAN_CATALOG = {
  poc: {
    plan: 'poc',
    tier: 'poc',
    label: 'POC / Trial',
    tagline: '30-day proof of concept with full enterprise features for evaluation.',
    pricing: {
      monthly_inr: 0,
      annual_inr: 0,
      monthly_label: 'Free Trial',
      annual_label: '30-day evaluation'
    },
    limits: {
      max_employees: 50,
      max_admins: 5,
      max_departments: 10
    },
    features: [...ALL_LICENSED_FEATURES],
    is_trial: true,
    default_duration: 30
  },
  starter: {
    plan: 'starter',
    tier: 'starter',
    label: 'Starter',
    tagline: 'Core HR operations for smaller organizations.',
    pricing: {
      monthly_inr: 4999,
      annual_inr: 49990,
      monthly_label: 'INR 4,999 / month',
      annual_label: 'INR 49,990 / year'
    },
    limits: {
      max_employees: 25,
      max_admins: 2,
      max_departments: 6
    },
    features: [...CORE_HR_FEATURES]
  },
  growth: {
    plan: 'growth',
    tier: 'growth',
    label: 'Growth',
    tagline: 'HRMS plus service desk, inventory, and operational modules.',
    pricing: {
      monthly_inr: 14999,
      annual_inr: 149990,
      monthly_label: 'INR 14,999 / month',
      annual_label: 'INR 149,990 / year'
    },
    limits: {
      max_employees: 150,
      max_admins: 10,
      max_departments: 25
    },
    features: [...CORE_HR_FEATURES, ...OPERATIONS_FEATURES]
  },
  enterprise: {
    plan: 'enterprise',
    tier: 'enterprise',
    label: 'Enterprise',
    tagline: 'Unlimited scale with payroll, LDAP, and advanced security.',
    pricing: {
      monthly_inr: null,
      annual_inr: null,
      monthly_label: 'Custom pricing',
      annual_label: 'Annual enterprise contract'
    },
    limits: {
      max_employees: 0,
      max_admins: 0,
      max_departments: 0
    },
    features: [...ALL_LICENSED_FEATURES]
  }
};

const VENDOR_MASTER_KEY = String(
  process.env.VENDOR_LICENSE_MASTER_KEY
  || process.env.HRMS_LICENSE_MASTER_KEY
  || process.env.LICENSE_MASTER_KEY
  || ''
);

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deriveCryptoKey(masterKey = null) {
  const key = masterKey || getMasterKey() || VENDOR_MASTER_KEY;
  if (!key) {
    throw new Error('No master key available for license encryption/decryption');
  }
  return crypto.createHash('sha256').update(String(key)).digest();
}

function normalizeFeatureList(features = [], fallback = []) {
  const merged = [...new Set([...(Array.isArray(fallback) ? fallback : []), ...(Array.isArray(features) ? features : [])].map(item => String(item || '').trim()).filter(Boolean))];
  return ALL_LICENSED_FEATURES.filter(feature => merged.includes(feature)).concat(merged.filter(feature => !ALL_LICENSED_FEATURES.includes(feature)));
}

function resolvePlanDefinition(plan, tier) {
  const direct = PLAN_CATALOG[String(plan || '').trim().toLowerCase()];
  if (direct) return direct;
  const byTier = PLAN_CATALOG[String(tier || '').trim().toLowerCase()];
  if (byTier) return byTier;
  return PLAN_CATALOG.enterprise;
}

export function getPublicPlanCatalog() {
  return Object.values(PLAN_CATALOG).map(plan => ({
    plan: plan.plan,
    tier: plan.tier,
    label: plan.label,
    tagline: plan.tagline,
    pricing: plan.pricing,
    limits: plan.limits,
    features: plan.features
  }));
}

export function getVendorSecurityNote() {
  const masterKey = getMasterKey();
  return {
    isolated_runtime: true,
    network_dependency_on_hrms: false,
    storage_dependency_on_hrms: false,
    token_format: 'HRMS2 opaque encrypted token',
    validation_target: 'Only the HRMS backend with the matching master key can decrypt and validate the license.',
    master_key_requirement: 'Configure the same strong master key separately in the vendor tool and in the HRMS backend. They do not call each other.',
    production_note: masterKey
      ? 'A custom vendor master key is configured via bootstrap encryption.'
      : 'CRITICAL: No master key available. License operations will fail.'
  };
}

export function createOpaqueLicense(payload = {}) {
  const planDefinition = resolvePlanDefinition(payload.plan, payload.tier);
  const now = new Date();
  const issuedAt = payload.iat ? Number(payload.iat) : Math.floor(now.getTime() / 1000);
  
  // For POC/Trial licenses, default to 30 days if not specified
  const defaultDuration = planDefinition.is_trial ? (planDefinition.default_duration || 30) : 365;
  const durationDays = Number(payload.duration_days) || defaultDuration;
  
  const expiresAt = payload.exp
    ? Number(payload.exp)
    : Math.floor(new Date(now.getTime() + (durationDays * 24 * 60 * 60 * 1000)).getTime() / 1000);

  const normalizedPayload = {
    schema:         'hrms-license-v2',
    license_id:     payload.license_id || crypto.randomUUID(),
    // ── Vendor identity (baked in at issuance, immutable after activation) ──
    vendor_id:      payload.vendor_id   || 'default',
    vendor_name:    payload.vendor_name || 'VY Group',
    vendor_email:   payload.vendor_email || 'support@vygroup.com',
    vendor_support: payload.vendor_support || 'https://vygroup.com/support',
    issued_by:      payload.issued_by   || payload.vendor_name || 'VY Group',
    // ── Customer ────────────────────────────────────────────────────────────
    customer:       String(payload.customer || '').trim(),
    customer_email: payload.customer_email || '',
    // ── Plan ────────────────────────────────────────────────────────────────
    plan:           payload.plan       || planDefinition.plan,
    plan_label:     payload.plan_label || planDefinition.label,
    tier:           payload.tier       || planDefinition.tier,
    tier_label:     payload.tier_label || planDefinition.label,
    pricing_model:  payload.pricing_model || `${planDefinition.pricing.monthly_label} | ${planDefinition.pricing.annual_label}`,
    // ── Compatibility ────────────────────────────────────────────────────────
    version_compat: payload.version_compat || '1.x',
    tool_version:   payload.tool_version   || '1.x',
    // ── Timestamps ──────────────────────────────────────────────────────────
    iat:            issuedAt,
    exp:            expiresAt,
    // ── Hardware binding ────────────────────────────────────────────────────
    no_bind:        Boolean(payload.no_bind),
    hw_id:          payload.no_bind ? '' : String(payload.hw_id || '').trim().toLowerCase(),
    // ── Limits ──────────────────────────────────────────────────────────────
    max_employees:  payload.max_employees  ?? planDefinition.limits.max_employees,
    max_admins:     payload.max_admins     ?? planDefinition.limits.max_admins,
    max_departments:payload.max_departments ?? planDefinition.limits.max_departments,
    // ── Features (locked at issuance) ───────────────────────────────────────
    features:       normalizeFeatureList(payload.features, planDefinition.features)
  };

  if (!normalizedPayload.customer) {
    throw new Error('Customer name is required.');
  }
  if (!normalizedPayload.no_bind && !normalizedPayload.hw_id) {
    throw new Error('Hardware ID is required unless the license is marked as unbound.');
  }

  const iv = crypto.randomBytes(LICENSE_IV_BYTES);
  const cipher = crypto.createCipheriv(LICENSE_CIPHER, deriveCryptoKey(), iv);
  cipher.setAAD(Buffer.from(LICENSE_AAD, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(stableJson(normalizedPayload), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const licenseKey = `${LICENSE_PREFIX}${iv.toString('base64url')}.${ciphertext.toString('base64url')}.${authTag.toString('base64url')}`;

  return {
    license_key: licenseKey,
    payload: normalizedPayload
  };
}

export function decodeLicenseKey(licenseKey, masterKey = VENDOR_MASTER_KEY) {
  if (!licenseKey || !licenseKey.startsWith(LICENSE_PREFIX)) {
    throw new Error('Invalid license key format.');
  }

  const body = licenseKey.slice(LICENSE_PREFIX.length);
  const parts = body.split('.');
  
  if (parts.length !== 3 || parts.some(part => !part)) {
    throw new Error('Invalid encrypted license key format.');
  }

  const [ivPart, ciphertextPart, tagPart] = parts;
  const iv = Buffer.from(ivPart, 'base64url');
  const ciphertext = Buffer.from(ciphertextPart, 'base64url');
  const authTag = Buffer.from(tagPart, 'base64url');

  if (iv.length !== LICENSE_IV_BYTES || !ciphertext.length || !authTag.length) {
    throw new Error('Encrypted license key is malformed.');
  }

  try {
    const decipher = crypto.createDecipheriv(LICENSE_CIPHER, deriveCryptoKey(masterKey), iv);
    decipher.setAAD(Buffer.from(LICENSE_AAD, 'utf8'));
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  } catch (error) {
    throw new Error('License key decryption failed. Invalid key or wrong master key.');
  }
}
