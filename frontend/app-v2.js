const TOKEN_KEY = 'vendor_console_token';
const root = document.getElementById('root');
const toastRegion = document.getElementById('toastRegion');

// CACHE BUSTER - DO NOT REMOVE - VERSION: 2026-08-25-V12-BugFixes
const VENDOR_TOOL_VERSION = 'v4.1.0-v12-BugFixes';
console.log('[License-Gen-Hrms] Loaded:', VENDOR_TOOL_VERSION, 'Time:', new Date().toISOString());
console.log('[CACHE BUSTER] If you see old version, press Ctrl+Shift+Delete and clear cache!');

let clockTimer = null;

const state = {
  view: 'loading',
  consoleName: 'License-Gen-HRMS',
  sessionToken: localStorage.getItem(TOKEN_KEY) || '',
  authStatus: {
    setup_required: false,
    authenticated: false,
    operator: null
  },
  plans: [],
  security: null,
  customers: [],
  summary: {
    total_customers: 0,
    active_customers: 0,
    renewals_due: 0,
    licenses_issued: 0
  },
  selectedCustomerId: '',
  searchQuery: '',
  lastIssuedLicense: null,
  analytics: null,
  expiringLicenses: [],
  showAnalytics: false,
  showTools: false,
  showSystemUpdate: false,
  updateData: null,
  currentPage: 'overview' // Track which page: overview, customers, profile, licenses, analytics, audit, templates, operators, portal, security, configuration, systemUpdate
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatDateTime(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDateOnly(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

function getDaysUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function getOperatorInitials(name) {
  return String(name || 'VC')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('') || 'VC';
}

function toFileStub(value) {
  return String(value || 'customer')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'customer';
}

function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function getSelectedCustomer() {
  return state.customers.find(customer => customer.id === state.selectedCustomerId) || null;
}

function getFilteredCustomers() {
  const needle = state.searchQuery.trim().toLowerCase();
  if (!needle) return state.customers;
  return state.customers.filter(customer => {
    return [
      customer.legal_name,
      customer.workspace_name,
      customer.primary_contact,
      customer.contact_email,
      customer.plan,
      customer.status,
      customer.deployment_type
    ].some(value => String(value || '').toLowerCase().includes(needle));
  });
}

function getPlanDefinition(planName) {
  return state.plans.find(plan => plan.plan === planName) || state.plans[0] || null;
}

function getSecurityLines() {
  const note = state.security || {};
  return [
    'Vendor-side commercial registry only.',
    'No runtime dependency on the HRMS API or database.',
    'Issued tokens are opaque encrypted HRMS2 licenses.',
    note.validation_target || 'Only the HRMS backend can validate the issued token.',
    note.master_key_requirement || 'Configure the matching master key on both products manually.'
  ];
}

function showToast(message, type = 'info') {
  const icons = { success: '\u2713', error: '\u2717', warning: '\u26A0', info: '\u2139' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span class="toast-text">${escapeHtml(message)}</span>`;
  toastRegion.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

function showModal({ title, message, type = 'alert', inputValue = '', okText = 'OK', cancelText = 'Cancel', isHtml = false } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';

    const header = document.createElement('div');
    header.className = 'modal-header';
    const h3 = document.createElement('h3');
    h3.className = 'modal-title';
    h3.textContent = title || (type === 'prompt' ? 'Input Required' : type === 'confirm' ? 'Confirm' : 'Notice');
    header.appendChild(h3);

    const body = document.createElement('div');
    body.className = 'modal-body';
    const msg = document.createElement('div');
    msg.className = 'modal-message';
    if (isHtml) { msg.innerHTML = message; } else { msg.textContent = message; }
    body.appendChild(msg);

    let inputEl = null;
    if (type === 'prompt') {
      inputEl = document.createElement('input');
      inputEl.type = 'text';
      inputEl.className = 'modal-input surface-input';
      inputEl.value = inputValue;
      body.appendChild(inputEl);
    }

    const footer = document.createElement('div');
    footer.className = 'modal-footer';

    const okBtn = document.createElement('button');
    okBtn.className = 'primary-btn';
    okBtn.textContent = okText;
    footer.appendChild(okBtn);

    if (type !== 'alert') {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'secondary-btn';
      cancelBtn.textContent = cancelText;
      footer.insertBefore(cancelBtn, okBtn);
      cancelBtn.addEventListener('click', () => {
        overlay.remove();
        resolve(null);
      });
    }

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(footer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    okBtn.addEventListener('click', () => {
      overlay.remove();
      if (type === 'prompt') resolve(inputEl.value);
      else resolve(true);
    });

    const doClose = () => { overlay.remove(); resolve(null); };
    overlay.addEventListener('click', e => { if (e.target === overlay) doClose(); });
    const handleKey = e => {
      if (e.key === 'Escape') { doClose(); }
      if (e.key === 'Enter' && type !== 'prompt') { okBtn.click(); }
      if (e.key === 'Enter' && type === 'prompt') { okBtn.click(); }
    };
    document.addEventListener('keydown', handleKey);
    overlay.addEventListener('remove', () => document.removeEventListener('keydown', handleKey));
    if (inputEl) setTimeout(() => inputEl.focus(), 100);
  });
}

function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    if (btn.dataset.origHtml) return;
    btn.dataset.origHtml = btn.innerHTML;
    btn.classList.add('btn-loading');
    btn.innerHTML = '<span class="btn-text"></span><span class="btn-spinner"></span>';
  } else if (btn.dataset.origHtml) {
    btn.classList.remove('btn-loading');
    btn.innerHTML = btn.dataset.origHtml;
    delete btn.dataset.origHtml;
  }
}

function setSessionToken(token) {
  state.sessionToken = token;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

function stopClock() {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

function updateClock() {
  const node = document.getElementById('liveClock');
  if (!node) return;
  node.textContent = new Date().toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

function startClock() {
  stopClock();
  updateClock();
  clockTimer = setInterval(updateClock, 30000);
}

function clearSession(message = '') {
  setSessionToken('');
  state.authStatus = {
    ...state.authStatus,
    authenticated: false,
    operator: null
  };
  state.view = state.authStatus.setup_required ? 'setup' : 'login';
  renderApp();
  bindCurrentView();
  if (message) showToast(message, 'warning');
}

async function api(path, options = {}, meta = {}) {
  const {
    auth = true,
    handleUnauthorized = true
  } = meta;

  const headers = {
    ...(options.headers || {})
  };

  if (auth && state.sessionToken) {
    headers.Authorization = `Bearer ${state.sessionToken}`;
  }

  // Always route API calls to the vendor backend on the same origin
  // since the backend serves its own frontend files.
  const backendUrl = `${window.location.origin}${path}`;

  const response = await fetch(backendUrl, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && handleUnauthorized) {
      clearSession('Vendor session expired. Sign in again.');
    }
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

async function loadPublicContext() {
  const authHeaders = state.sessionToken
    ? { Authorization: `Bearer ${state.sessionToken}` }
    : {};

  const [authStatus, plans, security] = await Promise.all([
    api('/api/auth/status', { headers: authHeaders }, { auth: false, handleUnauthorized: false }),
    api('/api/plans', {}, { auth: false, handleUnauthorized: false }),
    api('/api/security-note', {}, { auth: false, handleUnauthorized: false })
  ]);

  state.authStatus = authStatus || state.authStatus;
  state.consoleName = authStatus?.console_name || state.consoleName;
  state.plans = Array.isArray(plans) ? plans : [];
  state.security = security || null;

  if (!state.authStatus.authenticated) {
    setSessionToken('');
  }
}

function renderLoading() {
  return `
    <div class="loading-shell">
      <div class="loading-card">
        <div class="brand-mark brand-mark-large">VY</div>
        <div class="eyebrow">Boot Sequence</div>
        <h1>${escapeHtml(state.consoleName)}</h1>
        <p>Preparing operator console, session boundary, and commercial customer telemetry.</p>
      </div>
    </div>
  `;
}

function renderSecurityMarkup() {
  return getSecurityLines().map(item => `<li>${escapeHtml(item)}</li>`).join('');
}

function renderPlanStrip() {
  return `
    <div class="auth-plan-strip">
      ${state.plans.map(plan => `
        <div class="auth-plan-card">
          <div class="auth-plan-name">${escapeHtml(plan.label)}</div>
          <div class="auth-plan-price">${escapeHtml(plan.pricing?.monthly_label || 'Custom')}</div>
          <div class="auth-plan-copy">${escapeHtml(plan.tagline || '')}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAuthShell(mode) {
  const setupMode = mode === 'setup';
  return `
    <div class="auth-shell">
      <div class="auth-grid">
        <section class="auth-showcase">
          <div class="showcase-orbit showcase-orbit-a"></div>
          <div class="showcase-orbit showcase-orbit-b"></div>
          <div class="brand-row">
            <div class="brand-mark brand-mark-large">VY</div>
            <div>
              <div class="eyebrow">Vendor Command Grid</div>
              <h1>${escapeHtml(state.consoleName)}</h1>
            </div>
          </div>
          <h2>${setupMode ? 'Initialize the operator control layer' : 'Operator authentication required'}</h2>
          <p>${setupMode
            ? 'Create the first secure vendor operator, then unlock customer command, encrypted issuance, and deployment handoff workflows.'
            : 'Sign in to access the commercial registry, entitlement matrix, hardware binding intake, and secure HRMS license factory.'}</p>
          <div class="auth-badge-row">
            <span class="hero-chip">Opaque HRMS2 Tokens</span>
            <span class="hero-chip">Offline Validation Model</span>
            <span class="hero-chip">Vendor Data Boundary</span>
          </div>
          ${renderPlanStrip()}
          <div class="boundary-card boundary-card-auth">
            <div class="section-kicker">Security Boundary</div>
            <ul class="security-list">${renderSecurityMarkup()}</ul>
          </div>
        </section>
        <section class="auth-panel">
          <div class="section-kicker">${setupMode ? 'First-Run Setup' : 'Operator Sign-In'}</div>
          <h3>${setupMode ? 'Configure email & create operator' : 'Enter vendor credentials'}</h3>
          <p>${setupMode
            ? 'Step 1: Verify your email. Step 2: Set your login password.'
            : 'Use the vendor operator account created during setup to enter the command center.'}</p>
          <form id="${setupMode ? 'setupForm' : 'loginForm'}" class="auth-form">
            ${setupMode ? `
              <div id="setup-step1">
                <h4 style="color:#6366f1;margin:0 0 12px;font-size:14px;">Step 1 — Email Verification</h4>
                <label class="field">
                  <span class="field-label">Email Address</span>
                  <input id="setupEmail" class="surface-input" type="email" placeholder="your@email.com" required>
                </label>
                <label class="field">
                  <span class="field-label">SMTP Host</span>
                  <input id="setupSmtpHost" class="surface-input" type="text" placeholder="smtp.gmail.com" required>
                </label>
                <label class="field">
                  <span class="field-label">SMTP Port</span>
                  <input id="setupSmtpPort" class="surface-input" type="number" value="587" required>
                </label>
                <label class="field">
                  <span class="field-label">SMTP Username (usually your email)</span>
                  <input id="setupSmtpUser" class="surface-input" type="text" placeholder="your@email.com">
                </label>
                <label class="field">
                  <span class="field-label">SMTP Password / App Password</span>
                  <input id="setupSmtpPass" class="surface-input" type="password" placeholder="Your email password" required>
                </label>
                <button type="button" id="sendOtpBtn" class="primary-btn auth-submit" onclick="sendSetupOtp()">Send Verification Code</button>
                <label class="field" style="margin-top:16px;">
                  <span class="field-label">Enter 6-digit OTP from your email</span>
                  <input id="setupOtp" class="surface-input" type="text" placeholder="000000" maxlength="6" pattern="[0-9]{6}" inputmode="numeric" style="font-size:20px;letter-spacing:6px;text-align:center;">
                </label>
                <button type="button" id="verifyOtpBtn" class="primary-btn auth-submit" onclick="verifySetupOtp()" style="background:#10b981;" disabled>Verify Code</button>
                <div style="text-align:center;margin-top:12px;">
                  <a href="#" onclick="skipOtpSetup(event)" style="color:#9ca3af;font-size:12px;text-decoration:underline;cursor:pointer;">Skip for now (configure email later)</a>
                </div>
              </div>
              <div id="setup-step2" style="display:none;">
                <h4 id="step2Header" style="color:#10b981;margin:0 0 4px;font-size:14px;">✓ Email Verified</h4>
                <p style="color:#6b7280;font-size:12px;margin:0 0 16px;" id="verifiedEmailLabel"></p>
                <h4 style="color:#6366f1;margin:0 0 12px;font-size:14px;">Step 2 — Create Login Account</h4>
                <label class="field" id="step2EmailField" style="display:none;">
                  <span class="field-label">Email</span>
                  <input id="setupEmailStep2" class="surface-input" type="email" placeholder="your@email.com">
                </label>
                <label class="field">
                  <span class="field-label">Full Name</span>
                  <input id="setupFullName" class="surface-input" type="text" placeholder="Vendor Platform Admin" required>
                </label>
                <label class="field">
                  <span class="field-label">Login Password (separate from email password)</span>
                  <input id="setupPassword" class="surface-input" type="password" placeholder="Min 10 chars, upper+lower+number+special" required>
                </label>
                <label class="field">
                  <span class="field-label">Confirm Login Password</span>
                  <input id="setupPasswordConfirm" class="surface-input" type="password" placeholder="Re-enter login password" required>
                </label>
                <button class="primary-btn auth-submit" type="submit">Create Operator & Enter Console</button>
              </div>
            ` : ''}
            ${!setupMode ? `
            <label class="field">
              <span class="field-label">Email</span>
              <input id="loginEmail" class="surface-input" type="email" placeholder="operator@vygroup.com" required>
            </label>
            <label class="field">
              <span class="field-label">Password</span>
              <input id="loginPassword" class="surface-input" type="password" placeholder="Enter operator password" required>
            </label>
            <button class="primary-btn auth-submit" type="submit">Sign In to Console</button>
            ` : ''}
          </form>
        </section>
      </div>
    </div>
  `;
}

// ==================== SHARED LAYOUT COMPONENTS ====================

function renderSharedSidebar() {
  const operator = state.authStatus.operator || {};
  const currentPage = state.currentPage;
  
  return `
    <aside class="control-rail">
      <div class="rail-brand">
        <div class="brand-mark">VY</div>
        <div>
          <div class="eyebrow">Vendor Control Grid</div>
          <h1>Licensing Nexus</h1>
          <p>Commercial customers, deployment posture, and secure issuance.</p>
        </div>
      </div>

      <div class="operator-card">
        <div class="operator-avatar">${escapeHtml(getOperatorInitials(operator.full_name))}</div>
        <div class="operator-copy">
          <div class="operator-name">${escapeHtml(operator.full_name || 'Platform Operator')}</div>
          <div class="operator-meta">${escapeHtml(operator.email || 'Not signed in')}</div>
          <div class="operator-foot">
            <span class="status-pill active">Online</span>
            <span>Last access ${escapeHtml(formatDateTime(operator.last_login_at))}</span>
          </div>
        </div>
      </div>

      <div class="rail-section-title">Command Map</div>
      <nav class="rail-nav">
        <button class="rail-nav-btn ${currentPage === 'overview' ? 'active' : ''}" onclick="switchToPage('overview')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
          Overview
        </button>
        <button class="rail-nav-btn ${currentPage === 'customers' ? 'active' : ''}" onclick="switchToPage('customers')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          Customers
        </button>
        <button class="rail-nav-btn ${currentPage === 'profile' ? 'active' : ''}" onclick="switchToPage('profile')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          Profile
        </button>
        <button class="rail-nav-btn ${currentPage === 'licenses' ? 'active' : ''}" onclick="switchToPage('licenses')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
          Licenses
        </button>
        <button class="rail-nav-btn ${currentPage === 'analytics' ? 'active' : ''}" onclick="switchToPage('analytics')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          Analytics
        </button>
        <button class="rail-nav-btn ${currentPage === 'audit' ? 'active' : ''}" onclick="switchToPage('audit')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
          Audit Log
        </button>
        <button class="rail-nav-btn ${currentPage === 'templates' ? 'active' : ''}" onclick="switchToPage('templates')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
          Templates
        </button>
        <button class="rail-nav-btn ${currentPage === 'operators' ? 'active' : ''}" onclick="switchToPage('operators')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          Operators
        </button>
        <button class="rail-nav-btn ${currentPage === 'portal' ? 'active' : ''}" onclick="switchToPage('portal')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
          Outreach
        </button>
        <button class="rail-nav-btn ${currentPage === 'security' ? 'active' : ''}" onclick="switchToPage('security')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          Security
        </button>
        <button class="rail-nav-btn ${currentPage === 'configuration' ? 'active' : ''}" onclick="switchToPage('configuration')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"></path><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.03.03a2 2 0 1 1-2.83 2.83l-.03-.03a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.65V21a2 2 0 1 1-4 0v-.05a1.8 1.8 0 0 0-1.1-1.65 1.8 1.8 0 0 0-1.98.36l-.03.03a2 2 0 1 1-2.83-2.83l.03-.03A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.65-1.1H3a2 2 0 1 1 0-4h.05A1.8 1.8 0 0 0 4.7 8.8a1.8 1.8 0 0 0-.36-1.98l-.03-.03A2 2 0 1 1 7.14 3.96l.03.03a1.8 1.8 0 0 0 1.98.36A1.8 1.8 0 0 0 10.25 2.7V2.65a2 2 0 1 1 4 0v.05a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 1.98-.36l.03-.03a2 2 0 1 1 2.83 2.83l-.03.03a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.65 1.1H21a2 2 0 1 1 0 4h-.05A1.8 1.8 0 0 0 19.4 15Z"></path></svg>
          Configuration
        </button>
        <button class="rail-nav-btn ${currentPage === 'systemUpdate' ? 'active' : ''}" onclick="switchToPage('systemUpdate')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          System Update
        </button>
        <button class="rail-nav-btn ${currentPage === 'publishRelease' ? 'active' : ''}" onclick="switchToPage('publishRelease')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg>
          Publish Release
        </button>
        <button class="rail-nav-btn ${currentPage === 'updateManagement' ? 'active' : ''}" onclick="switchToPage('updateManagement')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          Push to Customers
        </button>
        <button class="rail-nav-btn ${currentPage === 'backup' ? 'active' : ''}" onclick="switchToPage('backup')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
          Backup & Vendors
        </button>
        <button class="rail-nav-btn ${currentPage === 'activity' ? 'active' : ''}" onclick="switchToPage('activity')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
          Activity Feed
        </button>
        <button class="rail-nav-btn ${currentPage === 'health' ? 'active' : ''}" onclick="switchToPage('health')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
          Health Scores
        </button>
        <button class="rail-nav-btn ${currentPage === 'deployments' ? 'active' : ''}" onclick="switchToPage('deployments')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
          Deployments
        </button>
        <button class="rail-nav-btn ${currentPage === 'campaigns' ? 'active' : ''}" onclick="switchToPage('campaigns')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
          Campaigns
        </button>
        <button class="rail-nav-btn ${currentPage === 'reports' ? 'active' : ''}" onclick="switchToPage('reports')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"></path><path d="M22 12A10 10 0 0 0 12 2v10z"></path></svg>
          Reports
        </button>
        <button class="rail-nav-btn ${currentPage === 'webhooks' ? 'active' : ''}" onclick="switchToPage('webhooks')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
          Webhooks
        </button>
        <button class="rail-nav-btn ${currentPage === 'selfService' ? 'active' : ''}" onclick="switchToPage('selfService')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M8 14s1.5 2 4 2 4-2 4-2"></path><line x1="9" y1="9" x2="9.01" y2="9"></line><line x1="15" y1="9" x2="15.01" y2="9"></line></svg>
          Customer Portal
        </button>
      </nav>
      <div style="padding:0 12px;margin-top:auto;">
        <button onclick="handleLogout()" class="rail-nav-btn" type="button" style="width:100%;color:var(--text-muted);border-top:1px solid var(--border-light);padding-top:12px;margin-top:8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
          Sign Out
        </button>
      </div>
    </aside>
  `;
}

// ==================== PAGE RENDER FUNCTIONS ====================

function renderOverviewPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Commercial Operations</div>
            <h2>Dashboard Overview</h2>
            <p>Monitor customer metrics, deployment readiness, and license issuance activity.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <section class="hero-panel" style="padding:20px 28px;">
          <div class="hero-copy">
            <div class="hero-chip-row" style="margin-bottom:8px;">
              <span class="hero-chip">Encrypted Delivery Tokens</span>
              <span class="hero-chip">Deployment Export</span>
            </div>
          </div>
          <div class="hero-stats">
            <div class="hero-stat-card">
              <span class="hero-stat-label">Live Clock</span>
              <strong id="liveClock" class="hero-stat-value">--</strong>
            </div>
            <div class="hero-stat-card">
              <span class="hero-stat-label">Selected Account</span>
              <strong id="heroCustomerValue" class="hero-stat-value">None</strong>
            </div>
            <div class="hero-stat-card">
              <span class="hero-stat-label">Renewal</span>
              <strong id="heroRenewalValue" class="hero-stat-value">--</strong>
            </div>
          </div>
        </section>

        <section id="metricsGrid" class="metrics-grid" style="margin:0 28px;"></section>

        <section style="padding:0 28px;">
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Quick Actions</div>
                <h3 class="section-title">Recent Licenses</h3>
              </div>
              <div class="section-actions">
                <button onclick="switchToPage('licenses')" class="secondary-btn" type="button">View All</button>
              </div>
            </div>
            <div id="recentLicensesDash" style="padding:20px;">
              <div class="empty-state" style="padding:24px;"><p>Loading recent licenses...</p></div>
            </div>
          </div>
        </section>

        <section style="padding:8px 28px 28px;">
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Renewal Pipeline</div>
                <h3 class="section-title">Upcoming Renewals</h3>
              </div>
              <div class="section-actions">
                <button onclick="switchToPage('portal')" class="secondary-btn" type="button">Manage</button>
              </div>
            </div>
            <div id="renewalsDash" style="padding:20px;">
              <div class="empty-state" style="padding:24px;"><p>Loading renewal data...</p></div>
            </div>
          </div>
        </section>
      </main>
    </div>
  `;
}

function renderCustomersPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Customer Management</div>
            <h2>Customer Registry</h2>
            <p>Manage commercial customers, contacts, and account status.</p>
          </div>
          <div class="command-actions">
            <label class="search-surface">
              <span class="search-label">Search</span>
              <input id="customerSearch" class="search-input" type="text" placeholder="Search customer, contact, plan, or status" value="${escapeHtml(state.searchQuery)}">
            </label>
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <section class="section-card registry-panel" style="padding: 2rem;">
          <div class="section-header">
            <div>
              <div class="section-kicker">Commercial Registry</div>
              <h3 class="section-title">Customer Book</h3>
            </div>
            <div class="section-actions">
              <button onclick="generateTrialLicense()" class="primary-btn" type="button" style="background:#10B981;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:6px;vertical-align:middle"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                Quick POC/Trial
              </button>
              <button id="newCustomerBtn" class="primary-btn" type="button">New Customer</button>
            </div>
          </div>
          <div id="customerList" class="customer-list"></div>
        </section>
      </main>
    </div>
  `;
}

function renderProfilePage() {
  const customer = getSelectedCustomer();
  const isNewCustomer = !customer;
  const displayName = customer ? (customer.legal_name || 'Customer') : 'New Customer';

  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Customer Profile</div>
            <h2>${escapeHtml(displayName)}</h2>
            <p>${isNewCustomer ? 'Create a new customer record' : 'Manage customer details, contacts, and account information.'}</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('customers')" class="ghost-btn" type="button">Back to List</button>
          </div>
        </header>

        <div style="padding: 2rem; max-width: ${isNewCustomer ? '900px' : '1100px'}; margin: 0 auto;">
          <section id="customerProfile" class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Account Profile</div>
                <h3 id="profileHeading" class="section-title">${isNewCustomer ? 'New Customer' : escapeHtml(customer.legal_name)}</h3>
              </div>
              <div class="section-actions">
                ${!isNewCustomer ? `
                  <button id="archiveCustomerBtn" class="secondary-btn" type="button">Archive</button>
                  <button id="deleteCustomerBtn" class="ghost-btn" type="button" style="color:#ef4444;">Delete</button>
                ` : ''}
                <button id="saveCustomerBtn" class="primary-btn" type="button">Save Customer</button>
              </div>
            </div>
            <form id="customerForm" class="profile-form">
              <div class="form-grid">
                <label class="field">
                  <span class="field-label">Legal Name *</span>
                  <input id="legalName" class="surface-input" type="text" placeholder="Acme Corporation" required>
                </label>
                <label class="field">
                  <span class="field-label">Workspace Name</span>
                  <input id="workspaceName" class="surface-input" type="text" placeholder="acme-workspace">
                </label>
                <label class="field">
                  <span class="field-label">Primary Contact</span>
                  <input id="primaryContact" class="surface-input" type="text" placeholder="John Doe">
                </label>
                <label class="field">
                  <span class="field-label">Contact Email</span>
                  <input id="contactEmail" class="surface-input" type="email" placeholder="john@acme.com">
                </label>
                <label class="field">
                  <span class="field-label">Contact Phone</span>
                  <input id="contactPhone" class="surface-input" type="tel" placeholder="+1 555 0100">
                </label>
                <label class="field">
                  <span class="field-label">Billing Contact</span>
                  <input id="billingContact" class="surface-input" type="text" placeholder="Jane Smith">
                </label>
                <label class="field">
                  <span class="field-label">Billing Email</span>
                  <input id="billingEmail" class="surface-input" type="email" placeholder="billing@acme.com">
                </label>
                <label class="field">
                  <span class="field-label">Status</span>
                  <select id="customerStatus" class="surface-input">
                    <option value="prospect">Prospect</option>
                    <option value="poc">POC/Trial</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">Plan</span>
                  <select id="plan" class="surface-input"></select>
                </label>
                <label class="field">
                  <span class="field-label">Deployment Type</span>
                  <select id="deploymentType" class="surface-input">
                    <option value="on-prem">On-Premise</option>
                    <option value="cloud">Cloud</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">Renewal Date</span>
                  <input id="renewalDate" class="surface-input" type="date">
                </label>
                <label class="field">
                  <span class="field-label">Duration (Days)</span>
                  <input id="durationDays" class="surface-input" type="number" value="365" min="1">
                </label>
                <label class="field">
                  <span class="field-label">Hardware ID</span>
                  <input id="hardwareId" class="surface-input" type="text" placeholder="HW-12345">
                  <label style="margin-top:0.5rem;display:flex;align-items:center;gap:0.5rem;">
                    <input id="noBind" type="checkbox">
                    <span style="font-size:0.875rem;color:#6b7280;">No hardware binding (floating license)</span>
                  </label>
                </label>
                <label class="field">
                  <span class="field-label">Max Employees</span>
                  <input id="maxEmployees" class="surface-input" type="number" placeholder="500">
                </label>
                <label class="field">
                  <span class="field-label">Max Admins</span>
                  <input id="maxAdmins" class="surface-input" type="number" placeholder="10">
                </label>
                <label class="field">
                  <span class="field-label">Max Departments</span>
                  <input id="maxDepartments" class="surface-input" type="number" placeholder="20">
                </label>
              </div>
              <label class="field">
                <span class="field-label">Feature Overrides (comma-separated)</span>
                <input id="featureOverrides" class="surface-input" type="text" placeholder="advanced_reports, custom_workflows">
              </label>
              <label class="field">
                <span class="field-label">Notes</span>
                <textarea id="customerNotes" class="surface-input" rows="3" placeholder="Internal notes about this customer"></textarea>
              </label>
            </form>
            ${!isNewCustomer ? '<div id="accountSignals" class="account-signals"></div>' : ''}
            ${!isNewCustomer ? '<div id="licenseHistory" class="license-history"></div>' : ''}
          </section>
          
          ${!isNewCustomer ? `
          <section class="section-card" style="margin-top: 2rem;">
            <div class="section-header">
              <div>
                <div class="section-kicker">License Output</div>
                <h3 class="section-title">Generated License</h3>
              </div>
              <div class="section-actions">
                <button id="generateBtn" class="primary-btn" type="button">Generate License</button>
                <button id="copyBtn" class="secondary-btn" type="button">Copy</button>
              </div>
            </div>
            <div class="section-body">
              <textarea id="licenseOutput" class="code-output" readonly placeholder="License will appear here after generation"></textarea>
            </div>
            
            <div class="section-header" style="margin-top:1.5rem;">
              <div>
                <div class="section-kicker">Deployment Manifest</div>
                <h3 class="section-title">Customer Deployment Package</h3>
              </div>
            </div>
            <div class="section-body">
              <textarea id="summaryOutput" class="code-output" readonly placeholder="Deployment manifest will appear here"></textarea>
            </div>
          </section>
          ` : ''}
        </div>
      </main>
    </div>
  `;
}

function renderLicensesPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">License Management</div>
            <h2>License Issuance</h2>
            <p>Generate, manage, and track customer licenses.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div style="padding: 2rem;">
          <section class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">All Licenses</div>
                <h3 class="section-title">License Registry</h3>
              </div>
              <div class="section-actions">
                <input type="text" id="licenseSearchInput" class="surface-input" placeholder="Search by customer or plan..." style="min-width:220px;" oninput="filterLicenseRegistry(this.value)">
              </div>
            </div>
            <div id="licenseRegistryContainer" style="padding:0 20px 20px;">
              <div class="empty-state">Loading licenses...</div>
            </div>
          </section>
        </div>
      </main>
    </div>
  `;
}

function renderAnalyticsPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Business Intelligence</div>
            <h2>Analytics & Reports</h2>
            <p>Customer metrics, conversion rates, and renewal forecasts.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div style="padding: 0 28px;">
          <section class="section-card" style="padding:20px;">
            <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;">Key Metrics</h3>
            <div id="analyticsMetricsGrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;"></div>
          </section>
          <section class="section-card" style="padding:20px;margin-top:20px;">
            <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;">Visual Analytics</h3>
            <div id="analyticsChartsContainer"></div>
          </section>
          <section class="section-card" style="padding:20px;margin-top:20px;">
            <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;">Expiring Licenses</h3>
            <div id="analyticsExpiringList"></div>
          </section>
        </div>
      </main>
    </div>`;
}

async function loadAnalyticsPage() {
  const metricsEl = document.getElementById('analyticsMetricsGrid');
  const chartsEl = document.getElementById('analyticsChartsContainer');
  const expiringEl = document.getElementById('analyticsExpiringList');
  try {
    const data = await api('/api/analytics/dashboard');
    if (metricsEl) {
      metricsEl.innerHTML = [
        { label: 'Total Customers', value: data.total_customers || 0, color: 'var(--primary, #6366f1)' },
        { label: 'Active Customers', value: data.active_customers || 0, color: '#10b981' },
        { label: 'POC Customers', value: data.poc_customers || 0, color: '#f59e0b' },
        { label: 'Conversion Rate', value: (data.conversion_rate || 0) + '%', color: '#6366f1' }
      ].map(m => `<div style="padding:16px;border-left:4px solid ${m.color};background:var(--bg);border-radius:0 8px 8px 0;"><div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">${m.label}</div><div style="font-size:24px;font-weight:700;color:${m.color};margin-top:4px;">${m.value}</div></div>`).join('');
    }
    if (chartsEl) {
      const customers = state.customers || [];
      const planCounts = {};
      customers.forEach(c => { planCounts[c.plan] = (planCounts[c.plan] || 0) + 1; });
      const maxPlan = Math.max(...Object.values(planCounts), 1);
      const barHtml = Object.entries(planCounts).map(([plan, count]) => {
        const pct = Math.round((count / maxPlan) * 100);
        return `<div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px;"><span style="text-transform:capitalize;font-weight:500;">${escapeHtml(plan)}</span><span style="color:var(--text-muted);">${count}</span></div>
          <div style="background:var(--bg, #f3f4f6);border-radius:4px;height:12px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:var(--primary, #6366f1);border-radius:4px;transition:width .3s;"></div></div>
        </div>`;
      }).join('');
      const statusCounts = {};
      customers.forEach(c => { statusCounts[c.status] = (statusCounts[c.status] || 0) + 1; });
      const maxStatus = Math.max(...Object.values(statusCounts), 1);
      const statusColors = { active: '#10b981', poc: '#f59e0b', prospect: '#3b82f6', archived: '#6b7280' };
      const statusHtml = Object.entries(statusCounts).map(([status, count]) => {
        const pct = Math.round((count / maxStatus) * 100);
        const color = statusColors[status] || '#6b7280';
        return `<div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px;"><span style="text-transform:capitalize;font-weight:500;">${escapeHtml(status)}</span><span style="color:var(--text-muted);">${count}</span></div>
          <div style="background:var(--bg, #f3f4f6);border-radius:4px;height:12px;overflow:hidden;"><div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width .3s;"></div></div>
        </div>`;
      }).join('');
      chartsEl.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div><h4 style="font-size:12px;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:12px;">Customers by Plan</h4>${barHtml || '<div style="color:var(--text-muted);font-size:12px;">No data</div>'}</div>
        <div><h4 style="font-size:12px;text-transform:uppercase;color:var(--text-muted);font-weight:600;margin-bottom:12px;">Customers by Status</h4>${statusHtml || '<div style="color:var(--text-muted);font-size:12px;">No data</div>'}</div>
      </div>`;
    }
    if (expiringEl) {
      const expiring = data.expiring_licenses || [];
      if (!expiring.length) {
        expiringEl.innerHTML = '<div class="empty-state">No licenses expiring within 30 days.</div>';
      } else {
        expiringEl.innerHTML = expiring.map(e => `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border-light, rgba(0,0,0,.06));">
          <div><span style="font-weight:600;font-size:13px;">${escapeHtml(e.customer_name)}</span><span style="font-size:12px;color:var(--text-muted);margin-left:8px;">${escapeHtml(e.plan)}</span></div>
          <div style="text-align:right;"><span style="font-size:12px;color:${e.days_remaining <= 7 ? 'var(--danger, #ef4444)' : 'var(--text-muted)'};">${e.days_remaining} days left</span></div>
        </div>`).join('');
      }
    }
  } catch (err) {
    if (chartsEl) chartsEl.innerHTML = `<div class="empty-state" style="color:var(--danger, #ef4444);">${escapeHtml(err.message)}</div>`;
  }
}

window.loadAnalyticsPage = loadAnalyticsPage;

function renderAuditPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Compliance & Tracking</div>
            <h2>Audit Log</h2>
            <p>Complete audit trail of all operator actions and system events.</p>
          </div>
          <div class="command-actions">
            <button onclick="refreshAuditLog()" class="secondary-btn" type="button">Refresh</button>
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div style="padding: 2rem;">
          <section class="section-card">
            <div id="auditLogContainer"><div class="empty-state">Loading audit log...</div></div>
          </section>
        </div>
      </main>
    </div>
  `;
}

function renderTemplatesPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Document Management</div>
            <h2>Document Templates</h2>
            <p>Manage deployment guides and customer documentation templates.</p>
          </div>
          <div class="command-actions">
            <button onclick="createTemplate()" class="primary-btn" type="button">New Template</button>
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div style="padding: 2rem;">
          <section class="section-card">
            <div id="templatesContainer"></div>
          </section>
          <section class="section-card" style="margin-top:20px;">
            <div style="padding:16px 20px;border-bottom:1px solid var(--border-light, rgba(0,0,0,.06));"><h3 style="font-size:14px;font-weight:600;">Custom Templates</h3></div>
            <div id="customTemplatesContainer" style="padding:16px 20px;">
              <div class="empty-state">Loading custom templates...</div>
            </div>
          </section>
        </div>
      </main>
    </div>`;
}

async function loadCustomTemplates() {
  const el = document.getElementById('customTemplatesContainer');
  if (!el) return;
  try {
    const data = await api('/api/templates');
    const templates = data.templates || [];
    if (!templates.length) {
      el.innerHTML = '<div class="empty-state">No custom templates yet. Click "New Template" to create one.</div>';
      return;
    }
    el.innerHTML = templates.map(t => {
      const catColors = { custom: '#6b7280', welcome: '#10b981', renewal: '#f59e0b', trial: '#6366f1', alert: '#ef4444' };
      const color = catColors[t.category] || '#6b7280';
      return `<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:14px 0;border-bottom:1px solid var(--border-light, rgba(0,0,0,.06));">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:13px;color:var(--text);">${escapeHtml(t.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Subject: ${escapeHtml(t.subject)}</div>
          <div style="font-size:11px;margin-top:4px;"><span style="padding:2px 8px;border-radius:10px;background:${color}20;color:${color};font-weight:500;">${escapeHtml(t.category)}</span></div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;margin-left:12px;">
          <button onclick="previewCustomTemplate('${t.id}')" class="secondary-btn" style="font-size:11px;padding:4px 10px;">Preview</button>
          <button onclick="deleteCustomTemplate('${t.id}')" class="ghost-btn" style="font-size:11px;color:var(--danger, #ef4444);padding:4px 10px;">Delete</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--danger, #ef4444);">${escapeHtml(err.message)}</div>`;
  }
}

async function previewCustomTemplate(id) {
  try {
    const data = await api('/api/templates');
    const t = (data.templates || []).find(t => t.id === id);
    if (!t) { showToast('Template not found.', 'error'); return; }
    const sampleVars = { customer_name: 'Acme Corp', license_key: 'HRMS2-demo-key-123...', plan: 'Enterprise', expires_at: '2027-01-01', contact_name: 'John Doe' };
    let body = t.body;
    let subject = t.subject;
    for (const [k, v] of Object.entries(sampleVars)) {
      body = body.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
      subject = subject.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    showModal({ title: t.name, message: `<div style="margin-bottom:12px;"><strong>Subject:</strong> ${escapeHtml(subject)}</div><div style="border:1px solid var(--border-light);border-radius:8px;padding:16px;background:var(--bg);font-size:13px;line-height:1.6;">${body}</div>`, isHtml: true });
  } catch (err) { showToast(err.message, 'error'); }
}

window.loadCustomTemplates = loadCustomTemplates;
window.previewCustomTemplate = previewCustomTemplate;
window.submitCreateTemplate = submitCreateTemplate;
window.deleteCustomTemplate = deleteCustomTemplate;

function renderOperatorsPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Access Management</div>
            <h2>Platform Operators</h2>
            <p>Manage vendor console operators and access permissions.</p>
          </div>
          <div class="command-actions">
            <button onclick="createOperator()" class="primary-btn" type="button">New Operator</button>
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div style="padding: 2rem;">
          <section class="section-card">
            <div id="operatorsContainer"></div>
          </section>
        </div>
      </main>
    </div>
  `;
}

function renderPortalPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Customer Communication</div>
            <h2>Outreach & Renewals</h2>
            <p>Track renewal reminders, draft customer emails, and manage onboarding status.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div style="padding: 2rem; display:flex; flex-direction:column; gap:2rem;">

          <!-- Renewal Pipeline -->
          <section class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Renewal Pipeline</div>
                <h3 class="section-title">Expiring Licenses</h3>
              </div>
              <div class="section-actions">
                <button onclick="triggerRenewalCheck()" class="secondary-btn" type="button">Run Renewal Check</button>
              </div>
            </div>
            <div id="renewalPipelineContainer" style="padding:0 20px 20px;">
              <div class="empty-state">Loading renewal data...</div>
            </div>
          </section>

          <!-- Email Composer -->
          <section class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Email Composer</div>
                <h3 class="section-title">Draft Customer Email</h3>
              </div>
            </div>
            <div style="padding:0 20px 20px; display:flex; flex-direction:column; gap:1rem;">
              <div class="form-grid">
                <label class="field">
                  <span class="field-label">Customer</span>
                  <select id="emailCustomerSelect" class="surface-input" onchange="prefillEmailComposer()">
                    <option value="">— Select customer —</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">Template</span>
                  <select id="emailTemplateSelect" class="surface-input" onchange="applyEmailTemplate()">
                    <option value="renewal">Renewal Reminder</option>
                    <option value="welcome">Welcome / Onboarding</option>
                    <option value="poc_followup">POC Follow-up</option>
                    <option value="license_delivered">License Delivered</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
              </div>
              <label class="field">
                <span class="field-label">To</span>
                <input id="emailTo" class="surface-input" type="email" placeholder="customer@company.com">
              </label>
              <label class="field">
                <span class="field-label">Subject</span>
                <input id="emailSubject" class="surface-input" type="text" placeholder="Email subject">
              </label>
              <label class="field">
                <span class="field-label">Message</span>
                <textarea id="emailBody" class="surface-input" rows="8" placeholder="Email body..."></textarea>
              </label>
              <div style="display:flex;gap:8px;">
                <button onclick="copyEmailDraft()" class="secondary-btn" type="button">Copy to Clipboard</button>
                <button onclick="openEmailClient()" class="primary-btn" type="button">Open in Email Client</button>
              </div>
            </div>
          </section>

          <!-- Onboarding Tracker -->
          <section class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Onboarding Tracker</div>
                <h3 class="section-title">Customer Onboarding Status</h3>
              </div>
            </div>
            <div id="onboardingTrackerContainer" style="padding:0 20px 20px;">
              <div class="empty-state">Loading onboarding data...</div>
            </div>
          </section>

        </div>
      </main>
    </div>
  `;
}

function renderSecurityPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Security & Compliance</div>
            <h2>Security Settings</h2>
            <p>Manage security policies, mail service, 2FA, CRL, and compliance features.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div style="padding:28px;display:flex;flex-direction:column;gap:24px;">

          <section class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Security Boundary</div>
                <h3 class="section-title">License-Gen-HRMS Security Model</h3>
              </div>
            </div>
            <div class="section-body">
              <div class="boundary-card">
                <ul id="securityList" class="security-list"></ul>
              </div>
            </div>
          </section>

          <section class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">TWO-FACTOR AUTHENTICATION</div>
                <h3 class="section-title">2FA / TOTP</h3>
              </div>
            </div>
            <div id="totpStatusArea" class="section-body">
              <p style="color:#6b7280;">Loading 2FA status...</p>
            </div>
          </section>

          <section class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">MAIL SERVICE</div>
                <h3 class="section-title">SMTP Configuration</h3>
              </div>
            </div>
            <div id="mailConfigArea" class="section-body">
              <p style="color:#6b7280;">Loading mail configuration...</p>
            </div>
          </section>

          <section class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">CERTIFICATE REVOCATION</div>
                <h3 class="section-title">CRL Management</h3>
              </div>
            </div>
            <div id="securityContainer" class="section-body">
              <p style="color:#6b7280;">Loading CRL settings...</p>
            </div>
          </section>

        </div>
      </main>
    </div>
  `;
}

async function loadTotpStatus() {
  const area = document.getElementById('totpStatusArea');
  if (!area) return;
  try {
    const data = await api('/api/auth/2fa/status');
    if (data.enabled) {
      area.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:40px;height:40px;background:#dcfce7;border-radius:10px;display:flex;align-items:center;justify-content:center;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>
            <div><strong style="color:#166534;">2FA is Enabled</strong><br><span style="font-size:13px;color:#16a34a;">Your account is protected with TOTP authentication.</span></div>
          </div>
          <div style="display:flex;gap:8px;">
            <button onclick="showRegenerateBackupCodes()" class="secondary-btn" style="font-size:13px;padding:8px 16px;">Regenerate Backup Codes</button>
            <button onclick="showDisable2FA()" class="ghost-btn" style="font-size:13px;padding:8px 16px;color:#ef4444;">Disable 2FA</button>
          </div>
        </div>`;
    } else {
      area.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:40px;height:40px;background:#fef3c7;border-radius:10px;display:flex;align-items:center;justify-content:center;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
            <div><strong style="color:#92400e;">2FA is Not Enabled</strong><br><span style="font-size:13px;color:#d97706;">Add an extra layer of security with authenticator app.</span></div>
          </div>
          <button onclick="showTotpSetup()" class="primary-btn" style="font-size:13px;padding:8px 20px;">Enable 2FA</button>
        </div>`;
    }
  } catch (e) {
    area.innerHTML = `<p style="color:#ef4444;">Failed to load 2FA status: ${escapeHtml(e.message)}</p>`;
  }
}

async function loadMailConfig() {
  const area = document.getElementById('mailConfigArea');
  if (!area) return;
  try {
    const cfg = await api('/api/mail/config');
    area.innerHTML = `
      <form id="mailConfigForm" onsubmit="saveMailConfig(event)" style="display:flex;flex-direction:column;gap:16px;">
        <label class="field">
          <span class="field-label">Enable Mail Service</span>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="mailActive" ${cfg.is_active ? 'checked' : ''} style="width:18px;height:18px;">
            <span style="font-size:13px;">Active</span>
          </label>
        </label>
        <div class="form-grid">
          <label class="field">
            <span class="field-label">SMTP Host *</span>
            <input id="mailHost" class="surface-input" type="text" value="${escapeHtml(cfg.smtp_host || '')}" placeholder="smtp.gmail.com" required>
          </label>
          <label class="field">
            <span class="field-label">Port</span>
            <input id="mailPort" class="surface-input" type="number" value="${cfg.smtp_port || 587}">
          </label>
          <label class="field">
            <span class="field-label">SMTP User (Email) *</span>
            <input id="mailUser" class="surface-input" type="email" value="${escapeHtml(cfg.smtp_user || '')}" placeholder="you@gmail.com" required>
          </label>
          <label class="field">
            <span class="field-label">SMTP Password *</span>
            <input id="mailPass" class="surface-input" type="password" value="" placeholder="${cfg.smtp_pass ? '•••••••• (set)' : 'Enter SMTP password'}">
          </label>
          <label class="field">
            <span class="field-label">From Name</span>
            <input id="mailFromName" class="surface-input" type="text" value="${escapeHtml(cfg.smtp_from_name || 'VY Group Vendor Console')}">
          </label>
          <label class="field">
            <span class="field-label">From Email</span>
            <input id="mailFromEmail" class="surface-input" type="email" value="${escapeHtml(cfg.smtp_from_email || '')}" placeholder="noreply@vygroup.com">
          </label>
        </div>
        <label class="field">
          <span class="field-label">TLS/SSL</span>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="mailSecure" ${cfg.smtp_secure ? 'checked' : ''} style="width:18px;height:18px;">
            <span style="font-size:13px;">Use TLS/SSL (port 465)</span>
          </label>
        </label>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button type="submit" class="primary-btn">Save Configuration</button>
          <button type="button" onclick="testMailConnection()" class="secondary-btn">Test Connection</button>
          <button type="button" onclick="sendTestEmail()" class="secondary-btn">Send Test Email</button>
        </div>
      </form>`;
  } catch (e) {
    area.innerHTML = `<p style="color:#ef4444;">Failed to load mail config: ${escapeHtml(e.message)}</p>`;
  }
}

window.saveMailConfig = async function(event) {
  event.preventDefault();
  const pass = document.getElementById('mailPass').value;
  const body = {
    smtp_host: document.getElementById('mailHost').value.trim(),
    smtp_port: parseInt(document.getElementById('mailPort').value) || 587,
    smtp_user: document.getElementById('mailUser').value.trim(),
    smtp_from_name: document.getElementById('mailFromName').value.trim(),
    smtp_from_email: document.getElementById('mailFromEmail').value.trim(),
    smtp_secure: document.getElementById('mailSecure').checked,
    is_active: document.getElementById('mailActive').checked
  };
  if (pass && pass !== '••••••••') body.smtp_pass = pass;
  try {
    await api('/api/mail/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    showToast('Mail configuration saved.', 'success');
    await loadMailConfig();
  } catch (e) { showToast('Failed to save: ' + e.message, 'error'); }
};

window.testMailConnection = async function() {
  try {
    const result = await api('/api/mail/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    showToast(result.connected ? `Connected to ${result.host}:${result.port}` : result.error, result.connected ? 'success' : 'error');
  } catch (e) { showToast('Test failed: ' + e.message, 'error'); }
};

window.sendTestEmail = async function() {
  const to = prompt('Enter email address to send test email:');
  if (!to) return;
  try {
    const result = await api('/api/mail/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }) });
    showToast(result.sent ? 'Test email sent!' : (result.error || 'Failed to send'), result.sent ? 'success' : 'error');
  } catch (e) { showToast('Failed: ' + e.message, 'error'); }
};

window.showDisable2FA = async function() {
  const password = prompt('Enter your password to disable 2FA:');
  if (!password) return;
  try {
    await api('/api/auth/2fa/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    showToast('2FA has been disabled.', 'success');
    await loadTotpStatus();
  } catch (e) { showToast(e.message, 'error'); }
};

window.showRegenerateBackupCodes = async function() {
  const password = prompt('Enter your password to regenerate backup codes:');
  if (!password) return;
  try {
    const result = await api('/api/auth/2fa/regenerate-backup-codes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    const codes = result.backupCodesPlain.join('\n');
    alert('New backup codes (save these - old codes are now invalid):\n\n' + codes);
    showToast('Backup codes regenerated.', 'success');
  } catch (e) { showToast(e.message, 'error'); }
};

function renderVendorConfigurationPage() {
  const configCards = [
    {
      title: 'License Policy',
      eyebrow: 'Commercial issuance',
      icon: 'fa-key',
      rows: [
        ['Plan catalog', `${state.plans.length || 0} active plan definition(s)`],
        ['Binding posture', 'Hardware-bound and unbound license support'],
        ['Renewal model', 'Validity period, expiry warnings, and extension workflow']
      ],
      action: `<button class="primary-btn" type="button" style="width:100%;padding:10px 0;font-size:13px;" onclick="switchToPage('licenses')">Open License Factory</button>`
    },
    {
      title: 'Customer Portal',
      eyebrow: 'Customer communication',
      icon: 'fa-envelope-open-text',
      rows: [
        ['Portal access', 'Customer ID + opaque license key'],
        ['Message templates', 'Trial, renewal, expiry, and delivery templates'],
        ['Renewal queue', `${state.expiringLicenses.length || 0} expiring license(s) loaded`]
      ],
      action: `<button class="primary-btn" type="button" style="width:100%;padding:10px 0;font-size:13px;" onclick="switchToPage('portal')">Open Outreach</button>`
    },
    {
      title: 'CRL Publishing',
      eyebrow: 'Revocation control',
      icon: 'fa-ban',
      rows: [
        ['CRL owner', 'License-Gen-HRMS only'],
        ['Release repo', 'HRMS-Release-Management CRL path'],
        ['Runtime dependency', 'HRMS consumes CRL, but does not edit it']
      ],
      action: `<button class="primary-btn" type="button" style="width:100%;padding:10px 0;font-size:13px;" onclick="switchToPage('security')">Open CRL Controls</button>`
    },
    {
      title: 'Release Channel',
      eyebrow: 'Vendor updates',
      icon: 'fa-cloud-arrow-up',
      rows: [
        ['Update owner', 'Vendor system update workflow'],
        ['Publishing', 'Vendor release service and release manifest'],
        ['Install surface', 'System Update page in this console']
      ],
      action: `<button class="primary-btn" type="button" style="width:100%;padding:10px 0;font-size:13px;" onclick="switchToPage('systemUpdate')">Open System Update</button>`
    },
    {
      title: 'Operators & Audit',
      eyebrow: 'Access boundary',
      icon: 'fa-user-shield',
      rows: [
        ['Operators', 'Vendor console users only'],
        ['Audit trail', 'Issuance, renewal, revocation, and operator events'],
        ['HRMS boundary', 'No HRMS admin settings are edited here']
      ],
      action: `<button class="primary-btn" type="button" style="width:100%;padding:10px 0;font-size:13px;" onclick="switchToPage('operators')">Open Operators</button>`
    },
    {
      title: 'Tool Ownership',
      eyebrow: 'Configuration boundary',
      icon: 'fa-diagram-project',
      rows: [
        ['HRMS', 'Employees, leave, attendance, documents, license activation'],
        ['Webmail', 'Mail providers, DNS, DKIM, mailboxes, queue, templates'],
        ['Vendor', 'Customers, licenses, CRL, vendor release updates']
      ],
      action: `<button class="primary-btn" type="button" style="width:100%;padding:10px 0;font-size:13px;background:#6366f1;opacity:0.7;" onclick="showToast('Configuration boundaries are separated by product surface.', 'info')">Boundary Confirmed</button>`
    }
  ];

  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Dedicated Tool Configuration</div>
            <h2>Vendor Configuration</h2>
            <p>Vendor-side controls stay here: license policy, CRL publishing, release updates, operators, audit, templates, and customer outreach.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div style="padding:2rem;">
          <section class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Configuration Map</div>
                <h3 class="section-title">Vendor-owned settings</h3>
              </div>
            </div>
            <div class="metric-grid" style="margin-top:1rem;">
              ${configCards.map(card => `
                <div class="metric-card" style="align-items:flex-start;min-height:240px;padding:24px;border:1px solid var(--border-light);border-radius:12px;background:var(--bg);transition:border-color 0.2s ease,box-shadow 0.2s ease;cursor:default;" onmouseenter="this.style.borderColor='#6366f1';this.style.boxShadow='0 4px 16px rgba(99,102,241,0.12)'" onmouseleave="this.style.borderColor='';this.style.boxShadow='none'">
                  <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
                    <div style="width:36px;height:36px;border-radius:8px;background:rgba(99,102,241,0.1);display:flex;align-items:center;justify-content:center;font-size:14px;color:#6366f1;"><i class="fa-solid ${card.icon}"></i></div>
                    <div class="section-kicker">${escapeHtml(card.eyebrow)}</div>
                  </div>
                  <h3 class="section-title" style="font-size:18px;margin:6px 0 16px;">${escapeHtml(card.title)}</h3>
                  <div style="display:grid;gap:0;width:100%;font-size:13px;color:var(--text-secondary, #6b7280);">
                    ${card.rows.map(([label, value]) => `
                      <div style="display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid var(--border-light);padding:10px 0;">
                        <span style="opacity:0.7;">${escapeHtml(label)}</span>
                        <strong style="color:var(--text);text-align:right;font-weight:500;">${escapeHtml(value)}</strong>
                      </div>
                    `).join('')}
                  </div>
                  <div style="margin-top:auto;padding-top:18px;width:100%;display:flex;justify-content:flex-end;">${card.action}</div>
                </div>
              `).join('')}
            </div>
          </section>
        </div>
      </main>
    </div>
  `;
}

function renderWorkspace() {
  const operator = state.authStatus.operator || {};
  return `
    <div class="command-shell">
      <aside class="control-rail">
        <div class="rail-brand">
          <div class="brand-mark">VY</div>
          <div>
            <div class="eyebrow">Vendor Control Grid</div>
            <h1>Licensing Nexus</h1>
            <p>Commercial customers, deployment posture, and secure issuance.</p>
          </div>
        </div>

        <div class="operator-card">
          <div class="operator-avatar">${escapeHtml(getOperatorInitials(operator.full_name))}</div>
          <div class="operator-copy">
            <div class="operator-name">${escapeHtml(operator.full_name || 'Platform Operator')}</div>
            <div class="operator-meta">${escapeHtml(operator.email || 'Not signed in')}</div>
            <div class="operator-foot">
              <span class="status-pill active">Online</span>
              <span>Last access ${escapeHtml(formatDateTime(operator.last_login_at))}</span>
            </div>
          </div>
        </div>

        <div class="rail-section-title">Command Map</div>
        <nav class="rail-nav">
          <button class="rail-nav-btn active" data-scroll-target="consoleOverview">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Overview
          </button>
          <button class="rail-nav-btn" data-scroll-target="customerRegistry">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
            Customers
          </button>
          <button class="rail-nav-btn" data-scroll-target="customerProfile">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            Profile
          </button>
          <button class="rail-nav-btn" data-scroll-target="licenseFactory">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Licenses
          </button>
          <button class="rail-nav-btn" data-scroll-target="analyticsSection">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
            Analytics
          </button>
          <button class="rail-nav-btn" data-scroll-target="auditSection">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
            Audit Log
          </button>
          <button class="rail-nav-btn" data-scroll-target="templatesSection">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
            Templates
          </button>
          <button class="rail-nav-btn" data-scroll-target="operatorsSection">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            Operators
          </button>
          <button class="rail-nav-btn" data-scroll-target="portalSection">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
            Portal
          </button>
          <button class="rail-nav-btn" data-scroll-target="securitySection">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
            Security
          </button>
          <button class="rail-nav-btn" onclick="switchToSystemUpdate()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            System Update
          </button>
        </nav>

        <div class="boundary-card">
          <div class="section-kicker">Security Boundary</div>
          <ul id="securityList" class="security-list"></ul>
        </div>
      </aside>

      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Commercial Operations</div>
            <h2>Customer Licensing Command Center</h2>
            <p>Operate the customer book, entitlement posture, and opaque issuance workflow from one vendor-only control desk.</p>
          </div>
          <div class="command-actions">
            <button onclick="toggleAnalytics()" class="secondary-btn" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:6px;vertical-align:middle"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
              Analytics
            </button>
            <button onclick="toggleTools()" class="secondary-btn" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:6px;vertical-align:middle"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
              Tools
            </button>
            <label class="search-surface">
              <span class="search-label">Registry Search</span>
              <input id="customerSearch" class="search-input" type="text" placeholder="Search customer, contact, plan, or status" value="${escapeHtml(state.searchQuery)}">
            </label>
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <section id="consoleOverview" class="hero-panel">
          <div class="hero-copy">
            <div class="section-kicker">Operator Feed</div>
            <h3>Mission-ready commercial console</h3>
            <p>The command desk keeps customer commercial context, deployment readiness, and issued-license evidence visible in one operational view.</p>
            <div class="hero-chip-row">
              <span class="hero-chip">No HRMS Runtime Link</span>
              <span class="hero-chip">Encrypted Delivery Tokens</span>
              <span class="hero-chip">Deployment Manifest Export</span>
            </div>
          </div>
          <div class="hero-stats">
            <div class="hero-stat-card">
              <span class="hero-stat-label">Live Clock</span>
              <strong id="liveClock" class="hero-stat-value">--</strong>
            </div>
            <div class="hero-stat-card">
              <span class="hero-stat-label">Focused Account</span>
              <strong id="heroCustomerValue" class="hero-stat-value">No customer selected</strong>
            </div>
            <div class="hero-stat-card">
              <span class="hero-stat-label">Renewal Signal</span>
              <strong id="heroRenewalValue" class="hero-stat-value">Awaiting selection</strong>
            </div>
          </div>
        </section>

        <section id="metricsGrid" class="metrics-grid"></section>

        <section id="analyticsPanel" class="section-card" style="display:none;"></section>
        <section id="toolsPanel" class="section-card" style="display:none;"></section>

        <section class="console-grid">
          <section id="customerRegistry" class="section-card registry-panel">
            <div class="section-header">
              <div>
                <div class="section-kicker">Commercial Registry</div>
                <h3 class="section-title">Customer Book</h3>
              </div>
              <div class="section-actions">
                <button onclick="generateTrialLicense()" class="primary-btn" type="button" style="background:#10B981;">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:6px;vertical-align:middle"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                  Quick POC/Trial
                </button>
                <button id="newCustomerBtn" class="primary-btn" type="button">New Customer</button>
              </div>
            </div>
            <div id="customerList" class="customer-list"></div>
          </section>

          <div id="consoleStack" class="console-stack locked">
            <div class="workspace-vault-lock" id="vaultLock">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
              <h3>Workspace Locked</h3>
              <p>Select a customer from the registry to securely access their data.</p>
            </div>
            <section class="section-card">
              <div class="section-header">
                <div>
                  <div class="section-kicker">Telemetry</div>
                  <h3 class="section-title">Selected Account Signals</h3>
                </div>
                <div id="accountStagePill" class="soft-badge">No customer selected</div>
              </div>
              <div id="accountSignals" class="signal-grid"></div>
            </section>

            <section id="customerProfile" class="section-card">
              <div class="section-header">
                <div>
                  <div class="section-kicker">Account Profile</div>
                  <h3 id="profileHeading" class="section-title">New Customer</h3>
                </div>
                <div class="section-actions">
                  <button id="saveCustomerBtn" class="primary-btn" type="button">Save Customer</button>
                  <button id="archiveCustomerBtn" class="ghost-btn" type="button">Archive</button>
                  <button id="deleteCustomerBtn" class="ghost-btn" type="button" style="color:#ef4444;border-color:#ef4444;" title="Hard delete — revokes all licenses immediately">Delete</button>
                </div>
              </div>

              <div class="form-grid">
                <label class="field">
                  <span class="field-label">Legal Name</span>
                  <input id="legalName" class="surface-input" type="text" placeholder="VY Group Client Pvt Ltd">
                </label>
                <label class="field">
                  <span class="field-label">Workspace Name</span>
                  <input id="workspaceName" class="surface-input" type="text" placeholder="Client HRMS Workspace">
                </label>
                <label class="field">
                  <span class="field-label">Primary Contact</span>
                  <input id="primaryContact" class="surface-input" type="text" placeholder="Client SPOC Name">
                </label>
                <label class="field">
                  <span class="field-label">Contact Email</span>
                  <input id="contactEmail" class="surface-input" type="email" placeholder="contact@customer.com">
                </label>
                <label class="field">
                  <span class="field-label">Contact Phone</span>
                  <input id="contactPhone" class="surface-input" type="text" placeholder="+91 98xxxxxxx">
                </label>
                <label class="field">
                  <span class="field-label">Billing Contact</span>
                  <input id="billingContact" class="surface-input" type="text" placeholder="Accounts Contact">
                </label>
                <label class="field">
                  <span class="field-label">Billing Email</span>
                  <input id="billingEmail" class="surface-input" type="email" placeholder="billing@customer.com">
                </label>
                <label class="field">
                  <span class="field-label">Status</span>
                  <select id="customerStatus" class="surface-input">
                    <option value="poc">POC / Trial</option>
                    <option value="active">Active</option>
                    <option value="prospect">Prospect</option>
                    <option value="renewal_due">Renewal Due</option>
                    <option value="suspended">Suspended</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">Plan</span>
                  <select id="plan" class="surface-input"></select>
                </label>
                <label class="field">
                  <span class="field-label">Deployment Type</span>
                  <select id="deploymentType" class="surface-input">
                    <option value="on-prem">On-Prem</option>
                    <option value="cloud">Cloud</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">Renewal Date</span>
                  <input id="renewalDate" class="surface-input" type="date">
                </label>
                <label class="field">
                  <span class="field-label">Duration (Days)</span>
                  <input id="durationDays" class="surface-input" type="number" min="1" value="365">
                  <span class="field-hint" style="font-size: 0.75rem; color: var(--text-secondary, #888); margin-top: 0.25rem; display: block;">POC/Trial licenses default to 30 days</span>
                </label>
                <label class="field field-toggle">
                  <span class="field-label">Unbound License</span>
                  <input id="noBind" class="toggle-input" type="checkbox">
                </label>
                <label class="field">
                  <span class="field-label">Hardware ID</span>
                  <input id="hardwareId" class="surface-input" type="text" placeholder="Paste HRMS hardware ID">
                </label>
                <label class="field">
                  <span class="field-label">Max Employees</span>
                  <input id="maxEmployees" class="surface-input" type="number" min="0" placeholder="Plan default">
                </label>
                <label class="field">
                  <span class="field-label">Max Admins</span>
                  <input id="maxAdmins" class="surface-input" type="number" min="0" placeholder="Plan default">
                </label>
                <label class="field">
                  <span class="field-label">Max Departments</span>
                  <input id="maxDepartments" class="surface-input" type="number" min="0" placeholder="Plan default">
                </label>
              </div>

              <label class="field field-full">
                <span class="field-label">Feature Overrides</span>
                <textarea id="featureOverrides" class="surface-input surface-textarea" rows="3" placeholder="Optional comma-separated features. Leave blank to use the plan defaults."></textarea>
              </label>
              <label class="field field-full">
                <span class="field-label">Commercial Notes</span>
                <textarea id="customerNotes" class="surface-input surface-textarea" rows="4" placeholder="Renewal notes, promised modules, deployment comments, and internal handoff notes."></textarea>
              </label>
            </section>

            <section class="section-card">
              <div class="section-header">
                <div>
                  <div class="section-kicker">Entitlement Matrix</div>
                  <h3 id="planHeading" class="section-title">Loading plan...</h3>
                </div>
                <div id="pricingBadge" class="soft-badge">--</div>
              </div>
              <div id="planSummary" class="summary-grid"></div>
            </section>

            <section id="licenseFactory" class="section-card">
              <div class="section-header">
                <div>
                  <div class="section-kicker">License Factory</div>
                  <h3 class="section-title">Encrypted Issuance & Handoff</h3>
                </div>
                <div class="section-actions">
                  <button id="generateBtn" class="primary-btn" type="button">Generate License</button>
                  <button id="copyBtn" class="secondary-btn" type="button">Copy License</button>
                </div>
              </div>
              <div style="padding: 1rem; background: rgba(138, 180, 248, 0.08); border-radius: 8px; margin-bottom: 1.5rem; border-left: 3px solid #5b9cf5;">
                <div style="font-weight: 600; color: #5b9cf5; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                  POC / Trial License Workflow
                </div>
                <div style="font-size: 0.875rem; color: var(--text-secondary); line-height: 1.5;">
                  <strong>For POC/Trial customers:</strong> Select "POC / Trial" plan to automatically set 30-day duration with full enterprise features. After successful evaluation, upgrade customer to production plan and issue new license.
                </div>
              </div>
              <label class="field field-full">
                <span class="field-label">Opaque License Key</span>
                <textarea id="licenseOutput" class="surface-input surface-textarea monospace" rows="6" readonly placeholder="Generated opaque customer license will appear here."></textarea>
              </label>
              <label class="field field-full">
                <span class="field-label">Deployment Manifest</span>
                <textarea id="summaryOutput" class="surface-input surface-textarea monospace" rows="8" readonly placeholder="The customer-linked deployment manifest will appear here."></textarea>
              </label>
              <div class="section-header nested-header">
                <div>
                  <div class="section-kicker">Issuance Ledger</div>
                  <h3 class="section-title">License History</h3>
                </div>
              </div>
              <div id="licenseHistory" class="history-list"></div>
            </section>
          </div>
        </section>

        <section id="analyticsSection" class="section-card">
          <div class="section-header">
            <div>
              <div class="section-kicker">Business Intelligence</div>
              <h3 class="section-title">Analytics & Reports</h3>
            </div>
          </div>
          <div id="fullAnalytics"></div>
        </section>

        <section id="auditSection" class="section-card">
          <div class="section-header">
            <div>
              <div class="section-kicker">Compliance & Security</div>
              <h3 class="section-title">Audit Log</h3>
            </div>
            <button onclick="refreshAuditLog()" class="secondary-btn">Refresh</button>
          </div>
          <div id="auditLogContainer"></div>
        </section>

        <section id="templatesSection" class="section-card">
          <div class="section-header">
            <div>
              <div class="section-kicker">Customer Communication</div>
              <h3 class="section-title">Email Templates</h3>
            </div>
            <button onclick="createTemplate()" class="primary-btn">New Template</button>
          </div>
          <div id="templatesContainer"></div>
        </section>

        <section id="operatorsSection" class="section-card">
          <div class="section-header">
            <div>
              <div class="section-kicker">Team Management</div>
              <h3 class="section-title">Operators & Roles</h3>
            </div>
            <button onclick="createOperator()" class="primary-btn">Add Operator</button>
          </div>
          <div id="operatorsContainer"></div>
        </section>

        <section id="portalSection" class="section-card">
          <div class="section-header">
            <div>
              <div class="section-kicker">Customer Self-Service</div>
              <h3 class="section-title">Customer Portal</h3>
            </div>
            <button onclick="sendRenewalReminders()" class="secondary-btn">Send Renewal Reminders</button>
          </div>
          <div id="customerPortalContainer"></div>
        </section>

        <section id="securitySection" class="section-card">
          <div class="section-header">
            <div>
              <div class="section-kicker">Security & Compliance</div>
              <h3 class="section-title">Security Settings</h3>
            </div>
          </div>
          <div id="securityContainer"></div>
          <div style="margin-top:24px;">
            <h4 style="margin-bottom:16px;">Charts & Analytics</h4>
            <div id="chartsContainer"></div>
          </div>
        </section>
      </main>
    </div>
  `;
}

// ==================== SYSTEM UPDATE DEDICATED PAGE ====================

function renderSystemUpdatePage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">System Management</div>
            <h2>System Update</h2>
            <p>Keep your vendor console up to date with the latest features and fixes.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div class="console-grid" style="max-width:900px;">

          <!-- Current Version Card -->
          <div class="section-card" style="margin-bottom:20px;">
            <div class="section-body" style="display:flex;align-items:center;justify-content:space-between;">
              <div>
                <div class="eyebrow" style="margin-bottom:4px;">Current Version</div>
                <div style="font-size:22px;font-weight:700;color:var(--text);letter-spacing:-.02em;" id="current-version-display">Loading...</div>
              </div>
              <button onclick="checkSystemUpdate()" id="checkUpdateBtn" class="primary-btn" type="button">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"></path><polyline points="21 3 21 9 15 9"></polyline></svg>
                Check for Updates
              </button>
            </div>
          </div>

          <!-- Update Status -->
          <div class="section-card" style="margin-bottom:20px;">
            <div class="section-header">
              <div>
                <div class="section-kicker">Update Status</div>
                <div class="section-title">Vendor Tool Self-Update</div>
              </div>
            </div>
            <div id="update-status" class="section-body" style="text-align:center;padding:40px;">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-placeholder, #d1d5db)" stroke-width="1.5" style="margin:0 auto 12px;"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <div style="color:var(--text-muted);font-size:14px;">Click "Check for Updates" to get started</div>
            </div>
          </div>

          <!-- Install Button (hidden by default) -->
          <div id="update-install-btn" style="display:none;margin-bottom:20px;"></div>

          <!-- Progress (hidden by default) -->
          <div id="update-progress" style="display:none;margin-bottom:20px;"></div>

          <!-- Release Details (hidden by default) -->
          <div id="update-details" style="display:none;margin-bottom:20px;">
            <div class="section-card">
              <div class="section-header">
                <div>
                  <div class="section-kicker">Release Notes</div>
                  <div class="section-title">What's New</div>
                </div>
              </div>
              <div id="update-release-notes" class="section-body" style="font-size:14px;line-height:1.7;color:var(--text-secondary, #6b7280);"></div>
              <div id="update-breaking-warning" style="display:none;padding:0 22px 16px;">
                <div style="background:var(--danger-bg);border:1px solid var(--danger);border-radius:var(--radius-sm);padding:12px 16px;font-size:13px;color:var(--danger, #ef4444);">
                  <strong>Breaking Changes:</strong> This update may require additional configuration. Review release notes carefully before installing.
                </div>
              </div>
            </div>
          </div>

          <!-- Version Info (hidden by default) -->
          <div id="update-version-info" style="display:none;">
            <div class="section-card">
              <div class="section-body" style="display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--text-muted);">
                <span>Auto-checks run every 24 hours</span>
                <button onclick="showReleaseHistory()" class="btn-text" type="button">View Release History</button>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  `;
}

async function loadSystemVersion() {
  const el = document.getElementById('current-version-display');
  if (!el) return;
  el.textContent = VENDOR_TOOL_VERSION || 'Unknown';
  try {
    const data = await api('/api/updates/status');
    if (data && data.current_version) el.textContent = data.current_version;
  } catch (err) { /* already showing fallback */ }
}
window.loadSystemVersion = loadSystemVersion;

// ==================== UPDATE MANAGEMENT PAGE ====================

function renderUpdateManagementPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Update Management</div>
            <h2>Push Updates to Customers</h2>
            <p>Check available HRMS releases, push updates to customers, or hold for specific ones.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div class="console-grid">

          <!-- Available Release -->
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Release Channel</div>
                <div class="section-title">Available HRMS Release</div>
              </div>
              <div class="section-actions">
                <button onclick="checkAvailableRelease()" class="secondary-btn" type="button">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 11-6.219-8.56"></path><polyline points="21 3 21 9 15 9"></polyline></svg>
                  Check GitHub
                </button>
              </div>
            </div>
            <div id="availableReleaseContainer" class="section-body">
              <div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">Click "Check GitHub" to fetch the latest release</div>
            </div>
          </div>

          <!-- Customer Selection & Push Actions -->
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Distribution</div>
                <div class="section-title">Select Customers to Push</div>
              </div>
              <div class="section-actions">
                <button onclick="selectAllCustomers()" class="ghost-btn" type="button">Select All</button>
                <button onclick="deselectAllCustomers()" class="ghost-btn" type="button">Deselect All</button>
              </div>
            </div>
            <div class="section-body">
              <div style="display:flex;gap:10px;margin-bottom:16px;">
                <input id="pushVersionInput" class="surface-input" style="flex:1;" placeholder="Release version (auto-filled from above)">
                <button onclick="pushToSelected()" class="primary-btn" id="pushSelectedBtn" type="button">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg>
                  Push to Selected
                </button>
                <button onclick="holdSelected()" class="secondary-btn" id="holdSelectedBtn" type="button" style="color:var(--warning, #f59e0b);border-color:var(--warning, #f59e0b);">
                  Hold Selected
                </button>
              </div>
              <div id="customerListContainer" style="max-height:400px;overflow-y:auto;">
                <div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">Loading customers...</div>
              </div>
            </div>
          </div>

          <!-- Push to All -->
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Bulk Action</div>
                <div class="section-title">Push to All Customers</div>
              </div>
            </div>
            <div class="section-body">
              <div style="display:flex;align-items:center;justify-content:space-between;">
                <div style="font-size:13px;color:var(--text-secondary, #6b7280);">
                  Push release to all customers. Customers on hold will be skipped.
                </div>
                <button onclick="pushToAllCustomers()" class="primary-btn" id="pushAllBtn" type="button">
                  Push to All
                </button>
              </div>
            </div>
          </div>

          <!-- Distribution History -->
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">History</div>
                <div class="section-title">Distribution History</div>
              </div>
              <div class="section-actions">
                <button onclick="refreshDistributionHistory()" class="secondary-btn" type="button">Refresh</button>
              </div>
            </div>
            <div id="distributionHistoryContainer" class="section-body">
              <div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">Loading...</div>
            </div>
          </div>

        </div>
      </main>
    </div>
  `;
}

let _updateMgmtCustomers = [];
let _updateMgmtSelected = new Set();

function selectAllCustomers() {
  _updateMgmtSelected = new Set(_updateMgmtCustomers.map(c => c.id));
  renderCustomerChecklist();
}

function deselectAllCustomers() {
  _updateMgmtSelected = new Set();
  renderCustomerChecklist();
}

function toggleCustomer(id) {
  if (_updateMgmtSelected.has(id)) _updateMgmtSelected.delete(id);
  else _updateMgmtSelected.add(id);
  renderCustomerChecklist();
}

function renderCustomerChecklist() {
  const container = document.getElementById('customerListContainer');
  if (!container) return;
  if (!_updateMgmtCustomers.length) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">No customers found</div>';
    return;
  }
  const selectedCount = _updateMgmtSelected.size;
  container.innerHTML = `
    <div style="padding:8px 12px;background:var(--bg);border-radius:var(--radius-sm);margin-bottom:8px;font-size:12px;color:var(--text-muted);">
      ${selectedCount} of ${_updateMgmtCustomers.length} customers selected
    </div>
    ${_updateMgmtCustomers.map(c => {
      const checked = _updateMgmtSelected.has(c.id) ? 'checked' : '';
      const statusColor = c.update_status === 'current' ? 'var(--success)' : c.update_status === 'hold' ? 'var(--warning)' : 'var(--text-muted)';
      return `
        <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--border-light);border-radius:var(--radius-sm);margin-bottom:4px;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background='transparent'">
          <input type="checkbox" ${checked} onchange="toggleCustomer('${c.id}')" style="accent-color:var(--primary, #6366f1);">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(c.legal_name)}</div>
            <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(c.contact_email || '')}</div>
          </div>
          <div style="text-align:right;flex-shrink:0;">
            <div style="font-size:11px;color:var(--text-muted);">HRMS ${escapeHtml(c.hrms_version || 'Unset')}</div>
            <div style="font-size:10px;color:${statusColor};font-weight:600;text-transform:uppercase;">${escapeHtml(c.update_status || 'current')}</div>
          </div>
        </label>
      `;
    }).join('')}
  `;
}

