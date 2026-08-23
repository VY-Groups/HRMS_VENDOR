// ==================== VENDOR TOOL V3 - SMART IMPROVEMENTS ====================
// Version: 3.0.0 - Smart Features & Optimizations
// Date: April 30, 2026

const TOKEN_KEY = 'vendor_console_token';
const CACHE_KEY_PREFIX = 'vendor_cache_';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const root = document.getElementById('root');
const toastRegion = document.getElementById('toastRegion');

const VENDOR_TOOL_VERSION = 'v3.0.0-smart-features';
console.log('🚀 Vendor Tool V3 Loaded:', VENDOR_TOOL_VERSION, 'Time:', new Date().toISOString());

let clockTimer = null;
let searchDebounceTimer = null;
let autoRefreshTimer = null;

// ==================== SMART CACHE SYSTEM ====================

const cache = {
  set(key, value, ttl = CACHE_TTL) {
    const item = {
      value,
      expiry: Date.now() + ttl,
      timestamp: Date.now()
    };
    try {
      localStorage.setItem(CACHE_KEY_PREFIX + key, JSON.stringify(item));
    } catch (e) {
      console.warn('Cache storage failed:', e);
    }
  },
  
  get(key) {
    try {
      const item = JSON.parse(localStorage.getItem(CACHE_KEY_PREFIX + key));
      if (!item) return null;
      if (Date.now() > item.expiry) {
        this.remove(key);
        return null;
      }
      return item.value;
    } catch (e) {
      return null;
    }
  },
  
  remove(key) {
    localStorage.removeItem(CACHE_KEY_PREFIX + key);
  },
  
  clear() {
    Object.keys(localStorage)
      .filter(key => key.startsWith(CACHE_KEY_PREFIX))
      .forEach(key => localStorage.removeItem(key));
  },
  
  isStale(key, maxAge = CACHE_TTL) {
    try {
      const item = JSON.parse(localStorage.getItem(CACHE_KEY_PREFIX + key));
      if (!item) return true;
      return Date.now() - item.timestamp > maxAge;
    } catch (e) {
      return true;
    }
  }
};

// ==================== KEYBOARD SHORTCUTS ====================

const shortcuts = {
  'ctrl+k': () => {
    const search = document.getElementById('customerSearch');
    if (search) {
      search.focus();
      search.select();
    }
  },
  'ctrl+n': () => {
    if (state.view === 'workspace') {
      startNewCustomer();
    }
  },
  'ctrl+s': (e) => {
    if (state.view === 'workspace' && state.currentPage === 'profile') {
      e.preventDefault();
      const saveBtn = document.getElementById('saveCustomerBtn');
      if (saveBtn && !saveBtn.disabled) {
        saveBtn.click();
      }
    }
  },
  'ctrl+1': () => switchToPage('overview'),
  'ctrl+2': () => switchToPage('customers'),
  'ctrl+3': () => switchToPage('profile'),
  'ctrl+4': () => switchToPage('licenses'),
  'ctrl+5': () => switchToPage('analytics'),
  'ctrl+6': () => switchToPage('audit'),
  'ctrl+7': () => switchToPage('templates'),
  'ctrl+8': () => switchToPage('operators'),
  'ctrl+9': () => switchToPage('security'),
  'escape': () => {
    state.selectedCustomerId = '';
    state.searchQuery = '';
    const search = document.getElementById('customerSearch');
    if (search) search.value = '';
    if (state.currentPage === 'customers') {
      renderCustomerList();
    }
  }
};

function handleKeyboardShortcut(e) {
  const key = [];
  if (e.ctrlKey || e.metaKey) key.push('ctrl');
  if (e.shiftKey) key.push('shift');
  if (e.altKey) key.push('alt');
  key.push(e.key.toLowerCase());
  
  const shortcut = key.join('+');
  const handler = shortcuts[shortcut];
  
  if (handler) {
    handler(e);
  }
}

// ==================== RECENT ACTIVITY TRACKING ====================

const recentActivity = {
  items: [],
  maxItems: 5,
  
  add(action, description, customerId = null) {
    this.items.unshift({
      action,
      description,
      customerId,
      timestamp: Date.now()
    });
    
    if (this.items.length > this.maxItems) {
      this.items = this.items.slice(0, this.maxItems);
    }
    
    this.save();
    this.render();
  },
  
  save() {
    try {
      localStorage.setItem('vendor_recent_activity', JSON.stringify(this.items));
    } catch (e) {
      console.warn('Failed to save recent activity:', e);
    }
  },
  
  load() {
    try {
      const saved = localStorage.getItem('vendor_recent_activity');
      if (saved) {
        this.items = JSON.parse(saved);
      }
    } catch (e) {
      this.items = [];
    }
  },
  
  render() {
    const container = document.getElementById('recentActivityFeed');
    if (!container) return;
    
    if (this.items.length === 0) {
      container.innerHTML = '<div class="empty-state-small">No recent activity</div>';
      return;
    }
    
    container.innerHTML = this.items.map(item => {
      const timeAgo = getTimeAgo(item.timestamp);
      return `
        <div class="activity-item" ${item.customerId ? `onclick="selectCustomerById('${item.customerId}')"` : ''}>
          <div class="activity-description">${escapeHtml(item.description)}</div>
          <div class="activity-time">${timeAgo}</div>
        </div>
      `;
    }).join('');
  }
};

function getTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ==================== BREADCRUMB NAVIGATION ====================

function renderBreadcrumb() {
  const parts = ['Home'];
  
  if (state.currentPage === 'overview') {
    parts.push('Dashboard');
  } else if (state.currentPage === 'customers') {
    parts.push('Customers');
  } else if (state.currentPage === 'profile') {
    parts.push('Customers');
    const customer = getSelectedCustomer();
    if (customer) {
      parts.push(customer.legal_name);
    } else {
      parts.push('New Customer');
    }
  } else if (state.currentPage === 'licenses') {
    parts.push('Licenses');
  } else if (state.currentPage === 'analytics') {
    parts.push('Analytics');
  } else if (state.currentPage === 'audit') {
    parts.push('Audit Log');
  } else if (state.currentPage === 'templates') {
    parts.push('Templates');
  } else if (state.currentPage === 'operators') {
    parts.push('Operators');
  } else if (state.currentPage === 'portal') {
    parts.push('Customer Portal');
  } else if (state.currentPage === 'security') {
    parts.push('Security');
  } else if (state.currentPage === 'systemUpdate') {
    parts.push('System Update');
  }
  
  return `
    <div class="breadcrumb">
      ${parts.map((part, index) => {
        const isLast = index === parts.length - 1;
        return `<span class="breadcrumb-item ${isLast ? 'active' : ''}">${escapeHtml(part)}</span>`;
      }).join('<span class="breadcrumb-separator">›</span>')}
    </div>
  `;
}

// ==================== SMART NOTIFICATIONS ====================

const notifications = {
  items: [],
  
  add(type, title, message, action = null) {
    const notification = {
      id: Date.now() + Math.random(),
      type, // 'info', 'warning', 'error', 'success'
      title,
      message,
      action,
      timestamp: Date.now(),
      read: false
    };
    
    this.items.unshift(notification);
    this.render();
    
    // Auto-dismiss after 10 seconds
    setTimeout(() => this.dismiss(notification.id), 10000);
  },
  
  dismiss(id) {
    this.items = this.items.filter(item => item.id !== id);
    this.render();
  },
  
  render() {
    const container = document.getElementById('notificationCenter');
    if (!container) return;
    
    const unread = this.items.filter(item => !item.read);
    const badge = document.getElementById('notificationBadge');
    if (badge) {
      badge.textContent = unread.length;
      badge.style.display = unread.length > 0 ? 'block' : 'none';
    }
  }
};

// ==================== LOADING STATES ====================

