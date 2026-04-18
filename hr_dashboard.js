const state = {
  token: localStorage.getItem('hr_dashboard_token') || '',
  adminName: localStorage.getItem('hr_dashboard_admin_name') || 'Admin',
  employees: [],
  notifications: [],
  filteredEmployees: [],
  charts: {}
};

const $ = (id) => document.getElementById(id);

function init() {
  applySavedTheme();
  bindEvents();
  setSystemInfo();

  if (state.token) {
    showApp();
    bootstrapDashboard();
  } else {
    showLogin();
  }
}

function bindEvents() {
  $('themeToggle')?.addEventListener('click', toggleTheme);
  $('refreshBtn')?.addEventListener('click', bootstrapDashboard);
  $('exportCsvBtn')?.addEventListener('click', exportCSV);
  $('exportPdfBtn')?.addEventListener('click', exportPDF);
  $('logoutBtn')?.addEventListener('click', logout);
  $('loginForm')?.addEventListener('submit', handleLogin);
  $('globalSearch')?.addEventListener('input', filterEmployees);
  $('visaFilter')?.addEventListener('change', filterEmployees);
  $('nationalityFilter')?.addEventListener('change', filterEmployees);
  $('restrictionFilter')?.addEventListener('change', filterEmployees);
  $('markAllNotificationsReadBtn')?.addEventListener('click', () => markNotificationsRead('all'));
  $('markAlertsReadBtn')?.addEventListener('click', () => markNotificationsRead('alerts'));

  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => switchSection(btn.dataset.section));
  });
}