async function checkAvailableRelease() {
  const container = document.getElementById('availableReleaseContainer');
  if (!container) return;
  container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);"><span class="btn-spinner" style="display:inline-block;"></span> Checking GitHub...</div>';
  
  try {
    const data = await api('/api/releases/latest');
    const release = data.release;
    if (!release) {
      container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);">No releases published yet. Use "Publish Release" to create one.</div>';
      return;
    }
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <div>
          <div style="font-size:20px;font-weight:700;color:var(--text);">v${escapeHtml(release.version)}</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:2px;">Published ${escapeHtml(release.published_at ? new Date(release.published_at).toLocaleDateString() : 'unknown')}</div>
        </div>
        <button onclick="setPushVersion('${escapeHtml(release.version)}')" class="primary-btn" type="button">Use This Version</button>
      </div>
      ${release.release_notes ? `<div style="margin-top:12px;padding:12px;background:var(--bg);border-radius:var(--radius-sm);font-size:13px;color:var(--text-secondary, #6b7280);line-height:1.6;">${escapeHtml(release.release_notes)}</div>` : ''}
      ${release.breaking_changes ? '<div style="margin-top:8px;padding:8px 12px;background:var(--danger-bg);border:1px solid var(--danger);border-radius:var(--radius-sm);font-size:12px;color:var(--danger, #ef4444);font-weight:600;">Breaking Changes — review before pushing</div>' : ''}
    `;
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--danger, #ef4444);font-size:13px;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function setPushVersion(version) {
  const input = document.getElementById('pushVersionInput');
  if (input) input.value = version;
}

async function pushToSelected() {
  const version = document.getElementById('pushVersionInput')?.value?.trim();
  if (!version) { showToast('Enter a release version first', 'warning'); return; }
  if (!_updateMgmtSelected.size) { showToast('Select at least one customer', 'warning'); return; }
  
  const btn = document.getElementById('pushSelectedBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span> Pushing...'; }
  
  try {
    const result = await api(`/api/distribution/${encodeURIComponent(version)}/push`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_ids: Array.from(_updateMgmtSelected) })
    });
    showToast(`Pushed v${version} to ${result.pushed} customer(s)`, 'success');
    refreshDistributionHistory();
    refreshCustomerListForPush();
  } catch (err) {
    showToast(`Push failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg> Push to Selected'; }
  }
}