function showLoadingState(containerId, message = 'Loading...') {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-message">${escapeHtml(message)}</div>
    </div>
  `;
}

function showSkeletonLoader(containerId, type = 'list') {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (type === 'list') {
    container.innerHTML = `
      <div class="skeleton-loader">
        ${Array(5).fill(0).map(() => `
          <div class="skeleton-item">
            <div class="skeleton-avatar"></div>
            <div class="skeleton-content">
              <div class="skeleton-line skeleton-line-title"></div>
              <div class="skeleton-line skeleton-line-text"></div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  } else if (type === 'card') {
    container.innerHTML = `
      <div class="skeleton-card">
        <div class="skeleton-line skeleton-line-title"></div>
        <div class="skeleton-line skeleton-line-text"></div>
        <div class="skeleton-line skeleton-line-text"></div>
      </div>
    `;
  }
}

// ==================== DEBOUNCED SEARCH ====================

function debouncedSearch(query, delay = 300) {
  clearTimeout(searchDebounceTimer);
  
  searchDebounceTimer = setTimeout(() => {
    state.searchQuery = query;
    renderCustomerList();
  }, delay);
}

// ==================== AUTO REFRESH ====================

function startAutoRefresh(interval = 5 * 60 * 1000) { // 5 minutes
  stopAutoRefresh();
  
  autoRefreshTimer = setInterval(async () => {
    if (state.view === 'workspace') {
      console.log('🔄 Auto-refreshing data...');
      await refreshDashboard();
      showToast('Data refreshed', 'info');
    }
  }, interval);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

// ==================== CUSTOMER HEALTH SCORE ====================

function calculateHealthScore(customer) {
  if (!customer) return { score: 0, status: 'unknown', color: 'gray' };
  
  let score = 100;
  const renewalDays = getDaysUntil(customer.renewal_date);
  
  // Deduct points based on renewal proximity
  if (renewalDays !== null) {
    if (renewalDays < 0) score -= 50; // Expired
    else if (renewalDays < 7) score -= 30; // Critical
    else if (renewalDays < 30) score -= 15; // Warning
  }
  
  // Deduct points for missing information
  if (!customer.hardware_id) score -= 10;
  if (!customer.contact_email) score -= 10;
  if (!customer.primary_contact) score -= 5;
  
  // Deduct points for inactive status
  if (customer.status === 'inactive') score -= 20;
  if (customer.status === 'archived') score -= 40;
  
  score = Math.max(0, Math.min(100, score));
  
  let status, color;
  if (score >= 80) {
    status = 'Healthy';
    color = '#10b981'; // green
  } else if (score >= 50) {
    status = 'At Risk';
    color = '#f59e0b'; // yellow
  } else {
    status = 'Critical';
    color = '#ef4444'; // red
  }
  
  return { score, status, color };
}

// ==================== SMART INSIGHTS ====================

function getSmartInsights() {
  const insights = [];
  
  // Expiring licenses
  const expiringSoon = state.customers.filter(c => {
    const days = getDaysUntil(c.renewal_date);
    return days !== null && days > 0 && days <= 30;
  });
  
  if (expiringSoon.length > 0) {
    insights.push({
      type: 'warning',
      icon: '⚠️',
      title: `${expiringSoon.length} license${expiringSoon.length > 1 ? 's' : ''} expiring soon`,
      description: 'Customers need renewal attention',
      action: () => switchToPage('customers')
    });
  }
  
  // Expired licenses
  const expired = state.customers.filter(c => {
    const days = getDaysUntil(c.renewal_date);
    return days !== null && days < 0;
  });
  
  if (expired.length > 0) {
    insights.push({
      type: 'error',
      icon: '🔴',
      title: `${expired.length} expired license${expired.length > 1 ? 's' : ''}`,
      description: 'Immediate action required',
      action: () => switchToPage('customers')
    });
  }
  
  // POC customers ready for conversion
  const pocCustomers = state.customers.filter(c => 
    c.status === 'poc' || c.plan === 'poc'
  );
  
  if (pocCustomers.length > 0) {
    insights.push({
      type: 'info',
      icon: '💡',
      title: `${pocCustomers.length} POC customer${pocCustomers.length > 1 ? 's' : ''}`,
      description: 'Consider converting to paid plans',
      action: () => switchToPage('customers')
    });
  }
  
  // Missing hardware IDs
  const missingHardware = state.customers.filter(c => 
    c.status === 'active' && !c.hardware_id
  );
  
  if (missingHardware.length > 0) {
    insights.push({
      type: 'warning',
      icon: '🔧',
      title: `${missingHardware.length} customer${missingHardware.length > 1 ? 's' : ''} missing hardware ID`,
      description: 'Deployment readiness incomplete',
      action: () => switchToPage('customers')
    });
  }
  
  return insights;
}

function renderSmartInsights() {
  const container = document.getElementById('smartInsights');
  if (!container) return;
  
  const insights = getSmartInsights();
  
  if (insights.length === 0) {
    container.innerHTML = `
      <div class="insight-card insight-success">
        <div class="insight-icon">✅</div>
        <div class="insight-content">
          <div class="insight-title">All systems healthy</div>
          <div class="insight-description">No immediate actions required</div>
        </div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = insights.map(insight => `
    <div class="insight-card insight-${insight.type}" ${insight.action ? `onclick="(${insight.action.toString()})()"` : ''}>
      <div class="insight-icon">${insight.icon}</div>
      <div class="insight-content">
        <div class="insight-title">${escapeHtml(insight.title)}</div>
        <div class="insight-description">${escapeHtml(insight.description)}</div>
      </div>
    </div>
  `).join('');
}

// ==================== EXPORT/IMPORT FUNCTIONALITY ====================

function exportAllData() {
  const data = {
    version: VENDOR_TOOL_VERSION,
    exportDate: new Date().toISOString(),
    customers: state.customers,
    summary: state.summary,
    analytics: state.analytics
  };
  
  const json = JSON.stringify(data, null, 2);
  const filename = `vendor-tool-export-${new Date().toISOString().split('T')[0]}.json`;
  downloadTextFile(filename, json, 'application/json');
  
  recentActivity.add('export', 'Exported all data to JSON');
  showToast('Data exported successfully', 'success');
}

function exportCustomersCSV() {
  const headers = ['Legal Name', 'Workspace', 'Contact', 'Email', 'Phone', 'Plan', 'Status', 'Renewal Date', 'Hardware ID'];
  const rows = state.customers.map(c => [
    c.legal_name,
    c.workspace_name,
    c.primary_contact,
    c.contact_email,
    c.contact_phone,
    c.plan,
    c.status,
    c.renewal_date || '',
    c.hardware_id || ''
  ]);
  
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  
  const filename = `customers-${new Date().toISOString().split('T')[0]}.csv`;
  downloadTextFile(filename, csv, 'text/csv');
  
  recentActivity.add('export', 'Exported customers to CSV');
  showToast('Customers exported to CSV', 'success');
}

// This file will be continued in the next part due to length...
// The rest of the original app-v2.js code will be imported below