async function handleLogin(event) {
  event.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;

  $('loginMessage').textContent = 'Logging in...';

  try {
    const response = await fetch(HR_DASHBOARD_CONFIG.authEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();
    if (!response.ok || !data?.success) {
      throw new Error(data?.message || 'Login failed');
    }

    state.token = data.token;
    state.adminName = data.admin_name || email;
    localStorage.setItem('hr_dashboard_token', state.token);
    localStorage.setItem('hr_dashboard_admin_name', state.adminName);

    showApp();
    bootstrapDashboard();
  } catch (error) {
    $('loginMessage').textContent = error.message || 'Unable to login.';
  }
}

function logout() {
  localStorage.removeItem('hr_dashboard_token');
  localStorage.removeItem('hr_dashboard_admin_name');
  state.token = '';
  showLogin();
}

function showLogin() {
  $('loginOverlay')?.classList.remove('hidden');
  $('appShell')?.classList.add('hidden');
}

function showApp() {
  $('loginOverlay')?.classList.add('hidden');
  $('appShell')?.classList.remove('hidden');
  $('adminNameTag').textContent = state.adminName;
}

async function bootstrapDashboard() {
  try {
    const [employees, notifications] = await Promise.all([
      fetchEmployees(),
      fetchNotifications()
    ]);

    state.employees = normalizeEmployees(employees);
    state.notifications = normalizeNotifications(notifications, state.employees);
    state.filteredEmployees = [...state.employees];

    renderOverview();
    renderFilterOptions();
    filterEmployees();
    renderAlertsTable();
    renderNotifications();
    renderCharts();
    updateLastSync();
  } catch (error) {
    console.error('Dashboard load error:', error);
    alert(`Dashboard load failed: ${error.message}`);
  }
}

async function fetchEmployees() {
  const response = await fetch(HR_DASHBOARD_CONFIG.employeesEndpoint, {
    headers: buildAuthHeaders()
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || 'Failed to fetch employee data');
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

async function fetchNotifications() {
  const response = await fetch(HR_DASHBOARD_CONFIG.notificationsEndpoint, {
    headers: buildAuthHeaders()
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || 'Failed to fetch notifications');
  return Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
}

async function markNotificationsRead(scope = 'all', id = null) {
  try {
    state.notifications = state.notifications.map((item) => {
      if (scope === 'all') return { ...item, read: true };
      if (scope === 'alerts' && item.type === 'alert') return { ...item, read: true };
      if (scope === 'single' && item.id === id) return { ...item, read: true };
      return item;
    });
    renderNotifications();
    renderOverview();

    if (HR_DASHBOARD_CONFIG.markNotificationReadEndpoint) {
      await fetch(HR_DASHBOARD_CONFIG.markNotificationReadEndpoint, {
        method: 'POST',
        headers: {
          ...buildAuthHeaders(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ scope, id })
      });
    }
  } catch (error) {
    console.error('markNotificationsRead error:', error);
  }
}
window.markNotificationsRead = markNotificationsRead;

function buildAuthHeaders() {
  const headers = { Accept: 'application/json' };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  return headers;
}

function normalizeEmployees(rows) {
  return rows.map((row, index) => {
    const surname = pick(row, ['Surname', 'surname']);
    const given = pick(row, ['Given Names', 'given_names']);
    const fullName = [given, surname].filter(Boolean).join(' ').trim() || `Employee ${index + 1}`;
    const currentVisa = pick(row, ['current_visa', 'Current Visa', 'visa_type']) || '-';
    const visaClass = pick(row, ['visa_class', 'Visa Class']);
    const visaSubClass = pick(row, ['visa_sub_class', 'Visa Sub Class']);
    const visaExpiry = pick(row, ['visa_expiry_date', 'Visa Expiry Date']);
    const restrictedRaw = pick(row, ['restricted_work_hours', 'restrictedHours', 'restricted_hours']);
    const restrictionDetails = pick(row, ['restriction_details', 'restrictionDetails']);
    const nationality = pick(row, ['Nationality', 'nationality']) || 'Unknown';
    const declarationDate = pick(row, ['declaration_date', 'Declaration Date']) || pick(row, ['created_at', 'Created At']);

    const daysLeft = calculateDaysLeft(visaExpiry);
    const isRestricted = /^yes$/i.test(String(restrictedRaw || '').trim());
    const isExpiring = Number.isFinite(daysLeft) && daysLeft <= HR_DASHBOARD_CONFIG.visaWarningDays && daysLeft >= 0;
    const expired = Number.isFinite(daysLeft) && daysLeft < 0;

    return {
      id: pick(row, ['id', 'ID']) || `${fullName}-${index}`,
      full_name: fullName,
      surname,
      given_names: given,
      contact_mobile_no: sanitizePhone(pick(row, ['Contact Mobile No', 'contact_mobile_no'])),
      contact_email_address: pick(row, ['Contact Email Address', 'contact_email_address']) || '-',
      nationality,
      suburb: pick(row, ['suburb', 'Suburb']) || '-',
      postal_code: pick(row, ['Postal Code', 'postal_code']) || '-',
      current_visa: currentVisa,
      visa_class: visaClass || '-',
      visa_sub_class: visaSubClass || '-',
      visa_expiry_date: visaExpiry || '',
      declaration_date: declarationDate || '',
      restricted_work_hours: isRestricted ? 'YES' : 'NO',
      restriction_details: restrictionDetails || '-',
      is_restricted: isRestricted,
      days_left: daysLeft,
      status: expired ? 'expired' : isExpiring ? 'visa-expiring' : isRestricted ? 'restricted' : 'active'
    };
  }).sort((a, b) => {
    const da = new Date(a.declaration_date || 0).getTime();
    const db = new Date(b.declaration_date || 0).getTime();
    return db - da;
  });
}

function normalizeNotifications(notifications, employees) {
  const base = notifications.map((item, index) => ({
    id: item.id || `n-${index}`,
    title: item.title || 'Notification',
    message: item.message || item.text || '-',
    type: item.type || 'info',
    created_at: item.created_at || item.date || new Date().toISOString(),
    read: Boolean(item.read)
  }));

  const autoAlerts = employees
    .filter((employee) => employee.status === 'visa-expiring' || employee.status === 'expired')
    .slice(0, 50)
    .map((employee) => ({
      id: `alert-${employee.id}`,
      title: employee.status === 'expired' ? 'Visa expired' : 'Visa expiring soon',
      message: `${employee.full_name} - ${employee.current_visa} expires on ${formatDate(employee.visa_expiry_date)}`,
      type: 'alert',
      created_at: employee.visa_expiry_date || new Date().toISOString(),
      read: false
    }));

  const merged = [...autoAlerts, ...base];
  const unique = new Map();
  merged.forEach((item) => unique.set(item.id, item));

  return Array.from(unique.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function renderOverview() {
  const total = state.employees.length;
  const nationalityMap = countBy(state.employees, (item) => item.nationality);
  const visaTypeMap = countBy(state.employees, (item) => item.current_visa);
  const expiring = state.employees.filter((item) => item.status === 'visa-expiring' || item.status === 'expired');
  const restricted = state.employees.filter((item) => item.is_restricted);
  const unread = state.notifications.filter((item) => !item.read).length;

  $('totalEmployees').textContent = total;
  $('totalNationalities').textContent = Object.keys(nationalityMap).length;
  $('expiring30').textContent = expiring.length;
  $('restrictedCount').textContent = restricted.length;
  $('visaTypeCount').textContent = Object.keys(visaTypeMap).length;
  $('unreadNotifications').textContent = unread;
  $('warningCount').textContent = `${expiring.length} items`;

  const recent = state.employees.slice(0, 8);
  $('recentRegistrationsCount').textContent = `${recent.length} items`;
  $('recentRegistrations').innerHTML = recent.length
    ? recent.map((employee) => `
      <div class="timeline-item">
        <h4>${escapeHtml(employee.full_name)}</h4>
        <p>${escapeHtml(employee.nationality)} • ${escapeHtml(employee.current_visa)}</p>
        <div class="timeline-meta">Registered: ${formatDate(employee.declaration_date)} ${employee.contact_mobile_no ? `• ${escapeHtml(employee.contact_mobile_no)}` : ''}</div>
      </div>
    `).join('')
    : emptyState('No recent registrations yet.');

  $('warningTableBody').innerHTML = expiring.length
    ? expiring
        .sort((a, b) => a.days_left - b.days_left)
        .map((employee) => `
          <tr>
            <td>${escapeHtml(employee.full_name)}</td>
            <td>${escapeHtml(employee.nationality)}</td>
            <td>${escapeHtml(employee.current_visa)}</td>
            <td>${formatDate(employee.visa_expiry_date)}</td>
            <td>${employee.days_left}</td>
            <td>${employee.is_restricted ? escapeHtml(employee.restriction_details) : '-'}</td>
          </tr>
        `).join('')
    : `<tr><td colspan="6">No visa warnings for the selected window.</td></tr>`;
}

function renderFilterOptions() {
  populateSelect('visaFilter', ['all', ...sortAlpha(uniqueValues(state.employees.map((item) => item.current_visa)))]);
  populateSelect('nationalityFilter', ['all', ...sortAlpha(uniqueValues(state.employees.map((item) => item.nationality)))]);
}

function filterEmployees() {
  const keyword = ($('globalSearch')?.value || '').trim().toLowerCase();
  const visaFilter = $('visaFilter')?.value || 'all';
  const nationalityFilter = $('nationalityFilter')?.value || 'all';
  const restrictionFilter = $('restrictionFilter')?.value || 'all';

  state.filteredEmployees = state.employees.filter((employee) => {
    const matchesKeyword = !keyword || [
      employee.full_name,
      employee.contact_mobile_no,
      employee.contact_email_address,
      employee.nationality,
      employee.current_visa,
      employee.suburb,
      employee.postal_code,
      employee.visa_class,
      employee.visa_sub_class
    ].join(' ').toLowerCase().includes(keyword);

    const matchesVisa = visaFilter === 'all' || employee.current_visa === visaFilter;
    const matchesNationality = nationalityFilter === 'all' || employee.nationality === nationalityFilter;
    const matchesRestriction = restrictionFilter === 'all'
      || (restrictionFilter === 'restricted' && employee.is_restricted)
      || (restrictionFilter === 'not-restricted' && !employee.is_restricted);

    return matchesKeyword && matchesVisa && matchesNationality && matchesRestriction;
  });

  renderEmployeesTable();
}

function renderEmployeesTable() {
  $('employeeTableBody').innerHTML = state.filteredEmployees.length
    ? state.filteredEmployees.map((employee) => `
      <tr>
        <td>${escapeHtml(employee.full_name)}</td>
        <td>${escapeHtml(employee.contact_mobile_no || '-')}</td>
        <td>${escapeHtml(employee.nationality)}</td>
        <td>${escapeHtml(employee.current_visa)}</td>
        <td>${formatDate(employee.visa_expiry_date)}</td>
        <td>${employee.is_restricted ? escapeHtml(employee.restriction_details) : 'No restriction'}</td>
        <td>${statusMarkup(employee.status, employee.days_left)}</td>
      </tr>
    `).join('')
    : `<tr><td colspan="7">No matching employees found.</td></tr>`;
}

function renderAlertsTable() {
  const alerts = state.employees.filter((employee) => employee.status === 'visa-expiring' || employee.status === 'expired');
  $('alertsTableBody').innerHTML = alerts.length
    ? alerts
      .sort((a, b) => a.days_left - b.days_left)
      .map((employee) => `
        <tr>
          <td>${escapeHtml(employee.full_name)}</td>
          <td>${escapeHtml(employee.current_visa)}</td>
          <td>${escapeHtml(`${employee.visa_class} / ${employee.visa_sub_class}`)}</td>
          <td>${formatDate(employee.visa_expiry_date)}</td>
          <td>${employee.days_left}</td>
          <td><button class="inline-btn" onclick="markNotificationsRead('single','alert-${escapeHtml(employee.id)}')">Mark read</button></td>
        </tr>
      `).join('')
    : `<tr><td colspan="6">No visa expiry alerts right now.</td></tr>`;
}

function renderNotifications() {
  $('notificationList').innerHTML = state.notifications.length
    ? state.notifications.map((item) => `
      <div class="notification-item">
        <h4>${escapeHtml(item.title)} ${item.read ? '' : '<span class="status-chip info">Unread</span>'}</h4>
        <p>${escapeHtml(item.message)}</p>
        <div class="notification-meta">
          ${formatDateTime(item.created_at)} • ${escapeHtml(item.type)}
        </div>
      </div>
    `).join('')
    : emptyState('No notifications available.');
}

function renderCharts() {
  const nationalityMap = countBy(state.employees, (item) => item.nationality);
  const visaTypeMap = countBy(state.employees, (item) => item.current_visa);
  const restrictionMap = {
    Restricted: state.employees.filter((item) => item.is_restricted).length,
    'No Restriction': state.employees.filter((item) => !item.is_restricted).length
  };
  const expiryBuckets = bucketExpiries(state.employees);

  renderChart('nationalityChart', 'doughnut', nationalityMap, 'Employees');
  renderChart('visaTypeChart', 'bar', visaTypeMap, 'Employees');
  renderChart('restrictionChart', 'pie', restrictionMap, 'Employees');
  renderChart('expiryTimelineChart', 'bar', expiryBuckets, 'Employees');
}

function renderChart(canvasId, type, mapObject, label) {
  const labels = Object.keys(mapObject);
  const data = Object.values(mapObject);
  const ctx = $(canvasId);
  if (!ctx) return;

  if (state.charts[canvasId]) state.charts[canvasId].destroy();

  state.charts[canvasId] = new Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data,
        backgroundColor: [
          '#6366f1', '#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#14b8a6', '#f97316', '#a855f7', '#0ea5e9'
        ],
        borderWidth: 0,
        borderRadius: type === 'bar' ? 12 : 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: getComputedStyle(document.body).getPropertyValue('--text') } }
      },
      scales: type === 'bar' ? {
        x: { ticks: { color: getComputedStyle(document.body).getPropertyValue('--muted') }, grid: { color: getComputedStyle(document.body).getPropertyValue('--line') } },
        y: { beginAtZero: true, ticks: { color: getComputedStyle(document.body).getPropertyValue('--muted') }, grid: { color: getComputedStyle(document.body).getPropertyValue('--line') } }
      } : {}
    }
  });
}