async function holdSelected() {
  const version = document.getElementById('pushVersionInput')?.value?.trim();
  if (!version) { showToast('Enter a release version first', 'warning'); return; }
  if (!_updateMgmtSelected.size) { showToast('Select at least one customer', 'warning'); return; }
  
  const reason = prompt('Reason for holding (optional):') || 'Held by operator';
  const btn = document.getElementById('holdSelectedBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span> Holding...'; }
  
  try {
    const result = await api(`/api/distribution/${encodeURIComponent(version)}/hold`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_ids: Array.from(_updateMgmtSelected), reason })
    });
    showToast(`Held v${version} for ${result.held} customer(s)`, 'success');
    refreshDistributionHistory();
    refreshCustomerListForPush();
  } catch (err) {
    showToast(`Hold failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Hold Selected'; }
  }
}

async function pushToAllCustomers() {
  const version = document.getElementById('pushVersionInput')?.value?.trim();
  if (!version) { showToast('Enter a release version first', 'warning'); return; }
  
  if (!confirm(`Push v${version} to ALL customers? Customers on hold will be skipped.`)) return;
  
  const btn = document.getElementById('pushAllBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span> Pushing...'; }
  
  try {
    const result = await api(`/api/distribution/${encodeURIComponent(version)}/push-all`, {
      method: 'POST'
    });
    showToast(`Pushed to ${result.pushed}, skipped ${result.skipped_hold} held`, 'success');
    refreshDistributionHistory();
    refreshCustomerListForPush();
  } catch (err) {
    showToast(`Push all failed: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = 'Push to All'; }
  }
}

async function refreshCustomerListForPush() {
  const container = document.getElementById('customerListContainer');
  if (!container) return;
  try {
    const data = await api('/api/customers');
    _updateMgmtCustomers = data.customers || data || [];
    renderCustomerChecklist();
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--danger, #ef4444);font-size:13px;">Error loading customers: ${escapeHtml(err.message)}</div>`;
  }
}

async function refreshDistributionHistory() {
  const container = document.getElementById('distributionHistoryContainer');
  if (!container) return;
  try {
    const data = await api('/api/distribution');
    const dists = data.distributions || [];
    if (!dists.length) {
      container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">No distributions yet</div>';
      return;
    }
    container.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;">' + dists.map(d => {
      const pushedCount = d.customers.filter(c => c.status === 'pushed').length;
      const holdCount = d.customers.filter(c => c.status === 'hold').length;
      const appliedCount = d.customers.filter(c => c.status === 'applied').length;
      return `
        <div style="padding:12px 16px;background:var(--bg);border:1px solid var(--border-light);border-radius:var(--radius-sm);">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <div style="display:flex;align-items:center;gap:10px;">
              <span style="font-size:15px;font-weight:700;color:var(--text);">v${escapeHtml(d.release_version)}</span>
              ${d.breaking_changes ? '<span class="status-pill red">Breaking</span>' : ''}
            </div>
            <div style="font-size:11px;color:var(--text-muted);">${escapeHtml(d.created_at ? new Date(d.created_at).toLocaleDateString() : '')}</div>
          </div>
          <div style="display:flex;gap:16px;margin-top:8px;font-size:12px;">
            <span style="color:var(--success, #10b981);">${pushedCount} pushed</span>
            <span style="color:var(--warning, #f59e0b);">${holdCount} held</span>
            <span style="color:var(--primary, #6366f1);">${appliedCount} applied</span>
            <span style="color:var(--text-muted);">${d.customers.length} total</span>
          </div>
        </div>
      `;
    }).join('') + '</div>';
  } catch (err) {
    container.innerHTML = `<div style="text-align:center;padding:24px;color:var(--danger, #ef4444);font-size:13px;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ==================== PUBLISH HRMS RELEASE PAGE ====================

function renderPublishReleasePage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Release Distribution</div>
            <h2>Publish HRMS Release</h2>
            <p>Push release manifests to GitHub for HRMS instances to auto-update.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div class="console-grid" style="max-width:900px;">

          <!-- How It Works -->
          <div class="section-card" style="margin-bottom:20px;">
            <div class="section-header">
              <div>
                <div class="section-kicker">How It Works</div>
                <div class="section-title">Release Distribution Flow</div>
              </div>
            </div>
            <div class="section-body">
              <div style="display:flex;gap:16px;flex-wrap:wrap;">
                <div style="flex:1;min-width:200px;background:var(--bg);border-radius:var(--radius);padding:16px;text-align:center;">
                  <div style="font-size:24px;margin-bottom:8px;">1</div>
                  <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;">Create Release</div>
                  <div style="font-size:12px;color:var(--text-muted);">Fill in version, notes, and assets</div>
                </div>
                <div style="flex:1;min-width:200px;background:var(--bg);border-radius:var(--radius);padding:16px;text-align:center;">
                  <div style="font-size:24px;margin-bottom:8px;">2</div>
                  <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;">Sign & Push</div>
                  <div style="font-size:12px;color:var(--text-muted);">HMAC-signed manifest pushed to GitHub</div>
                </div>
                <div style="flex:1;min-width:200px;background:var(--bg);border-radius:var(--radius);padding:16px;text-align:center;">
                  <div style="font-size:24px;margin-bottom:8px;">3</div>
                  <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:4px;">HRMS Auto-Update</div>
                  <div style="font-size:12px;color:var(--text-muted);">HRMS instances fetch and apply update</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Publish Form -->
          <div class="section-card" style="margin-bottom:20px;">
            <div class="section-header">
              <div>
                <div class="section-kicker">New Release</div>
                <div class="section-title">Create Release Manifest</div>
              </div>
            </div>
            <div class="section-body">
              <form id="publishReleaseForm" onsubmit="submitReleasePublish(event)" style="display:flex;flex-direction:column;gap:16px;">
                <div class="form-grid">
                  <label class="field">
                    <span class="field-label">Version *</span>
                    <input name="version" class="surface-input" type="text" placeholder="e.g. 1.2.0" required>
                  </label>
                  <label class="field">
                    <span class="field-label">Min License Version</span>
                    <input name="min_license_version" class="surface-input" type="text" placeholder="e.g. 1.0.0" value="1.0.0">
                  </label>
                </div>
                <label class="field">
                  <span class="field-label">Release Notes *</span>
                  <textarea name="release_notes" class="surface-textarea" placeholder="What changed in this release..." rows="4" required></textarea>
                </label>
                <div class="form-grid">
                  <label class="field">
                    <span class="field-label">Download URL</span>
                    <input name="download_url" class="surface-input" type="url" placeholder="https://github.com/...zip">
                  </label>
                  <label class="field">
                    <span class="field-label">Checksum (SHA-256)</span>
                    <input name="checksum" class="surface-input" type="text" placeholder="sha256:...">
                  </label>
                </div>
                <div class="form-grid">
                  <label class="field">
                    <span class="field-label">Size (MB)</span>
                    <input name="size_mb" class="surface-input" type="number" step="0.1" placeholder="0">
                  </label>
                  <label class="field field-toggle" style="justify-content:flex-end;padding-top:24px;">
                    <input name="breaking_changes" type="checkbox" class="toggle-input">
                    <span class="field-label" style="margin:0;">Breaking Changes</span>
                  </label>
                </div>
                <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:8px;">
                  <button type="button" onclick="document.getElementById('publishReleaseForm').reset()" class="ghost-btn">Clear</button>
                  <button type="submit" class="primary-btn" id="publishReleaseBtn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg>
                    Publish Release
                  </button>
                </div>
              </form>
            </div>
          </div>

          <!-- Publish Result -->
          <div id="publish-result" style="display:none;margin-bottom:20px;"></div>

          <!-- Previous Releases -->
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">History</div>
                <div class="section-title">Published Releases</div>
              </div>
              <div class="section-actions">
                <button onclick="refreshReleaseHistory()" class="secondary-btn" type="button">Refresh</button>
              </div>
            </div>
            <div id="release-history-list" class="section-body">
              <div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">Loading...</div>
            </div>
          </div>

        </div>
      </main>
    </div>
  `;
}

async function submitReleasePublish(event) {
  event.preventDefault();
  const form = event.target;
  const btn = document.getElementById('publishReleaseBtn');
  const resultDiv = document.getElementById('publish-result');
  
  const data = {
    version: form.version.value.trim(),
    release_notes: form.release_notes.value.trim(),
    breaking_changes: form.breaking_changes.checked,
    min_license_version: form.min_license_version.value.trim() || '1.0.0',
    download_url: form.download_url.value.trim(),
    checksum: form.checksum.value.trim(),
    size_mb: parseFloat(form.size_mb.value) || 0
  };

  if (!data.version || !data.release_notes) {
    showToast('Version and release notes are required.', 'warning');
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="btn-spinner"></span> Publishing...'; }
  
  try {
    const result = await api('/api/releases/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div class="section-card" style="border-color:var(--success, #10b981);">
        <div class="section-body">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            <span style="font-size:16px;font-weight:700;color:var(--success, #10b981);">Release Published Successfully</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--text-secondary, #6b7280);">
            <div><strong>Version:</strong> v${escapeHtml(result.version)}</div>
            <div><strong>Commit:</strong> ${result.commit_sha ? result.commit_sha.slice(0,7) : 'N/A'}</div>
            <div><strong>Raw URL:</strong> <a href="${escapeHtml(result.raw_url)}" target="_blank" style="color:var(--primary, #6366f1);text-decoration:underline;">${escapeHtml(result.raw_url)}</a></div>
          </div>
        </div>
      </div>
    `;
    
    form.reset();
    refreshReleaseHistory();
    showToast(`HRMS v${result.version} published to GitHub`, 'success');
  } catch (error) {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = `
      <div class="section-card" style="border-color:var(--danger, #ef4444);">
        <div class="section-body">
          <div style="display:flex;align-items:center;gap:10px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
            <span style="font-size:14px;font-weight:600;color:var(--danger, #ef4444);">${escapeHtml(error.message)}</span>
          </div>
        </div>
      </div>
    `;
    showToast(error.message || 'Publish failed', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2Z"></path></svg> Publish Release'; }
  }
}

async function refreshReleaseHistory() {
  const container = document.getElementById('release-history-list');
  if (!container) return;
  
  try {
    const data = await api('/api/releases');
    const releases = data.releases || [];
    
    if (!releases.length) {
      container.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">No releases published yet</div>';
      return;
    }
    
    container.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px;">' + releases.map(r => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border-light);">
        <div style="display:flex;align-items:center;gap:12px;">
          <span style="font-size:14px;font-weight:700;color:var(--text);">v${escapeHtml(r.version)}</span>
          ${r.breaking_changes ? '<span class="status-pill red">Breaking</span>' : ''}
          <span style="font-size:12px;color:var(--text-muted);">${escapeHtml(r.release_date ? new Date(r.release_date).toLocaleDateString() : '')}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted);max-width:300px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(r.release_notes || '')}</div>
      </div>
    `).join('') + '</div>';
  } catch (error) {
    container.innerHTML = '<div style="text-align:center;padding:24px;color:var(--danger, #ef4444);font-size:13px;">Failed to load releases</div>';
  }
}

// ==================== BACKUP & VENDOR MANAGEMENT PAGE ====================

function renderBackupPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Data Protection</div>
            <h2>Backup & Vendor Management</h2>
            <p>Per-vendor GitHub backup, restore, and vendor lifecycle management.</p>
          </div>
          <div class="command-actions">
            <button onclick="triggerManualBackup()" class="primary-btn" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path></svg>
              Backup Now
            </button>
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>

        <div class="console-grid">

          <!-- Backup Status -->
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">GitHub Backup</div>
                <div class="section-title">Backup Status</div>
              </div>
              <div class="section-actions">
                <button onclick="refreshBackupStatus()" class="secondary-btn" type="button">Refresh</button>
              </div>
            </div>
            <div id="backupStatusContainer" class="section-body">
              <div class="empty-state">Loading backup status...</div>
            </div>
          </div>

          <!-- Vendor Registry -->
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Vendor Lifecycle</div>
                <div class="section-title">Vendor Registry</div>
              </div>
              <div class="section-actions">
                <button onclick="showCreateVendorForm()" class="primary-btn" type="button">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  Add Vendor
                </button>
                <button onclick="refreshVendorList()" class="secondary-btn" type="button">Refresh</button>
              </div>
            </div>
            <div id="vendorListContainer" class="section-body">
              <div class="empty-state">Loading vendors...</div>
            </div>
          </div>

          <!-- Create Vendor Form (hidden by default) -->
          <div id="vendorFormSection" class="section-card" style="display:none;">
            <div class="section-header">
              <div>
                <div class="section-kicker">New Vendor</div>
                <div class="section-title">Create Vendor</div>
              </div>
              <div class="section-actions">
                <button onclick="hideVendorForm()" class="ghost-btn" type="button">Cancel</button>
              </div>
            </div>
            <div class="section-body">
              <form id="vendorCreateForm" onsubmit="submitCreateVendor(event)">
                <div class="form-grid" style="grid-template-columns:1fr 1fr;">
                  <label class="field">
                    <span class="field-label">Vendor Name *</span>
                    <input name="name" class="surface-input" required>
                  </label>
                  <label class="field">
                    <span class="field-label">Email *</span>
                    <input name="email" type="email" class="surface-input" required>
                  </label>
                  <label class="field">
                    <span class="field-label">Company</span>
                    <input name="company" class="surface-input">
                  </label>
                  <label class="field">
                    <span class="field-label">Plan</span>
                    <select name="plan" class="surface-input">
                      <option value="poc">POC</option>
                      <option value="starter">Starter</option>
                      <option value="growth" selected>Growth</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </label>
                  <label class="field">
                    <span class="field-label">Max Employees</span>
                    <input name="max_employees" type="number" value="0" class="surface-input">
                  </label>
                  <label class="field">
                    <span class="field-label">Max Admins</span>
                    <input name="max_admins" type="number" value="0" class="surface-input">
                  </label>
                  <label class="field" style="grid-column:span 2;">
                    <span class="field-label">Notes</span>
                    <textarea name="notes" class="surface-textarea" rows="2"></textarea>
                  </label>
                </div>
                <div style="margin-top:16px;">
                  <button type="submit" class="primary-btn">Create Vendor</button>
                </div>
              </form>
            </div>
          </div>

          <!-- Restore from Backup -->
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Disaster Recovery</div>
                <div class="section-title">Restore from Backup</div>
              </div>
            </div>
            <div class="section-body">
              <div style="display:flex;gap:12px;align-items:flex-end;">
                <label class="field" style="flex:1;margin:0;">
                  <span class="field-label">Vendor ID to Restore</span>
                  <input id="restoreVendorId" class="surface-input" placeholder="e.g. 61b53eed">
                </label>
                <button onclick="triggerRestore()" class="secondary-btn" type="button" style="height:36px;margin-bottom:2px;">Restore</button>
              </div>
              <div id="restoreResult" style="margin-top:12px;"></div>
            </div>
          </div>

          <!-- Change VY-Group Password -->
          <div class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">Master Account</div>
                <div class="section-title">Change VY-Group Password</div>
              </div>
            </div>
            <div class="section-body">
              <form id="masterPasswordForm" onsubmit="submitMasterPasswordChange(event)">
                <div class="form-grid" style="grid-template-columns:1fr 1fr;max-width:600px;">
                  <label class="field">
                    <span class="field-label">Current Password *</span>
                    <input name="currentPassword" type="password" class="surface-input" required>
                  </label>
                  <label class="field">
                    <span class="field-label">New Password *</span>
                    <input name="newPassword" type="password" class="surface-input" required minlength="10">
                  </label>
                </div>
                <div style="margin-top:16px;display:flex;align-items:center;gap:12px;">
                  <button type="submit" class="primary-btn">Change Password</button>
                  <span style="font-size:12px;color:var(--text-muted);">Min 10 chars, uppercase, lowercase, number, special character</span>
                </div>
              </form>
              <div id="masterPasswordResult" style="margin-top:12px;"></div>
            </div>
          </div>

        </div>
      </main>
    </div>
  `;
}

async function refreshBackupStatus() {
  const container = document.getElementById('backupStatusContainer');
  if (!container) return;
  try {
    const status = await api('/api/backup/status');
    const vendors = await api('/api/backup/vendors').catch(() => ({ vendors: [] }));
    const registry = await api('/api/vendors').catch(() => ({ vendors: [] }));

    let html = '<div style="display:grid;gap:12px;">';

    // Backup status entries
    const statusEntries = Object.entries(status.status || {});
    if (statusEntries.length === 0) {
      html += '<div class="empty-state">No backup activity recorded yet. Backups are triggered automatically after data mutations.</div>';
    } else {
      for (const [vid, s] of statusEntries) {
        const success = s.success ? '<span style="color:#10b981;font-weight:600;">✓ OK</span>' : '<span style="color:#ef4444;font-weight:600;">✗ Failed</span>';
        html += `<div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${escapeHtml(vid)}</strong>
            <span style="color:#64748b;margin-left:8px;">v${escapeHtml(s.version || 0)}</span>
            <span style="color:#64748b;margin-left:8px;">${escapeHtml(s.reason || '')}</span>
          </div>
          <div>${success} <span style="color:#94a3b8;font-size:12px;">${escapeHtml(s.timestamp || '')}</span></div>
        </div>`;
      }
    }

    // Backed-up vendors on GitHub
    if (vendors.vendors?.length > 0) {
      html += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0;">';
      html += '<div style="font-size:12px;font-weight:600;color:#64748b;margin-bottom:8px;">Vendors on GitHub:</div>';
      for (const v of vendors.vendors) {
        html += `<div style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:#f1f5f9;border-radius:12px;font-size:13px;margin:2px;">
          <span style="width:6px;height:6px;border-radius:50%;background:#10b981;"></span>
          ${escapeHtml(v.vendor_id)}
        </div>`;
      }
      html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:#ef4444;">Error loading backup status: ${escapeHtml(err.message)}</div>`;
  }
}

async function triggerManualBackup() {
  const operator = state.authStatus.operator || {};
  const vendorId = operator.vendor_id;
  if (!vendorId) {
    showToast('No vendor_id found for current operator.', 'error');
    return;
  }
  try {
    showToast('Starting backup...', 'info');
    const result = await api(`/api/backup/${vendorId}`, { method: 'POST', body: JSON.stringify({ reason: 'manual_ui' }) });
    if (result.success) {
      showToast(`Backup complete (v${result.version}, ${result.elapsed_ms}ms)`, 'success');
    } else if (result.warning) {
      showToast(result.error || 'GitHub backup not configured. Set VENDOR_GITHUB_TOKEN to enable.', 'warning');
    } else {
      showToast(`Backup failed: ${result.error || result.reason}`, 'error');
    }
    refreshBackupStatus();
  } catch (err) {
    showToast(`Backup error: ${err.message}`, 'error');
  }
}

