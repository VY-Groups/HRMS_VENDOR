import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'distributions.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function ensureStore() {
  ensureDir();
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify({ distributions: [] }, null, 2));
    return { distributions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { distributions: [] };
  }
}

function saveStore(store) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

export function getDistributions() {
  return ensureStore();
}

export function getDistributionsByVersion(version) {
  const store = ensureStore();
  return store.distributions.find(d => d.release_version === version) || null;
}

export function createDistribution(version, releaseNotes, breakingChanges) {
  const store = ensureStore();
  const existing = store.distributions.find(d => d.release_version === version);
  if (existing) return existing;
  
  const dist = {
    release_version: version,
    release_notes: releaseNotes || '',
    breaking_changes: breakingChanges || false,
    created_at: new Date().toISOString(),
    status: 'pending',
    customers: []
  };
  store.distributions.unshift(dist);
  saveStore(store);
  return dist;
}

export function pushToCustomer(version, customerId, customerName, vendorId) {
  const store = ensureStore();
  let dist = store.distributions.find(d => d.release_version === version);
  if (!dist) {
    dist = {
      release_version: version,
      release_notes: '',
      breaking_changes: false,
      created_at: new Date().toISOString(),
      status: 'active',
      customers: []
    };
    store.distributions.unshift(dist);
  }
  
  const existing = dist.customers.find(c => c.customer_id === customerId);
  if (existing) {
    existing.status = 'pushed';
    existing.pushed_at = new Date().toISOString();
    existing.error = null;
  } else {
    dist.customers.push({
      customer_id: customerId,
      customer_name: customerName || '',
      vendor_id: vendorId || '',
      status: 'pushed',
      pushed_at: new Date().toISOString(),
      applied_at: null,
      error: null
    });
  }
  
  dist.status = 'active';
  saveStore(store);
  return dist;
}

export function holdCustomer(version, customerId, customerName, vendorId, reason) {
  const store = ensureStore();
  let dist = store.distributions.find(d => d.release_version === version);
  if (!dist) {
    dist = {
      release_version: version,
      release_notes: '',
      breaking_changes: false,
      created_at: new Date().toISOString(),
      status: 'active',
      customers: []
    };
    store.distributions.unshift(dist);
  }
  
  const existing = dist.customers.find(c => c.customer_id === customerId);
  if (existing) {
    existing.status = 'hold';
    existing.hold_reason = reason || '';
    existing.hold_at = new Date().toISOString();
  } else {
    dist.customers.push({
      customer_id: customerId,
      customer_name: customerName || '',
      vendor_id: vendorId || '',
      status: 'hold',
      hold_reason: reason || '',
      hold_at: new Date().toISOString(),
      pushed_at: null,
      applied_at: null,
      error: null
    });
  }
  
  saveStore(store);
  return dist;
}

export function pushToAll(version, customers) {
  // customers = [{ id, name, vendor_id }]
  const store = ensureStore();
  let dist = store.distributions.find(d => d.release_version === version);
  if (!dist) {
    dist = {
      release_version: version,
      release_notes: '',
      breaking_changes: false,
      created_at: new Date().toISOString(),
      status: 'active',
      customers: []
    };
    store.distributions.unshift(dist);
  }
  
  const results = [];
  for (const c of customers) {
    const existing = dist.customers.find(x => x.customer_id === c.id);
    if (existing && existing.status === 'hold') {
      results.push({ customer_id: c.id, status: 'skipped_hold' });
      continue;
    }
    if (existing) {
      existing.status = 'pushed';
      existing.pushed_at = new Date().toISOString();
      existing.error = null;
    } else {
      dist.customers.push({
        customer_id: c.id,
        customer_name: c.name || '',
        vendor_id: c.vendor_id || '',
        status: 'pushed',
        pushed_at: new Date().toISOString(),
        applied_at: null,
        error: null
      });
    }
    results.push({ customer_id: c.id, status: 'pushed' });
  }
  
  dist.status = 'active';
  saveStore(store);
  return { dist, results };
}

export function releaseCustomer(version, customerId) {
  const store = ensureStore();
  const dist = store.distributions.find(d => d.release_version === version);
  if (!dist) return null;
  
  const c = dist.customers.find(x => x.customer_id === customerId);
  if (c) {
    c.status = 'pushed';
    c.pushed_at = new Date().toISOString();
    c.hold_reason = null;
    c.hold_at = null;
  }
  
  saveStore(store);
  return dist;
}

export function markApplied(version, customerId) {
  const store = ensureStore();
  const dist = store.distributions.find(d => d.release_version === version);
  if (!dist) return null;
  
  const c = dist.customers.find(x => x.customer_id === customerId);
  if (c) {
    c.status = 'applied';
    c.applied_at = new Date().toISOString();
  }
  
  saveStore(store);
  return dist;
}

export function getDistributionSummary() {
  const store = ensureStore();
  return store.distributions.map(d => ({
    version: d.release_version,
    status: d.status,
    total: d.customers.length,
    pushed: d.customers.filter(c => c.status === 'pushed').length,
    applied: d.customers.filter(c => c.status === 'applied').length,
    hold: d.customers.filter(c => c.status === 'hold').length,
    error: d.customers.filter(c => c.status === 'error').length,
    created_at: d.created_at
  }));
}
