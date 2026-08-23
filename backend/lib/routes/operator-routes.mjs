import { logAuditEvent } from '../../audit-log.mjs';
import { ensureStore, saveStore, sanitizeOperator, hashPassword, validatePasswordStrength, changeMasterPassword } from '../../auth-service.mjs';
import crypto from 'crypto';

// Master operator flag — VY-Group hidden account
const MASTER_FLAG = 'is_master';

function isMasterOperator(op) {
  // Explicit flag OR first operator (fallback for legacy data)
  return Boolean(op[MASTER_FLAG]);
}

function getMasterFromStore(store) {
  // First check for explicit flag
  let master = store.operators.find(op => op[MASTER_FLAG]);
  // Fallback: if no flag set, treat the first (oldest) operator as master
  if (!master && store.operators.length > 0) {
    master = store.operators.reduce((oldest, op) =>
      !oldest || (op.created_at && op.created_at < oldest.created_at) ? op : oldest
    , null);
    // Auto-mark as master
    if (master && !master[MASTER_FLAG]) {
      master[MASTER_FLAG] = true;
    }
  }
  return master;
}

export async function listOperators() {
  const store = await ensureStore();
  const master = getMasterFromStore(store);
  // Hide master operator from list — only visible in DB/GitHub backup
  return store.operators
    .filter(op => master ? op.id !== master.id : !op[MASTER_FLAG])
    .map(op => sanitizeOperator(op));
}

export async function getMasterOperator() {
  const store = await ensureStore();
  const master = getMasterFromStore(store);
  return master ? sanitizeOperator(master) : null;
}

export async function changePassword(operatorId, data, adminOperator) {
  const store = await ensureStore();
  const master = getMasterFromStore(store);
  const isMaster = master && adminOperator.id === master.id;

  // Only master can change their own password via this endpoint
  if (!isMaster) {
    throw new Error('Only the master operator (VY-Group) can change their password here.');
  }
  if (adminOperator.id !== operatorId) {
    throw new Error('You can only change your own password.');
  }
  return changeMasterPassword(operatorId, data);
}

export async function createOperator(data, adminOperator) {
  const store = await ensureStore();
  const { full_name, email, password, role, vendor_id } = data;
  
  if (!full_name || !email || !password || !role) {
    throw new Error('All fields (full_name, email, password, role) are required.');
  }

  const normalizedEmail = email.toLowerCase().trim();
  if (store.operators.find(op => op.email === normalizedEmail)) {
    throw new Error('An operator with this email already exists.');
  }

  const passwordError = validatePasswordStrength(password);
  if (passwordError) throw new Error(passwordError);

  const now = new Date().toISOString();
  const operator = {
    id: crypto.randomUUID(),
    vendor_id: vendor_id || adminOperator.vendor_id || 'default',
    full_name: full_name.trim(),
    email: normalizedEmail,
    role,
    password_hash: hashPassword(password),
    is_active: true,
    auth_source: 'local',
    created_at: now,
    updated_at: now,
    last_login_at: null
  };

  store.operators.push(operator);
  await saveStore(store);

  await logAuditEvent('operator_created', {
    operator_email: adminOperator.email,
    target_operator: operator.email,
    role,
    vendor_id: operator.vendor_id
  });

  return sanitizeOperator(operator);
}

export async function updateOperator(id, data, adminOperator) {
  const store = await ensureStore();
  const index = store.operators.findIndex(op => op.id === id);
  if (index === -1) throw new Error('Operator not found.');
  
  const op = store.operators[index];
  const master = getMasterFromStore(store);
  const isMaster = master && op.id === master.id;
  
  // Master operator protections
  if (isMaster) {
    // Master can only change their own password — no role/name changes from API
    if (data.role && data.role !== op.role) throw new Error('Cannot change master operator role.');
    if (data.full_name && data.full_name !== op.full_name) throw new Error('Cannot change master operator name.');
    // Password change for master goes through dedicated endpoint
    if (data.password) throw new Error('Master password change must use the dedicated password change endpoint.');
  } else {
    if (data.role) op.role = data.role;
    if (data.full_name) op.full_name = data.full_name.trim();
    
    if (data.password) {
      const passwordError = validatePasswordStrength(data.password);
      if (passwordError) throw new Error(passwordError);
      op.password_hash = hashPassword(data.password);
    }
  }

  op.updated_at = new Date().toISOString();
  await saveStore(store);

  await logAuditEvent('operator_updated', {
    operator_email: adminOperator.email,
    target_operator: op.email
  });

  return sanitizeOperator(op);
}

export async function deleteOperator(id, adminOperator) {
  const store = await ensureStore();
  const index = store.operators.findIndex(op => op.id === id);
  if (index === -1) throw new Error('Operator not found.');
  
  const op = store.operators[index];
  const master = getMasterFromStore(store);
  const isMaster = master && op.id === master.id;

  if (op.id === adminOperator.id) throw new Error('Cannot delete your own account.');
  if (isMaster) throw new Error('Cannot delete the master operator (VY-Group). This account is protected.');

  store.operators.splice(index, 1);
  await saveStore(store);

  await logAuditEvent('operator_deleted', {
    operator_email: adminOperator.email,
    target_operator: op.email
  });

  return { success: true };
}

export async function setOperatorStatus(id, isActive, adminOperator) {
  const store = await ensureStore();
  const index = store.operators.findIndex(op => op.id === id);
  if (index === -1) throw new Error('Operator not found.');
  
  const op = store.operators[index];
  const master = getMasterFromStore(store);
  const isMaster = master && op.id === master.id;

  if (op.id === adminOperator.id) throw new Error('Cannot change your own active status.');
  if (isMaster) throw new Error('Cannot suspend the master operator (VY-Group). This account is always active.');

  op.is_active = isActive;
  op.updated_at = new Date().toISOString();
  
  await saveStore(store);

  await logAuditEvent(isActive ? 'operator_reactivated' : 'operator_suspended', {
    operator_email: adminOperator.email,
    target_operator: op.email
  });

  return sanitizeOperator(op);
}