async function refreshVendorList() {
  const container = document.getElementById('vendorListContainer');
  if (!container) return;
  try {
    const { vendors } = await api('/api/vendors');
    if (!vendors.length) {
      container.innerHTML = '<div class="empty-state">No vendors registered. Create your first vendor above.</div>';
      return;
    }
    let html = '<div style="display:grid;gap:8px;">';
    for (const v of vendors) {
      const statusColor = v.status === 'active' ? '#10b981' : v.status === 'suspended' ? '#f59e0b' : '#94a3b8';
      html += `<div style="padding:12px;border:1px solid #e2e8f0;border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong>${escapeHtml(v.name)}</strong>
          <span style="color:#64748b;margin-left:8px;">${escapeHtml(v.email)}</span>
          <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;margin-left:8px;background:${statusColor}20;color:${statusColor};">${escapeHtml(v.status)}</span>
          <span style="color:#94a3b8;margin-left:8px;font-size:12px;">${escapeHtml(v.plan)} | ID: ${escapeHtml(v.vendor_id)}</span>
        </div>
        <div style="display:flex;gap:6px;">
          ${v.status === 'active'
            ? `<button onclick="suspendVendorAction('${v.vendor_id}')" class="ghost-btn" style="font-size:12px;padding:4px 8px;color:#f59e0b;">Suspend</button>`
            : `<button onclick="activateVendorAction('${v.vendor_id}')" class="ghost-btn" style="font-size:12px;padding:4px 8px;color:#10b981;">Activate</button>`}
          <button onclick="deleteVendorAction('${v.vendor_id}', '${escapeHtml(v.name)}')" class="ghost-btn" style="font-size:12px;padding:4px 8px;color:#ef4444;">Delete</button>
        </div>
      </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:#ef4444;">Error: ${escapeHtml(err.message)}</div>`;
  }
}

function showCreateVendorForm() {
  const section = document.getElementById('vendorFormSection');
  if (section) section.style.display = 'block';
}

function hideVendorForm() {
  const section = document.getElementById('vendorFormSection');
  if (section) section.style.display = 'none';
}

async function submitCreateVendor(event) {
  event.preventDefault();
  const form = event.target;
  const data = {
    name: form.name.value,
    email: form.email.value,
    company: form.company.value,
    plan: form.plan.value,
    max_employees: parseInt(form.max_employees.value) || 0,
    max_admins: parseInt(form.max_admins.value) || 0,
    notes: form.notes.value
  };
  try {
    await api('/api/vendors', { method: 'POST', body: JSON.stringify(data) });
    showToast('Vendor created successfully', 'success');
    form.reset();
    hideVendorForm();
    refreshVendorList();
  } catch (err) {
    showToast(`Failed to create vendor: ${err.message}`, 'error');
  }
}

async function suspendVendorAction(vendorId) {
  if (!confirm(`Suspend vendor ${vendorId}?`)) return;
  try {
    await api(`/api/vendors/${vendorId}/suspend`, { method: 'POST' });
    showToast('Vendor suspended', 'success');
    refreshVendorList();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function activateVendorAction(vendorId) {
  try {
    await api(`/api/vendors/${vendorId}/activate`, { method: 'POST' });
    showToast('Vendor activated', 'success');
    refreshVendorList();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function deleteVendorAction(vendorId, name) {
  if (!confirm(`Delete vendor "${name}" (${vendorId})? This will trigger a final backup and remove the vendor permanently.`)) return;
  try {
    await api(`/api/vendors/${vendorId}`, { method: 'DELETE' });
    showToast('Vendor deleted', 'success');
    refreshVendorList();
  } catch (err) {
    showToast(`Error: ${err.message}`, 'error');
  }
}

async function submitMasterPasswordChange(event) {
  event.preventDefault();
  const form = event.target;
  const resultDiv = document.getElementById('masterPasswordResult');
  const operator = state.authStatus.operator || {};

  if (!operator.id) {
    resultDiv.innerHTML = '<div style="padding:12px;border:1px solid #ef4444;border-radius:8px;background:#ef444410;color:#ef4444;">Not authenticated.</div>';
    return;
  }

  const data = {
    currentPassword: form.currentPassword.value,
    newPassword: form.newPassword.value
  };

  if (data.currentPassword === data.newPassword) {
    resultDiv.innerHTML = '<div style="padding:12px;border:1px solid #f59e0b;border-radius:8px;background:#f59e0b10;color:#92400e;">New password must be different from current password.</div>';
    return;
  }

  try {
    await api(`/api/operators/${operator.id}/change-password`, {
      method: 'POST',
      body: JSON.stringify(data)
    });
    resultDiv.innerHTML = '<div style="padding:12px;border:1px solid #10b981;border-radius:8px;background:#10b98110;color:#065f46;">✓ Password changed successfully. Use new password for next login.</div>';
    form.reset();
    showToast('Master password changed.', 'success');
  } catch (err) {
    resultDiv.innerHTML = `<div style="padding:12px;border:1px solid #ef4444;border-radius:8px;background:#ef444410;color:#ef4444;">✗ ${escapeHtml(err.message)}</div>`;
  }
}

async function triggerRestore() {
  const input = document.getElementById('restoreVendorId');
  const resultDiv = document.getElementById('restoreResult');
  if (!input || !input.value.trim()) {
    showToast('Enter a vendor ID to restore', 'error');
    return;
  }
  const vendorId = input.value.trim();
  resultDiv.innerHTML = '<div style="color:#6366f1;font-weight:500;">Restoring...</div>';
  try {
    const result = await api(`/api/restore/${vendorId}`, { method: 'POST', body: JSON.stringify({ merge: true }) });
    resultDiv.innerHTML = `<div style="padding:12px;border:1px solid #10b981;border-radius:8px;background:#10b98110;">
      <strong style="color:#10b981;">✓ Restore complete</strong><br>
      <span style="font-size:13px;color:#64748b;">
        Customers: ${result.restored?.customers || 0} | Operators: ${result.restored?.operators || 0} | CRL entries: ${result.restored?.crl_entries || 0} | Audit: ${result.restored?.audit_entries || 0}
      </span>
    </div>`;
    showToast(`Restored vendor ${vendorId}`, 'success');
    refreshBackupStatus();
    refreshVendorList();
  } catch (err) {
    resultDiv.innerHTML = `<div style="padding:12px;border:1px solid #ef4444;border-radius:8px;background:#ef444410;color:#ef4444;">
      ✗ Restore failed: ${escapeHtml(err.message)}
    </div>`;
  }
}

function renderApp() {
  if (state.view === 'loading') {
    root.innerHTML = renderLoading();
    return;
  }
  if (state.view === 'setup') {
    root.innerHTML = renderAuthShell('setup');
    return;
  }
  if (state.view === 'login') {
    root.innerHTML = renderAuthShell('login');
    return;
  }
  
  // Page-based routing
  switch(state.currentPage) {
    case 'overview':
      root.innerHTML = renderOverviewPage();
      break;
    case 'customers':
      root.innerHTML = renderCustomersPage();
      break;
    case 'profile':
      root.innerHTML = renderProfilePage();
      break;
    case 'licenses':
      root.innerHTML = renderLicensesPage();
      setTimeout(() => renderLicenseRegistry(), 0);
      break;
    case 'analytics':
      root.innerHTML = renderAnalyticsPage();
      setTimeout(() => { loadAnalyticsPage(); }, 100);
      break;
    case 'audit':
      root.innerHTML = renderAuditPage();
      break;
    case 'templates':
      root.innerHTML = renderTemplatesPage();
      setTimeout(() => { renderTemplates(); loadCustomTemplates(); }, 100);
      break;
    case 'operators':
      root.innerHTML = renderOperatorsPage();
      break;
    case 'portal':
      root.innerHTML = renderPortalPage();
      break;
    case 'security':
      root.innerHTML = renderSecurityPage();
      setTimeout(() => { loadTotpStatus(); loadMailConfig(); }, 100);
      break;
    case 'configuration':
      root.innerHTML = renderVendorConfigurationPage();
      break;
    case 'systemUpdate':
      root.innerHTML = renderSystemUpdatePage();
      setTimeout(() => { loadSystemVersion(); }, 100);
      break;
    case 'backup':
      root.innerHTML = renderBackupPage();
      setTimeout(() => { refreshBackupStatus(); refreshVendorList(); }, 100);
      break;
    case 'updateManagement':
      root.innerHTML = renderUpdateManagementPage();
      setTimeout(() => { refreshCustomerListForPush(); refreshDistributionHistory(); }, 100);
      break;
    case 'publishRelease':
      root.innerHTML = renderPublishReleasePage();
      setTimeout(() => { refreshReleaseHistory(); }, 100);
      break;
    case 'activity':
      root.innerHTML = renderActivityFeedPage();
      setTimeout(() => { loadActivityFeed(); }, 100);
      break;
    case 'health':
      root.innerHTML = renderHealthScoresPage();
      setTimeout(() => { loadHealthScores(); }, 100);
      break;
    case 'deployments':
      root.innerHTML = renderDeploymentsPage();
      setTimeout(() => { loadDeploymentStatus(); }, 100);
      break;
    case 'campaigns':
      root.innerHTML = renderCampaignsPage();
      setTimeout(() => { loadCampaigns(); }, 100);
      break;
    case 'reports':
      root.innerHTML = renderReportsPage();
      setTimeout(() => { loadReportSummary(); }, 100);
      break;
    case 'webhooks':
      root.innerHTML = renderWebhooksPage();
      setTimeout(() => { loadWebhooks(); }, 100);
      break;
    case 'selfService':
      root.innerHTML = renderSelfServicePage();
      break;
    default:
      root.innerHTML = renderOverviewPage();
  }
  
  // Bind events after rendering
  setTimeout(() => {
    bindCurrentView();
    renderSecurityNote();
  }, 100);
}

function renderSecurityNote() {
  const container = document.getElementById('securityList');
  if (!container) return;
  container.innerHTML = renderSecurityMarkup();
}

function renderMetrics() {
  const activeCustomers = state.customers.filter(customer => customer.status === 'active').length;
  const prospects = state.customers.filter(customer => customer.status === 'prospect').length;
  const hardwareReady = state.customers.filter(customer => customer.hardware_id).length;
  const boundLicenses = state.customers.reduce((count, customer) => count + ((customer.licenses || []).filter(license => !license.no_bind).length), 0);
  const unboundLicenses = Math.max((state.summary.licenses_issued || 0) - boundLicenses, 0);

  const metrics = [
    ['Customer Book', state.summary.total_customers || 0, `${activeCustomers} active / ${prospects} prospect`],
    ['Renewal Watch', state.summary.renewals_due || 0, 'Contracts inside 30-day renewal horizon'],
    ['Deployment Ready', hardwareReady, `${Math.max((state.summary.total_customers || 0) - hardwareReady, 0)} still need hardware IDs`],
    ['Issuance Trail', state.summary.licenses_issued || 0, `${boundLicenses} bound / ${unboundLicenses} unbound records`]
  ];

  const grid = document.getElementById('metricsGrid');
  if (!grid) return;
  grid.innerHTML = metrics.map(([label, value, note]) => `
    <div class="metric-card">
      <div class="metric-label">${escapeHtml(label)}</div>
      <div class="metric-value">${escapeHtml(value)}</div>
      <div class="metric-note">${escapeHtml(note)}</div>
    </div>
  `).join('');
}

function renderHeroTelemetry() {
  const customer = getSelectedCustomer();
  const customerNode = document.getElementById('heroCustomerValue');
  const renewalNode = document.getElementById('heroRenewalValue');
  if (!customerNode || !renewalNode) return;

  customerNode.textContent = customer?.legal_name || 'None';
  const renewalDays = getDaysUntil(customer?.renewal_date);
  renewalNode.textContent = renewalDays == null
    ? '--'
    : renewalDays < 0
      ? 'Overdue'
      : `${renewalDays}d remaining`;
}

function renderRecentLicensesDash() {
  const el = document.getElementById('recentLicensesDash');
  if (!el) return;

  const allLicenses = [];
  (state.customers || []).forEach(c => {
    (c.licenses || []).forEach(l => {
      allLicenses.push({ ...l, customer_name: c.legal_name, customer_id: c.id });
    });
  });

  const recent = allLicenses
    .filter(l => l.generated_at)
    .sort((a, b) => new Date(b.generated_at) - new Date(a.generated_at))
    .slice(0, 5);

  if (!recent.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px;"><p>No licenses issued yet.</p></div>';
    return;
  }

  el.innerHTML = recent.map(l => {
    const now = Math.floor(Date.now() / 1000);
    let pillStatus, pillLabel;
    if (l.revoked) {
      pillStatus = 'red'; pillLabel = 'Revoked';
    } else if (l.expires_at_ts && l.expires_at_ts < now) {
      pillStatus = 'red'; pillLabel = 'Expired';
    } else {
      pillStatus = 'green'; pillLabel = 'Active';
    }
    const typeLabel = l.no_bind ? 'Unbound' : l.hardware_id ? 'Bound' : 'Standard';
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--panel-border, rgba(0,0,0,.06));">
        <div>
          <strong style="font-weight:600;">${escapeHtml(l.customer_name || 'Unknown')}</strong>
          <div style="font-size:12px;color:var(--text-muted);">Type: ${escapeHtml(typeLabel)} | Key: ${escapeHtml(l.license_key || 'N/A').substring(0, 24)}...</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px;color:var(--text-muted);">${escapeHtml(l.generated_at || '')}</div>
          <span class="status-pill ${pillStatus}">${escapeHtml(pillLabel)}</span>
        </div>
      </div>
    `;
  }).join('');
}

function renderRenewalsDash() {
  const el = document.getElementById('renewalsDash');
  if (!el) return;

  const upcoming = (state.expiringLicenses || [])
    .filter(l => {
      const days = getDaysUntil(l.expiry_date);
      return days != null && days >= 0;
    })
    .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date))
    .slice(0, 5);

  if (!upcoming.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px;"><p>No upcoming renewals.</p></div>';
    return;
  }

  el.innerHTML = upcoming.map(l => {
    const days = getDaysUntil(l.expiry_date);
    const urgency = days <= 7 ? 'red' : days <= 14 ? 'yellow' : 'green';
    const customer = (state.customers || []).find(c => c.id === l.customer_id);
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--panel-border, rgba(0,0,0,.06));">
        <div>
          <strong style="font-weight:600;">${escapeHtml(customer?.legal_name || 'Unknown')}</strong>
          <div style="font-size:12px;color:var(--text-muted);">Expires: ${escapeHtml(l.expiry_date || 'N/A')}</div>
        </div>
        <span class="status-pill ${urgency}">${days}d</span>
      </div>
    `;
  }).join('');
}

function renderPlanOptions() {
  const select = document.getElementById('plan');
  if (!select) return;
  const current = select.value;
  select.innerHTML = state.plans.map(plan => `<option value="${escapeHtml(plan.plan)}">${escapeHtml(plan.label)}</option>`).join('');
  if (current && state.plans.some(plan => plan.plan === current)) {
    select.value = current;
  }
}

function renderCustomerList() {
  const list = document.getElementById('customerList');
  const badge = document.getElementById('customerCountBadge');
  if (!list) return;
  const customers = getFilteredCustomers();
  if (badge) {
    badge.textContent = `${customers.length} account${customers.length === 1 ? '' : 's'}`;
  }

  if (!customers.length) {
    list.innerHTML = `<div class="empty-state">No customer records match the current filter. Create a customer to begin the commercial workflow.</div>`;
    return;
  }

  list.innerHTML = customers.map(customer => {
    const selected = customer.id === state.selectedCustomerId;
    const latest = customer.latest_license;
    const renewalDays = getDaysUntil(customer.renewal_date);
    const status = customer.status || 'active';
    const licenseInfo = latest
      ? `Issued ${formatDateOnly(latest.generated_at)}`
      : 'No license yet';
    const planLabel = formatLabel(customer.plan || '--');
    const deployLabel = formatLabel(customer.deployment_type || 'on-prem');
    return `
      <button class="customer-item ${selected ? 'active' : ''}" data-customer-id="${escapeHtml(customer.id)}" data-status="${escapeHtml(status)}" type="button">
        <div class="customer-item-head">
          <div>
            <div class="customer-title">${escapeHtml(customer.legal_name)}</div>
            <div class="customer-sub">${escapeHtml(customer.workspace_name || 'Workspace pending')}</div>
          </div>
          <span class="status-pill ${escapeHtml(status)}">${escapeHtml(formatLabel(status))}</span>
        </div>
        <div class="customer-meta">
          <span>${escapeHtml(customer.primary_contact || '')}</span>
          ${customer.contact_email ? `<span style="color:#d1d5db;">|</span><span>${escapeHtml(customer.contact_email)}</span>` : ''}
        </div>
        <div class="customer-item-foot">
          <div class="customer-foot-left">
            <span class="status-pill ${escapeHtml(status)}" style="font-size:10px;padding:2px 8px;">${escapeHtml(planLabel)}</span>
            <span style="font-size:11px;color:#9ca3af;">${escapeHtml(deployLabel)}</span>
          </div>
          <div class="customer-foot-right">${escapeHtml(licenseInfo)}</div>
        </div>
      </button>
    `;
  }).join('');

  list.querySelectorAll('[data-customer-id]').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedCustomerId = button.dataset.customerId || '';
      
      // Switch to profile page to show customer details
      switchToPage('profile');
      
      const stack = document.getElementById('consoleStack');
      if (stack) stack.classList.remove('locked');
    });
  });
}

function renderAccountSignals() {
  const customer = getSelectedCustomer();
  const container = document.getElementById('accountSignals');
  const pill = document.getElementById('accountStagePill');
  if (!container || !pill) return;

  if (!customer) {
    pill.textContent = 'No customer selected';
    container.innerHTML = `<div class="empty-state">Select a customer from the registry to inspect renewal, deployment, binding, and issuance signals.</div>`;
    return;
  }

  const renewalDays = getDaysUntil(customer.renewal_date);
  const latestLicense = customer.latest_license;
  const cards = [
    ['Renewal Horizon', renewalDays == null ? 'Unscheduled' : renewalDays < 0 ? 'Expired' : `${renewalDays} days`, renewalDays == null ? 'Set a commercial renewal date to enable contract monitoring.' : renewalDays < 0 ? 'The scheduled renewal date has already passed.' : 'Time remaining before the contract reaches renewal.'],
    ['Deployment Posture', formatLabel(customer.deployment_type || 'on-prem'), customer.hardware_id ? 'Hardware binding reference is available.' : 'Awaiting hardware binding input from the customer.'],
    ['Issuance History', customer.license_count || 0, latestLicense ? `Latest issue ${formatDateTime(latestLicense.generated_at)}.` : 'No license has been issued for this account yet.'],
    ['Binding State', latestLicense ? (latestLicense.no_bind ? 'Unbound' : 'Bound') : (customer.hardware_id ? 'Ready to bind' : 'Awaiting input'), latestLicense?.hardware_id || customer.hardware_id || 'Capture the HRMS hardware ID before issuing a bound token.']
  ];

  pill.textContent = `${formatLabel(customer.status)} / ${formatLabel(customer.plan)}`;
  container.innerHTML = cards.map(([label, value, note]) => `
    <div class="signal-card">
      <div class="signal-label">${escapeHtml(label)}</div>
      <div class="signal-value">${escapeHtml(value)}</div>
      <div class="signal-note">${escapeHtml(note)}</div>
    </div>
  `).join('');
}

function applyPlanDefaults(force = false) {
  const planSelect = document.getElementById('plan');
  const statusSelect = document.getElementById('customerStatus');
  const plan = getPlanDefinition(planSelect?.value);
  if (!plan) return;

  const planHeading = document.getElementById('planHeading');
  const pricingBadge = document.getElementById('pricingBadge');
  if (planHeading) planHeading.textContent = `${plan.label} Entitlement Matrix`;
  if (pricingBadge) pricingBadge.textContent = plan.pricing?.monthly_label || 'Custom pricing';

  const employees = document.getElementById('maxEmployees');
  const admins = document.getElementById('maxAdmins');
  const departments = document.getElementById('maxDepartments');
  const durationDays = document.getElementById('durationDays');
  const renewalDate = document.getElementById('renewalDate');

  // Early return if required elements don't exist
  if (!durationDays || !renewalDate) return;

  // Check if this is a POC/Trial plan (check both plan and status)
  const isPOC = plan.is_trial || 
                planSelect.value === 'poc' || 
                statusSelect?.value === 'poc' ||
                plan.label.toLowerCase().includes('poc') || 
                plan.label.toLowerCase().includes('trial');

  // Handle POC/Trial specific logic
  if (isPOC) {
    // Set duration to 30 days and disable the field
    durationDays.value = 30;
    durationDays.disabled = true;
    durationDays.style.backgroundColor = '#f3f4f6';
    durationDays.style.cursor = 'not-allowed';
    
    // Auto-calculate renewal date as today + 30 days
    const today = new Date();
    const renewalDateValue = new Date(today.getTime() + (30 * 24 * 60 * 60 * 1000));
    const formattedDate = renewalDateValue.toISOString().split('T')[0];
    renewalDate.value = formattedDate;
    renewalDate.disabled = true;
    renewalDate.style.backgroundColor = '#f3f4f6';
    renewalDate.style.cursor = 'not-allowed';
  } else {
    // Enable duration and renewal date for non-POC plans
    durationDays.disabled = false;
    durationDays.style.backgroundColor = '';
    durationDays.style.cursor = '';
    if (!durationDays.value) {
      durationDays.value = 365;
    }
    
    renewalDate.disabled = false;
    renewalDate.style.backgroundColor = '';
    renewalDate.style.cursor = '';
  }

  if (employees && (force || !employees.dataset.touched)) employees.value = plan.limits?.max_employees || '';
  if (admins && (force || !admins.dataset.touched)) admins.value = plan.limits?.max_admins || '';
  if (departments && (force || !departments.dataset.touched)) departments.value = plan.limits?.max_departments || '';

  const planSummary = document.getElementById('planSummary');
  if (planSummary) {
    planSummary.innerHTML = [
      ['Employees', plan.limits?.max_employees || 'Unlimited', plan.tagline],
      ['Admin Seats', plan.limits?.max_admins || 'Unlimited', plan.tagline],
      ['Departments', plan.limits?.max_departments || 'Unlimited', plan.tagline],
      ['Module Pack', Array.isArray(plan.features) ? plan.features.length : 0, Array.isArray(plan.features) ? plan.features.join(', ') : 'Core operations']
    ].map(([label, value, note]) => `
      <div class="summary-card">
        <div class="summary-label">${escapeHtml(label)}</div>
        <div class="summary-value">${escapeHtml(value)}</div>
        <div class="summary-note">${escapeHtml(note)}</div>
      </div>
    `).join('');
  }

  const overrideField = document.getElementById('featureOverrides');
  if (overrideField && !overrideField.value.trim()) {
    overrideField.placeholder = `Plan defaults: ${(plan.features || []).join(', ')}`;
  }
}

function toggleHardwareRequirement() {
  const noBind = document.getElementById('noBind');
  const hardware = document.getElementById('hardwareId');
  if (!noBind || !hardware) return;
  hardware.disabled = noBind.checked;
  if (noBind.checked) hardware.value = '';
}

function clearTouchedState() {
  ['maxEmployees', 'maxAdmins', 'maxDepartments'].forEach(id => {
    const node = document.getElementById(id);
    if (node) delete node.dataset.touched;
  });
}

function buildStoredManifest(customer, license) {
  return {
    manifest_version: '1.0',
    generated_at: license.generated_at || '',
    customer: {
      legal_name: customer.legal_name,
      workspace_name: customer.workspace_name || '',
      primary_contact: customer.primary_contact || '',
      contact_email: customer.contact_email || ''
    },
    commercial: {
      status: customer.status || 'active',
      plan: license.plan_label || formatLabel(license.plan),
      deployment_type: customer.deployment_type || 'on-prem',
      renewal_date: customer.renewal_date || '',
      duration_days: customer.duration_days || ''
    },
    license: {
      expires_at: license.expires_at || '',
      expires_at_unix: license.expires_at_ts || '',
      binding_required: !license.no_bind,
      hardware_id: license.hardware_id || 'unbound',
      max_employees: license.max_employees,
      max_admins: license.max_admins,
      max_departments: license.max_departments,
      features: license.features || []
    },
    security_boundary: state.security || {}
  };
}

function buildIssuedManifest(customer, result) {
  return {
    manifest_version: '1.0',
    generated_at: result.generated_at,
    customer: {
      legal_name: result.payload.customer,
      workspace_name: customer.workspace_name || '',
      primary_contact: customer.primary_contact || '',
      contact_email: customer.contact_email || ''
    },
    commercial: {
      status: customer.status || 'active',
      plan: result.payload.plan_label,
      deployment_type: customer.deployment_type || 'on-prem',
      renewal_date: customer.renewal_date || '',
      duration_days: customer.duration_days || ''
    },
    license: {
      expires_at_unix: result.payload.exp,
      binding_required: !result.payload.no_bind,
      hardware_id: result.payload.hw_id || 'unbound',
      max_employees: result.payload.max_employees,
      max_admins: result.payload.max_admins,
      max_departments: result.payload.max_departments,
      features: result.payload.features || []
    },
    security_boundary: result.security_note || state.security || {}
  };
}

function renderLicenseHistory() {
  const container = document.getElementById('licenseHistory');
  const customer = getSelectedCustomer();
  if (!container) return;

  if (!customer || !Array.isArray(customer.licenses) || !customer.licenses.length) {
    container.innerHTML = `<div class="empty-state">No issued licenses are stored for this customer yet. Save the account and generate the first secure token to begin the ledger.</div>`;
    return;
  }

  container.innerHTML = customer.licenses.map(license => `
    <div class="history-card">
      <div class="history-head">
        <div>
          <div class="history-title">${escapeHtml(license.plan_label || formatLabel(license.plan))}</div>
          <div class="history-meta">Issued ${escapeHtml(formatDateTime(license.generated_at))}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          ${license.revoked ? '<span class="status-pill suspended">REVOKED</span>' : `
            <span class="status-pill ${license.no_bind ? 'prospect' : 'active'}">${license.no_bind ? 'Unbound' : 'Bound'}</span>
            <button onclick="extendLicense('${customer.id}', '${license.issuance_id}')" class="secondary-btn" style="min-height:32px;padding:6px 12px;font-size:12px;">Extend</button>
            <button onclick="revokeLicense('${customer.id}', '${license.issuance_id}')" class="ghost-btn" style="min-height:32px;padding:6px 12px;font-size:12px;color:#EF4444;">Revoke</button>
          `}
        </div>
      </div>
      <div class="history-grid">
        <div><strong>Expiry</strong><span>${escapeHtml(license.expires_at ? formatDateTime(license.expires_at) : '--')}</span></div>
        <div><strong>Hardware</strong><span>${escapeHtml(license.hardware_id || 'unbound')}</span></div>
        <div><strong>Employees</strong><span>${escapeHtml(license.max_employees || 'Unlimited')}</span></div>
        <div><strong>Modules</strong><span>${escapeHtml((license.features || []).length)}</span></div>
        ${license.revoked ? `<div><strong>Revoked</strong><span>${escapeHtml(license.revoked_reason || 'No reason')}</span></div>` : ''}
        ${license.extended ? `<div><strong>Extended</strong><span>+${escapeHtml(license.extension_days)} days</span></div>` : ''}
      </div>
    </div>
  `).join('');
}

function renderIssuedLicense(result) {
  const customer = result.customer || getSelectedCustomer() || {};
  state.lastIssuedLicense = result;
  const licenseOutputEl = document.getElementById('licenseOutput');
  const summaryOutputEl = document.getElementById('summaryOutput');
  if (licenseOutputEl) licenseOutputEl.value = result.license_key || '';
  if (summaryOutputEl) summaryOutputEl.value = JSON.stringify(buildIssuedManifest(customer, result), null, 2);
}

function populateCustomerForm(customer) {
  // Check if we're on the profile page - if not, skip rendering
  if (!document.getElementById('legalName')) return;
  
  const data = customer || {
    legal_name: '',
    workspace_name: '',
    primary_contact: '',
    contact_email: '',
    contact_phone: '',
    billing_contact: '',
    billing_email: '',
    plan: state.plans[0]?.plan || 'growth',
    status: 'active',
    deployment_type: 'on-prem',
    hardware_id: '',
    renewal_date: '',
    duration_days: 365,
    max_employees: '',
    max_admins: '',
    max_departments: '',
    notes: '',
    feature_overrides: []
  };

  const profileHeading = document.getElementById('profileHeading');
  if (profileHeading) profileHeading.textContent = customer ? customer.legal_name : 'New Customer';
  
  document.getElementById('legalName').value = data.legal_name || '';
  document.getElementById('workspaceName').value = data.workspace_name || '';
  document.getElementById('primaryContact').value = data.primary_contact || '';
  document.getElementById('contactEmail').value = data.contact_email || '';
  document.getElementById('contactPhone').value = data.contact_phone || '';
  document.getElementById('billingContact').value = data.billing_contact || '';
  document.getElementById('billingEmail').value = data.billing_email || '';
  document.getElementById('customerStatus').value = data.status || 'active';
  document.getElementById('plan').value = data.plan || state.plans[0]?.plan || 'growth';
  document.getElementById('deploymentType').value = data.deployment_type || 'on-prem';
  // Set duration/renewal only for non-POC plans; applyPlanDefaults will override for POC
  const selectedPlan = getPlanDefinition(data.plan || state.plans[0]?.plan);
  const isDataPOC = selectedPlan?.is_trial || 
                    (data.plan === 'poc') || 
                    (data.status === 'poc') ||
                    selectedPlan?.label?.toLowerCase().includes('poc') ||
                    selectedPlan?.label?.toLowerCase().includes('trial');
  if (!isDataPOC) {
    document.getElementById('renewalDate').value = data.renewal_date || '';
    document.getElementById('durationDays').value = data.duration_days || 365;
  }
  document.getElementById('noBind').checked = !data.hardware_id;
  document.getElementById('hardwareId').value = data.hardware_id || '';
  document.getElementById('maxEmployees').value = data.max_employees || '';
  document.getElementById('maxAdmins').value = data.max_admins || '';
  document.getElementById('maxDepartments').value = data.max_departments || '';
  document.getElementById('featureOverrides').value = Array.isArray(data.feature_overrides) ? data.feature_overrides.join(', ') : '';
  document.getElementById('customerNotes').value = data.notes || '';
  const archiveBtn = document.getElementById('archiveCustomerBtn');
  const deleteBtn = document.getElementById('deleteCustomerBtn');
  if (archiveBtn) archiveBtn.disabled = !customer;
  if (deleteBtn) deleteBtn.disabled = !customer;

  clearTouchedState();
  toggleHardwareRequirement();
  applyPlanDefaults(!customer);
  renderLicenseHistory();
  renderAccountSignals();
  renderHeroTelemetry();

  const licenseOutputEl = document.getElementById('licenseOutput');
  const summaryOutputEl = document.getElementById('summaryOutput');
  if (customer?.latest_license) {
    if (licenseOutputEl) licenseOutputEl.value = customer.latest_license.license_key || '';
    if (summaryOutputEl) summaryOutputEl.value = JSON.stringify(buildStoredManifest(customer, customer.latest_license), null, 2);
  } else {
    if (licenseOutputEl) licenseOutputEl.value = '';
    if (summaryOutputEl) summaryOutputEl.value = '';
  }
}

function getFormPayload() {
  return {
    legal_name: document.getElementById('legalName').value.trim(),
    workspace_name: document.getElementById('workspaceName').value.trim(),
    primary_contact: document.getElementById('primaryContact').value.trim(),
    contact_email: document.getElementById('contactEmail').value.trim(),
    contact_phone: document.getElementById('contactPhone').value.trim(),
    billing_contact: document.getElementById('billingContact').value.trim(),
    billing_email: document.getElementById('billingEmail').value.trim(),
    plan: document.getElementById('plan').value,
    status: document.getElementById('customerStatus').value,
    deployment_type: document.getElementById('deploymentType').value,
    renewal_date: document.getElementById('renewalDate').value,
    duration_days: Number(document.getElementById('durationDays').value || 365),
    hardware_id: document.getElementById('noBind').checked ? '' : document.getElementById('hardwareId').value.trim(),
    max_employees: document.getElementById('maxEmployees').value === '' ? '' : Number(document.getElementById('maxEmployees').value),
    max_admins: document.getElementById('maxAdmins').value === '' ? '' : Number(document.getElementById('maxAdmins').value),
    max_departments: document.getElementById('maxDepartments').value === '' ? '' : Number(document.getElementById('maxDepartments').value),
    feature_overrides: document.getElementById('featureOverrides').value.split(',').map(item => item.trim()).filter(Boolean),
    notes: document.getElementById('customerNotes').value.trim()
  };
}

function buildCustomerManifest() {
  const customer = getSelectedCustomer();
  if (!customer) return null;
  const license = customer.latest_license || null;
  return {
    exported_at: new Date().toISOString(),
    vendor_workspace: state.consoleName,
    customer: {
      id: customer.id,
      legal_name: customer.legal_name,
      workspace_name: customer.workspace_name,
      status: customer.status,
      plan: customer.plan,
      deployment_type: customer.deployment_type,
      renewal_date: customer.renewal_date,
      primary_contact: customer.primary_contact,
      contact_email: customer.contact_email,
      billing_contact: customer.billing_contact,
      billing_email: customer.billing_email,
      hardware_id: customer.hardware_id,
      notes: customer.notes
    },
    latest_license: license ? {
      generated_at: license.generated_at,
      plan: license.plan_label || formatLabel(license.plan),
      expires_at: license.expires_at || '',
      binding_required: !license.no_bind,
      hardware_id: license.hardware_id || 'unbound',
      max_employees: license.max_employees,
      max_admins: license.max_admins,
      max_departments: license.max_departments,
      features: license.features || [],
      license_key: license.license_key || ''
    } : null,
    deployment_manifest: document.getElementById('summaryOutput').value.trim() || '',
    security_boundary: state.security || {}
  };
}

async function refreshDashboard(preferredCustomerId = state.selectedCustomerId) {
  const [dashboard, analytics, expiring] = await Promise.all([
    api('/api/dashboard'),
    api('/api/analytics/dashboard').catch(() => null),
    api('/api/licenses/expiring').catch(() => ({ licenses: [] }))
  ]);
  state.summary = dashboard.summary || state.summary;
  state.customers = Array.isArray(dashboard.customers) ? dashboard.customers : [];
  state.analytics = analytics;
  state.expiringLicenses = expiring.licenses || [];
  if (preferredCustomerId && state.customers.some(customer => customer.id === preferredCustomerId)) {
    state.selectedCustomerId = preferredCustomerId;
  } else {
    state.selectedCustomerId = '';
  }
  
  // Only render page-specific content if those elements exist on current page
  if (document.getElementById('securityList')) renderSecurityNote();
  if (document.getElementById('metricsGrid')) renderMetrics();
  if (document.getElementById('recentLicensesDash')) renderRecentLicensesDash();
  if (document.getElementById('renewalsDash')) renderRenewalsDash();
  if (document.getElementById('plan')) renderPlanOptions();
  if (document.getElementById('customerList')) renderCustomerList();
  if (document.getElementById('legalName')) populateCustomerForm(getSelectedCustomer());
  
  const stack = document.getElementById('consoleStack');
  if (stack) stack.classList.toggle('locked', !state.selectedCustomerId);
}

