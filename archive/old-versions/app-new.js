const TOKEN_KEY = 'vendor_console_token';
const root = document.getElementById('root');
const toastRegion = document.getElementById('toastRegion');

// CACHE BUSTER - DO NOT REMOVE - VERSION: 2026-04-30-FINAL-999
const VENDOR_TOOL_VERSION = 'v2.0.0-dedicated-update-page';
console.log('🚀 Vendor Tool Loaded:', VENDOR_TOOL_VERSION, 'Time:', new Date().toISOString());

let clockTimer = null;

const state = {
  view: 'loading',
  consoleName: 'VY Group Vendor Licensing Console',
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
  currentPage: 'overview' // Track which page: overview, customers, profile, licenses, analytics, audit, templates, operators, portal, security, systemUpdate
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
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toastRegion.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 260);
  }, 2600);
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

  // Always route API calls to the vendor backend on port 3005,
  // regardless of which port the frontend is being served on.
  const vendorBackendPort = '3005';
  const backendUrl = window.location.port === vendorBackendPort
    ? path  // already on backend — relative path is fine
    : `${window.location.protocol}//${window.location.hostname}:${vendorBackendPort}${path}`;

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
          <h3>${setupMode ? 'Create vendor administrator' : 'Enter vendor credentials'}</h3>
          <p>${setupMode
            ? 'This setup runs once and creates the primary platform administrator for the vendor console.'
            : 'Use the vendor operator account created during setup to enter the command center.'}</p>
          <form id="${setupMode ? 'setupForm' : 'loginForm'}" class="auth-form">
            ${setupMode ? `
              <label class="field">
                <span class="field-label">Full Name</span>
                <input id="setupFullName" class="surface-input" type="text" placeholder="Vendor Platform Admin" required>
              </label>
            ` : ''}
            <label class="field">
              <span class="field-label">Email</span>
              <input id="${setupMode ? 'setupEmail' : 'loginEmail'}" class="surface-input" type="email" placeholder="operator@vygroup.com" required>
            </label>
            <label class="field">
              <span class="field-label">Password</span>
              <input id="${setupMode ? 'setupPassword' : 'loginPassword'}" class="surface-input" type="password" placeholder="${setupMode ? 'Minimum 10 chars with strong complexity' : 'Enter operator password'}" required>
            </label>
            ${setupMode ? `
              <label class="field">
                <span class="field-label">Confirm Password</span>
                <input id="setupPasswordConfirm" class="surface-input" type="password" placeholder="Re-enter the password" required>
              </label>
            ` : ''}
            <button class="primary-btn auth-submit" type="submit">${setupMode ? 'Create Operator & Enter Console' : 'Sign In to Console'}</button>
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
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>
          Portal
        </button>
        <button class="rail-nav-btn ${currentPage === 'security' ? 'active' : ''}" onclick="switchToPage('security')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
          Security
        </button>
        <button class="rail-nav-btn ${currentPage === 'systemUpdate' ? 'active' : ''}" onclick="switchToPage('systemUpdate')">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          System Update
        </button>
      </nav>

      <div class="boundary-card">
        <div class="section-kicker">Security Boundary</div>
        <ul id="securityList" class="security-list"></ul>
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
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
          </div>
        </header>

        <section class="hero-panel">
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
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
          </div>
        </header>

        <section class="section-card registry-panel" style="margin:20px;">
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
  if (!customer) {
    return `
      <div class="command-shell">
        ${renderSharedSidebar()}
        <main class="console-main">
          <header class="command-bar">
            <div class="command-heading">
              <div class="eyebrow">Customer Profile</div>
              <h2>No Customer Selected</h2>
              <p>Select a customer from the Customers page to view their profile.</p>
            </div>
            <div class="command-actions">
              <button onclick="switchToPage('customers')" class="primary-btn" type="button">Go to Customers</button>
              <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
            </div>
          </header>
        </main>
      </div>
    `;
  }

  return `
    <div class="command-shell">
      ${renderSharedSidebar()}
      <main class="console-main">
        <header class="command-bar">
          <div class="command-heading">
            <div class="eyebrow">Customer Profile</div>
            <h2>${escapeHtml(customer.customer_name || 'Customer')}</h2>
            <p>Manage customer details, contacts, and account information.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToPage('customers')" class="secondary-btn" type="button">Back to List</button>
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
          </div>
        </header>

        <div class="console-grid" style="margin:20px;">
          <section id="customerProfile" class="section-card profile-panel">
            <div class="section-header">
              <div>
                <div class="section-kicker">Account Profile</div>
                <h3 class="section-title">Customer Details</h3>
              </div>
              <div class="section-actions">
                <button onclick="archiveSelectedCustomer()" class="secondary-btn" type="button">Archive</button>
                <button onclick="deleteSelectedCustomer()" class="ghost-btn" type="button" style="color:#ef4444;">Delete</button>
                <button onclick="saveCustomer()" class="primary-btn" type="button">Save Changes</button>
              </div>
            </div>
            <form id="customerForm" class="profile-form">
              <div class="form-grid">
                <label class="field">
                  <span class="field-label">Customer Name</span>
                  <input id="customerName" class="surface-input" type="text" placeholder="Acme Corporation" required>
                </label>
                <label class="field">
                  <span class="field-label">Contact Person</span>
                  <input id="contactPerson" class="surface-input" type="text" placeholder="John Doe">
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
                  <span class="field-label">Status</span>
                  <select id="customerStatus" class="surface-input">
                    <option value="prospect">Prospect</option>
                    <option value="poc">POC/Trial</option>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label class="field">
                  <span class="field-label">Plan</span>
                  <select id="customerPlan" class="surface-input"></select>
                </label>
              </div>
              <label class="field">
                <span class="field-label">Notes</span>
                <textarea id="customerNotes" class="surface-input" rows="3" placeholder="Internal notes about this customer"></textarea>
              </label>
            </form>
            <div id="accountSignals" class="account-signals"></div>
          </section>
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
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
          </div>
        </header>

        <div style="margin:20px;">
          <section class="section-card">
            <div class="section-header">
              <div>
                <div class="section-kicker">License Factory</div>
                <h3 class="section-title">Generate License</h3>
              </div>
            </div>
            <p style="padding:0 20px 20px;color:var(--muted);">Select a customer from the Customers page to generate licenses.</p>
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
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
          </div>
        </header>

        <div style="margin:20px;">
          <section class="section-card">
            <h3 style="padding:20px 20px 0;">Analytics Dashboard</h3>
            <div id="chartsContainer" style="padding:20px;"></div>
          </section>
        </div>
      </main>
    </div>
  `;
}

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
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
          </div>
        </header>

        <div style="margin:20px;">
          <section class="section-card">
            <div id="auditLogContainer"></div>
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
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
          </div>
        </header>

        <div style="margin:20px;">
          <section class="section-card">
            <div id="templatesContainer"></div>
          </section>
        </div>
      </main>
    </div>
  `;
}

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
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
          </div>
        </header>

        <div style="margin:20px;">
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
            <div class="eyebrow">Customer Self-Service</div>
            <h2>Customer Portal</h2>
            <p>Customer-facing portal for license management and renewals.</p>
          </div>
          <div class="command-actions">
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
          </div>
        </header>

        <div style="margin:20px;">
          <section class="section-card">
            <div id="customerPortalContainer"></div>
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
            <p>Manage security policies, CRL, and compliance features.</p>
          </div>
          <div class="command-actions">
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
          </div>
        </header>

        <div style="margin:20px;">
          <section class="section-card">
            <div id="securityContainer"></div>
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
            <button id="signOutBtn" class="ghost-btn" type="button">Sign Out</button>
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
          <button class="rail-nav-btn" onclick="switchToWorkspace()">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
            Overview
          </button>
          <button class="rail-nav-btn active">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            System Update
          </button>
        </nav>

        <div class="boundary-card">
          <div class="section-kicker">Security Boundary</div>
          <ul id="securityList" class="security-list"></ul>
        </div>
      </aside>

      <main class="console-main" style="background:#f8fafc;">
        <header class="command-bar" style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border:none;">
          <div class="command-heading">
            <div class="eyebrow" style="color:rgba(255,255,255,0.9);">System Management</div>
            <h2 style="color:white;">System Update</h2>
            <p style="color:rgba(255,255,255,0.95);">Keep your Vendor Tool up to date with the latest features, security improvements, and bug fixes.</p>
          </div>
          <div class="command-actions">
            <button onclick="switchToWorkspace()" class="ghost-btn" type="button" style="color:white;border-color:rgba(255,255,255,0.3);" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;margin-right:6px;vertical-align:middle"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Back to Dashboard
            </button>
            <button id="signOutBtn" class="ghost-btn" type="button" style="color:white;border-color:rgba(255,255,255,0.3);" onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='transparent'">Sign Out</button>
          </div>
        </header>

        <div style="max-width:1000px;margin:0 auto;padding:40px 20px;">
          <!-- Check Button Card -->
          <div style="background:white;border-radius:20px;padding:32px;margin-bottom:24px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
            <div style="text-align:center;">
              <button onclick="checkSystemUpdate()" id="checkUpdateBtn" style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:white;border:none;padding:14px 32px;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:10px;box-shadow:0 8px 20px -6px rgba(99,102,241,0.5);font-family:inherit;transition:all 0.2s;" onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 12px 24px -6px rgba(99,102,241,0.6)'" onmouseout="this.style.transform='';this.style.boxShadow='0 8px 20px -6px rgba(99,102,241,0.5)'">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                </svg>
                Check for Updates
              </button>
            </div>
          </div>

          <!-- Update Status Card -->
          <div style="background:white;border-radius:20px;padding:40px;margin-bottom:24px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
            <div id="update-status" style="background:#f8fafc;border:2px solid #e2e8f0;padding:60px 40px;border-radius:16px;text-align:center;">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 20px;">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              <p style="margin:0;font-size:16px;color:#64748b;font-weight:600;">Click "Check for Updates" to get started</p>
            </div>
          </div>

          <!-- Install Button -->
          <div id="update-install-btn" style="display:none;text-align:center;margin-bottom:24px;"></div>

          <!-- Progress -->
          <div id="update-progress" style="display:none;margin-bottom:24px;"></div>

          <!-- Details Card -->
          <div id="update-details" style="display:none;margin-bottom:24px;">
            <div style="background:white;border-radius:20px;padding:32px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
              <div style="background:rgba(99,102,241,0.08);border-left:4px solid #6366f1;padding:24px;border-radius:12px;margin-bottom:20px;">
                <strong style="color:#4338ca;font-size:17px;display:flex;align-items:center;gap:10px;margin-bottom:16px;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4338ca" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  Release Notes
                </strong>
                <div id="update-release-notes" style="font-size:15px;color:#475569;white-space:pre-wrap;line-height:1.8;"></div>
              </div>
              <div id="update-breaking-warning" style="display:none;background:rgba(239,68,68,0.1);border-left:4px solid #ef4444;padding:24px;border-radius:12px;">
                <strong style="color:#b91c1c;font-size:17px;display:flex;align-items:center;gap:10px;margin-bottom:12px;">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  Breaking Changes
                </strong>
                <p style="margin:0;font-size:14px;color:#7f1d1d;line-height:1.7;">This update contains breaking changes. Back up your data before upgrading.</p>
              </div>
            </div>
          </div>

          <!-- Version Info Card -->
          <div id="update-version-info" style="display:none;">
            <div style="background:white;border-radius:20px;padding:24px;box-shadow:0 4px 20px rgba(0,0,0,0.08);text-align:center;">
              <div style="display:flex;align-items:center;justify-content:center;gap:16px;flex-wrap:wrap;font-size:14px;color:#6b7280;">
                <span id="update-version-text"></span>
                <span style="color:#d1d5db;">·</span>
                <a href="javascript:void(0)" onclick="showReleaseHistory()" style="color:#6366f1;font-weight:700;text-decoration:none;display:flex;align-items:center;gap:6px;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  View Release History
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  `;
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
      break;
    case 'analytics':
      root.innerHTML = renderAnalyticsPage();
      break;
    case 'audit':
      root.innerHTML = renderAuditPage();
      break;
    case 'templates':
      root.innerHTML = renderTemplatesPage();
      break;
    case 'operators':
      root.innerHTML = renderOperatorsPage();
      break;
    case 'portal':
      root.innerHTML = renderPortalPage();
      break;
    case 'security':
      root.innerHTML = renderSecurityPage();
      break;
    case 'systemUpdate':
      root.innerHTML = renderSystemUpdatePage();
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

  customerNode.textContent = customer?.legal_name || 'No customer selected';
  const renewalDays = getDaysUntil(customer?.renewal_date);
  renewalNode.textContent = renewalDays == null
    ? 'No renewal scheduled'
    : renewalDays < 0
      ? 'Renewal overdue'
      : `${renewalDays} days to renewal`;
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
    const isPOC = customer.status === 'poc' || customer.plan === 'poc';
    const pocBadge = isPOC ? '<span class="status-pill poc" style="margin-left: 0.5rem; font-size: 0.7rem;">POC</span>' : '';
    const footer = latest
      ? `Last issue ${formatDateTime(latest.generated_at)}`
      : renewalDays == null
        ? 'No license issued yet'
        : renewalDays < 0
          ? 'Renewal overdue'
          : `Renewal in ${renewalDays} days`;
    return `
      <button class="customer-item ${selected ? 'active' : ''}" data-customer-id="${escapeHtml(customer.id)}" type="button">
        <div class="customer-item-head">
          <div>
            <div class="customer-title">${escapeHtml(customer.legal_name)}${pocBadge}</div>
            <div class="customer-sub">${escapeHtml(customer.workspace_name || 'Workspace pending')}</div>
            <div class="customer-meta">${escapeHtml(customer.primary_contact || 'No primary contact')}${customer.contact_email ? ` / ${escapeHtml(customer.contact_email)}` : ''}</div>
          </div>
          <span class="status-pill ${escapeHtml(customer.status || 'active')}">${escapeHtml(formatLabel(customer.status))}</span>
        </div>
        <div class="customer-item-foot">
          <span>${escapeHtml(formatLabel(customer.plan || '--'))} / ${escapeHtml(formatLabel(customer.deployment_type || 'on-prem'))}</span>
          <span>${escapeHtml(footer)}</span>
        </div>
      </button>
    `;
  }).join('');

  list.querySelectorAll('[data-customer-id]').forEach(button => {
    button.addEventListener('click', () => {
      state.selectedCustomerId = button.dataset.customerId || '';
      populateCustomerForm(getSelectedCustomer());
      renderCustomerList();
      renderHeroTelemetry();
      
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
  const plan = getPlanDefinition(document.getElementById('plan')?.value);
  if (!plan) return;

  document.getElementById('planHeading').textContent = `${plan.label} Entitlement Matrix`;
  document.getElementById('pricingBadge').textContent = plan.pricing?.monthly_label || 'Custom pricing';

  const employees = document.getElementById('maxEmployees');
  const admins = document.getElementById('maxAdmins');
  const departments = document.getElementById('maxDepartments');
  const durationDays = document.getElementById('durationDays');

  if (force || !employees.dataset.touched) employees.value = plan.limits?.max_employees || '';
  if (force || !admins.dataset.touched) admins.value = plan.limits?.max_admins || '';
  if (force || !departments.dataset.touched) departments.value = plan.limits?.max_departments || '';
  
  // Auto-set duration for POC/Trial licenses
  if (plan.is_trial && (force || !durationDays.dataset.touched)) {
    durationDays.value = plan.default_duration || 30;
  }

  document.getElementById('planSummary').innerHTML = [
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
        ${license.extended ? `<div><strong>Extended</strong><span>+${license.extension_days} days</span></div>` : ''}
      </div>
    </div>
  `).join('');
}

function renderIssuedLicense(result) {
  const customer = result.customer || getSelectedCustomer() || {};
  state.lastIssuedLicense = result;
  document.getElementById('licenseOutput').value = result.license_key || '';
  document.getElementById('summaryOutput').value = JSON.stringify(buildIssuedManifest(customer, result), null, 2);
}

function populateCustomerForm(customer) {
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

  document.getElementById('profileHeading').textContent = customer ? customer.legal_name : 'New Customer';
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
  document.getElementById('renewalDate').value = data.renewal_date || '';
  document.getElementById('durationDays').value = data.duration_days || 365;
  document.getElementById('noBind').checked = !data.hardware_id;
  document.getElementById('hardwareId').value = data.hardware_id || '';
  document.getElementById('maxEmployees').value = data.max_employees || '';
  document.getElementById('maxAdmins').value = data.max_admins || '';
  document.getElementById('maxDepartments').value = data.max_departments || '';
  document.getElementById('featureOverrides').value = Array.isArray(data.feature_overrides) ? data.feature_overrides.join(', ') : '';
  document.getElementById('customerNotes').value = data.notes || '';
  document.getElementById('archiveCustomerBtn').disabled = !customer;
  document.getElementById('deleteCustomerBtn').disabled = !customer;

  clearTouchedState();
  toggleHardwareRequirement();
  applyPlanDefaults(!customer);
  renderLicenseHistory();
  renderAccountSignals();
  renderHeroTelemetry();

  if (customer?.latest_license) {
    document.getElementById('licenseOutput').value = customer.latest_license.license_key || '';
    document.getElementById('summaryOutput').value = JSON.stringify(buildStoredManifest(customer, customer.latest_license), null, 2);
  } else {
    document.getElementById('licenseOutput').value = '';
    document.getElementById('summaryOutput').value = '';
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
  renderSecurityNote();
  renderMetrics();
  renderPlanOptions();
  renderCustomerList();
  populateCustomerForm(getSelectedCustomer());
  
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
  if (!window.confirm(`Archive ${customer.legal_name}?`)) return;
  await api(`/api/customers/${customer.id}/archive`, { method: 'POST' });
  await refreshDashboard(customer.id);
  showToast('Customer archived.', 'success');
}

async function deleteSelectedCustomer() {
  const customer = getSelectedCustomer();
  if (!customer) return;
  const activeLicenses = (customer.licenses || []).filter(l => !l.revoked && l.license_id);
  const warn = activeLicenses.length > 0
    ? `\n\n⚠ WARNING: ${activeLicenses.length} active license(s) will be IMMEDIATELY revoked and added to CRL.\nHRMS instances will lose access within 6 hours.`
    : '';
  if (!window.confirm(`Permanently delete "${customer.legal_name}"?${warn}\n\nThis cannot be undone.`)) return;
  const reason = window.prompt('Reason for deletion (required):', 'Customer account terminated');
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
  populateCustomerForm(null);
  renderCustomerList();
  renderHeroTelemetry();
  
  const stack = document.getElementById('consoleStack');
  if (stack) stack.classList.remove('locked');
}

async function handleSetupSubmit(event) {
  event.preventDefault();
  const full_name = document.getElementById('setupFullName').value.trim();
  const email = document.getElementById('setupEmail').value.trim();
  const password = document.getElementById('setupPassword').value;
  const confirm = document.getElementById('setupPasswordConfirm').value;

  if (!full_name || !email || !password) {
    showToast('Complete the operator setup form.', 'warning');
    return;
  }
  if (password !== confirm) {
    showToast('Passwords do not match.', 'error');
    return;
  }

  const button = event.submitter || document.querySelector('#setupForm .auth-submit');
  if (button) button.disabled = true;
  try {
    const result = await api('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name, email, password })
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

async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  const button = event.submitter || document.querySelector('#loginForm .auth-submit');
  if (button) button.disabled = true;
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    }, { auth: false, handleUnauthorized: false });

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
    if (button) button.disabled = false;
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

function bindAuthEvents() {
  const setupForm = document.getElementById('setupForm');
  const loginForm = document.getElementById('loginForm');
  if (setupForm) setupForm.addEventListener('submit', handleSetupSubmit);
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);
}

function bindWorkspaceEvents() {
  document.querySelectorAll('.rail-nav-btn').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.rail-nav-btn').forEach(node => node.classList.remove('active'));
      button.classList.add('active');
      document.getElementById(button.dataset.scrollTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  document.getElementById('signOutBtn').addEventListener('click', handleLogout);
  document.getElementById('newCustomerBtn').addEventListener('click', startNewCustomer);
  document.getElementById('saveCustomerBtn').addEventListener('click', async () => {
    try {
      await saveCustomer();
    } catch (error) {
      showToast(error.message || 'Failed to save customer.', 'error');
    }
  });
  document.getElementById('archiveCustomerBtn').addEventListener('click', async () => {
    try {
      await archiveSelectedCustomer();
    } catch (error) {
      showToast(error.message || 'Failed to archive customer.', 'error');
    }
  });

  document.getElementById('deleteCustomerBtn').addEventListener('click', async () => {
    try {
      await deleteSelectedCustomer();
    } catch (error) {
      showToast(error.message || 'Failed to delete customer.', 'error');
    }
  });
  document.getElementById('generateBtn').addEventListener('click', async () => {
    const button = document.getElementById('generateBtn');
    button.disabled = true;
    try {
      await generateLicense();
    } catch (error) {
      showToast(error.message || 'Failed to generate license.', 'error');
    } finally {
      button.disabled = false;
    }
  });
  document.getElementById('copyBtn').addEventListener('click', copyLicense);
  document.getElementById('customerSearch').addEventListener('input', event => {
    state.searchQuery = event.target.value || '';
    renderCustomerList();
  });
  document.getElementById('plan').addEventListener('change', () => applyPlanDefaults(false));
  document.getElementById('noBind').addEventListener('change', toggleHardwareRequirement);
  ['maxEmployees', 'maxAdmins', 'maxDepartments'].forEach(id => {
    document.getElementById(id).addEventListener('input', event => {
      event.target.dataset.touched = 'true';
    });
  });

  // Render new sections
  renderFullAnalytics();
  refreshAuditLog();
  renderTemplates();
  renderOperators();
  renderCustomerPortalInfo();
  renderSecuritySettings();
  renderCharts();

  startClock();
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
    
    document.getElementById('licenseOutput').value = result.license_key || '';
    document.getElementById('summaryOutput').value = JSON.stringify(result.payload, null, 2);
  } catch (error) {
    showToast(error.message || 'Failed to generate trial license.', 'error');
  }
}

async function validateLicense() {
  const licenseKey = prompt('Enter license key to validate:');
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
      alert(`${msg}\n\nCustomer: ${result.payload.customer}\nPlan: ${result.payload.plan_label}\nExpires: ${new Date(result.payload.exp * 1000).toLocaleString()}`);
    } else {
      alert(`License INVALID\n\n${result.error}`);
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
      prompt('Test Hardware ID (copy this):', hwId);
    }
  } catch (error) {
    showToast(error.message || 'Failed to generate hardware ID.', 'error');
  }
}

async function revokeLicense(customerId, issuanceId) {
  const reason = prompt('Reason for revocation:');
  if (reason === null) return;
  
  try {
    const result = await api(`/api/customers/${customerId}/licenses/${issuanceId}/revoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason || 'Revoked by vendor' })
    });
    
    showToast('License revoked successfully.', 'success');

    // Show kill switch key to operator so they can send it to customer
    if (result.kill_switch_key) {
      const msg = [
        '⚠️  LICENSE REVOKED — KILL SWITCH KEY GENERATED',
        '',
        'To immediately block HRMS access on the customer server:',
        '',
        result.instructions?.join('\n') || '',
        '',
        '── KILL SWITCH LICENSE KEY ──',
        result.kill_switch_key,
        '',
        'This key is already expired. Installing it on the HRMS server',
        'will immediately block all access (no grace period).'
      ].join('\n');
      
      // Copy to clipboard automatically
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(result.kill_switch_key);
        alert(msg + '\n\n✅ Kill switch key has been copied to your clipboard.');
      } else {
        prompt('Copy this kill switch key and send to customer IT team:', result.kill_switch_key);
      }
    } else {
      alert('License revoked in vendor records.\n\nNote: The customer\'s HRMS will continue working until they replace or delete their license.key file.');
    }

    await refreshDashboard(customerId);
    populateCustomerForm(getSelectedCustomer());
  } catch (error) {
    showToast(error.message || 'Failed to revoke license.', 'error');
  }
}