function exportCSV() {
  if (!state.filteredEmployees.length) return;
  const rows = state.filteredEmployees.map((employee) => ({
    Name: employee.full_name,
    Mobile: employee.contact_mobile_no,
    Email: employee.contact_email_address,
    Nationality: employee.nationality,
    Visa: employee.current_visa,
    Visa_Class: employee.visa_class,
    Visa_Sub_Class: employee.visa_sub_class,
    Visa_Expiry: employee.visa_expiry_date,
    Restriction: employee.restriction_details,
    Status: employee.status
  }));

  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'hr-dashboard-export.csv';
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF() {
  window.print();
}

function switchSection(section) {
  document.querySelectorAll('.nav-link').forEach((btn) => btn.classList.remove('active'));
  document.querySelectorAll('.content-section').forEach((sec) => sec.classList.add('hidden'));
  document.querySelector(`[data-section="${section}"]`)?.classList.add('active');
  $(`${section}Section`)?.classList.remove('hidden');
}

function setSystemInfo() {
  $('employeesApiText').textContent = HR_DASHBOARD_CONFIG.employeesEndpoint;
  $('notificationsApiText').textContent = HR_DASHBOARD_CONFIG.notificationsEndpoint;
  $('pollIntervalText').textContent = `${HR_DASHBOARD_CONFIG.pollingSeconds} seconds`;
  $('warningWindowText').textContent = `${HR_DASHBOARD_CONFIG.visaWarningDays} days`;
}

function updateLastSync() {
  $('lastSyncText').textContent = `Last synced: ${formatDateTime(new Date().toISOString())}`;
}

function toggleTheme() {
  const next = document.body.classList.contains('dark') ? 'light' : 'dark';
  setTheme(next);
  renderCharts();
}

function applySavedTheme() {
  setTheme(localStorage.getItem('hr_dashboard_theme') || 'light');
}

function setTheme(theme) {
  document.body.classList.toggle('dark', theme === 'dark');
  localStorage.setItem('hr_dashboard_theme', theme);
}

function pick(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && row?.[key] !== '') return row[key];
  }
  return '';
}