async function saveCustomer() {
  const payload = getFormPayload();
  if (!payload.legal_name) {
    throw new Error('Customer legal name is required.');
  }
  const customer = getSelectedCustomer();
  const endpoint = customer ? `/api/customers/${customer.id}` : '/api/customers';
  const method = customer ? 'PUT' : 'POST';
  const result = await api(endpoint, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  await refreshDashboard(result.customer.id);
  showToast('Customer record saved.', 'success');
}

async function archiveSelectedCustomer() {
  const customer = getSelectedCustomer();
  if (!customer) return;
  const ok = await showModal({ title: 'Archive Customer', message: `Archive ${customer.legal_name}?`, type: 'confirm', okText: 'Archive' });
  if (!ok) return;
  await api(`/api/customers/${customer.id}/archive`, { method: 'POST' });
  await refreshDashboard(customer.id);
  showToast('Customer archived.', 'success');
}

async function deleteSelectedCustomer() {
  const customer = getSelectedCustomer();
  if (!customer) return;
  const activeLicenses = (customer.licenses || []).filter(l => !l.revoked && l.license_id);
  const warn = activeLicenses.length > 0
    ? `\n\nWARNING: ${activeLicenses.length} active license(s) will be IMMEDIATELY revoked and added to CRL.\nHRMS instances will lose access within 6 hours.`
    : '';
  const ok = await showModal({ title: 'Delete Customer', message: `Permanently delete "${customer.legal_name}"?${warn}\n\nThis cannot be undone.`, type: 'confirm', okText: 'Delete' });
  if (!ok) return;
  const reason = await showModal({ title: 'Reason for Deletion', message: 'Provide a reason for this deletion:', type: 'prompt', inputValue: 'Customer account terminated', okText: 'Delete' });
  if (!reason) return;
  const result = await api(`/api/customers/${customer.id}/delete`, { method: 'DELETE', body: JSON.stringify({ reason }) });
  state.selectedCustomerId = '';
  await refreshDashboard();
  showToast(result.message || `Customer deleted. ${result.licenses_revoked || 0} license(s) revoked.`, 'success');
}

async function generateLicense() {
  let customer = getSelectedCustomer();
  if (!customer) {
    await saveCustomer();
    customer = getSelectedCustomer();
  }
  if (!customer) {
    throw new Error('Save the customer before generating a license.');
  }

  const payload = getFormPayload();
  const result = await api(`/api/customers/${customer.id}/licenses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customer: payload.legal_name,
      plan: payload.plan,
      duration_days: payload.duration_days,
      no_bind: !payload.hardware_id,
      hw_id: payload.hardware_id,
      max_employees: payload.max_employees === '' ? undefined : payload.max_employees,
      max_admins: payload.max_admins === '' ? undefined : payload.max_admins,
      max_departments: payload.max_departments === '' ? undefined : payload.max_departments,
      features: payload.feature_overrides
    })
  });

  renderIssuedLicense(result);
  await refreshDashboard(customer.id);
  showToast('Encrypted customer license generated.', 'success');
}

async function copyLicense() {
  const value = document.getElementById('licenseOutput').value.trim();
  if (!value) {
    showToast('Generate a license first.', 'warning');
    return;
  }
  await navigator.clipboard.writeText(value);
  showToast('License copied to clipboard.', 'success');
}

function downloadManifest() {
  const manifest = buildCustomerManifest();
  if (!manifest) {
    showToast('Select a customer to export the manifest.', 'warning');
    return;
  }
  downloadTextFile(`${toFileStub(manifest.customer.legal_name)}-license-manifest.json`, JSON.stringify(manifest, null, 2), 'application/json;charset=utf-8');
  showToast('Deployment manifest downloaded.', 'success');
}

function startNewCustomer() {
  state.selectedCustomerId = '';
  state.lastIssuedLicense = null;
  
  // Switch to profile page to show the form
  switchToPage('profile');
  
  const stack = document.getElementById('consoleStack');
  if (stack) stack.classList.remove('locked');
}

async function handleSetupSubmit(event) {
  event.preventDefault();
  const full_name = document.getElementById('setupFullName').value.trim();
  const email = document.getElementById('setupEmailStep2')?.value.trim() || document.getElementById('setupEmail')?.value.trim() || window._verifiedEmail;
  const password = document.getElementById('setupPassword').value;
  const confirm = document.getElementById('setupPasswordConfirm').value;
  const smtpConfig = window._verifiedSmtpConfig || {};

  if (!full_name || !email || !password) {
    showToast('Complete all fields.', 'warning');
    return;
  }
  if (password !== confirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }
  if (smtpConfig.smtp_pass && password === smtpConfig.smtp_pass) {
    showToast('Login password must be different from email password.', 'error');
    return;
  }

  const button = event.submitter || document.querySelector('#setupForm .auth-submit');
  if (button) button.disabled = true;
  try {
    const result = await api('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name, email, password,
        smtp_host: smtpConfig.smtp_host,
        smtp_port: smtpConfig.smtp_port,
        smtp_user: smtpConfig.smtp_user,
        smtp_pass: smtpConfig.smtp_pass,
        smtp_from_name: 'VY Group Vendor Console'
      })
    }, { auth: false, handleUnauthorized: false });

    setSessionToken(result.token || '');
    state.authStatus = {
      ...state.authStatus,
      setup_required: false,
      authenticated: true,
      operator: result.operator || null
    };
    state.view = 'workspace';
    renderApp();
    bindCurrentView();
    await refreshDashboard();
    showToast('Vendor operator created. Console unlocked.', 'success');
  } catch (error) {
    showToast(error.message || 'Failed to create vendor operator.', 'error');
  } finally {
    if (button) button.disabled = false;
  }
}

window.sendSetupOtp = async function() {
  const email = document.getElementById('setupEmail').value.trim();
  const smtp_host = document.getElementById('setupSmtpHost').value.trim();
  const smtp_port = document.getElementById('setupSmtpPort').value.trim();
  const smtp_user = document.getElementById('setupSmtpUser').value.trim();
  const smtp_pass = document.getElementById('setupSmtpPass').value;

  if (!email || !smtp_host || !smtp_pass) {
    showToast('Email, SMTP host, and SMTP password are required.', 'warning');
    return;
  }

  const btn = document.getElementById('sendOtpBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  try {
    await api('/api/auth/send-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, smtp_host, smtp_port, smtp_user: smtp_user || email, smtp_pass })
    }, { auth: false, handleUnauthorized: false });

    window._pendingOtpEmail = email;
    window._pendingSmtpConfig = { smtp_host, smtp_port, smtp_user: smtp_user || email, smtp_pass };
    showToast('OTP sent to your email. Check your inbox.', 'success');
    document.getElementById('setupOtp')?.focus();
    if (btn) btn.textContent = 'Resend Code';
  } catch (error) {
    showToast(error.message || 'Failed to send OTP.', 'error');
  } finally {
    if (btn) { btn.disabled = false; }
  }
};

window.verifySetupOtp = async function() {
  const email = window._pendingOtpEmail;
  const code = document.getElementById('setupOtp')?.value.trim();
  if (!email || !code) {
    showToast('Enter the 6-digit code from your email.', 'warning');
    return;
  }

  const btn = document.getElementById('verifyOtpBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying...'; }
  try {
    await api('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    }, { auth: false, handleUnauthorized: false });

    window._verifiedEmail = email;
    window._verifiedSmtpConfig = window._pendingSmtpConfig;
    document.getElementById('setup-step1').style.display = 'none';
    document.getElementById('setup-step2').style.display = 'block';
    document.getElementById('verifiedEmailLabel').textContent = email;
    showToast('Email verified!', 'success');
  } catch (error) {
    showToast(error.message || 'Invalid OTP.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Verify Code'; }
  }
};

window.verifyOtpKeyup = function(e) {
  const btn = document.getElementById('verifyOtpBtn');
  if (btn) btn.disabled = (e.target.value || '').length !== 6;
};

window.skipOtpSetup = function(e) {
  e.preventDefault();
  const emailVal = document.getElementById('setupEmail')?.value.trim() || '';
  window._verifiedEmail = emailVal;
  window._verifiedSmtpConfig = null;
  ['setupEmail','setupSmtpHost','setupSmtpPort','setupSmtpUser','setupSmtpPass','setupOtp'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.removeAttribute('required');
  });
  document.getElementById('setup-step1').style.display = 'none';
  document.getElementById('setup-step2').style.display = 'block';
  document.getElementById('verifiedEmailLabel').textContent = emailVal || 'Not verified';
  document.getElementById('step2Header').textContent = 'Email skipped — configure later in Security settings';
  document.getElementById('step2Header').style.color = '#f59e0b';
  // Show email field in step 2 if not already filled
  if (emailVal) {
    const step2Email = document.getElementById('setupEmailStep2');
    if (step2Email) step2Email.value = emailVal;
  } else {
    document.getElementById('step2EmailField').style.display = 'block';
  }
};

async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const button = event.submitter || document.querySelector('#loginForm .auth-submit');
  setLoading(button, true);
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }, { auth: false, handleUnauthorized: false });

    if (result.requires_2fa) {
      setLoading(button, false);
      show2faChallenge(result.operator_id);
      return;
    }

    setSessionToken(result.token || '');
    state.authStatus = {
      ...state.authStatus,
      authenticated: true,
      operator: result.operator || null
    };
    state.view = 'workspace';
    renderApp();
    bindCurrentView();
    await refreshDashboard();
    showToast('Vendor operator authenticated.', 'success');
  } catch (error) {
    showToast(error.message || 'Failed to sign in.', 'error');
  } finally {
    setLoading(button, false);
  }
}

async function handleLogout() {
  try {
    await api('/api/auth/logout', { method: 'POST' }, { auth: false, handleUnauthorized: false });
  } catch (_) {
    // ignore sign-out response failures
  }
  clearSession('Signed out of vendor console.');
}
window.handleLogout = handleLogout;

function bindAuthEvents() {
  const setupForm = document.getElementById('setupForm');
  const loginForm = document.getElementById('loginForm');
  if (setupForm) setupForm.addEventListener('submit', handleSetupSubmit);
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);
  
  const otpInput = document.getElementById('setupOtp');
  if (otpInput) otpInput.addEventListener('keyup', verifyOtpKeyup);
}

function bindWorkspaceEvents() {
  // Navigation is handled by onclick="switchToPage()" in the template
  // No need to bind navigation buttons here anymore

  // Customer page specific buttons
  const newCustomerBtn = document.getElementById('newCustomerBtn');
  if (newCustomerBtn) newCustomerBtn.addEventListener('click', startNewCustomer);

  const saveCustomerBtn = document.getElementById('saveCustomerBtn');
  if (saveCustomerBtn) {
    saveCustomerBtn.addEventListener('click', async () => {
      setLoading(saveCustomerBtn, true);
      try {
        await saveCustomer();
      } catch (error) {
        showToast(error.message || 'Failed to save customer.', 'error');
      } finally {
        setLoading(saveCustomerBtn, false);
      }
    });
  }

  const archiveCustomerBtn = document.getElementById('archiveCustomerBtn');
  if (archiveCustomerBtn) {
    archiveCustomerBtn.addEventListener('click', async () => {
      setLoading(archiveCustomerBtn, true);
      try {
        await archiveSelectedCustomer();
      } catch (error) {
        showToast(error.message || 'Failed to archive customer.', 'error');
      } finally {
        setLoading(archiveCustomerBtn, false);
      }
    });
  }

  const deleteCustomerBtn = document.getElementById('deleteCustomerBtn');
  if (deleteCustomerBtn) {
    deleteCustomerBtn.addEventListener('click', async () => {
      setLoading(deleteCustomerBtn, true);
      try {
        await deleteSelectedCustomer();
      } catch (error) {
        showToast(error.message || 'Failed to delete customer.', 'error');
      } finally {
        setLoading(deleteCustomerBtn, false);
      }
    });
  }

  const generateBtn = document.getElementById('generateBtn');
  if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
      setLoading(generateBtn, true);
      try {
        await generateLicense();
      } catch (error) {
        showToast(error.message || 'Failed to generate license.', 'error');
      } finally {
        setLoading(generateBtn, false);
      }
    });
  }

  const copyBtn = document.getElementById('copyBtn');
  if (copyBtn) copyBtn.addEventListener('click', copyLicense);

  const customerSearch = document.getElementById('customerSearch');
  if (customerSearch) {
    customerSearch.addEventListener('input', event => {
      state.searchQuery = event.target.value || '';
      renderCustomerList();
    });
  }

  const planSelect = document.getElementById('plan');
  if (planSelect) planSelect.addEventListener('change', () => applyPlanDefaults(false));

  const statusSelect = document.getElementById('customerStatus');
  if (statusSelect) statusSelect.addEventListener('change', () => {
    // If status is POC, also apply POC logic
    if (statusSelect.value === 'poc') {
      applyPlanDefaults(false);
    }
  });

  const noBindCheckbox = document.getElementById('noBind');
  if (noBindCheckbox) noBindCheckbox.addEventListener('change', toggleHardwareRequirement);

  ['maxEmployees', 'maxAdmins', 'maxDepartments'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener('input', event => {
        event.target.dataset.touched = 'true';
      });
    }
  });

  // Render page-specific content based on current page
  switch(state.currentPage) {
    case 'overview':
      startClock();
      break;
    case 'customers':
      renderCustomerList();
      break;
    case 'profile':
      renderPlanOptions();
      populateCustomerForm(getSelectedCustomer());
      break;
    case 'analytics':
      renderFullAnalytics();
      renderCharts();
      break;
    case 'audit':
      refreshAuditLog();
      break;
    case 'licenses':
      renderLicenseRegistry();
      break;
    case 'templates':
      renderTemplates();
      break;
    case 'operators':
      // Use new comprehensive operator management UI
      if (typeof loadOperators === 'function') loadOperators();
      else renderOperators();
      break;
    case 'portal':
      renderCommunicationPage();
      break;
    case 'security':
      renderSecurityNote();
      renderSecuritySettings();
      break;
  }
}

// NEW FEATURES - Analytics, Tools, License Management
async function generateTrialLicense() {
  const customer = getSelectedCustomer();
  if (!customer) {
    showToast('Select a customer first.', 'warning');
    return;
  }
  
  try {
    const result = await api(`/api/customers/${customer.id}/licenses/trial`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    showToast('30-day trial license generated!', 'success');
    await refreshDashboard(customer.id);
    populateCustomerForm(getSelectedCustomer());
    
    const licenseOutputEl2 = document.getElementById('licenseOutput');
    const summaryOutputEl2 = document.getElementById('summaryOutput');
    if (licenseOutputEl2) licenseOutputEl2.value = result.license_key || '';
    if (summaryOutputEl2) summaryOutputEl2.value = JSON.stringify(result.payload, null, 2);
  } catch (error) {
    showToast(error.message || 'Failed to generate trial license.', 'error');
  }
}

async function validateLicense() {
  const licenseKey = await showModal({ title: 'Validate License', message: 'Enter license key to validate:', type: 'prompt', okText: 'Validate' });
  if (!licenseKey) return;
  
  try {
    const result = await api('/api/licenses/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: licenseKey })
    });
    
    if (result.valid) {
      const msg = result.expired 
        ? `License EXPIRED (${result.days_remaining} days ago)` 
        : `License VALID (${result.days_remaining} days remaining)`;
      const expires = new Date(result.payload.exp * 1000).toLocaleString();
      await showModal({ title: 'License Validation', message: `${msg}\n\nCustomer: ${result.payload.customer}\nPlan: ${result.payload.plan_label}\nExpires: ${expires}`, type: 'alert' });
    } else {
      await showModal({ title: 'License Invalid', message: `License INVALID\n\n${result.error}`, type: 'alert' });
    }
  } catch (error) {
    showToast(error.message || 'Validation failed.', 'error');
  }
}

async function generateHardwareId() {
  try {
    const result = await api('/api/tools/generate-hardware-id');
    const hwId = result.hardware_id;
    
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(hwId);
      showToast(`Test Hardware ID copied: ${hwId}`, 'success');
    } else {
      await showModal({ title: 'Hardware ID', message: `Test Hardware ID:\n\n${hwId}`, type: 'alert', okText: 'Copy' });
      try { await navigator.clipboard.writeText(hwId); } catch {}
    }
  } catch (error) {
    showToast(error.message || 'Failed to generate hardware ID.', 'error');
  }
}

async function revokeLicense(customerId, issuanceId) {
  const reason = await showModal({ title: 'Revoke License', message: 'Reason for revocation:', type: 'prompt', inputValue: 'Licence terms violated', okText: 'Revoke' });
  if (!reason) return;
  
  try {
    const result = await api(`/api/customers/${customerId}/licenses/${issuanceId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || 'Revoked by vendor' })
    });
    
    showToast('License revoked successfully.', 'success');

    if (result.kill_switch_key) {
      try { await navigator.clipboard.writeText(result.kill_switch_key); } catch {}
      const msg = [
        'LICENSE REVOKED - KILL SWITCH KEY GENERATED',
        '',
        'To immediately block HRMS access, install this kill switch key:',
        '',
        result.kill_switch_key,
        '',
        'This key is already expired. Installing it on the HRMS server',
        'will immediately block all access (no grace period).'
      ].join('\n');
      await showModal({ title: 'License Revoked', message: msg + '\n\nKill switch key copied to clipboard.', type: 'alert', okText: 'OK' });
    } else {
      await showModal({ title: 'License Revoked', message: 'License revoked in vendor records.\n\nNote: The customer\'s HRMS will continue working until they replace or delete their license.key file.', type: 'alert' });
    }

    await refreshDashboard(customerId);
    populateCustomerForm(getSelectedCustomer());
  } catch (error) {
    showToast(error.message || 'Failed to revoke license.', 'error');
  }
}