async function extendLicense(customerId, issuanceId) {
  const days = prompt('Extend by how many days?', '30');
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
    const response = await fetch('http://localhost:3005/api/customers/export', {
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
        <strong class="metric-value">${a.total_customers || 0}</strong>
        <span class="metric-note">${a.active_customers || 0} active</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">POC Customers</span>
        <strong class="metric-value">${a.poc_customers || 0}</strong>
        <span class="metric-note">Trial evaluations</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Expiring This Week</span>
        <strong class="metric-value">${a.expiring_this_week || 0}</strong>
        <span class="metric-note">Renewal required</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Conversion Rate</span>
        <strong class="metric-value">${a.conversion_rate || 0}%</strong>
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
        <div class="section-kicker">Vendor Tools</div>
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

function bindCurrentView() {
  stopClock();
  if (state.view === 'workspace') {
    bindWorkspaceEvents();
    renderSecurityNote();
    renderMetrics();
    renderPlanOptions();
    renderCustomerList();
    populateCustomerForm(getSelectedCustomer());
    startClock();
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
      // User is logged in - show workspace
      state.view = 'workspace';
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
    // Default to setup view for fresh deployments
    console.error('Vendor backend initialization error:', error);
    state.view = 'setup';
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
  
  const auditEntries = [];
  state.customers.forEach(c => {
    if (c.licenses && c.licenses.length > 0) {
      c.licenses.forEach(lic => {
        auditEntries.push({
          timestamp: lic.generated_at,
          operator: state.authStatus.operator?.email || 'system',
          action: 'license_generated',
          customer: c.legal_name,
          details: `${lic.plan_label} license generated`
        });
        if (lic.revoked) {
          auditEntries.push({
            timestamp: lic.revoked_at,
            operator: state.authStatus.operator?.email || 'system',
            action: 'license_revoked',
            customer: c.legal_name,
            details: lic.revoked_reason || 'No reason provided'
          });
        }
      });
    }
  });
  
  auditEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  container.innerHTML = auditEntries.length > 0 ? `
    <div class="history-list">
      ${auditEntries.slice(0, 50).map(entry => `
        <div class="history-card">
          <div class="history-head">
            <div class="history-title">${escapeHtml(entry.action.replace(/_/g, ' ').toUpperCase())}</div>
            <span class="status-pill ${entry.action.includes('revoked') ? 'suspended' : 'active'}">${escapeHtml(entry.operator)}</span>
          </div>
          <div class="history-meta">
            ${escapeHtml(entry.customer)} • ${escapeHtml(formatDateTime(entry.timestamp))}
          </div>
          <div style="margin-top:8px;color:var(--muted);font-size:13px;">${escapeHtml(entry.details)}</div>
        </div>
      `).join('')}
    </div>
  ` : '<div class="empty-state">No audit entries yet.</div>';
}

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

function createTemplate() {
  const name = prompt('Template name:');
  if (!name) return;
  showToast('Template creation feature - Coming soon!', 'info');
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
  
  alert(`Subject: ${template.subject}\n\n${preview}`);
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
        <strong class="metric-value">${a.total_customers || 0}</strong>
        <span class="metric-note">${a.active_customers || 0} active</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">POC Customers</span>
        <strong class="metric-value">${a.poc_customers || 0}</strong>
        <span class="metric-note">Trial evaluations</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Expiring This Week</span>
        <strong class="metric-value">${a.expiring_this_week || 0}</strong>
        <span class="metric-note">Renewal required</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Conversion Rate</span>
        <strong class="metric-value">${a.conversion_rate || 0}%</strong>
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
  renderCustomerList();
  populateCustomerForm(getSelectedCustomer());
  document.getElementById('customerProfile')?.scrollIntoView({ behavior: 'smooth' });
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
          Active:   ${'█'.repeat(Math.floor((a.active_customers / a.total_customers) * 20))} ${a.active_customers}<br>
          POC:      ${'█'.repeat(Math.floor((a.poc_customers / a.total_customers) * 20))} ${a.poc_customers}<br>
          Prospect: ${'█'.repeat(Math.floor(((a.total_customers - a.active_customers - a.poc_customers) / a.total_customers) * 20))} ${a.total_customers - a.active_customers - a.poc_customers}
        </div>
      </div>
      <div class="history-card">
        <h4 style="margin-bottom:16px;">License Status</h4>
        <div style="font-family:monospace;font-size:12px;line-height:1.8;">
          Expiring Week:  ${'█'.repeat(Math.min(a.expiring_this_week, 20))} ${a.expiring_this_week}<br>
          Expiring Month: ${'█'.repeat(Math.min(a.expiring_this_month, 20))} ${a.expiring_this_month}<br>
          Conversion:     ${'█'.repeat(Math.floor(a.conversion_rate / 5))} ${a.conversion_rate}%
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
async function loadOperators() {
  try {
    const result = await api('/api/operators');
    return result.operators || [];
  } catch (error) {
    return [];
  }
}

async function createOperator() {
  const fullName = prompt('Operator Full Name:');
  if (!fullName) return;
  
  const email = prompt('Operator Email:');
  if (!email) return;
  
  const password = prompt('Password (min 10 chars):');
  if (!password || password.length < 10) {
    showToast('Password must be at least 10 characters', 'error');
    return;
  }
  
  const role = prompt('Role (admin/sales/support):', 'sales');
  
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
          <div style="margin-top:8px;color:var(--muted);font-size:13px;">
            Last login: ${escapeHtml(formatDateTime(op.last_login_at))}
          </div>
        </div>
      `).join('')}
    </div>
  ` : '<div class="empty-state">No operators yet.</div>';
}

// Customer Self-Service Portal
function renderCustomerPortalInfo() {
  const container = document.getElementById('customerPortalContainer');
  if (!container) return;
  
  container.innerHTML = `
    <div class="history-card">
      <h4 style="margin-bottom:12px;">Customer Self-Service Portal</h4>
      <p style="color:var(--muted);margin-bottom:16px;">
        Customers can access their licenses and request renewals through the self-service portal.
      </p>
      <div style="background:var(--bg-elevated);padding:12px;border-radius:8px;font-family:monospace;font-size:13px;">
        Portal URL: http://localhost:3005/customer-portal<br>
        Login: Customer ID + License Key
      </div>
      <div style="margin-top:16px;">
        <strong>Features:</strong>
        <ul style="margin-top:8px;color:var(--muted);line-height:1.8;">
          <li>View license details</li>
          <li>Download license keys</li>
          <li>Request renewals</li>
          <li>View deployment guides</li>
        </ul>
      </div>
    </div>
  `;
}

// Security Features
function renderSecuritySettings() {
  const container = document.getElementById('securityContainer');
  if (!container) return;
  
  container.innerHTML = `
    <div class="form-grid">
      <div class="history-card">
        <h4 style="margin-bottom:12px;">Session Management</h4>
        <p style="color:var(--muted);font-size:13px;">
          ✅ Session timeout: 30 minutes<br>
          ✅ Auto-logout on inactivity<br>
          ✅ Secure token storage
        </p>
      </div>
      <div class="history-card">
        <h4 style="margin-bottom:12px;">Rate Limiting</h4>
        <p style="color:var(--muted);font-size:13px;">
          ✅ 100 requests per minute<br>
          ✅ IP-based tracking<br>
          ✅ Automatic cleanup
        </p>
      </div>
      <div class="history-card">
        <h4 style="margin-bottom:12px;">Data Protection</h4>
        <p style="color:var(--muted);font-size:13px;">
          ✅ AES-256-GCM encryption<br>
          ✅ Secure password hashing<br>
          ✅ GDPR compliance ready
        </p>
      </div>
      <div class="history-card">
        <h4 style="margin-bottom:12px;">Audit Trail</h4>
        <p style="color:var(--muted);font-size:13px;">
          ✅ All actions logged<br>
          ✅ Operator tracking<br>
          ✅ Timestamp records
        </p>
      </div>
    </div>

    <!-- CRL Management -->
    <div style="margin-top:32px;">
      <div class="section-header nested-header">
        <div>
          <div class="section-kicker">Certificate Revocation List</div>
          <h3 class="section-title">CRL Management</h3>
        </div>
        <div style="display:flex;gap:10px;">
          <button onclick="loadCRLStatus()" class="secondary-btn">Refresh</button>
          <button onclick="publishCRL()" class="primary-btn" id="publishCRLBtn">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Publish CRL to GitHub
          </button>
        </div>
      </div>

      <div id="crlStatusPanel" style="margin-bottom:20px;">
        <div class="empty-state">Loading CRL status...</div>
      </div>

      <div id="crlEntriesPanel"></div>
    </div>
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
          <div style="font-weight:700;color:#065f46;margin-bottom:4px;">✅ GitHub Publishing Configured</div>
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
        <div style="font-weight:700;color:#92400e;margin-bottom:8px;">⚠️ GitHub Token Not Set</div>
        <div style="font-size:13px;color:#78350f;line-height:1.7;">
          Repo is already configured: <strong>VY-Groups/HRMS-Release-Management</strong><br><br>
          You just need to add a GitHub Personal Access Token:<br><br>
          <strong>Step 1:</strong> Go to <a href="https://github.com/settings/tokens" target="_blank" style="color:#92400e;">github.com/settings/tokens</a> → Generate new token (classic)<br>
          <strong>Step 2:</strong> Select scope: <code>repo</code> (full control of private repositories)<br>
          <strong>Step 3:</strong> Add to <code>vendor-license-tool/backend/.env</code>:<br><br>
          <code style="background:rgba(0,0,0,.06);padding:8px 12px;border-radius:6px;display:block;font-size:12px;">
            CRL_GITHUB_TOKEN=ghp_your_token_here
          </code><br>
          <strong>Step 4:</strong> Restart the vendor tool server<br><br>
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
  if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }
  try {
    const result = await api('/api/crl/publish', { method: 'POST' });
    showToast(`CRL v${result.version} published — ${result.entries} revoked license(s)`, 'success');
    if (result.commit_url) {
      setTimeout(() => {
        if (confirm(`CRL published successfully!\n\nCommit: ${result.commit_url}\n\nOpen commit on GitHub?`)) {
          window.open(result.commit_url, '_blank');
        }
      }, 300);
    }
    await loadCRLStatus();
  } catch (error) {
    showToast(error.message || 'Failed to publish CRL', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Publish CRL to GitHub'; }
  }
}

async function removeCRLEntry(licenseId) {
  if (!confirm(`Remove license ${licenseId} from CRL?\n\nThis will allow the license to work again on HRMS after the next CRL fetch.`)) return;
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
  const confirm = prompt('Type DELETE to confirm permanent data deletion:');
  if (confirm !== 'DELETE') return;
  
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
window.renderCustomerPortalInfo = renderCustomerPortalInfo;
window.renderSecuritySettings = renderSecuritySettings;
window.exportCustomerData = exportCustomerData;
window.deleteCustomerData = deleteCustomerData;

// ==================== PAGE NAVIGATION FUNCTIONS ====================

function switchToPage(pageName) {
  state.currentPage = pageName;
  renderApp();
}

function switchToSystemUpdate() {
  state.currentPage = 'systemUpdate';
  renderApp();
  setTimeout(() => {
    bindCurrentView();
    renderSecurityNote();
  }, 100);
}

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
  switchToWorkspace();
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
    const res = await fetch('/api/updates/status', {
      headers: { Authorization: 'Bearer ' + state.sessionToken }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    if (data.available) {
      const relDate = data.release_date ? new Date(data.release_date).toLocaleDateString('en-IN', {dateStyle:'medium'}) : 'N/A';
      const sizeTxt = data.size_mb ? data.size_mb + ' MB' : '';
      statusDiv.innerHTML =
        '<div style="display:inline-block;padding:12px 20px;background:rgba(245,158,11,0.15);border-radius:12px;margin-bottom:20px;">' +
          '<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 12px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>' +
        '</div>' +
        '<h3 style="margin:0 0 14px 0;color:#92400e;font-size:24px;font-weight:800;">Update Available</h3>' +
        '<div style="display:flex;align-items:center;justify-content:center;gap:12px;font-size:18px;margin-bottom:12px;">' +
          '<span style="color:#94a3b8;font-weight:600;">v' + (data.current_version||'?') + '</span>' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>' +
          '<strong style="color:#6366f1;font-size:22px;font-weight:800;">v' + (data.latest_version||'?') + '</strong>' +
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
  } catch (err) {
    statusDiv.innerHTML =
      '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;margin:0 auto 16px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
      '<p style="margin:0 0 8px 0;color:#dc2626;font-size:16px;font-weight:700;">Could not check for updates</p>' +
      '<p style="margin:0;font-size:13px;color:#94a3b8;">' + err.message + '</p>';
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

  if (!confirm('Install the update now?\n\nThe system will:\n1. Download the latest version\n2. Apply the update safely\n3. Restart automatically\n\nYour data will NOT be affected.')) return;

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

    log('<span style="color:#4ade80;">✓</span> Update downloaded successfully', '#d4d4d4');
    log('<span style="color:#4ade80;">✓</span> Files applied safely', '#d4d4d4');
    log('<span style="color:#4ade80;">✓</span> ' + (result.message || 'Update installed!'), '#4ade80');

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
    log('<span style="color:#f87171;">✗</span> Error: ' + err.message, '#f87171');
    if (progressDiv) {
      progressDiv.innerHTML +=
        '<div style="background:rgba(239,68,68,0.08);border:2px solid rgba(239,68,68,0.3);border-radius:10px;padding:18px;margin-top:14px;text-align:center;">' +
          '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-3px;margin-right:8px;"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' +
          '<strong style="color:#b91c1c;font-size:15px;">Installation failed: ' + err.message + '</strong>' +
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
    const res = await fetch('/api/updates/history', {
      headers: { Authorization: 'Bearer ' + state.sessionToken }
    });
    
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const data = await res.json();
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
              <h3 style="margin:0;font-size:19px;font-weight:700;color:#111827;">v${version}</h3>
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
            Vendor Tool checks for updates every 24 hours. When a new version is available, you'll see an "Install Update Automatically" button in the System Update section.
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
        <p style="margin-top:10px;color:#6b7280;font-size:14px;">${err.message}</p>
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
window.closeSystemUpdate = closeSystemUpdate;
window.switchToSystemUpdate = switchToSystemUpdate;
window.switchToWorkspace = switchToWorkspace;