function sanitizePhone(phone) {
  return String(phone || '').replace(/^'/, '').trim();
}

function countBy(array, selector) {
  return array.reduce((acc, item) => {
    const key = selector(item) || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function uniqueValues(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function sortAlpha(arr) {
  return arr.sort((a, b) => String(a).localeCompare(String(b)));
}

function calculateDaysLeft(dateValue) {
  if (!dateValue) return NaN;
  const target = new Date(dateValue);
  if (Number.isNaN(target.getTime())) return NaN;
  const now = new Date();
  const diff = target.setHours(0,0,0,0) - now.setHours(0,0,0,0);
  return Math.ceil(diff / 86400000);
}

function bucketExpiries(employees) {
  const buckets = {
    'Expired': 0,
    '0-30 days': 0,
    '31-60 days': 0,
    '61-90 days': 0,
    '90+ days': 0,
    'Unknown': 0
  };

  employees.forEach((employee) => {
    const d = employee.days_left;
    if (!Number.isFinite(d)) buckets['Unknown'] += 1;
    else if (d < 0) buckets['Expired'] += 1;
    else if (d <= 30) buckets['0-30 days'] += 1;
    else if (d <= 60) buckets['31-60 days'] += 1;
    else if (d <= 90) buckets['61-90 days'] += 1;
    else buckets['90+ days'] += 1;
  });

  return buckets;
}

function statusMarkup(status, daysLeft) {
  if (status === 'expired') return `<span class="status-chip danger">Expired</span>`;
  if (status === 'visa-expiring') return `<span class="status-chip warn">${daysLeft} days left</span>`;
  if (status === 'restricted') return `<span class="status-chip info">Restricted</span>`;
  return `<span class="status-chip ok">Active</span>`;
}

function populateSelect(id, values) {
  const select = $(id);
  if (!select) return;
  const current = select.value;
  select.innerHTML = values.map((value) => `
    <option value="${escapeHtml(value)}">${value === 'all' ? select.options[0]?.text || 'All' : escapeHtml(value)}</option>
  `).join('');
  if (values.includes(current)) select.value = current;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function emptyState(text) {
  return `<div class="timeline-item"><p>${escapeHtml(text)}</p></div>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

document.addEventListener('DOMContentLoaded', init);