async function extendLicense(customerId, issuanceId) {
  const days = await showModal({ title: 'Extend License', message: 'Extend by how many days?', type: 'prompt', inputValue: '30', okText: 'Extend' });
  if (!days) return;
  
  const additionalDays = parseInt(days, 10);
  if (isNaN(additionalDays) || additionalDays <= 0) {
    showToast('Invalid number of days.', 'error');
    return;
  }
  
  try {
    await api(`/api/customers/${customerId}/licenses/${issuanceId}/extend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ additional_days: additionalDays })
    });
    
    showToast(`License extended by ${additionalDays} days.`, 'success');
    await refreshDashboard(customerId);
    populateCustomerForm(getSelectedCustomer());
  } catch (error) {
    showToast(error.message || 'Failed to extend license.', 'error');
  }
}

async function exportCustomersCsv() {
  try {
    const response = await fetch(`${window.location.origin}/api/customers/export`, {
      headers: { Authorization: `Bearer ${state.sessionToken}` }
    });
    
    if (!response.ok) throw new Error('Export failed');
    
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-export-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    
    showToast('Customer registry exported.', 'success');
  } catch (error) {
    showToast(error.message || 'Export failed.', 'error');
  }
}

function toggleAnalytics() {
  state.showAnalytics = !state.showAnalytics;
  renderAnalyticsDashboard();
}

function toggleTools() {
  state.showTools = !state.showTools;
  renderToolsPanel();
}

function renderAnalyticsDashboard() {
  const container = document.getElementById('analyticsPanel');
  if (!container) return;
  
  if (!state.showAnalytics || !state.analytics) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'block';
  const a = state.analytics;
  
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-kicker">Analytics Dashboard</div>
        <h3 class="section-title">Business Intelligence</h3>
      </div>
      <button onclick="toggleAnalytics()" class="ghost-btn">Close</button>
    </div>
    <div class="metrics-grid">
      <div class="metric-card">
        <span class="metric-label">Total Customers</span>
        <strong class="metric-value">${escapeHtml(a.total_customers || 0)}</strong>
        <span class="metric-note">${escapeHtml(a.active_customers || 0)} active</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">POC Customers</span>
        <strong class="metric-value">${escapeHtml(a.poc_customers || 0)}</strong>
        <span class="metric-note">Trial evaluations</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Expiring This Week</span>
        <strong class="metric-value">${escapeHtml(a.expiring_this_week || 0)}</strong>
        <span class="metric-note">Renewal required</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Conversion Rate</span>
        <strong class="metric-value">${escapeHtml(a.conversion_rate || 0)}%</strong>
        <span class="metric-note">POC to Active</span>
      </div>
    </div>
    ${state.expiringLicenses.length > 0 ? `
      <div style="margin-top: 18px;">
        <h4 style="margin-bottom: 12px;">Expiring Licenses (Next 30 Days)</h4>
        <div class="history-list">
          ${state.expiringLicenses.slice(0, 10).map(lic => `
            <div class="history-card">
              <div class="history-head">
                <div class="history-title">${escapeHtml(lic.customer_name)}</div>
                <span class="status-pill ${lic.days_remaining <= 7 ? 'renewal_due' : 'warning'}">${lic.days_remaining}d</span>
              </div>
              <div class="history-meta">${escapeHtml(lic.contact_email)} • ${escapeHtml(lic.plan)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

function renderToolsPanel() {
  const container = document.getElementById('toolsPanel');
  if (!container) return;
  
  if (!state.showTools) {
    container.style.display = 'none';
    return;
  }
  
  container.style.display = 'block';
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-kicker">License Management</div>
        <h3 class="section-title">License Management Tools</h3>
      </div>
      <button onclick="toggleTools()" class="ghost-btn">Close</button>
    </div>
    <div class="form-grid">
      <button onclick="validateLicense()" class="secondary-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:8px;vertical-align:middle"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
        Validate License
      </button>
      <button onclick="generateHardwareId()" class="secondary-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:8px;vertical-align:middle"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
        Generate Test HW ID
      </button>
      <button onclick="exportCustomersCsv()" class="secondary-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:8px;vertical-align:middle"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        Export Customers CSV
      </button>
    </div>
  `;
}

// Make functions globally accessible
window.toggleAnalytics = toggleAnalytics;
window.toggleTools = toggleTools;
window.validateLicense = validateLicense;
window.generateHardwareId = generateHardwareId;
window.exportCustomersCsv = exportCustomersCsv;
window.generateTrialLicense = generateTrialLicense;
window.revokeLicense = revokeLicense;
window.extendLicense = extendLicense;
window.switchToPage = switchToPage;
window.filterLicenseRegistry = filterLicenseRegistry;
window.renderLicenseRegistry = renderLicenseRegistry;
window.quickEmailCustomer = quickEmailCustomer;
window.prefillEmailComposer = prefillEmailComposer;
window.applyEmailTemplate = applyEmailTemplate;
window.copyEmailDraft = copyEmailDraft;
window.openEmailClient = openEmailClient;
window.triggerRenewalCheck = triggerRenewalCheck;

function bindCurrentView() {
  stopClock();
  if (state.view === 'workspace') {
    bindWorkspaceEvents();
    // Page-specific rendering is now handled inside bindWorkspaceEvents()
    // based on state.currentPage
    return;
  }
  bindAuthEvents();
}

async function init() {
  renderApp();
  try {
    await loadPublicContext();
    
    // Determine which view to show based on auth status
    if (state.authStatus.setup_required) {
      // No operators exist - show registration/setup page
      state.view = 'setup';
    } else if (state.authStatus.authenticated) {
      // User is logged in - show workspace with overview page
      state.view = 'workspace';
      state.currentPage = 'overview'; // Set default page
    } else {
      // Operators exist but user not logged in - show login page
      state.view = 'login';
    }
    
    renderApp();
    bindCurrentView();
    
    if (state.view === 'workspace') {
      await refreshDashboard();
    }
  } catch (error) {
    // Backend is unreachable or returned an error
    // Default to login view if operators exist, otherwise setup
    console.error('Vendor backend initialization error:', error);
    
    // Try to determine if this is a connection error vs setup needed
    if (error.message && error.message.includes('setup')) {
      state.view = 'setup';
    } else {
      state.view = 'login';
    }
    
    renderApp();
    bindCurrentView();
    
    const errorMsg = error.message || 'Backend unreachable';
    const helpMsg = 'Ensure the vendor backend is running on port 3005';
    showToast(`${errorMsg}. ${helpMsg}`, 'error');
  }
}

// Wait for DOM to be ready before initializing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}


// ============================================
// PHASE 2-5: MISSING FEATURES IMPLEMENTATION
// ============================================

// Audit Log System
async function refreshAuditLog() {
  const container = document.getElementById('auditLogContainer');
  if (!container) return;

  // Render filter bar + table shell
  container.innerHTML = `
    <div style="padding:20px;">
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;align-items:flex-end;">
        <label class="field" style="flex:1;min-width:180px;">
          <span class="field-label">Event Type</span>
          <select id="auditActionFilter" class="surface-input" onchange="refreshAuditLog()">
            <option value="">All Events</option>
            <option value="login_success">Login Success</option>
            <option value="login_failed">Login Failed</option>
            <option value="login_success_2fa">Login 2FA</option>
            <option value="operator_created">Operator Created</option>
            <option value="operator_deleted">Operator Deleted</option>
            <option value="operator_suspended">Operator Suspended</option>
            <option value="password_reset_requested">Password Reset</option>
            <option value="totp_enabled">2FA Enabled</option>
            <option value="totp_disabled">2FA Disabled</option>
          </select>
        </label>
        <label class="field" style="flex:1;min-width:180px;">
          <span class="field-label">Operator Email</span>
          <input id="auditEmailFilter" class="surface-input" type="text" placeholder="Filter by email" oninput="refreshAuditLog()">
        </label>
        <label class="field" style="min-width:160px;">
          <span class="field-label">From Date</span>
          <input id="auditStartDate" class="surface-input" type="date" onchange="refreshAuditLog()">
        </label>
        <label class="field" style="min-width:160px;">
          <span class="field-label">To Date</span>
          <input id="auditEndDate" class="surface-input" type="date" onchange="refreshAuditLog()">
        </label>
        <button onclick="exportAuditCsv()" class="secondary-btn" style="height:38px;align-self:flex-end;">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:4px;vertical-align:middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          Export CSV
        </button>
      </div>
      <div id="auditTableBody"><div class="empty-state">Loading...</div></div>
    </div>
  `;

  // Build query params from filter inputs
  const params = new URLSearchParams();
  const action = document.getElementById('auditActionFilter')?.value;
  const email = document.getElementById('auditEmailFilter')?.value;
  const startDate = document.getElementById('auditStartDate')?.value;
  const endDate = document.getElementById('auditEndDate')?.value;
  if (action) params.set('action', action);
  if (email) params.set('operator_email', email);
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  params.set('limit', '100');

  try {
    const data = await api(`/api/audit-logs?${params.toString()}`);
    const entries = Array.isArray(data) ? data : (data.entries || []);
    const tableBody = document.getElementById('auditTableBody');
    if (!tableBody) return;

    if (!entries.length) {
      tableBody.innerHTML = '<div class="empty-state">No audit log entries found for the selected filters.</div>';
      return;
    }

    tableBody.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="border-bottom:2px solid #e5e7eb;">
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;">Timestamp</th>
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;">Event</th>
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;">Operator</th>
            <th style="padding:10px 12px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;">Details</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(entry => {
            const isWarning = entry.event_type?.includes('failed') || entry.event_type?.includes('suspended') || entry.event_type?.includes('deleted');
            const eventLabel = formatLabel(entry.event_type || entry.action || 'unknown');
            const pill = `<span class="status-pill ${isWarning ? '' : 'active'}" style="font-size:11px;${isWarning ? 'background:#fef2f2;color:#b91c1c;border-color:#fca5a5;' : ''}">${escapeHtml(eventLabel)}</span>`;
            const detailStr = typeof entry.details === 'object' ? Object.entries(entry.details || {}).map(([k,v]) => `${k}: ${v}`).join(', ') : (entry.details || '');
            return `<tr style="border-bottom:1px solid #f3f4f6;">
              <td style="padding:10px 12px;color:#6b7280;white-space:nowrap;">${escapeHtml(formatDateTime(entry.timestamp))}</td>
              <td style="padding:10px 12px;">${pill}</td>
              <td style="padding:10px 12px;color:#374151;">${escapeHtml(entry.operator_email || entry.operator || '—')}</td>
              <td style="padding:10px 12px;color:#6b7280;font-size:12px;">${escapeHtml(detailStr)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    const tableBody = document.getElementById('auditTableBody');
    if (tableBody) tableBody.innerHTML = `<div class="empty-state" style="color:#ef4444;">Failed to load audit logs: ${escapeHtml(err.message)}</div>`;
  }
}

async function exportAuditCsv() {
  try {
    const resp = await fetch(`${window.location.origin}/api/audit-logs/export`, {
      headers: { Authorization: `Bearer ${state.sessionToken}` }
    });
    if (!resp.ok) throw new Error('Export failed');
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Audit log exported.', 'success');
  } catch (err) {
    showToast('Export failed: ' + err.message, 'error');
  }
}
window.exportAuditCsv = exportAuditCsv;

// Email Templates System
const EMAIL_TEMPLATES = {
  trial: {
    name: 'Trial License Welcome',
    subject: 'Your {{customer_name}} HRMS Trial License',
    body: `Dear {{contact_name}},

Welcome to VY Group HRMS! Your 30-day trial license is ready.

License Key:
{{license_key}}

Installation Instructions:
1. Download HRMS from our portal
2. Install on your server
3. Enter the license key above
4. Configure your organization

Expires: {{expiry_date}}

Need help? Contact support@vygroup.com

Best regards,
VY Group Team`
  },
  renewal: {
    name: 'License Renewal Reminder',
    subject: 'HRMS License Expiring Soon - {{customer_name}}',
    body: `Dear {{contact_name}},

Your HRMS license will expire in {{days_remaining}} days.

Current License: {{plan_name}}
Expiry Date: {{expiry_date}}

To renew:
1. Contact your account manager
2. Review pricing options
3. Receive new license key

Don't let your operations be interrupted!

Contact: sales@vygroup.com

Best regards,
VY Group Team`
  },
  expired: {
    name: 'License Expired Notice',
    subject: 'URGENT: HRMS License Expired - {{customer_name}}',
    body: `Dear {{contact_name}},

Your HRMS license has expired.

Expired: {{expiry_date}}
Grace Period: 7 days remaining

Immediate action required to avoid service disruption.

Contact us immediately: support@vygroup.com
Phone: +91-XXXXXXXXXX

Best regards,
VY Group Team`
  },
  deployment: {
    name: 'Deployment Guide',
    subject: 'HRMS Deployment Guide - {{customer_name}}',
    body: `Dear {{contact_name}},

Your HRMS deployment guide:

License Key: {{license_key}}
Plan: {{plan_name}}
Hardware ID: {{hardware_id}}

Deployment Steps:
1. System Requirements: 4GB RAM, 20GB Storage
2. Install PostgreSQL 14+
3. Download HRMS package
4. Run installation script
5. Configure license key
6. Set up admin account

Configuration:
- Database: PostgreSQL
- Port: 3001 (backend), 8080 (frontend)
- License: Enter during first run

Support: support@vygroup.com

Best regards,
VY Group Team`
  }
};

async function createTemplate() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:560px;">
      <div class="modal-header"><h3 class="modal-title">Create Email Template</h3></div>
      <div class="modal-body">
        <div class="field"><label class="field-label">Template Name</label><input type="text" id="tplName" class="surface-input" placeholder="e.g. Onboarding Welcome"></div>
        <div class="field"><label class="field-label">Subject Line</label><input type="text" id="tplSubject" class="surface-input" placeholder="Welcome to HRMS, {{customer_name}}"></div>
        <div class="field"><label class="field-label">Email Body (HTML supported, use {{variable}} placeholders)</label><textarea id="tplBody" class="surface-textarea" rows="8" placeholder="<h2>Welcome {{customer_name}}</h2><p>Your license key is {{license_key}}...</p>"></textarea></div>
        <div class="field"><label class="field-label">Category</label><select id="tplCategory" class="surface-input"><option value="custom">Custom</option><option value="welcome">Welcome</option><option value="renewal">Renewal</option><option value="trial">Trial</option><option value="alert">Alert</option></select></div>
      </div>
      <div class="modal-footer">
        <button class="ghost-btn" onclick="this.closest('.modal-overlay').remove()">Cancel</button>
        <button class="primary-btn" onclick="submitCreateTemplate();this.closest('.modal-overlay').remove()">Create Template</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function submitCreateTemplate() {
  const name = document.getElementById('tplName')?.value?.trim();
  const subject = document.getElementById('tplSubject')?.value?.trim();
  const body = document.getElementById('tplBody')?.value?.trim();
  const category = document.getElementById('tplCategory')?.value || 'custom';
  if (!name || !subject || !body) { showToast('Name, subject, and body are required.', 'error'); return; }
  try {
    await api('/api/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, subject, body, category }) });
    showToast('Template created.', 'success');
    loadCustomTemplates();
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteCustomTemplate(id) {
  if (!confirm('Delete this template?')) return;
  try {
    await api(`/api/templates/${id}`, { method: 'DELETE' });
    showToast('Template deleted.', 'success');
    renderTemplatesPage();
  } catch (err) { showToast(err.message, 'error'); }
}

function renderTemplates() {
  const container = document.getElementById('templatesContainer');
  if (!container) return;
  
  container.innerHTML = `
    <div class="form-grid">
      ${Object.entries(EMAIL_TEMPLATES).map(([key, template]) => `
        <div class="history-card">
          <div class="history-title">${escapeHtml(template.name)}</div>
          <div class="history-meta" style="margin-top:8px;">${escapeHtml(template.subject)}</div>
          <div style="margin-top:12px;">
            <button onclick="previewTemplate('${key}')" class="secondary-btn" style="width:100%;">Preview</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function previewTemplate(key) {
  const template = EMAIL_TEMPLATES[key];
  if (!template) return;
  
  const customer = getSelectedCustomer();
  let preview = template.body
    .replace(/\{\{customer_name\}\}/g, customer?.legal_name || 'Customer Name')
    .replace(/\{\{contact_name\}\}/g, customer?.primary_contact || 'Contact Name')
    .replace(/\{\{license_key\}\}/g, customer?.latest_license?.license_key || 'HRMS2-XXXX-XXXX-XXXX')
    .replace(/\{\{plan_name\}\}/g, customer?.plan || 'Enterprise')
    .replace(/\{\{expiry_date\}\}/g, customer?.latest_license?.expires_at ? formatDateTime(customer.latest_license.expires_at) : 'N/A')
    .replace(/\{\{days_remaining\}\}/g, '30')
    .replace(/\{\{hardware_id\}\}/g, customer?.hardware_id || 'Not bound');
  
  const subject = escapeHtml(template.subject);
  const body = escapeHtml(preview).replace(/\n/g, '<br>');

  const html = `
    <div style="font-family:inherit; font-size:14px; color:var(--text); line-height:1.7; letter-spacing:0.01em;">
      <div style="
        background:var(--bg);
        border:1px solid var(--border);
        border-radius:var(--radius);
        padding:16px 20px;
        margin-bottom:16px;
      ">
        <span style="font-size:11px; text-transform:uppercase; letter-spacing:0.06em; color:var(--text-secondary, #6b7280); font-weight:600;">Subject</span>
        <div style="margin-top:4px; font-size:15px; font-weight:700; color:var(--text);">${subject}</div>
      </div>
      <div style="
        background:#ffffff;
        border:1px solid var(--border);
        border-radius:var(--radius);
        padding:20px 24px;
        line-height:1.8;
        letter-spacing:0.005em;
        color:var(--text);
        white-space:pre-wrap;
      ">${body}</div>
    </div>`;

  showModal({
    title: template.name,
    message: html,
    type: 'alert',
    okText: 'Close',
    isHtml: true
  }).then(() => {
    navigator.clipboard.writeText(`Subject: ${template.subject}\n\n${preview}`).catch(() => {});
  });
}

// Full Analytics Rendering
function renderFullAnalytics() {
  const container = document.getElementById('fullAnalytics');
  if (!container || !state.analytics) return;
  
  const a = state.analytics;
  container.innerHTML = `
    <div class="metrics-grid">
      <div class="metric-card">
        <span class="metric-label">Total Customers</span>
        <strong class="metric-value">${escapeHtml(a.total_customers || 0)}</strong>
        <span class="metric-note">${escapeHtml(a.active_customers || 0)} active</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">POC Customers</span>
        <strong class="metric-value">${escapeHtml(a.poc_customers || 0)}</strong>
        <span class="metric-note">Trial evaluations</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Expiring This Week</span>
        <strong class="metric-value">${escapeHtml(a.expiring_this_week || 0)}</strong>
        <span class="metric-note">Renewal required</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Conversion Rate</span>
        <strong class="metric-value">${escapeHtml(a.conversion_rate || 0)}%</strong>
        <span class="metric-note">POC to Active</span>
      </div>
    </div>
    ${state.expiringLicenses.length > 0 ? `
      <div style="margin-top:24px;">
        <h4 style="margin-bottom:16px;font-size:18px;">Expiring Licenses (Next 30 Days)</h4>
        <div class="history-list">
          ${state.expiringLicenses.map(lic => `
            <div class="history-card">
              <div class="history-head">
                <div class="history-title">${escapeHtml(lic.customer_name)}</div>
                <span class="status-pill ${lic.days_remaining <= 7 ? 'renewal_due' : 'warning'}">${lic.days_remaining}d</span>
              </div>
              <div class="history-meta">${escapeHtml(lic.contact_email)} • ${escapeHtml(lic.plan)}</div>
              <div style="margin-top:12px;">
                <button onclick="selectCustomerById('${lic.customer_id}')" class="secondary-btn" style="width:100%;">View Customer</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}
  `;
}

function selectCustomerById(customerId) {
  state.selectedCustomerId = customerId;
  
  // Switch to profile page to show the customer details
  switchToPage('profile');
}

// Make functions globally accessible
window.refreshAuditLog = refreshAuditLog;
window.createTemplate = createTemplate;
window.previewTemplate = previewTemplate;
window.selectCustomerById = selectCustomerById;


// ============================================
// PHASE 3-5: ADVANCED FEATURES
// ============================================

// Charts & Visualization
function renderCharts() {
  const container = document.getElementById('chartsContainer');
  if (!container || !state.analytics) return;
  
  const a = state.analytics;
  
  // Simple ASCII charts
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:24px;">
      <div class="history-card">
        <h4 style="margin-bottom:16px;">Customer Distribution</h4>
        <div style="font-family:monospace;font-size:12px;line-height:1.8;">
          Active:   ${'█'.repeat(Math.floor((a.active_customers / a.total_customers) * 20))} ${escapeHtml(a.active_customers)}<br>
          POC:      ${'█'.repeat(Math.floor((a.poc_customers / a.total_customers) * 20))} ${escapeHtml(a.poc_customers)}<br>
          Prospect: ${'█'.repeat(Math.floor(((a.total_customers - a.active_customers - a.poc_customers) / a.total_customers) * 20))} ${escapeHtml(a.total_customers - a.active_customers - a.poc_customers)}
        </div>
      </div>
      <div class="history-card">
        <h4 style="margin-bottom:16px;">License Status</h4>
        <div style="font-family:monospace;font-size:12px;line-height:1.8;">
          Expiring Week:  ${'█'.repeat(Math.min(a.expiring_this_week, 20))} ${escapeHtml(a.expiring_this_week)}<br>
          Expiring Month: ${'█'.repeat(Math.min(a.expiring_this_month, 20))} ${escapeHtml(a.expiring_this_month)}<br>
          Conversion:     ${'█'.repeat(Math.floor(a.conversion_rate / 5))} ${escapeHtml(a.conversion_rate)}%
        </div>
      </div>
    </div>
  `;
}

// Renewal Automation
async function sendRenewalReminders() {
  try {
    const result = await api('/api/renewals/send-reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    showToast(`Sent ${result.reminders_sent} renewal reminders`, 'success');
    return result;
  } catch (error) {
    showToast(error.message || 'Failed to send reminders', 'error');
  }
}

// Multi-Operator Management
async function fetchOperators() {
  try {
    const result = await api('/api/operators');
    return result.operators || [];
  } catch (error) {
    return [];
  }
}

async function createOperator() {
  const fullName = await showModal({ title: 'Create Operator', message: 'Operator Full Name:', type: 'prompt', okText: 'Next' });
  if (!fullName) return;
  
  const email = await showModal({ title: 'Create Operator', message: 'Operator Email:', type: 'prompt', okText: 'Next' });
  if (!email) return;
  
  const password = await showModal({ title: 'Create Operator', message: 'Password (min 10 chars):', type: 'prompt', okText: 'Next' });
  if (!password || password.length < 10) {
    showToast('Password must be at least 10 characters', 'error');
    return;
  }
  
  const role = await showModal({ title: 'Create Operator', message: 'Role (admin/sales/support):', type: 'prompt', inputValue: 'sales', okText: 'Create' });
  
  try {
    await api('/api/operators', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: fullName, email, password, role })
    });
    
    showToast('Operator created successfully', 'success');
    renderOperators();
  } catch (error) {
    showToast(error.message || 'Failed to create operator', 'error');
  }
}

async function renderOperators() {
  const container = document.getElementById('operatorsContainer');
  if (!container) return;
  
  const operators = await loadOperators();
  
  container.innerHTML = operators.length > 0 ? `
    <div class="history-list">
      ${operators.map(op => `
        <div class="history-card">
          <div class="history-head">
            <div class="history-title">${escapeHtml(op.full_name || op.email)}</div>
            <span class="status-pill ${op.role === 'admin' ? 'active' : 'prospect'}">${escapeHtml(op.role || 'operator')}</span>
          </div>
          <div class="history-meta">${escapeHtml(op.email)}</div>
          <div style="margin-top:8px;color:var(--text-muted, #6b7280);font-size:13px;">
            Last login: ${escapeHtml(formatDateTime(op.last_login_at))}
          </div>
        </div>
      `).join('')}
    </div>
  ` : '<div class="empty-state">No operators yet.</div>';
}

// ── License Registry (Licenses page) ─────────────────────────────────────
let _allLicenseRows = [];

async function renderLicenseRegistry() {
  const container = document.getElementById('licenseRegistryContainer');
  if (!container) return;

  try {
    // Use state.customers which is already loaded — avoids a redundant auth'd API call
    const customers = state.customers && state.customers.length > 0
      ? state.customers
      : await api('/api/customers');

    _allLicenseRows = [];
    for (const customer of customers) {
      for (const lic of (customer.licenses || [])) {
        _allLicenseRows.push({ customer, license: lic });
      }
    }

    if (_allLicenseRows.length === 0) {
      container.innerHTML = '<div class="empty-state">No licenses issued yet. Go to a customer profile to generate one.</div>';
      return;
    }

    renderLicenseRows(_allLicenseRows, container);
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:#ef4444;">Failed to load licenses: ${escapeHtml(err.message)}</div>`;
  }
}

function renderLicenseRows(rows, container) {
  container.innerHTML = `
    <div class="history-list" style="margin-top:8px;">
      ${rows.map(({ customer, license: lic }) => `
        <div class="history-card">
          <div class="history-head">
            <div>
              <div class="history-title">${escapeHtml(customer.legal_name)}</div>
              <div class="history-meta">${escapeHtml(lic.plan_label || formatLabel(lic.plan))} &nbsp;·&nbsp; Issued ${escapeHtml(formatDateTime(lic.generated_at))}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              ${lic.revoked
                ? '<span class="status-pill suspended">REVOKED</span>'
                : `
                  <span class="status-pill ${lic.no_bind ? 'prospect' : 'active'}">${lic.no_bind ? 'Unbound' : 'Bound'}</span>
                  <button onclick="switchToPage('customers');setTimeout(()=>selectCustomerById('${customer.id}'),300)" class="secondary-btn" style="min-height:32px;padding:6px 12px;font-size:12px;">Open</button>
                  <button onclick="extendLicense('${customer.id}','${lic.issuance_id}')" class="secondary-btn" style="min-height:32px;padding:6px 12px;font-size:12px;">Extend</button>
                  <button onclick="revokeLicense('${customer.id}','${lic.issuance_id}')" class="ghost-btn" style="min-height:32px;padding:6px 12px;font-size:12px;color:#EF4444;">Revoke</button>
                `
              }
            </div>
          </div>
          <div class="history-grid">
            <div><strong>Expires</strong><span>${escapeHtml(lic.expires_at ? formatDateTime(lic.expires_at) : '--')}</span></div>
            <div><strong>Hardware</strong><span>${escapeHtml(lic.hardware_id || 'Unbound')}</span></div>
            <div><strong>Employees</strong><span>${escapeHtml(String(lic.max_employees || 'Unlimited'))}</span></div>
            <div><strong>Modules</strong><span>${escapeHtml(String((lic.features || []).length))}</span></div>
            ${lic.revoked ? `<div><strong>Revoked</strong><span>${escapeHtml(lic.revoked_reason || 'No reason')}</span></div>` : ''}
            ${lic.extended ? `<div><strong>Extended</strong><span>+${escapeHtml(lic.extension_days)} days</span></div>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function filterLicenseRegistry(query) {
  const container = document.getElementById('licenseRegistryContainer');
  if (!container) return;
  const q = (query || '').toLowerCase().trim();
  const filtered = q
    ? _allLicenseRows.filter(({ customer, license }) =>
        customer.legal_name.toLowerCase().includes(q) ||
        (license.plan_label || license.plan || '').toLowerCase().includes(q) ||
        (license.hardware_id || '').toLowerCase().includes(q)
      )
    : _allLicenseRows;

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">No licenses match your search.</div>';
  } else {
    renderLicenseRows(filtered, container);
  }
}

// ── Customer Communication (Portal page) ─────────────────────────────────

const OUTREACH_TEMPLATES = {
  renewal: {
    subject: 'Your HRMS License is Expiring Soon',
    body: `Dear {contact_name},

This is a reminder that your HRMS {plan} license is due for renewal on {renewal_date}.

To ensure uninterrupted access, please get in touch with us to process your renewal.

License Details:
- Plan: {plan}
- Renewal Date: {renewal_date}
- Workspace: {workspace_name}

Please reply to this email or contact us at support@vygroup.com to proceed.

Best regards,
VY Group Support Team`
  },
  welcome: {
    subject: 'Welcome to HRMS — Your Deployment Package',
    body: `Dear {contact_name},

Welcome to HRMS! We're excited to have {legal_name} on board.

Your license has been generated and your deployment package is ready. Please find the details below.

Getting Started:
1. Download and install HRMS on your server
2. Place the license.key file in the backend directory
3. Start the backend with: npm start
4. Access HRMS at: http://your-server:8080

Workspace: {workspace_name}
Plan: {plan}
Support: support@vygroup.com

Best regards,
VY Group Team`
  },
  poc_followup: {
    subject: 'How is your HRMS POC going?',
    body: `Dear {contact_name},

We hope your 30-day HRMS proof of concept is going well!

We wanted to check in and see if you have any questions or need assistance with the evaluation.

Your POC Details:
- Workspace: {workspace_name}
- Expires: {renewal_date}

If you're ready to move forward with a full license, we'd love to discuss the right plan for {legal_name}.

Feel free to reply to this email or schedule a call with our team.

Best regards,
VY Group Sales Team`
  },
  license_delivered: {
    subject: 'Your HRMS License Key — Action Required',
    body: `Dear {contact_name},

Your HRMS license has been generated and is ready for activation.

Installation Steps:
1. Copy the license key provided separately
2. In your HRMS backend directory, create a file named: license.key
3. Paste the license key into that file
4. Restart the HRMS backend: npm start
5. Go to Settings → License to verify activation

Workspace: {workspace_name}
Plan: {plan}

If you need any assistance, please contact support@vygroup.com

Best regards,
VY Group Team`
  },
  custom: {
    subject: '',
    body: ''
  }
};

async function renderCommunicationPage() {
  // Populate renewal pipeline
  await renderRenewalPipeline();
  // Populate customer dropdown
  await populateEmailCustomerSelect();
  // Populate onboarding tracker
  await renderOnboardingTracker();
}

async function renderRenewalPipeline() {
  const container = document.getElementById('renewalPipelineContainer');
  if (!container) return;

  try {
    const customers = state.customers && state.customers.length > 0
      ? state.customers
      : await api('/api/customers');

    const now = Date.now();
    const rows = [];

    for (const c of customers) {
      if (!c.licenses || c.licenses.length === 0) continue;
      if (c.status === 'archived') continue;
      const lic = c.licenses.find(l => !l.revoked);
      if (!lic) continue;
      const expiresMs = lic.expires_at_ts ? lic.expires_at_ts * 1000 : new Date(lic.expires_at || 0).getTime();
      const daysLeft = Math.ceil((expiresMs - now) / (24 * 60 * 60 * 1000));
      rows.push({ customer: c, license: lic, daysLeft });
    }

    rows.sort((a, b) => a.daysLeft - b.daysLeft);

    if (rows.length === 0) {
      container.innerHTML = '<div class="empty-state">No active licenses to track.</div>';
      return;
    }

    container.innerHTML = `
      <div class="history-list" style="margin-top:8px;">
        ${rows.map(({ customer: c, license: lic, daysLeft }) => {
          const urgency = daysLeft <= 7 ? 'suspended' : daysLeft <= 30 ? 'prospect' : 'active';
          const urgencyLabel = daysLeft <= 0 ? 'EXPIRED' : daysLeft <= 7 ? 'CRITICAL' : daysLeft <= 30 ? 'EXPIRING SOON' : 'OK';
          return `
            <div class="history-card">
              <div class="history-head">
                <div>
                  <div class="history-title">${escapeHtml(c.legal_name)}</div>
                  <div class="history-meta">${escapeHtml(lic.plan_label || formatLabel(lic.plan))} &nbsp;·&nbsp; ${escapeHtml(c.contact_email || 'No email')}</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;">
                  <span class="status-pill ${urgency}">${urgencyLabel}</span>
                  <span style="font-size:13px;font-weight:600;color:var(--text-muted, #6b7280);">${daysLeft > 0 ? daysLeft + ' days left' : 'Expired'}</span>
                  <button onclick="quickEmailCustomer('${c.id}')" class="secondary-btn" style="min-height:32px;padding:6px 12px;font-size:12px;">Draft Email</button>
                </div>
              </div>
              <div class="history-grid">
                <div><strong>Renewal Date</strong><span>${escapeHtml(c.renewal_date || formatDateTime(lic.expires_at) || '--')}</span></div>
                <div><strong>Plan</strong><span>${escapeHtml(lic.plan_label || formatLabel(lic.plan))}</span></div>
                <div><strong>Contact</strong><span>${escapeHtml(c.primary_contact || '--')}</span></div>
                <div><strong>Workspace</strong><span>${escapeHtml(c.workspace_name || '--')}</span></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:#ef4444;">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

async function populateEmailCustomerSelect() {
  const select = document.getElementById('emailCustomerSelect');
  if (!select) return;
  try {
    const customers = state.customers && state.customers.length > 0
      ? state.customers
      : await api('/api/customers');
    select.innerHTML = '<option value="">— Select customer —</option>' +
      customers.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.legal_name)} (${escapeHtml(c.contact_email || 'no email')})</option>`).join('');
  } catch (_) {}
}

function prefillEmailComposer() {
  const customerId = document.getElementById('emailCustomerSelect')?.value;
  if (!customerId) return;
  const customer = state.customers.find(c => c.id === customerId);
  if (!customer) return;
  const toField = document.getElementById('emailTo');
  if (toField) toField.value = customer.contact_email || '';
  applyEmailTemplate();
}

function applyEmailTemplate() {
  const templateKey = document.getElementById('emailTemplateSelect')?.value || 'renewal';
  const customerId = document.getElementById('emailCustomerSelect')?.value;
  const customer = customerId ? state.customers.find(c => c.id === customerId) : null;
  const tpl = OUTREACH_TEMPLATES[templateKey] || OUTREACH_TEMPLATES.custom;

  const replacements = {
    '{contact_name}': customer?.primary_contact || customer?.legal_name || 'Team',
    '{legal_name}': customer?.legal_name || 'Your Organization',
    '{workspace_name}': customer?.workspace_name || 'your-workspace',
    '{plan}': customer?.plan ? formatLabel(customer.plan) : 'HRMS',
    '{renewal_date}': customer?.renewal_date || 'your renewal date'
  };

  let subject = tpl.subject;
  let body = tpl.body;
  for (const [key, val] of Object.entries(replacements)) {
    subject = subject.replaceAll(key, val);
    body = body.replaceAll(key, val);
  }

  const subjectField = document.getElementById('emailSubject');
  const bodyField = document.getElementById('emailBody');
  if (subjectField && tpl.subject) subjectField.value = subject;
  if (bodyField && tpl.body) bodyField.value = body;
}

function quickEmailCustomer(customerId) {
  const select = document.getElementById('emailCustomerSelect');
  if (select) {
    select.value = customerId;
    prefillEmailComposer();
    // Scroll to email composer
    document.getElementById('emailTo')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function copyEmailDraft() {
  const subject = document.getElementById('emailSubject')?.value || '';
  const body = document.getElementById('emailBody')?.value || '';
  const full = `Subject: ${subject}\n\n${body}`;
  navigator.clipboard.writeText(full).then(() => showToast('Email draft copied to clipboard.', 'success'));
}

function openEmailClient() {
  const to = document.getElementById('emailTo')?.value || '';
  const subject = encodeURIComponent(document.getElementById('emailSubject')?.value || '');
  const body = encodeURIComponent(document.getElementById('emailBody')?.value || '');
  window.open(`mailto:${encodeURIComponent(to)}?subject=${subject}&body=${body}`, '_blank');
}

async function renderOnboardingTracker() {
  const container = document.getElementById('onboardingTrackerContainer');
  if (!container) return;

  try {
    const customers = state.customers && state.customers.length > 0
      ? state.customers
      : await api('/api/customers');
    const stages = {
      prospect:  { label: 'Prospect',    color: '#6b7280', customers: [] },
      poc:       { label: 'POC / Trial', color: '#f59e0b', customers: [] },
      active:    { label: 'Active',      color: '#10b981', customers: [] },
      inactive:  { label: 'Inactive',    color: '#ef4444', customers: [] },
      archived:  { label: 'Archived',    color: '#9ca3af', customers: [] }
    };

    for (const c of customers) {
      const stage = stages[c.status] || stages.prospect;
      stage.customers.push(c);
    }

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-top:8px;">
        ${Object.values(stages).map(stage => `
          <div class="history-card" style="border-top:3px solid ${stage.color};">
            <div style="font-weight:600;font-size:14px;margin-bottom:8px;">${escapeHtml(stage.label)}</div>
            <div style="font-size:2rem;font-weight:700;color:${stage.color};">${stage.customers.length}</div>
            <div style="margin-top:8px;font-size:12px;color:var(--text-muted, #6b7280);">
              ${stage.customers.slice(0, 3).map(c => `<div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(c.legal_name)}</div>`).join('')}
              ${stage.customers.length > 3 ? `<div>+${stage.customers.length - 3} more</div>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:#ef4444;">Failed to load: ${escapeHtml(err.message)}</div>`;
  }
}

async function triggerRenewalCheck() {
  try {
    showToast('Running renewal check...', 'info');
    const result = await api('/api/renewals/check', { method: 'POST' });
    showToast(`Renewal check complete. Sent: ${result.sent || 0}, Skipped: ${result.skipped || 0}`, 'success');
    await renderRenewalPipeline();
  } catch (err) {
    showToast(err.message || 'Renewal check failed.', 'error');
  }
}

// Security Features
function renderSecuritySettings() {
  const container = document.getElementById('securityContainer');
  if (!container) return;
  
  container.innerHTML = `
    <div class="section-header">
      <div>
        <div class="section-kicker">Security Features</div>
        <h3 class="section-title">Platform Security Controls</h3>
      </div>
    </div>
    <div class="section-body">
      <div class="form-grid">
        <div class="history-card">
          <h4 style="margin-bottom:12px;">Session Management</h4>
          <p style="color:var(--text-muted, #6b7280);font-size:13px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> Session timeout: 30 minutes<br>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> Auto-logout on inactivity<br>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> Secure token storage
          </p>
        </div>
        <div class="history-card">
          <h4 style="margin-bottom:12px;">Rate Limiting</h4>
          <p style="color:var(--text-muted, #6b7280);font-size:13px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> 100 requests per minute<br>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> IP-based tracking<br>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> Automatic cleanup
          </p>
        </div>
        <div class="history-card">
          <h4 style="margin-bottom:12px;">Data Protection</h4>
          <p style="color:var(--text-muted, #6b7280);font-size:13px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> AES-256-GCM encryption<br>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> Secure password hashing<br>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> GDPR compliance ready
          </p>
        </div>
        <div class="history-card">
          <h4 style="margin-bottom:12px;">Audit Trail</h4>
          <p style="color:var(--text-muted, #6b7280);font-size:13px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> All actions logged<br>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> Operator tracking<br>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;color:#10b981;"><polyline points="20 6 9 17 4 12"></polyline></svg> Timestamp records
          </p>
        </div>
      </div>
    </div>

    <section class="section-card" style="margin-top:20px;">
      <div class="section-header">
        <div>
          <div class="section-kicker">Certificate Revocation List</div>
          <h3 class="section-title">CRL Management</h3>
        </div>
        <div class="section-actions">
          <button onclick="loadCRLStatus()" class="secondary-btn">Refresh</button>
          <button onclick="publishCRL()" class="primary-btn" id="publishCRLBtn">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Publish CRL to GitHub
          </button>
        </div>
      </div>
      <div class="section-body">
        <div id="crlStatusPanel" style="margin-bottom:20px;">
          <div class="empty-state">Loading CRL status...</div>
        </div>
        <div id="crlEntriesPanel"></div>
      </div>
    </section>
  `;

  // Load CRL status immediately
  loadCRLStatus();
}

async function loadCRLStatus() {
  const statusPanel  = document.getElementById('crlStatusPanel');
  const entriesPanel = document.getElementById('crlEntriesPanel');
  if (!statusPanel) return;

  try {
    const crl = await api('/api/crl');
    const cfg = crl.github || {};

    // Config status banner
    statusPanel.innerHTML = cfg.configured ? `
      <div style="background:var(--green-light,#d1fae5);border:1px solid #6ee7b7;border-radius:10px;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
        <div>
          <div style="font-weight:700;color:#065f46;margin-bottom:4px;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg> GitHub Publishing Configured</div>
          <div style="font-size:13px;color:#047857;">
            Repo: <strong>${escapeHtml(cfg.owner)}/${escapeHtml(cfg.repo)}</strong> &nbsp;|&nbsp;
            Branch: <strong>${escapeHtml(cfg.branch)}</strong> &nbsp;|&nbsp;
            Path: <strong>${escapeHtml(cfg.path)}</strong>
          </div>
          ${cfg.raw_url ? `<div style="font-size:12px;margin-top:6px;color:#065f46;">
            HRMS CRL URL: <code style="background:rgba(0,0,0,.06);padding:2px 6px;border-radius:4px;">${escapeHtml(cfg.raw_url)}</code>
            <button onclick="navigator.clipboard.writeText('${escapeHtml(cfg.raw_url)}').then(()=>showToast('URL copied','success'))" style="margin-left:8px;background:none;border:none;cursor:pointer;color:#059669;font-size:12px;font-weight:600;">Copy</button>
          </div>` : ''}
        </div>
        <div style="font-size:12px;color:#047857;">
          CRL v${crl.version || 1} &nbsp;|&nbsp; ${crl.entries?.length || 0} revoked
        </div>
      </div>
    ` : `
      <div style="background:var(--amber-light,#fef3c7);border:1px solid #fcd34d;border-radius:10px;padding:16px 20px;">
        <div style="font-weight:700;color:#92400e;margin-bottom:8px;"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px;"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg> GitHub Token Not Set</div>
        <div style="font-size:13px;color:#78350f;line-height:1.7;">
          Repo is already configured: <strong>VY-Groups/HRMS-Release-Management</strong><br><br>
          You just need to add a GitHub Personal Access Token:<br><br>
          <strong>Step 1:</strong> Go to <a href="https://github.com/settings/tokens" target="_blank" style="color:#92400e;">github.com/settings/tokens</a> → Generate new token (classic)<br>
          <strong>Step 2:</strong> Select scope: <code>repo</code> (full control of private repositories)<br>
          <strong>Step 3:</strong> Add to <code>vendor-license-tool/backend/.env</code>:<br><br>
          <code style="background:rgba(0,0,0,.06);padding:8px 12px;border-radius:6px;display:block;font-size:12px;">
            CRL_GITHUB_TOKEN=ghp_your_token_here
          </code><br>
          <strong>Step 4:</strong> Restart the License-Gen-HRMS server<br><br>
          Then set in HRMS <code>backend/.env</code>:<br>
          <code style="background:rgba(0,0,0,.06);padding:8px 12px;border-radius:6px;display:block;font-size:12px;margin-top:6px;">
            HRMS_CRL_URL=https://raw.githubusercontent.com/VY-Groups/HRMS-Release-Management/main/crl/revoked.json
          </code>
        </div>
      </div>
    `;

    // Revoked entries table
    if (!entriesPanel) return;
    const entries = crl.entries || [];
    entriesPanel.innerHTML = entries.length > 0 ? `
      <h4 style="margin-bottom:14px;font-size:16px;">Revoked Licenses (${entries.length})</h4>
      <div class="history-list">
        ${entries.map(e => `
          <div class="history-card" style="border-left-color:#ef4444;">
            <div class="history-head">
              <div>
                <div class="history-title">${escapeHtml(e.customer)} — ${escapeHtml(e.plan)}</div>
                <div class="history-meta">ID: <code>${escapeHtml(e.license_id)}</code></div>
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <span class="status-pill suspended">REVOKED</span>
                <button onclick="removeCRLEntry('${escapeHtml(e.license_id)}')" class="ghost-btn" style="font-size:12px;padding:6px 12px;color:#ef4444;">Remove</button>
              </div>
            </div>
            <div class="history-grid">
              <div><strong>Reason</strong><span>${escapeHtml(e.reason)}</span></div>
              <div><strong>Revoked At</strong><span>${escapeHtml(formatDateTime(e.revoked_at))}</span></div>
              <div><strong>Revoked By</strong><span>${escapeHtml(e.revoked_by || 'vendor')}</span></div>
            </div>
          </div>
        `).join('')}
      </div>
    ` : `<div class="empty-state">No revoked licenses in CRL. When you revoke a license, it is automatically added here.</div>`;

  } catch (error) {
    statusPanel.innerHTML = `<div class="empty-state" style="color:#ef4444;">Failed to load CRL: ${escapeHtml(error.message)}</div>`;
  }
}

async function publishCRL() {
  const btn = document.getElementById('publishCRLBtn');
  setLoading(btn, true);
  try {
    const result = await api('/api/crl/publish', { method: 'POST' });
    showToast(`CRL v${result.version} published — ${result.entries} revoked license(s)`, 'success');
    if (result.commit_url) {
      setTimeout(async () => {
        const ok = await showModal({ title: 'CRL Published', message: `CRL v${result.version} published — ${result.entries} revoked license(s).\n\nCommit: ${result.commit_url}\n\nOpen commit on GitHub?`, type: 'confirm', okText: 'Open GitHub' });
        if (ok) window.open(result.commit_url, '_blank');
      }, 300);
    }
    await loadCRLStatus();
  } catch (error) {
    showToast(error.message || 'Failed to publish CRL', 'error');
  } finally {
    setLoading(btn, false);
  }
}

async function removeCRLEntry(licenseId) {
  const ok = await showModal({ title: 'Remove from CRL', message: `Remove license ${licenseId} from CRL?\n\nThis will allow the license to work again on HRMS after the next CRL fetch.`, type: 'confirm', okText: 'Remove' });
  if (!ok) return;
  try {
    await api(`/api/crl/${licenseId}`, { method: 'DELETE' });
    showToast('License removed from CRL', 'success');
    await loadCRLStatus();
  } catch (error) {
    showToast(error.message || 'Failed to remove from CRL', 'error');
  }
}

window.loadCRLStatus   = loadCRLStatus;
window.publishCRL      = publishCRL;
window.removeCRLEntry  = removeCRLEntry;

// GDPR Compliance
async function exportCustomerData(customerId) {
  try {
    const result = await api(`/api/gdpr/export-data?customer_id=${customerId}`);
    const json = JSON.stringify(result.data, null, 2);
    downloadTextFile(`customer-data-${customerId}.json`, json, 'application/json');
    showToast('Customer data exported', 'success');
  } catch (error) {
    showToast(error.message || 'Export failed', 'error');
  }
}

async function deleteCustomerData(customerId) {
  const answer = await showModal({ title: 'Delete Customer Data', message: 'Type DELETE to confirm permanent data deletion:', type: 'prompt', okText: 'Delete' });
  if (answer !== 'DELETE') return;
  
  try {
    await api(`/api/gdpr/delete-data/${customerId}`, { method: 'DELETE' });
    showToast('Customer data deleted', 'success');
    await refreshDashboard();
  } catch (error) {
    showToast(error.message || 'Deletion failed', 'error');
  }
}

// Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
  // Ctrl+K for quick search
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('customerSearch')?.focus();
  }
  
  // Ctrl+N for new customer
  if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
    e.preventDefault();
    startNewCustomer();
  }
  
  // Ctrl+S for save
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    saveCustomer();
  }
});

// Make functions globally accessible
window.renderCharts = renderCharts;
window.sendRenewalReminders = sendRenewalReminders;
window.createOperator = createOperator;
window.renderOperators = renderOperators;
window.renderCommunicationPage = renderCommunicationPage;
window.renderSecuritySettings = renderSecuritySettings;
window.exportCustomerData = exportCustomerData;
window.deleteCustomerData = deleteCustomerData;

// ==================== PAGE NAVIGATION FUNCTIONS ====================

function switchToPage(pageName) {
  state.currentPage = pageName;
  renderApp();
  setTimeout(() => {
    bindCurrentView();
    if (pageName === 'overview') {
      if (document.getElementById('recentLicensesDash')) renderRecentLicensesDash();
      if (document.getElementById('renewalsDash')) renderRenewalsDash();
      if (document.getElementById('metricsGrid')) renderMetrics();
    }
  }, 100);
}

function switchToSystemUpdate() {
  state.currentPage = 'systemUpdate';
  renderApp();
  setTimeout(() => {
    bindCurrentView();
    renderSecurityNote();
  }, 100);
}

function switchToPublishRelease() {
  state.currentPage = 'publishRelease';
  renderApp();
  setTimeout(() => {
    bindCurrentView();
    refreshReleaseHistory();
  }, 100);
}
window.switchToPublishRelease = switchToPublishRelease;

function switchToUpdateManagement() {
  state.currentPage = 'updateManagement';
  renderApp();
  setTimeout(() => {
    bindCurrentView();
    refreshCustomerListForPush();
    refreshDistributionHistory();
  }, 100);
}
window.switchToUpdateManagement = switchToUpdateManagement;

window.renderUpdateManagementPage = renderUpdateManagementPage;
window.checkAvailableRelease = checkAvailableRelease;
window.setPushVersion = setPushVersion;
window.pushToSelected = pushToSelected;
window.holdSelected = holdSelected;
window.pushToAllCustomers = pushToAllCustomers;
window.refreshCustomerListForPush = refreshCustomerListForPush;
window.refreshDistributionHistory = refreshDistributionHistory;
window.selectAllCustomers = selectAllCustomers;
window.deselectAllCustomers = deselectAllCustomers;
window.toggleCustomer = toggleCustomer;

function switchToWorkspace() {
  state.currentPage = 'workspace';
  renderApp();
  setTimeout(() => {
    bindCurrentView();
    renderSecurityNote();
    refreshDashboard();
  }, 100);
}

function openSystemUpdate() {
  switchToSystemUpdate();
}

function closeSystemUpdate() {
  switchToPage('overview');
}

function renderMarkdownNotes(text) {
  return String(text || '')
    .split('\n')
    .map(line => {
      if (line.startsWith('- ')) {
        return '<div style="padding-left:20px;margin:6px 0;display:flex;gap:8px;"><span style="color:#6366f1;font-weight:700;">•</span><span>' + escapeHtml(line.slice(2)) + '</span></div>';
      }
      return '<div style="margin:10px 0;">' + escapeHtml(line) + '</div>';
    })
    .join('');
}

async function checkSystemUpdate() {
  const statusDiv = document.getElementById('update-status');
  const detailsDiv = document.getElementById('update-details');
  const installBtnDiv = document.getElementById('update-install-btn');
  const notesDiv = document.getElementById('update-release-notes');
  const breakingDiv = document.getElementById('update-breaking-warning');
  const versionDiv = document.getElementById('update-version-info');
  const checkBtn = document.getElementById('checkUpdateBtn');
  if (!statusDiv) return;

  if (checkBtn) {
    checkBtn.disabled = true;
    checkBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Checking...';
  }

  statusDiv.innerHTML =
    '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;display:block;margin:0 auto 16px;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
    '<p style="margin:0;font-size:15px;font-weight:600;color:#64748b;">Checking for updates...</p>';
  statusDiv.style.background = '#f8fafc';
  statusDiv.style.border = '2px solid #e2e8f0';
  if (installBtnDiv) installBtnDiv.style.display = 'none';
  if (detailsDiv) detailsDiv.style.display = 'none';

  try {
    const data = await api('/api/updates/status');

    if (data.available) {
      const relDate = data.release_date ? new Date(data.release_date).toLocaleDateString('en-IN', {dateStyle:'medium'}) : 'N/A';
      const sizeTxt = data.size_mb ? data.size_mb + ' MB' : '';
      statusDiv.innerHTML =
        '<div style="display:inline-block;padding:12px 20px;background:rgba(245,158,11,0.15);border-radius:12px;margin-bottom:20px;">' +
          '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' +
        '</div>' +
        '<h3 style="margin:0 0 14px 0;color:#92400e;font-size:24px;font-weight:800;">Update Available</h3>' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:12px;font-size:18px;margin-bottom:12px;">' +
          '<span style="color:#94a3b8;font-weight:600;">v' + escapeHtml(data.current_version||'?') + '</span>' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>' +
          '<strong style="color:#6366f1;font-size:22px;font-weight:800;">v' + escapeHtml(data.latest_version||'?') + '</strong>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:16px;font-size:13px;color:#64748b;flex-wrap:wrap;">' +
          '<span style="display:flex;align-items:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>' + relDate + '</span>' +
          (sizeTxt ? '<span style="display:flex;align-items:center;gap:6px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>' + sizeTxt + '</span>' : '') +
        '</div>';
      statusDiv.style.background = 'rgba(245,158,11,0.06)';
      statusDiv.style.border = '2px solid rgba(245,158,11,0.25)';

      if (installBtnDiv) {
        installBtnDiv.style.display = 'block';
        installBtnDiv.innerHTML =
          '<button onclick="installUpdate()" id="install-update-btn" style="' +
            'background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border:none;' +
            'padding:16px 40px;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;' +
            'display:inline-flex;align-items:center;gap:12px;box-shadow:0 12px 28px -8px rgba(99,102,241,0.6);' +
            'font-family:inherit;transition:all 0.2s;"' +
            ' onmouseover="this.style.transform=\'translateY(-2px)\';this.style.boxShadow=\'0 16px 32px -8px rgba(99,102,241,0.7)\'"' +
            ' onmouseout="this.style.transform=\'\';this.style.boxShadow=\'0 12px 28px -8px rgba(99,102,241,0.6)\'">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
            ' Install Update Now' +
          '</button>' +
          '<p style="margin-top:14px;font-size:13px;color:#64748b;display:flex;align-items:center;justify-content:center;gap:8px;">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
            'Safe automatic install — your data is preserved' +
          '</p>';
      }

      if (notesDiv) notesDiv.innerHTML = renderMarkdownNotes(data.release_notes || 'No release notes provided.');
      if (breakingDiv) breakingDiv.style.display = data.breaking_changes ? 'block' : 'none';
      if (detailsDiv) detailsDiv.style.display = 'block';
    } else {
      statusDiv.innerHTML =
        '<div style="display:inline-block;padding:12px 20px;background:rgba(16,185,129,0.15);border-radius:12px;margin-bottom:20px;">' +
          '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 12px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
        '</div>' +
        '<h3 style="margin:0 0 14px 0;color:#065f46;font-size:24px;font-weight:800;">You\'re Up to Date</h3>' +
        '<p style="font-size:16px;color:#475569;margin-bottom:8px;">Current version: <strong style="color:#0f172a;">v' + (data.current_version||'?') + '</strong></p>' +
        '<p style="font-size:13px;color:#94a3b8;">Last checked: ' + (data.last_check ? new Date(data.last_check).toLocaleString('en-IN') : 'just now') + '</p>';
      statusDiv.style.background = 'rgba(16,185,129,0.06)';
      statusDiv.style.border = '2px solid rgba(16,185,129,0.25)';
      if (detailsDiv) detailsDiv.style.display = 'none';
      if (installBtnDiv) installBtnDiv.style.display = 'none';
    }
    if (versionDiv) {
      versionDiv.style.display = 'block';
      const versionText = document.getElementById('update-version-text');
      if (versionText) {
        versionText.textContent = 'Check interval: every ' + (data.update_check_interval_hours || 24) + ' hours';
      }
    }

    const versionDisplay = document.getElementById('current-version-display');
    if (versionDisplay && data.current_version) {
      versionDisplay.textContent = data.current_version;
    }
  } catch (err) {
    statusDiv.innerHTML =
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 16px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
      '<p style="margin:0 0 8px 0;color:#dc2626;font-size:16px;font-weight:700;">Could not check for updates</p>' +
      '<p style="margin:0;font-size:13px;color:#94a3b8;">' + escapeHtml(err.message) + '</p>';
    statusDiv.style.background = '#fef2f2';
    statusDiv.style.border = '2px solid #fecaca';
  }

  if (checkBtn) {
    checkBtn.disabled = false;
    checkBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Check for Updates';
  }
}

async function installUpdate() {
  const btn = document.getElementById('install-update-btn');
  const progressDiv = document.getElementById('update-progress');
  const statusDiv = document.getElementById('update-status');
  const installBtnDiv = document.getElementById('update-install-btn');

  const ok = await showModal({ title: 'Install Update', message: 'Install the update now?\n\nThe system will:\n1. Download the latest version\n2. Apply the update safely\n3. Restart automatically\n\nYour data will NOT be affected.', type: 'confirm', okText: 'Install' });
  if (!ok) return;

  if (btn) { btn.disabled = true; btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Installing...'; }
  if (progressDiv) {
    progressDiv.style.display = 'block';
    progressDiv.innerHTML =
      '<div style="background:#f8fafc;border:2px solid #e2e8f0;border-radius:12px;padding:24px;">' +
        '<div style="display:flex;align-items:center;gap:14px;margin-bottom:18px;">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;flex-shrink:0;"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>' +
          '<strong style="color:var(--gray-800);font-size:15px;">Installing update, please wait...</strong>' +
        '</div>' +
        '<div id="install-log" style="background:#1e1e1e;border-radius:10px;padding:16px;font-family:monospace;font-size:13px;color:#d4d4d4;line-height:1.9;max-height:220px;overflow-y:auto;">' +
          '<span style="color:#60a5fa;">›</span> Starting update process...<br>' +
        '</div>' +
      '</div>';
  }

  const log = (msg, color) => {
    const logDiv = document.getElementById('install-log');
    if (logDiv) {
      logDiv.innerHTML += '<span style="color:' + (color||'#d4d4d4') + ';">' + msg + '</span><br>';
      logDiv.scrollTop = logDiv.scrollHeight;
    }
  };

  try {
    log('<span style="color:#60a5fa;">›</span> Contacting update server...', '#d4d4d4');

    const res = await fetch('/api/updates/install', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + state.sessionToken
      },
      body: JSON.stringify({ confirm: true })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'HTTP ' + res.status }));
      throw new Error(err.error || 'HTTP ' + res.status);
    }

    const result = await res.json();

    log('<span style="color:#4ade80;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg></span> Update downloaded successfully', '#d4d4d4');
    log('<span style="color:#4ade80;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg></span> Files applied safely', '#d4d4d4');
    log('<span style="color:#4ade80;"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;"><polyline points="20 6 9 17 4 12"></polyline></svg></span> ' + escapeHtml(result.message || 'Update installed!'), '#4ade80');

    if (progressDiv) {
      progressDiv.innerHTML =
        '<div style="background:rgba(16,185,129,0.08);border:2px solid rgba(16,185,129,0.3);border-radius:12px;padding:28px;text-align:center;">' +
          '<svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' +
          '<h3 style="margin-top:16px;color:#065f46;font-size:20px;font-weight:700;">Update Installed Successfully!</h3>' +
          '<p style="color:var(--gray-600);margin-top:10px;font-size:15px;">The system has been updated. Reloading in <span id="reload-countdown">5</span> seconds...</p>' +
          '<button onclick="location.reload()" style="margin-top:18px;background:#10b981;color:white;border:none;padding:12px 28px;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:10px;">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>' +
            'Reload Now' +
          '</button>' +
        '</div>';
      let count = 5;
      const timer = setInterval(() => {
        count--;
        const el = document.getElementById('reload-countdown');
        if (el) el.textContent = count;
        if (count <= 0) { clearInterval(timer); location.reload(); }
      }, 1000);
    }
    if (installBtnDiv) installBtnDiv.style.display = 'none';
    if (statusDiv) statusDiv.style.display = 'none';

  } catch (err) {
    log('<span style="color:#f87171;">✗</span> Error: ' + escapeHtml(err.message), '#f87171');
    if (progressDiv) {
      progressDiv.innerHTML +=
        '<div style="background:rgba(239,68,68,0.08);border:2px solid rgba(239,68,68,0.3);border-radius:10px;padding:18px;margin-top:14px;text-align:center;">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-3px;margin-right:8px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
          '<strong style="color:#b91c1c;font-size:15px;">Installation failed: ' + escapeHtml(err.message) + '</strong>' +
          '<p style="font-size:13px;color:var(--gray-500);margin-top:8px;">Please try again or contact support.</p>' +
          '<button onclick="checkSystemUpdate()" style="margin-top:12px;background:var(--gray-100);border:2px solid var(--gray-200);padding:10px 22px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px;font-weight:600;">Try Again</button>' +
        '</div>';
    }
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Install Update Automatically'; }
  }
}

async function showReleaseHistory() {
  const modal = document.createElement('div');
  modal.id = 'release-history-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="background:white;border-radius:18px;max-width:820px;width:100%;max-height:90vh;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.35);display:flex;flex-direction:column;">
      <div style="padding:28px;border-bottom:2px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
        <h2 style="margin:0;font-size:22px;color:#111827;font-weight:700;display:flex;align-items:center;gap:12px;">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Release History
        </h2>
        <button onclick="document.getElementById('release-history-modal').remove()" style="background:none;border:none;cursor:pointer;padding:10px;border-radius:10px;transition:background 0.2s;" onmouseover="this.style.background='#f3f4f6'" onmouseout="this.style.background='none'">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div id="history-content" style="padding:28px;overflow-y:auto;flex:1;">
        <div style="text-align:center;padding:48px 24px;">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="animation:spin 1s linear infinite;display:block;margin:0 auto;">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <p style="margin-top:14px;color:#6b7280;font-size:15px;">Loading release history...</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  try {
    const data = await api('/api/releases');
    const releases = data.releases || [];

    if (releases.length === 0) {
      document.getElementById('history-content').innerHTML = `
        <div style="text-align:center;padding:48px 24px;">
          <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto;">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p style="margin-top:18px;color:#6b7280;font-size:16px;">No release history available</p>
        </div>
      `;
      return;
    }

    let html = '<div style="display:flex;flex-direction:column;gap:18px;">';
    
    releases.forEach((rel, idx) => {
      const version = rel.version || 'Unknown';
      const date = rel.release_date ? new Date(rel.release_date).toLocaleDateString('en-IN', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      }) : 'N/A';
      const sizeMB = rel.size_mb ? rel.size_mb + ' MB' : '';
      const isBreaking = rel.breaking_changes;
      const isLatest = idx === 0;

      html += `
        <div style="border:2px solid ${isLatest ? '#6366f1' : '#e5e7eb'};border-radius:14px;padding:20px;background:${isLatest ? 'rgba(99,102,241,0.03)' : 'white'};">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <h3 style="margin:0;font-size:19px;font-weight:700;color:#111827;">v${escapeHtml(version)}</h3>
              ${isLatest ? '<span style="background:#6366f1;color:white;font-size:11px;font-weight:700;padding:4px 10px;border-radius:7px;text-transform:uppercase;letter-spacing:0.6px;">Latest</span>' : ''}
              ${isBreaking ? '<span style="background:#ef4444;color:white;font-size:11px;font-weight:700;padding:4px 10px;border-radius:7px;text-transform:uppercase;letter-spacing:0.6px;">Breaking</span>' : ''}
            </div>
            <div style="text-align:right;">
              <div style="font-size:14px;color:#6b7280;font-weight:600;">${date}</div>
              ${sizeMB ? '<div style="font-size:12px;color:#9ca3af;margin-top:3px;">' + sizeMB + '</div>' : ''}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;font-size:14px;color:#6b7280;">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <span>Released and available for installation</span>
          </div>
        </div>
      `;
    });

    html += '</div>';
    
    html += `
      <div style="margin-top:24px;padding:20px;background:#f9fafb;border-radius:12px;border:2px solid #e5e7eb;">
        <div style="display:flex;align-items:start;gap:12px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:2px;">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <div style="font-size:14px;color:#4b5563;line-height:1.7;">
            <strong style="color:#111827;font-size:15px;">Automatic Updates</strong><br>
            License-Gen-HRMS checks for updates every 24 hours. When a new version is available, you'll see an "Install Update Automatically" button in the System Update section.
          </div>
        </div>
      </div>
    `;

    document.getElementById('history-content').innerHTML = html;

  } catch (err) {
    document.getElementById('history-content').innerHTML = `
      <div style="text-align:center;padding:48px 24px;">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto;">
          <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        <p style="margin-top:18px;color:#ef4444;font-size:16px;font-weight:700;">Failed to load release history</p>
        <p style="margin-top:10px;color:#6b7280;font-size:14px;">${escapeHtml(err.message)}</p>
        <button onclick="showReleaseHistory()" style="margin-top:18px;background:#6366f1;color:white;border:none;padding:12px 24px;border-radius:10px;cursor:pointer;font-family:inherit;font-size:15px;font-weight:700;">
          Try Again
        </button>
      </div>
    `;
  }
}

window.checkSystemUpdate = checkSystemUpdate;
window.installUpdate = installUpdate;
window.showReleaseHistory = showReleaseHistory;
window.openSystemUpdate = openSystemUpdate;

window.switchToSystemUpdate = switchToSystemUpdate;
window.switchToWorkspace = switchToWorkspace;
window.renderPublishReleasePage = renderPublishReleasePage;
window.submitReleasePublish = submitReleasePublish;
window.refreshReleaseHistory = refreshReleaseHistory;

// Backup & Vendor Management functions
window.refreshBackupStatus = refreshBackupStatus;
window.triggerManualBackup = triggerManualBackup;
window.refreshVendorList = refreshVendorList;
window.showCreateVendorForm = showCreateVendorForm;
window.hideVendorForm = hideVendorForm;
window.submitCreateVendor = submitCreateVendor;
window.suspendVendorAction = suspendVendorAction;
window.activateVendorAction = activateVendorAction;
window.deleteVendorAction = deleteVendorAction;
window.triggerRestore = triggerRestore;
window.submitMasterPasswordChange = submitMasterPasswordChange;


// ============================================
// PHASE 3.5: OPERATOR MANAGEMENT UI
// ============================================

let operatorsList = [];

async function loadOperators() {
  const container = document.getElementById('operatorsContainer');
  if (!container) return;
  
  container.innerHTML = '<div class="empty-state">Loading operators...</div>';
  
  try {
    const result = await api('/api/operators');
    operatorsList = result.operators || [];
    renderOperatorsTable();
  } catch (err) {
    container.innerHTML = '<div class="empty-state" style="color:red;">Error: ' + escapeHtml(err.message) + '</div>';
  }
}

function renderOperatorsTable() {
  const container = document.getElementById('operatorsContainer');
  if (!container) return;
  
  if (!operatorsList || operatorsList.length === 0) {
    container.innerHTML = '<div class="empty-state">No operators found.</div>';
    return;
  }
  
  let html = '<table class="data-table" style="width:100%;text-align:left;border-collapse:collapse;">';
  html += '<thead><tr style="border-bottom:1px solid #e5e7eb;">';
  html += '<th style="padding:12px;font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;">Name</th>';
  html += '<th style="padding:12px;font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;">Email</th>';
  html += '<th style="padding:12px;font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;">Role</th>';
  html += '<th style="padding:12px;font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;">Status</th>';
  html += '<th style="padding:12px;font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;">Last Login</th>';
  html += '<th style="padding:12px;font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;">Actions</th>';
  html += '</tr></thead><tbody>';
  
  operatorsList.forEach(op => {
    const statusPill = op.is_active 
      ? '<span class="status-pill active">Active</span>' 
      : '<span class="status-pill suspended" style="background:#fef2f2;color:#b91c1c;border-color:#fca5a5;">Suspended</span>';
      
    html += '<tr style="border-bottom:1px solid #f3f4f6;">';
    html += '<td style="padding:12px;"><strong>' + escapeHtml(op.full_name) + '</strong></td>';
    html += '<td style="padding:12px;color:#4b5563;">' + escapeHtml(op.email) + '</td>';
    html += '<td style="padding:12px;">' + escapeHtml(formatLabel(op.role)) + '</td>';
    html += '<td style="padding:12px;">' + statusPill + '</td>';
    html += '<td style="padding:12px;color:#6b7280;">' + escapeHtml(formatDateTime(op.last_login_at)) + '</td>';
    html += '<td style="padding:12px;">';
    
    html += '<button onclick="editOperatorModal(\'' + op.id + '\')" class="secondary-btn" style="padding:4px 8px;font-size:12px;margin-right:4px;">Edit</button>';
    
    if (op.is_active) {
      html += '<button onclick="suspendOperator(\'' + op.id + '\')" class="ghost-btn" style="padding:4px 8px;font-size:12px;margin-right:4px;">Suspend</button>';
    } else {
      html += '<button onclick="reactivateOperator(\'' + op.id + '\')" class="secondary-btn" style="padding:4px 8px;font-size:12px;margin-right:4px;">Reactivate</button>';
    }
    
    html += '<button onclick="deleteOperator(\'' + op.id + '\')" class="ghost-btn" style="padding:4px 8px;font-size:12px;color:#ef4444;">Delete</button>';
    
    html += '</td></tr>';
  });
  
  html += '</tbody></table>';
  container.innerHTML = html;
}

window.createOperator = function() {
  editOperatorModal();
};

window.editOperatorModal = function(id = null) {
  const operator = id ? operatorsList.find(op => op.id === id) : null;
  const isNew = !operator;
  
  const modalHtml = `
    <div id="operatorModal" class="modal-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;">
      <div class="modal-card" style="background:white;padding:32px;border-radius:16px;width:100%;max-width:500px;box-shadow:0 10px 25px rgba(0,0,0,0.1);">
        <h3 style="margin-top:0;margin-bottom:16px;">${isNew ? 'New Operator' : 'Edit Operator'}</h3>
        <form id="operatorForm" onsubmit="saveOperator(event, '${id || ''}')" style="display:flex;flex-direction:column;gap:16px;">
          <label class="field" style="width:100%;">
            <span class="field-label">Full Name</span>
            <input id="opName" class="surface-input" type="text" value="${operator ? escapeHtml(operator.full_name) : ''}" required>
          </label>
          <label class="field" style="width:100%;">
            <span class="field-label">Email</span>
            <input id="opEmail" class="surface-input" type="email" value="${operator ? escapeHtml(operator.email) : ''}" required>
          </label>
          <label class="field" style="width:100%;">
            <span class="field-label">Role</span>
            <select id="opRole" class="surface-input" required>
              <option value="Platform_Admin" ${operator && operator.role === 'Platform_Admin' ? 'selected' : ''}>Platform Admin</option>
              <option value="License_Manager" ${operator && operator.role === 'License_Manager' ? 'selected' : ''}>License Manager</option>
              <option value="Viewer" ${operator && operator.role === 'Viewer' ? 'selected' : ''}>Viewer</option>
              <option value="Auditor" ${operator && operator.role === 'Auditor' ? 'selected' : ''}>Auditor</option>
            </select>
          </label>
          <label class="field" style="width:100%;">
            <span class="field-label">${isNew ? 'Password' : 'New Password (leave blank to keep current)'}</span>
            <input id="opPassword" class="surface-input" type="password" ${isNew ? 'required' : ''} placeholder="Min 10 chars, uppercase, lowercase, number, special">
          </label>
          <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:16px;">
            <button type="button" class="secondary-btn" onclick="document.getElementById('operatorModal').remove()">Cancel</button>
            <button type="submit" class="primary-btn">Save</button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  document.body.insertAdjacentHTML('beforeend', modalHtml);
};

window.saveOperator = async function(event, id) {
  event.preventDefault();
  
  const name = document.getElementById('opName').value;
  const email = document.getElementById('opEmail').value;
  const role = document.getElementById('opRole').value;
  const password = document.getElementById('opPassword').value;
  
  const submitBtn = event.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  
  try {
    if (id) {
      await api('/api/operators/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, full_name: name, password: password || undefined })
      });
      showToast('Operator updated.', 'success');
    } else {
      await api('/api/operators', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name: name, email, role, password })
      });
      showToast('Operator created.', 'success');
    }
    document.getElementById('operatorModal').remove();
    loadOperators();
  } catch (err) {
    showToast(err.message, 'error');
    submitBtn.disabled = false;
  }
};

window.suspendOperator = async function(id) {
  const ok = await showModal({ title: 'Suspend Operator', message: 'Are you sure you want to suspend this operator?', type: 'confirm', okText: 'Suspend' });
  if (!ok) return;
  try {
    await api('/api/operators/' + id + '/suspend', { method: 'POST' });
    showToast('Operator suspended.', 'success');
    loadOperators();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.reactivateOperator = async function(id) {
  try {
    await api('/api/operators/' + id + '/reactivate', { method: 'POST' });
    showToast('Operator reactivated.', 'success');
    loadOperators();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteOperator = async function(id) {
  const ok = await showModal({ title: 'Delete Operator', message: 'Are you sure you want to permanently delete this operator? This cannot be undone.', type: 'confirm', okText: 'Delete' });
  if (!ok) return;
  try {
    await api('/api/operators/' + id, { method: 'DELETE' });
    showToast('Operator deleted.', 'success');
    loadOperators();
  } catch (err) {
    showToast(err.message, 'error');
  }
};


// ============================================
// PHASE 4.5 & 5.8: 2FA + FORGOT PASSWORD UI
// ============================================

function show2faChallenge(operatorId) {
  // Remove any existing modal
  document.getElementById('twoFaModal')?.remove();

  const html = `
    <div id="twoFaModal" class="modal-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);">
      <div style="background:white;padding:40px;border-radius:20px;width:100%;max-width:420px;box-shadow:0 20px 60px rgba(0,0,0,0.2);text-align:center;">
        <div style="width:64px;height:64px;background:linear-gradient(135deg,#6366f1,#4f46e5);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        </div>
        <h3 style="margin:0 0 8px;font-size:22px;">Two-Factor Authentication</h3>
        <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">Enter the 6-digit code from your authenticator app, or use a backup code.</p>
        <form id="twoFaForm" onsubmit="submit2faCode(event, '${operatorId}')">
          <input id="twoFaCode" class="surface-input" type="text" inputmode="numeric" pattern="[0-9a-fA-F]{6,8}" maxlength="8" placeholder="000000" required autofocus
            style="text-align:center;font-size:28px;letter-spacing:8px;padding:16px;font-weight:700;font-family:monospace;width:100%;box-sizing:border-box;margin-bottom:16px;">
          <button type="submit" class="primary-btn" style="width:100%;padding:14px;font-size:15px;font-weight:700;">Verify Code</button>
          <button type="button" onclick="document.getElementById('twoFaModal').remove()" class="ghost-btn" style="width:100%;margin-top:8px;padding:10px;">Cancel → Return to Login</button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  setTimeout(() => document.getElementById('twoFaCode')?.focus(), 100);
}

window.submit2faCode = async function(event, operatorId) {
  event.preventDefault();
  const code = document.getElementById('twoFaCode').value.trim();
  const submitBtn = event.target.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Verifying...';

  try {
    // Call backend TOTP verify endpoint
    const result = await fetch(`${window.location.origin}/api/auth/2fa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operator_id: operatorId, token: code })
    });
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || 'Invalid 2FA code.');

    document.getElementById('twoFaModal')?.remove();
    setSessionToken(data.token || '');
    state.authStatus = { ...state.authStatus, authenticated: true, operator: data.operator || null };
    state.view = 'workspace';
    renderApp();
    bindCurrentView();
    await refreshDashboard();
    showToast('Signed in with two-factor authentication.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Verify Code';
    document.getElementById('twoFaCode').value = '';
    document.getElementById('twoFaCode').focus();
  }
};
window.show2faChallenge = show2faChallenge;

// Forgot Password UI
window.showForgotPassword = function() {
  document.getElementById('forgotPasswordModal')?.remove();
  const html = `
    <div id="forgotPasswordModal" class="modal-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);">
      <div style="background:white;padding:40px;border-radius:20px;width:100%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
        <h3 style="margin:0 0 8px;font-size:20px;">Reset Password</h3>
        <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">Enter your operator email address. If an account exists, a password reset link will be emailed to you.</p>
        <form id="forgotPasswordForm" onsubmit="submitForgotPassword(event)">
          <label class="field" style="width:100%;margin-bottom:16px;">
            <span class="field-label">Email Address</span>
            <input id="forgotEmail" class="surface-input" type="email" placeholder="operator@vygroup.com" required autofocus>
          </label>
          <button type="submit" class="primary-btn" style="width:100%;padding:14px;font-size:15px;font-weight:700;">Send Reset Link</button>
          <button type="button" onclick="document.getElementById('forgotPasswordModal').remove()" class="ghost-btn" style="width:100%;margin-top:8px;padding:10px;">Cancel</button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);
  setTimeout(() => document.getElementById('forgotEmail')?.focus(), 100);
};

window.submitForgotPassword = async function(event) {
  event.preventDefault();
  const email = document.getElementById('forgotEmail').value.trim();
  const btn = event.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Sending...';

  try {
    const res = await fetch(`${window.location.origin}/api/auth/forgot-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    document.getElementById('forgotPasswordModal')?.remove();
    if (data.dev_reset_link) {
      showToast('Reset token generated. Use the link below to reset.', 'success');
      const tokenModal = document.createElement('div');
      tokenModal.id = 'resetTokenModal';
      tokenModal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);';
      tokenModal.innerHTML = `
        <div style="background:white;padding:40px;border-radius:20px;width:100%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,0.2);">
          <h3 style="margin:0 0 8px;font-size:20px;">Password Reset Link</h3>
          <p style="color:#6b7280;margin:0 0 16px;font-size:14px;">No email service configured. Use this link to reset your password:</p>
          <div style="background:#f3f4f6;padding:12px;border-radius:8px;font-family:monospace;font-size:13px;word-break:break-all;margin-bottom:16px;">${escapeHtml(data.dev_reset_link)}</div>
          <button onclick="window.location.hash='${escapeHtml(data.dev_reset_link)}';document.getElementById('resetTokenModal').remove();location.reload();" class="primary-btn" style="width:100%;padding:12px;">Open Reset Page</button>
          <button onclick="navigator.clipboard.writeText('${escapeHtml(data.dev_reset_link)}');showToast('Link copied','success');" class="ghost-btn" style="width:100%;margin-top:8px;padding:10px;">Copy Link</button>
          <button onclick="document.getElementById('resetTokenModal').remove()" class="ghost-btn" style="width:100%;margin-top:8px;padding:10px;">Close</button>
        </div>
      `;
      document.body.appendChild(tokenModal);
    } else {
      showToast(data.message || 'If an account exists, a password reset link has been sent.', 'success');
    }
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false; btn.textContent = 'Send Reset Link';
  }
};

// Inject "Forgot password?" link into login form
const _origBindAuthEvents = typeof bindAuthEvents !== 'undefined' ? bindAuthEvents : null;
function injectForgotPasswordLink() {
  const loginForm = document.getElementById('loginForm');
  if (!loginForm || document.getElementById('forgotPasswordLink')) return;
  const link = document.createElement('div');
  link.id = 'forgotPasswordLink';
  link.style.cssText = 'text-align:right;margin-top:-8px;margin-bottom:8px;';
  link.innerHTML = '<a href="javascript:void(0)" onclick="showForgotPassword()" style="font-size:13px;color:#6366f1;text-decoration:none;font-weight:500;">Forgot password?</a>';
  const submitBtn = loginForm.querySelector('.auth-submit');
  if (submitBtn) loginForm.insertBefore(link, submitBtn);
}

// Patch bindAuthEvents to inject forgot password after it runs
const _origBA = window.bindAuthEvents;
if (typeof window.bindAuthEvents === 'function') {
  const orig = window.bindAuthEvents;
  window.bindAuthEvents = function(...args) {
    orig.apply(this, args);
    setTimeout(injectForgotPasswordLink, 50);
  };
} else {
  // Observe DOM for login form appearance
  const observer = new MutationObserver(() => injectForgotPasswordLink());
  observer.observe(document.body, { childList: true, subtree: true });
}

// ============================================
// PHASE 5.8: TOTP SETUP UI (in Security/Profile page)
// ============================================

window.showTotpSetup = async function() {
  document.getElementById('totpSetupModal')?.remove();
  const html = `
    <div id="totpSetupModal" class="modal-overlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:9999;backdrop-filter:blur(4px);overflow-y:auto;">
      <div style="background:white;padding:40px;border-radius:20px;width:100%;max-width:480px;box-shadow:0 20px 60px rgba(0,0,0,0.2);margin:20px;">
        <h3 style="margin:0 0 8px;">Setup Two-Factor Authentication</h3>
        <p style="color:#6b7280;margin:0 0 20px;font-size:14px;">Scan the QR code below with your authenticator app (Google Authenticator, Authy), then enter the 6-digit code to confirm.</p>
        <div id="totpQrArea" style="text-align:center;padding:20px;background:#f8fafc;border-radius:12px;margin-bottom:20px;">
          <div style="color:#6b7280;">Loading QR code...</div>
        </div>
        <div id="totpManualSecret" style="display:none;margin-bottom:16px;background:#f1f5f9;padding:12px;border-radius:8px;font-family:monospace;font-size:13px;word-break:break-all;"></div>
        <button onclick="document.getElementById('totpManualSecret').style.display = document.getElementById('totpManualSecret').style.display === 'none' ? 'block' : 'none'" class="ghost-btn" style="font-size:12px;padding:6px 12px;margin-bottom:16px;">Show Manual Entry Key</button>
        <form id="totpConfirmForm" onsubmit="confirmTotpSetup(event)" style="display:flex;flex-direction:column;gap:12px;">
          <label class="field">
            <span class="field-label">Enter 6-digit verification code</span>
            <input id="totpConfirmCode" class="surface-input" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="000000" required style="font-size:20px;letter-spacing:6px;text-align:center;font-family:monospace;font-weight:700;">
          </label>
          <div id="totpBackupCodesSection" style="display:none;">
            <p style="font-size:13px;color:#dc2626;font-weight:600;margin:8px 0 4px;">⚠ Save these backup codes — they will not be shown again:</p>
            <div id="totpBackupCodes" style="background:#fef2f2;padding:12px;border-radius:8px;font-family:monospace;font-size:13px;line-height:2;"></div>
            <button type="button" onclick="downloadBackupCodes()" class="secondary-btn" style="width:100%;margin-top:8px;">Download Backup Codes</button>
          </div>
          <button type="submit" class="primary-btn" style="padding:14px;font-size:15px;font-weight:700;">Confirm & Enable 2FA</button>
          <button type="button" onclick="document.getElementById('totpSetupModal').remove()" class="ghost-btn" style="padding:10px;">Cancel</button>
        </form>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  try {
    const data = await api('/api/auth/2fa/setup');
    const qrArea = document.getElementById('totpQrArea');
    if (data.qrCodeDataUrl) {
      qrArea.innerHTML = `<img src="${escapeHtml(data.qrCodeDataUrl)}" alt="QR Code" style="width:200px;height:200px;">`;
    }
    if (data.secret) {
      document.getElementById('totpManualSecret').textContent = 'Secret: ' + data.secret;
    }
    if (data.backupCodesPlain) {
      document.getElementById('totpBackupCodesSection').style.display = 'block';
      document.getElementById('totpBackupCodes').innerHTML = data.backupCodesPlain.map(c => escapeHtml(c)).join('<br>');
      window._totpBackupCodes = data.backupCodesPlain;
    }
    window._totpSetupData = data;
  } catch (err) {
    document.getElementById('totpQrArea').innerHTML = `<div style="color:#ef4444;">Failed to load setup: ${escapeHtml(err.message)}</div>`;
  }
};

window.confirmTotpSetup = async function(event) {
  event.preventDefault();
  const token = document.getElementById('totpConfirmCode').value.trim();
  const btn = event.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Enabling...';

  try {
    await api('/api/auth/2fa/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, secret: window._totpSetupData?.secret, backup_codes: window._totpSetupData?.backupCodesHashed })
    });
    document.getElementById('totpSetupModal')?.remove();
    showToast('Two-factor authentication enabled successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
    btn.disabled = false; btn.textContent = 'Confirm & Enable 2FA';
  }
};

window.downloadBackupCodes = function() {
  const codes = (window._totpBackupCodes || []).join('\n');
  downloadTextFile('vy-vendor-2fa-backup-codes.txt', `VY Group Vendor Console - 2FA Backup Codes\nGenerated: ${new Date().toISOString()}\n\nIMPORTANT: Store these in a safe place. Each code can only be used once.\n\n${codes}`);
};

// ============================================
// PHASE 6.5: LDAP SETTINGS UI
// ============================================

window.renderLdapSettings = async function(container) {
  if (!container) container = document.getElementById('securityContainer');
  if (!container) return;

  container.innerHTML += `
    <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:4px;">Directory Integration</div>
          <h4 style="margin:0;font-size:17px;font-weight:700;">LDAP / Active Directory</h4>
        </div>
        <button onclick="testLdapConnection()" class="secondary-btn" style="font-size:13px;">Test Connection</button>
      </div>
      <form id="ldapSettingsForm" onsubmit="saveLdapSettings(event)" style="display:flex;flex-direction:column;gap:16px;">
        <div class="form-grid">
          <label class="field">
            <span class="field-label">LDAP Server URL</span>
            <input id="ldapUrl" class="surface-input" type="text" placeholder="ldap://192.168.1.100:389 or ldaps://...">
          </label>
          <label class="field">
            <span class="field-label">Base DN</span>
            <input id="ldapBaseDn" class="surface-input" type="text" placeholder="DC=vygroup,DC=com">
          </label>
          <label class="field">
            <span class="field-label">Bind DN Template</span>
            <input id="ldapBindDn" class="surface-input" type="text" placeholder="{{identifier}}@vygroup.com">
            <span style="font-size:11px;color:#9ca3af;margin-top:4px;display:block;">Use {{identifier}} as placeholder for email/username</span>
          </label>
          <label class="field">
            <span class="field-label">User Filter</span>
            <input id="ldapUserFilter" class="surface-input" type="text" placeholder="(sAMAccountName={{identifier}})">
          </label>
        </div>
        <div style="display:flex;align-items:center;gap:12px;padding:12px;background:#f8fafc;border-radius:8px;">
          <input id="ldapAutoProvision" type="checkbox" style="width:16px;height:16px;">
          <div>
            <div style="font-weight:600;font-size:14px;">Auto-Provisioning</div>
            <div style="font-size:12px;color:#6b7280;">Automatically create operator accounts on first successful LDAP login</div>
          </div>
        </div>
        <div id="ldapTestResult" style="display:none;"></div>
        <button type="submit" class="primary-btn" style="align-self:flex-start;padding:12px 24px;">Save LDAP Settings</button>
      </form>
    </div>
    <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:24px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;margin-bottom:4px;">Two-Factor Authentication</div>
          <h4 style="margin:0;font-size:17px;font-weight:700;">My 2FA Settings</h4>
        </div>
      </div>
      <p style="color:#6b7280;font-size:14px;margin:0 0 16px;">Protect your account with an authenticator app (Google Authenticator, Authy, etc.)</p>
      <button onclick="showTotpSetup()" class="primary-btn" style="background:linear-gradient(135deg,#6366f1,#4f46e5);">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:6px;vertical-align:middle;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        Setup Two-Factor Authentication
      </button>
    </div>
  `;

  // Load existing LDAP settings
  try {
    const settings = await api('/api/settings/ldap').catch(() => ({}));
    if (settings?.ldap_url) document.getElementById('ldapUrl').value = settings.ldap_url;
    if (settings?.ldap_base_dn) document.getElementById('ldapBaseDn').value = settings.ldap_base_dn;
    if (settings?.ldap_bind_dn) document.getElementById('ldapBindDn').value = settings.ldap_bind_dn;
    if (settings?.ldap_user_filter) document.getElementById('ldapUserFilter').value = settings.ldap_user_filter;
    if (settings?.ldap_auto_provision) document.getElementById('ldapAutoProvision').checked = true;
  } catch (_) {}
};

window.saveLdapSettings = async function(event) {
  event.preventDefault();
  const btn = event.target.querySelector('button[type="submit"]');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    await api('/api/settings/ldap', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: document.getElementById('ldapUrl').value.trim(),
        base_dn: document.getElementById('ldapBaseDn').value.trim(),
        bind_dn: document.getElementById('ldapBindDn').value.trim(),
        bind_password: document.getElementById('ldapBindPassword')?.value || '',
        user_filter: document.getElementById('ldapUserFilter').value.trim(),
        use_ssl: document.getElementById('ldapUseSsl')?.checked || false,
        use_tls: document.getElementById('ldapUseTls')?.checked || false
      })
    });
    showToast('LDAP settings saved.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Save LDAP Settings';
  }
};

window.testLdapConnection = async function() {
  const resultDiv = document.getElementById('ldapTestResult');
  if (!resultDiv) return;
  resultDiv.style.display = 'block';
  resultDiv.innerHTML = '<div style="padding:12px;background:var(--bg);border-radius:8px;color:var(--text-muted);font-size:13px;">Testing connection...</div>';

  try {
    const resp = await api('/api/settings/ldap/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: document.getElementById('ldapUrl').value.trim(),
        base_dn: document.getElementById('ldapBaseDn').value.trim()
      })
    });
    const success = resp.success;
    resultDiv.innerHTML = `<div style="padding:12px;border-radius:8px;font-size:13px;background:${success ? 'rgba(16,185,129,.1)' : 'rgba(239,68,68,.1)'};color:${success ? '#10b981' : '#ef4444'};">${escapeHtml(resp.message || (success ? 'Connection successful.' : 'Connection failed.'))}</div>`;
  } catch (err) {
    resultDiv.innerHTML = `<div style="padding:12px;background:rgba(239,68,68,.1);border-radius:8px;color:#ef4444;font-size:13px;">Connection failed: ${escapeHtml(err.message)}</div>`;
  }
};

// Hook LDAP settings into security page render
const _origRenderSecuritySettings = window.renderSecuritySettings;
window.renderSecuritySettings = function(...args) {
  if (typeof _origRenderSecuritySettings === 'function') _origRenderSecuritySettings.apply(this, args);
  setTimeout(() => renderLdapSettings(), 100);
};

// ══════════════════════════════════════════════════════════════════════
// ACTIVITY FEED PAGE
// ══════════════════════════════════════════════════════════════════════

function renderActivityFeedPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">System Timeline</div>
            <h2>Activity Feed</h2>
            <p>Real-time log of all system events and operator actions.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>
        <div id="activityFeedContainer" style="padding:0 28px;">
          <div class="empty-state">Loading activity feed...</div>
        </div>
      </main>
    </div>`;
}

async function loadActivityFeed() {
  const el = document.getElementById('activityFeedContainer');
  if (!el) return;
  try {
    const data = await api('/api/activity-feed?limit=100');
    const feed = data.feed || [];
    if (!feed.length) {
      el.innerHTML = '<div class="empty-state">No activity recorded yet.</div>';
      return;
    }
    el.innerHTML = feed.map(e => {
      const typeColors = {
        customer_created: '#10b981', customer_deleted: '#ef4444', customer_archived: '#f59e0b',
        license_generated: '#6366f1', license_revoked: '#ef4444', license_extended: '#10b981',
        login_success: '#3b82f6', login_failed: '#ef4444', operator_created: '#8b5cf6',
        operator_deleted: '#ef4444', password_reset: '#f59e0b', smtp_tested: '#3b82f6'
      };
      const color = typeColors[e.type] || '#6b7280';
      const labels = {
        customer_created: 'Customer Created', customer_deleted: 'Customer Deleted', customer_archived: 'Customer Archived',
        license_generated: 'License Generated', license_revoked: 'License Revoked', license_extended: 'License Extended',
        login_success: 'Login Success', login_failed: 'Login Failed', operator_created: 'Operator Created',
        operator_deleted: 'Operator Deleted', password_reset: 'Password Reset', smtp_tested: 'SMTP Tested',
        gdpr_data_deletion: 'GDPR Deletion'
      };
      const detail = e.detail ? (typeof e.detail === 'string' ? e.detail : (e.detail.customer_name || e.detail.operator_email || JSON.stringify(e.detail).substring(0, 80))) : '';
      return `<div style="display:flex;gap:16px;padding:16px 0;border-bottom:1px solid var(--border-light, rgba(0,0,0,.06));align-items:flex-start;">
        <div style="width:10px;height:10px;border-radius:50%;background:${color};margin-top:6px;flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <span style="font-weight:600;font-size:13px;color:var(--text);">${escapeHtml(labels[e.type] || e.type)}</span>
            <span style="font-size:11px;color:var(--text-muted);flex-shrink:0;">${escapeHtml(e.timestamp ? new Date(e.timestamp).toLocaleString() : '')}</span>
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">
            <span style="color:var(--primary, #6366f1);font-weight:500;">${escapeHtml(e.operator)}</span>
            ${detail ? ' — ' + escapeHtml(detail) : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--danger, #ef4444);">Failed to load activity feed: ${escapeHtml(err.message)}</div>`;
  }
}

window.loadActivityFeed = loadActivityFeed;

// ══════════════════════════════════════════════════════════════════════
// HEALTH SCORES PAGE
// ══════════════════════════════════════════════════════════════════════

function renderHealthScoresPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Risk Assessment</div>
            <h2>Customer Health Scores</h2>
            <p>Composite health rating per customer based on license status, expiry, and account completeness.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>
        <div id="healthScoresContainer" style="padding:0 28px;">
          <div class="empty-state">Loading health scores...</div>
        </div>
      </main>
    </div>`;
}

async function loadHealthScores() {
  const el = document.getElementById('healthScoresContainer');
  if (!el) return;
  try {
    const data = await api('/api/customers/health');
    const customers = data.customers || [];
    if (!customers.length) {
      el.innerHTML = '<div class="empty-state">No customers found.</div>';
      return;
    }
    const healthy = customers.filter(c => c.level === 'healthy').length;
    const atRisk = customers.filter(c => c.level === 'at_risk').length;
    const critical = customers.filter(c => c.level === 'critical').length;
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">
        <div class="section-card" style="padding:20px;border-left:4px solid #10b981;">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Healthy</div>
          <div style="font-size:28px;font-weight:700;color:#10b981;">${healthy}</div>
        </div>
        <div class="section-card" style="padding:20px;border-left:4px solid #f59e0b;">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">At Risk</div>
          <div style="font-size:28px;font-weight:700;color:#f59e0b;">${atRisk}</div>
        </div>
        <div class="section-card" style="padding:20px;border-left:4px solid #ef4444;">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Critical</div>
          <div style="font-size:28px;font-weight:700;color:#ef4444;">${critical}</div>
        </div>
      </div>
      ${customers.map(c => {
        const color = c.level === 'healthy' ? '#10b981' : c.level === 'at_risk' ? '#f59e0b' : '#ef4444';
        const barWidth = c.score;
        return `<div style="display:flex;align-items:center;gap:16px;padding:14px 0;border-bottom:1px solid var(--border-light, rgba(0,0,0,.06));">
          <div style="width:140px;font-weight:600;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(c.customer_name)}">${escapeHtml(c.customer_name)}</div>
          <div style="flex:1;background:var(--bg, #f9fafb);border-radius:4px;height:8px;overflow:hidden;">
            <div style="width:${barWidth}%;height:100%;background:${color};border-radius:4px;transition:width .3s;"></div>
          </div>
          <div style="width:50px;text-align:right;font-weight:700;font-size:14px;color:${color};">${c.score}</div>
          <div style="width:80px;"><span class="status-pill ${c.level === 'healthy' ? 'green' : c.level === 'at_risk' ? 'yellow' : 'red'}">${escapeHtml(c.level)}</span></div>
          <div style="width:80px;font-size:11px;color:var(--text-muted);">${escapeHtml(c.license_status)}</div>
        </div>`;
      }).join('')}`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--danger, #ef4444);">Failed to load health scores: ${escapeHtml(err.message)}</div>`;
  }
}

window.loadHealthScores = loadHealthScores;

// ══════════════════════════════════════════════════════════════════════
// DEPLOYMENTS STATUS PAGE
// ══════════════════════════════════════════════════════════════════════

function renderDeploymentsPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Version Map</div>
            <h2>Deployment Status</h2>
            <p>Track which HRMS versions customers are running and update readiness.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>
        <div id="deploymentsContainer" style="padding:0 28px;">
          <div class="empty-state">Loading deployment status...</div>
        </div>
      </main>
    </div>`;
}

async function loadDeploymentStatus() {
  const el = document.getElementById('deploymentsContainer');
  if (!el) return;
  try {
    const data = await api('/api/deployments/status');
    const versions = data.versions || [];
    if (!versions.length) {
      el.innerHTML = '<div class="empty-state">No deployment data found.</div>';
      return;
    }
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px;">
        <div class="section-card" style="padding:20px;border-left:4px solid var(--primary, #6366f1);">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Total Customers</div>
          <div style="font-size:28px;font-weight:700;color:var(--primary, #6366f1);">${data.total || 0}</div>
        </div>
        <div class="section-card" style="padding:20px;border-left:4px solid #10b981;">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Up to Date</div>
          <div style="font-size:28px;font-weight:700;color:#10b981;">${data.up_to_date || 0}</div>
        </div>
        <div class="section-card" style="padding:20px;border-left:4px solid #f59e0b;">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Needs Update</div>
          <div style="font-size:28px;font-weight:700;color:#f59e0b;">${data.needs_update || 0}</div>
        </div>
      </div>
      <div class="section-card" style="padding:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;">Version Distribution</h3>
        ${versions.map(v => {
          const pct = data.total ? Math.round((v.count / data.total) * 100) : 0;
          return `<div style="margin-bottom:16px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
              <span style="font-size:13px;font-weight:600;color:var(--text);">${escapeHtml(v.version || 'Unknown')}</span>
              <span style="font-size:12px;color:var(--text-muted);">${v.count} customer(s) (${pct}%)</span>
            </div>
            <div style="background:var(--bg, #f9fafb);border-radius:4px;height:8px;overflow:hidden;">
              <div style="width:${pct}%;height:100%;background:var(--primary, #6366f1);border-radius:4px;"></div>
            </div>
            <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">
              ${v.customers.map(c => `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:var(--bg, #f3f4f6);color:var(--text-muted);">${escapeHtml(c.name)}</span>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--danger, #ef4444);">Failed to load deployment status: ${escapeHtml(err.message)}</div>`;
  }
}

window.loadDeploymentStatus = loadDeploymentStatus;

// ══════════════════════════════════════════════════════════════════════
// EMAIL CAMPAIGNS PAGE
// ══════════════════════════════════════════════════════════════════════

function renderCampaignsPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Email Outreach</div>
            <h2>Campaigns</h2>
            <p>Send bulk emails to customers and track campaign history.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>
        <div style="padding:0 28px;display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div class="section-card" style="padding:20px;">
            <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;">New Campaign</h3>
            <div class="field">
              <label class="field-label">Campaign Name</label>
              <input type="text" id="campaignName" class="surface-input" placeholder="e.g. Q3 Renewal Push">
            </div>
            <div class="field">
              <label class="field-label">Subject</label>
              <input type="text" id="campaignSubject" class="surface-input" placeholder="Email subject line">
            </div>
            <div class="field">
              <label class="field-label">Message (HTML supported)</label>
              <textarea id="campaignMessage" class="surface-textarea" rows="5" placeholder="Email body content..."></textarea>
            </div>
            <div class="field">
              <label class="field-label">Recipients</label>
              <div id="campaignRecipients" style="max-height:200px;overflow-y:auto;border:1px solid var(--border-light, rgba(0,0,0,.1));border-radius:6px;padding:8px;">
                <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:12px;">
                  <input type="checkbox" id="campaignSelectAll" onchange="toggleCampaignSelectAll()" style="accent-color:var(--primary, #6366f1);"> Select All Customers
                </label>
              </div>
            </div>
            <button onclick="sendCampaign()" class="primary-btn" style="width:100%;padding:10px 0;margin-top:8px;">Send Campaign</button>
          </div>
          <div class="section-card" style="padding:20px;max-height:calc(100vh - 200px);overflow-y:auto;">
            <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;">Campaign History</h3>
            <div id="campaignHistory">
              <div class="empty-state">Loading campaigns...</div>
            </div>
          </div>
        </div>
      </main>
    </div>`;
}

async function loadCampaigns() {
  const recipientsEl = document.getElementById('campaignRecipients');
  const historyEl = document.getElementById('campaignHistory');
  if (!recipientsEl || !historyEl) return;
  try {
    const customers = state.customers || [];
    const existing = recipientsEl.querySelectorAll('label[data-cid]').length;
    if (existing === 0 && customers.length) {
      const checkHtml = customers.map(c => `<label data-cid="${c.id}" style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;font-size:12px;"><input type="checkbox" value="${c.id}" class="campaign-cb" style="accent-color:var(--primary, #6366f1);"> ${escapeHtml(c.legal_name)} <span style="color:var(--text-muted);font-size:10px;">${escapeHtml(c.contact_email || '')}</span></label>`).join('');
      recipientsEl.insertAdjacentHTML('beforeend', checkHtml);
    }
  } catch (_) {}
  try {
    const data = await api('/api/campaigns');
    const campaigns = data.campaigns || [];
    if (!campaigns.length) {
      historyEl.innerHTML = '<div class="empty-state">No campaigns sent yet.</div>';
      return;
    }
    historyEl.innerHTML = campaigns.map(c => `<div style="padding:12px 0;border-bottom:1px solid var(--border-light, rgba(0,0,0,.06));">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:600;font-size:13px;">${escapeHtml(c.name)}</span>
        <span style="font-size:11px;color:var(--text-muted);">${escapeHtml(c.created_at ? new Date(c.created_at).toLocaleDateString() : '')}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">Sent: ${c.sent || 0} | Failed: ${c.failed || 0} | Total: ${c.total || 0}</div>
    </div>`).join('');
  } catch (err) {
    historyEl.innerHTML = `<div class="empty-state" style="color:var(--danger, #ef4444);">${escapeHtml(err.message)}</div>`;
  }
}

function toggleCampaignSelectAll() {
  const checked = document.getElementById('campaignSelectAll')?.checked;
  document.querySelectorAll('.campaign-cb').forEach(cb => { cb.checked = checked; });
}

async function sendCampaign() {
  const name = document.getElementById('campaignName')?.value?.trim();
  const subject = document.getElementById('campaignSubject')?.value?.trim();
  const message = document.getElementById('campaignMessage')?.value?.trim();
  if (!name || !subject || !message) { showToast('Name, subject, and message are required.', 'error'); return; }
  const ids = [...document.querySelectorAll('.campaign-cb:checked')].map(cb => cb.value);
  if (!ids.length) { showToast('Select at least one recipient.', 'error'); return; }
  try {
    const result = await api('/api/campaigns', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, subject, message, customer_ids: ids }) });
    showToast(result.message || 'Campaign sent.', 'success');
    document.getElementById('campaignName').value = '';
    document.getElementById('campaignSubject').value = '';
    document.getElementById('campaignMessage').value = '';
    loadCampaigns();
  } catch (err) { showToast(err.message, 'error'); }
}

window.loadCampaigns = loadCampaigns;
window.toggleCampaignSelectAll = toggleCampaignSelectAll;
window.sendCampaign = sendCampaign;

// ══════════════════════════════════════════════════════════════════════
// REPORTS PAGE
// ══════════════════════════════════════════════════════════════════════

function renderReportsPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Intelligence</div>
            <h2>Reports</h2>
            <p>Generate and download summary reports for customers, licenses, and plans.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>
        <div id="reportsContainer" style="padding:0 28px;">
          <div class="empty-state">Loading report data...</div>
        </div>
      </main>
    </div>`;
}

async function loadReportSummary() {
  const el = document.getElementById('reportsContainer');
  if (!el) return;
  try {
    const data = await api('/api/reports/summary');
    const plans = data.by_plan || {};
    const statuses = data.by_status || {};
    const lic = data.licenses || {};
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px;">
        <div class="section-card" style="padding:20px;border-left:4px solid var(--primary, #6366f1);">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Total Customers</div>
          <div style="font-size:28px;font-weight:700;color:var(--primary, #6366f1);">${data.total_customers || 0}</div>
        </div>
        <div class="section-card" style="padding:20px;border-left:4px solid #10b981;">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Active Licenses</div>
          <div style="font-size:28px;font-weight:700;color:#10b981;">${lic.active || 0}</div>
        </div>
        <div class="section-card" style="padding:20px;border-left:4px solid #f59e0b;">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Expired</div>
          <div style="font-size:28px;font-weight:700;color:#f59e0b;">${lic.expired || 0}</div>
        </div>
        <div class="section-card" style="padding:20px;border-left:4px solid #ef4444;">
          <div style="font-size:11px;text-transform:uppercase;color:var(--text-muted);font-weight:600;">Revoked</div>
          <div style="font-size:28px;font-weight:700;color:#ef4444;">${lic.revoked || 0}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="section-card" style="padding:20px;">
          <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Customers by Plan</h3>
          ${Object.keys(plans).map(p => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-light, rgba(0,0,0,.06));font-size:13px;"><span style="text-transform:capitalize;">${escapeHtml(p)}</span><span style="font-weight:600;">${plans[p]}</span></div>`).join('') || '<div style="color:var(--text-muted);font-size:12px;">No data</div>'}
        </div>
        <div class="section-card" style="padding:20px;">
          <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">Customers by Status</h3>
          ${Object.keys(statuses).map(s => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-light, rgba(0,0,0,.06));font-size:13px;"><span style="text-transform:capitalize;">${escapeHtml(s)}</span><span style="font-weight:600;">${statuses[s]}</span></div>`).join('') || '<div style="color:var(--text-muted);font-size:12px;">No data</div>'}
        </div>
      </div>
      <div style="margin-top:20px;">
        <button onclick="downloadReport()" class="secondary-btn" type="button">Download Full Report (JSON)</button>
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--danger, #ef4444);">Failed to load reports: ${escapeHtml(err.message)}</div>`;
  }
}

async function downloadReport() {
  try {
    const data = await api('/api/reports/summary');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Report downloaded.', 'success');
  } catch (err) { showToast(err.message, 'error'); }
}

window.loadReportSummary = loadReportSummary;
window.downloadReport = downloadReport;

// ══════════════════════════════════════════════════════════════════════
// WEBHOOKS PAGE
// ══════════════════════════════════════════════════════════════════════

function renderWebhooksPage() {
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Integrations</div>
            <h2>Webhooks</h2>
            <p>Configure HTTP webhook endpoints for event notifications.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>
        <div style="padding:0 28px;display:grid;grid-template-columns:1fr 1fr;gap:20px;">
          <div class="section-card" style="padding:20px;">
            <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;">Add Webhook</h3>
            <div class="field">
              <label class="field-label">Endpoint URL</label>
              <input type="url" id="webhookUrl" class="surface-input" placeholder="https://your-server.com/webhook">
            </div>
            <div class="field">
              <label class="field-label">Events (comma-separated)</label>
              <input type="text" id="webhookEvents" class="surface-input" value="license_generated, license_revoked, customer_created" placeholder="license_generated, license_revoked, customer_created">
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              <button onclick="createWebhook()" class="primary-btn" style="flex:1;">Add Webhook</button>
              <button onclick="testWebhook()" class="secondary-btn" style="flex:1;">Test Connection</button>
            </div>
          </div>
          <div class="section-card" style="padding:20px;max-height:calc(100vh - 200px);overflow-y:auto;">
            <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;">Registered Webhooks</h3>
            <div id="webhooksList">
              <div class="empty-state">Loading webhooks...</div>
            </div>
          </div>
        </div>
      </main>
    </div>`;
}

async function loadWebhooks() {
  const el = document.getElementById('webhooksList');
  if (!el) return;
  try {
    const data = await api('/api/webhooks');
    const webhooks = data.webhooks || [];
    if (!webhooks.length) {
      el.innerHTML = '<div class="empty-state">No webhooks configured.</div>';
      return;
    }
    el.innerHTML = webhooks.map(w => `<div style="padding:12px;border:1px solid var(--border-light, rgba(0,0,0,.08));border-radius:8px;margin-bottom:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;font-weight:600;word-break:break-all;">${escapeHtml(w.url)}</span>
        <button onclick="deleteWebhook('${w.id}')" class="ghost-btn" style="font-size:11px;color:var(--danger, #ef4444);flex-shrink:0;">Delete</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Events: ${escapeHtml((w.events || []).join(', '))}</div>
      <div style="font-size:11px;color:var(--text-muted);">Created: ${escapeHtml(w.created_at ? new Date(w.created_at).toLocaleDateString() : '')}</div>
    </div>`).join('');
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--danger, #ef4444);">${escapeHtml(err.message)}</div>`;
  }
}

async function createWebhook() {
  const url = document.getElementById('webhookUrl')?.value?.trim();
  if (!url) { showToast('URL is required.', 'error'); return; }
  const events = (document.getElementById('webhookEvents')?.value || '').split(',').map(e => e.trim()).filter(Boolean);
  try {
    await api('/api/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, events }) });
    showToast('Webhook created.', 'success');
    document.getElementById('webhookUrl').value = '';
    loadWebhooks();
  } catch (err) { showToast(err.message, 'error'); }
}

async function testWebhook() {
  const url = document.getElementById('webhookUrl')?.value?.trim();
  if (!url) { showToast('Enter a URL to test.', 'error'); return; }
  try {
    const result = await api('/api/webhooks/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    showToast(result.message || (result.success ? 'Connection successful.' : 'Test failed.'), result.success ? 'success' : 'error');
  } catch (err) { showToast(err.message, 'error'); }
}

async function deleteWebhook(id) {
  if (!confirm('Delete this webhook?')) return;
  try {
    await api(`/api/webhooks/${id}`, { method: 'DELETE' });
    showToast('Webhook deleted.', 'success');
    loadWebhooks();
  } catch (err) { showToast(err.message, 'error'); }
}

window.loadWebhooks = loadWebhooks;
window.createWebhook = createWebhook;
window.testWebhook = testWebhook;
window.deleteWebhook = deleteWebhook;

// ══════════════════════════════════════════════════════════════════════
// CUSTOMER SELF-SERVICE PORTAL PAGE
// ══════════════════════════════════════════════════════════════════════

function renderSelfServicePage() {
  const customers = state.customers || [];
  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Customer View</div>
            <h2>Customer Self-Service Portal</h2>
            <p>Preview what customers see when they access their portal. Select a customer to view their portal data.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('overview')" class="ghost-btn" type="button">Back to Dashboard</button>
          </div>
        </header>
        <div style="padding:0 28px;">
          <div class="section-card" style="padding:20px;margin-bottom:20px;">
            <div class="field" style="max-width:400px;">
              <label class="field-label">Select Customer</label>
              <select id="portalCustomerSelect" class="surface-input" onchange="loadCustomerPortal(this.value)">
                <option value="">— Choose a customer —</option>
                ${customers.map(c => `<option value="${c.id}">${escapeHtml(c.legal_name)}</option>`).join('')}
              </select>
            </div>
          </div>
          <div id="customerPortalData">
            <div class="empty-state">Select a customer to view their portal data.</div>
          </div>
        </div>
      </main>
    </div>`;
}

async function loadCustomerPortal(customerId) {
  const el = document.getElementById('customerPortalData');
  if (!el) return;
  if (!customerId) {
    el.innerHTML = '<div class="empty-state">Select a customer to view their portal data.</div>';
    return;
  }
  el.innerHTML = '<div class="empty-state">Loading customer portal data...</div>';
  try {
    const data = await api(`/api/customer-portal/${customerId}`);
    const c = data.customer;
    const lic = data.active_license;
    const hist = data.license_history || [];
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div class="section-card" style="padding:20px;">
          <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;">Account Details</h3>
          <div style="font-size:13px;line-height:2;">
            <div><span style="color:var(--text-muted);">Company:</span> <strong>${escapeHtml(c.legal_name)}</strong></div>
            <div><span style="color:var(--text-muted);">Plan:</span> <strong style="text-transform:capitalize;">${escapeHtml(c.plan)}</strong></div>
            <div><span style="color:var(--text-muted);">Status:</span> <span class="status-pill ${c.status === 'active' ? 'green' : 'yellow'}">${escapeHtml(c.status)}</span></div>
            <div><span style="color:var(--text-muted);">HRMS Version:</span> ${escapeHtml(c.hrms_version || 'Not deployed')}</div>
            <div><span style="color:var(--text-muted);">Update Status:</span> <span class="status-pill ${c.update_status === 'current' ? 'green' : 'yellow'}">${escapeHtml(c.update_status || 'current')}</span></div>
            <div><span style="color:var(--text-muted);">Renewal Date:</span> ${escapeHtml(c.renewal_date || 'Not set')}</div>
          </div>
        </div>
        <div class="section-card" style="padding:20px;">
          <h3 style="font-size:14px;font-weight:600;margin-bottom:16px;">Active License</h3>
          ${lic ? `<div style="font-size:13px;line-height:2;">
            <div><span style="color:var(--text-muted);">Plan:</span> <strong style="text-transform:capitalize;">${escapeHtml(lic.plan)}</strong></div>
            <div><span style="color:var(--text-muted);">Status:</span> <span class="status-pill ${lic.status === 'active' ? 'green' : 'red'}">${escapeHtml(lic.status)}</span></div>
            <div><span style="color:var(--text-muted);">Expires:</span> ${escapeHtml(lic.expires_at ? new Date(lic.expires_at).toLocaleDateString() : 'N/A')}</div>
            <div><span style="color:var(--text-muted);">Days Remaining:</span> ${lic.days_remaining != null ? lic.days_remaining + ' days' : 'N/A'}</div>
            <div><span style="color:var(--text-muted);">Hardware ID:</span> ${escapeHtml(lic.hardware_id || 'Unbound')}</div>
          </div>` : '<div style="color:var(--text-muted);font-size:13px;">No active license.</div>'}
        </div>
      </div>
      <div class="section-card" style="padding:20px;margin-top:20px;">
        <h3 style="font-size:14px;font-weight:600;margin-bottom:12px;">License History (${hist.length} total)</h3>
        ${hist.length ? hist.map(l => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border-light, rgba(0,0,0,.06));font-size:12px;">
          <span style="text-transform:capitalize;">${escapeHtml(l.plan)}</span>
          <span class="status-pill ${l.status === 'active' ? 'green' : l.status === 'revoked' ? 'red' : 'yellow'}" style="font-size:10px;">${escapeHtml(l.status)}</span>
          <span style="color:var(--text-muted);">${escapeHtml(l.generated_at ? new Date(l.generated_at).toLocaleDateString() : '')}</span>
          <span style="color:var(--text-muted);">${l.expires_at ? 'Exp: ' + new Date(l.expires_at).toLocaleDateString() : ''}</span>
        </div>`).join('') : '<div style="color:var(--text-muted);font-size:12px;">No license history.</div>'}
      </div>`;
  } catch (err) {
    el.innerHTML = `<div class="empty-state" style="color:var(--danger, #ef4444);">Failed to load portal data: ${escapeHtml(err.message)}</div>`;
  }
}

window.loadCustomerPortal = loadCustomerPortal;

