/* ===================================================
   人头马年框项目管理 - 前端主程序
   对接后端 API：
   - 正常：与页面同源 /api（用 node 启动后访问 http://localhost:端口/）
   - 若误用 file:// 打开本页：读 localStorage.remy_apiBase，否则默认 http://127.0.0.1:3088/api
   =================================================== */

function resolveApiBase() {
  try {
    if (typeof window === 'undefined' || !window.location) return '/api';
    const { protocol } = window.location;
    if (protocol === 'file:') {
      const custom = localStorage.getItem('remy_apiBase');
      if (custom) return String(custom).replace(/\/$/, '');
      return 'http://127.0.0.1:3088/api';
    }
  } catch (e) { /* ignore */ }
  return '/api';
}

const API = resolveApiBase();
// 25年度：2025-04-01 → 2026-03-31，所有历史数据均属于25年度
let currentYear = localStorage.getItem('remy_activeYear') || '25';
let currentYearFrameId = null;
let currentPage = localStorage.getItem('remy_currentPage') || 'dashboard';
let activitiesState = { page: 1, search: '', type: '', period: '', region: '', brand: '', year: '', month: '', sortOrder: 'DESC', data: [], total: 0 };
let logisticsState = { data: [], selectedIds: new Set() };
let warehouseState = { data: [], selectedIds: new Set() };
let charts = {};
let costNoCostYMFilter = localStorage.getItem('remy_costNoCostYMFilter') || 'all';
let pendingDeleteActivityId = null;
let pendingDeleteActivityAt = 0;
const DELETE_CONFIRM_MS = 8000;

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', async () => {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    showToast('请通过 node 启动项目后在浏览器访问 http://localhost:端口/（不要直接打开 html 文件）', 'warning');
  }
  applyTheme(localStorage.getItem('remy_theme') || 'dark');
  loadAppVersion();
  await loadYearFrames();
  await initBrands();
  navigate(currentPage);
  checkConnection();
  renderLucideIcons();
});

// ===== API 请求封装 =====
async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const url = `${API}${path}`;
    const res = await fetch(url, opts);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(
        res.ok ? '响应不是合法 JSON' : `请求失败 (${res.status})，URL：${url}`
      );
    }
    if (!res.ok) {
      throw new Error(data.error || data.message || `请求失败 (${res.status})，URL：${url}`);
    }
    return data;
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (err instanceof TypeError && (msg.includes('fetch') || msg.includes('Load failed') || msg.includes('Failed to fetch'))) {
      throw new Error(
        '连不上接口：请确认已运行 node src/server.js，并用浏览器打开 http://localhost 上的地址（不要 file:// 打开）。当前 API：' + API
      );
    }
    throw err;
  }
}

// ===== 年框管理 =====
async function loadYearFrames() {
  try {
    const frames = await api('GET', '/year-frames');
    const target = frames.find(f => f.year.startsWith(currentYear));
    if (target) currentYearFrameId = target.id;
    updateBadges();
  } catch (e) {
    console.error('加载年框失败', e);
  }
}

function switchYear(year) {
  currentYear = year;
  localStorage.setItem('remy_activeYear', year);
  document.querySelectorAll('.year-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.year === year);
  });
  document.getElementById('yearBadge').textContent = year + '年度';
  dashboardState = {
    brand: '',
    region: '',
    activityType: '',
    executionFlag: '',
    period: '',
    month: '',
  };
  loadYearFrames().then(() => navigate(currentPage));
}

// ===== 导航 =====
function navigate(page) {
  currentPage = page;
  localStorage.setItem('remy_currentPage', page);

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  const titles = {
    dashboard: '数据看板',
    activities: '活动记录',
    calendar: '排期日历',
    cost: '成本管理',
    logistics: '物流记录',
    warehouse: '仓储记录',
    wine: '客户用酒',
    backup: '数据备份',
  };
  document.getElementById('pageTitle').textContent = titles[page] || page;

  const container = document.getElementById('pageContainer');
  container.innerHTML = '<div class="empty-state"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>';

  // 销毁旧图表
  Object.values(charts).forEach(c => c && c.destroy());
  charts = {};

  const renders = {
    dashboard: renderDashboard,
    activities: renderActivities,
    calendar: renderCalendar,
    cost: renderCost,
    logistics: renderLogistics,
    warehouse: renderWarehouse,
    wine: renderWine,
    backup: renderBackup,
  };
  if (renders[page]) {
    Promise.resolve(renders[page]()).finally(() => {
      renderLucideIcons();
    });
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
  document.getElementById('mainContent').classList.toggle('full-width');
}

// ===== 主题 =====
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
}

const THEME_ICON_MOON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const THEME_ICON_SUN =
  '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('remy_theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  if (theme === 'dark') {
    btn.innerHTML = THEME_ICON_MOON;
    btn.title = '切换到亮色模式';
    btn.setAttribute('aria-label', '当前为暗色主题，点击切换到亮色');
  } else {
    btn.innerHTML = THEME_ICON_SUN;
    btn.title = '切换到暗色模式';
    btn.setAttribute('aria-label', '当前为亮色主题，点击切换到暗色');
  }
}

async function loadAppVersion() {
  const el = document.getElementById('appVersion');
  if (!el) return;
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`);
    if (!r.ok) throw new Error('version fetch failed');
    const j = await r.json();
    if (j && typeof j.version === 'string' && j.version.trim()) el.textContent = j.version.trim();
  } catch (_) {
    /* 保留 index.html 中的默认文案 */
  }
}

// ===== 连接状态 =====
async function checkConnection() {
  try {
    await fetch(`${API}/health`);
    document.getElementById('connectionStatus').innerHTML = '<span class="status-dot"></span><span>已连接</span>';
  } catch {
    document.getElementById('connectionStatus').innerHTML = '<span class="status-dot" style="background:var(--danger)"></span><span>离线</span>';
  }
}

// ===== Toast =====
function showToast(msg, type = 'info') {
  const icons = {
    success: '<i data-lucide="circle-check-big" style="width:14px;height:14px"></i>',
    error: '<i data-lucide="circle-x" style="width:14px;height:14px"></i>',
    warning: '<i data-lucide="triangle-alert" style="width:14px;height:14px"></i>',
    info: '<i data-lucide="info" style="width:14px;height:14px"></i>',
  };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  renderLucideIcons();
  setTimeout(() => {
    el.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ===== 弹窗（栈：子弹窗关闭后父弹窗仍保留，如 新建活动 → 编辑品牌）=====
let activeModal = null;
const modalStack = [];

function openModal(id) {
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.add('active');
  if (activeModal && activeModal !== id) {
    modalStack.push(activeModal);
  }
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('active');
    activeModal = id;
  }
}

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  if (!activeModal) {
    overlay.classList.remove('active');
    return;
  }
  const cur = document.getElementById(activeModal);
  if (cur) cur.classList.remove('active');
  const prev = modalStack.length ? modalStack.pop() : null;
  if (prev) {
    activeModal = prev;
  } else {
    activeModal = null;
    overlay.classList.remove('active');
  }
}

// ===== 工具函数 =====
function parseWineDetails(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

function fmtMoney(v) {
  const n = parseFloat(v) || 0;
  return '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return '—';
  // 加8小时修正时区
  const local = new Date(dt.getTime() + 8*3600*1000);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth()+1).padStart(2,'0')}-${String(local.getUTCDate()).padStart(2,'0')}`;
}

function fmtDateShort(d) {
  if (!d) return '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  const local = new Date(dt.getTime() + 8*3600*1000);
  return `${local.getUTCMonth()+1}/${local.getUTCDate()}`;
}

function statusBadge(s) {
  const today = new Date();
  if (s === 'cancelled') return '<span class="badge badge-danger">已取消</span>';
  // 根据逻辑展示
  return '<span class="badge badge-success">已完成</span>';
}

function brandColor(brand) {
  const map = { 'XO': 'warning', 'PHD': 'accent', 'CLUB': 'blue', 'REMY': 'success' };
  return map[brand] || 'gray';
}

function typeColor(type) {
  const map = { '晚宴': 'accent', '品鉴': 'blue', '培训': 'success', '婚宴': 'warning', '宴会': 'danger' };
  return map[type] || 'gray';
}

// ===== 更新 badge 数量 =====
async function updateBadges() {
  try {
    const qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '';
    const [acts, logs, wars] = await Promise.all([
      api('GET', `/activities${qs}`),
      api('GET', `/logistics${qs}`),
      api('GET', `/warehouse${qs}`),
    ]);
    document.getElementById('badge-activities').textContent = acts.length || 0;
    document.getElementById('badge-logistics').textContent = logs.length || 0;
    document.getElementById('badge-warehouse').textContent = wars.length || 0;
  } catch (e) {}
}

/* =============================================
   页面：数据看板
   ============================================= */
let dashboardState = {
  brand: '',
  region: '',
  activityType: '',
  executionFlag: '',
  period: '',
  month: '',
};
let dashboardFilterOptions = null;
let dashboardPanelKey = '';

const DASHBOARD_FILTER_META = {
  brand: { title: '品牌', icon: 'tag' },
  region: { title: '区域', icon: 'map-pin' },
  activityType: { title: '类别', icon: 'shapes' },
  executionFlag: { title: '执行', icon: 'user-check' },
  period: { title: '时段', icon: 'calendar-range' },
  month: { title: '月份', icon: 'calendar-days' },
};

function renderLucideIcons() {
  if (typeof window !== 'undefined' && window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function normalizeFilterOptions(options) {
  return (options || []).map((opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: String(opt.value || ''), label: String(opt.label || opt.value || '') };
  });
}

function filterLabelByValue(key, value) {
  if (!value || !dashboardFilterOptions) return '全部';
  const map = {
    brand: normalizeFilterOptions(dashboardFilterOptions.brands),
    region: normalizeFilterOptions(dashboardFilterOptions.regions),
    activityType: normalizeFilterOptions(dashboardFilterOptions.activityTypes),
    executionFlag: normalizeFilterOptions(dashboardFilterOptions.executionFlags),
    period: normalizeFilterOptions(dashboardFilterOptions.periods),
    month: normalizeFilterOptions(dashboardFilterOptions.fiscalMonths),
  };
  const hit = (map[key] || []).find((x) => x.value === value);
  return hit ? hit.label : value;
}

function renderDashboardFilterButton(key, title, icon) {
  const label = filterLabelByValue(key, dashboardState[key]);
  const isOpen = dashboardPanelKey === key;
  return `<button class="btn btn-secondary btn-sm ${isOpen ? 'active' : ''}" onclick="openDashboardFilterPanel('${key}')"><i data-lucide="${icon}" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"></i>${escapeHtml(title)}：${escapeHtml(label)}</button>`;
}

function dashboardOptionsByKey(key) {
  if (!dashboardFilterOptions) return [];
  const optionsMap = {
    brand: normalizeFilterOptions(dashboardFilterOptions.brands),
    region: normalizeFilterOptions(dashboardFilterOptions.regions),
    activityType: normalizeFilterOptions(dashboardFilterOptions.activityTypes),
    executionFlag: normalizeFilterOptions(dashboardFilterOptions.executionFlags),
    period: normalizeFilterOptions(dashboardFilterOptions.periods),
    month: normalizeFilterOptions(dashboardFilterOptions.fiscalMonths),
  };
  return optionsMap[key] || [];
}

function openDashboardFilterPanel(key) {
  dashboardPanelKey = dashboardPanelKey === key ? '' : key;
  renderDashboard();
}

function chooseDashboardFilter(key, value) {
  dashboardState[key] = value || '';
  dashboardPanelKey = '';
  renderDashboard();
}

function renderDashboardFilterPanel() {
  if (!dashboardPanelKey) return '';
  const meta = DASHBOARD_FILTER_META[dashboardPanelKey];
  const options = dashboardOptionsByKey(dashboardPanelKey);
  const cur = dashboardState[dashboardPanelKey] || '';
  return `
    <div class="card" style="margin-top:10px;padding:12px">
      <div class="card-sub" style="margin-bottom:8px">${escapeHtml(meta.title)}（单选）</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <button class="btn btn-secondary btn-sm ${cur === '' ? 'active' : ''}" onclick="chooseDashboardFilter('${dashboardPanelKey}','')">全部</button>
        ${options.map((o) => `<button class="btn btn-secondary btn-sm ${cur === o.value ? 'active' : ''}" onclick="chooseDashboardFilter('${dashboardPanelKey}','${escapeHtml(String(o.value))}')">${escapeHtml(o.label)}</button>`).join('')}
      </div>
    </div>
  `;
}

function resetDashboardFilters() {
  dashboardState = {
    brand: '',
    region: '',
    activityType: '',
    executionFlag: '',
    period: '',
    month: '',
  };
  dashboardPanelKey = '';
  renderDashboard();
}

function dashboardQueryString() {
  const sp = new URLSearchParams();
  if (currentYearFrameId) sp.set('yearFrameId', String(currentYearFrameId));
  if (dashboardState.brand) sp.set('brands', dashboardState.brand);
  if (dashboardState.region) sp.set('regions', dashboardState.region);
  if (dashboardState.activityType) sp.set('activityTypes', dashboardState.activityType);
  if (dashboardState.executionFlag) sp.set('executionFlags', dashboardState.executionFlag);
  if (dashboardState.period) sp.set('periods', dashboardState.period);
  if (dashboardState.month) sp.set('months', dashboardState.month);
  const q = sp.toString();
  return q ? `?${q}` : '';
}

async function renderDashboard() {
  const container = document.getElementById('pageContainer');
  try {
    const query = dashboardQueryString();
    const [options, dash] = await Promise.all([
      api('GET', '/dashboard/options' + (currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '')),
      api('GET', '/dashboard' + query),
    ]);

    const { summary, activityByType, activityByBrand, activityByRegion, activityByMonth } = dash;
    dashboardFilterOptions = options;

    container.innerHTML = `
      <!-- 统计卡片 -->
      <div class="stats-grid">
        <div class="stat-card accent">
          <div class="stat-icon"><i data-lucide="flag" style="width:16px;height:16px"></i></div>
          <div class="stat-label">活动总场次</div>
          <div class="stat-value">${summary.activityCount || 0}</div>
          <div class="stat-sub">当前筛选条件下活动记录数</div>
        </div>
        <div class="stat-card success">
          <div class="stat-icon"><i data-lucide="wallet" style="width:16px;height:16px"></i></div>
          <div class="stat-label">总报价（活动报价）</div>
          <div class="stat-value">${fmtMoney(summary.activityRevenue || 0)}</div>
          <div class="stat-sub">活动执行报价合计</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-icon"><i data-lucide="warehouse" style="width:16px;height:16px"></i></div>
          <div class="stat-label">仓储报价</div>
          <div class="stat-value sm">${fmtMoney(summary.warehouseRevenue || 0)}</div>
          <div class="stat-sub">仓储模块 quoted_price 合计</div>
        </div>
        <div class="stat-card blue">
          <div class="stat-icon"><i data-lucide="bar-chart-3" style="width:16px;height:16px"></i></div>
          <div class="stat-label">汇总报价</div>
          <div class="stat-value sm">${fmtMoney(summary.totalRevenue || 0)}</div>
          <div class="stat-sub">活动报价 + 仓储报价</div>
        </div>
      </div>
      <div class="card" style="margin:16px 0">
        <div class="card-header">
          <div><div class="card-title">透视筛选</div><div class="card-sub">点击按钮弹出小面板单选，未选择时显示全部</div></div>
          <button class="btn btn-secondary btn-sm" onclick="resetDashboardFilters()">重置筛选</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${renderDashboardFilterButton('brand', '品牌', 'tag')}
          ${renderDashboardFilterButton('region', '区域', 'map-pin')}
          ${renderDashboardFilterButton('activityType', '类别', 'shapes')}
          ${renderDashboardFilterButton('executionFlag', '执行', 'user-check')}
          ${renderDashboardFilterButton('period', '时段', 'calendar-range')}
          ${renderDashboardFilterButton('month', '月份', 'calendar-days')}
        </div>
        ${renderDashboardFilterPanel()}
      </div>
      ${summary.regionShare ? `<div class="card" style="margin-bottom:16px"><div class="card-title"><i data-lucide="pie-chart" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>${escapeHtml(summary.regionShare.region)} 场次占全国比</div><div class="card-sub">${summary.regionShare.regionCount} / ${summary.regionShare.nationalCount} = ${(summary.regionShare.ratio * 100).toFixed(1)}%</div></div>` : ''}

      <!-- 图表区 -->
      <div class="chart-grid" style="margin-bottom:24px">
        <div class="chart-card">
          <div class="card-header">
            <div><div class="card-title">月度场次趋势（财年）</div><div class="card-sub">4月 → 次年3月</div></div>
          </div>
          <canvas id="chartMonthTrend"></canvas>
        </div>
        <div class="chart-card">
          <div class="card-header">
            <div><div class="card-title">品牌报价分布</div><div class="card-sub">按报价金额</div></div>
          </div>
          <canvas id="chartBrand"></canvas>
        </div>
        <div class="chart-card">
          <div class="card-header">
            <div><div class="card-title">区域结构分布</div><div class="card-sub">按场次数量</div></div>
          </div>
          <canvas id="chartRegion"></canvas>
        </div>
        <div class="chart-card">
          <div class="card-header">
            <div><div class="card-title">活动类别分布</div><div class="card-sub">仅统计：晚宴/品鉴/培训/纯设计</div></div>
          </div>
          <canvas id="chartType"></canvas>
        </div>
      </div>

    `;

    // 绘制图表
    drawMonthTrendChart(activityByMonth);
    drawTypeChart(activityByType);
    drawBrandChart(activityByBrand);
    drawRegionChart(activityByRegion);
    renderLucideIcons();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}

function drawMonthTrendChart(data) {
  const ctx = document.getElementById('chartMonthTrend');
  if (!ctx) return;
  charts.monthTrend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map((d) => d.monthLabel),
      datasets: [{
        label: '场次',
        data: data.map((d) => d.count),
        backgroundColor: '#7c6af7',
        borderRadius: 6,
      }],
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true },
      },
    },
  });
}

function drawTypeChart(data) {
  const ctx = document.getElementById('chartType');
  if (!ctx) return;
  const total = data.reduce((s, d) => s + (parseInt(d.count, 10) || 0), 0);
  const labels = data.map((d) => {
    const c = parseInt(d.count, 10) || 0;
    const p = total > 0 ? ((c / total) * 100).toFixed(1) : '0.0';
    return `${d.activity_type} (${c} / ${p}%)`;
  });
  charts.type = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: data.map(d => d.count),
        backgroundColor: ['#7c6af7','#60a5fa','#34d399','#fbbf24','#f87171'],
        borderWidth: 0,
        hoverOffset: 6,
      }]
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(), padding: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw} 场` }
        }
      },
      cutout: '60%',
    }
  });
}

function drawBrandChart(data) {
  const ctx = document.getElementById('chartBrand');
  if (!ctx) return;
  const colors = { 'X.O': '#fbbf24', 'PHD': '#7c6af7', 'CLUB': '#60a5fa', 'REMY': '#34d399' };
  charts.brand = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.brand),
      datasets: [{
        label: '报价',
        data: data.map(d => parseFloat(d.revenue) || 0),
        backgroundColor: data.map(d => colors[d.brand] || '#9ea3b8'),
        borderRadius: 6,
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(), font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim(), font: { size: 11 }, callback: v => '¥' + (v/10000).toFixed(0) + 'w' }, grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border').trim() } }
      }
    }
  });
}

function drawRegionChart(data) {
  const ctx = document.getElementById('chartRegion');
  if (!ctx) return;
  const total = data.reduce((s, d) => s + (parseInt(d.count, 10) || 0), 0);
  const labels = data.map((d) => {
    const c = parseInt(d.count, 10) || 0;
    const p = total > 0 ? ((c / total) * 100).toFixed(1) : '0.0';
    return `${d.region || '未知'} (${c} / ${p}%)`;
  });
  charts.region = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: data.map((d) => d.count),
        backgroundColor: ['#7c6af7', '#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee'],
        borderWidth: 0,
      }],
    },
    options: {
      plugins: { legend: { position: 'bottom' } },
      cutout: '60%',
    },
  });
}

/* =============================================
   页面：活动记录
   ============================================= */
async function renderActivities() {
  const container = document.getElementById('pageContainer');

  // 初始化筛选状态
  activitiesState.page = 1;

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <input type="text" class="search-input" id="actSearch" placeholder="搜索城市/客户/项目编号..." oninput="debounceSearch()" value="${activitiesState.search}">
        <select class="filter-select" id="actYear" onchange="filterActivities()">
          <option value="">全部年份</option>
          <option value="2025">2025年</option>
          <option value="2026">2026年</option>
        </select>
        <select class="filter-select" id="actMonth" onchange="filterActivities()">
          <option value="">全部月份</option>
          <option value="1">1月</option>
          <option value="2">2月</option>
          <option value="3">3月</option>
          <option value="4">4月</option>
          <option value="5">5月</option>
          <option value="6">6月</option>
          <option value="7">7月</option>
          <option value="8">8月</option>
          <option value="9">9月</option>
          <option value="10">10月</option>
          <option value="11">11月</option>
          <option value="12">12月</option>
        </select>
        <select class="filter-select" id="actType" onchange="filterActivities()">
          <option value="">全部类型</option>
        </select>
        <select class="filter-select" id="actFilterPeriod" onchange="filterActivities()">
          <option value="">全部时段</option>
        </select>
        <select class="filter-select" id="actFilterRegion" onchange="filterActivities()">
          <option value="">全部区域</option>
        </select>
        <select class="filter-select" id="actBrand" onchange="filterActivities()">
          <option value="">全部品牌</option>
        </select>
        <button class="btn btn-secondary btn-sm" onclick="toggleSortOrder()">
          日期 <span id="sortIcon">${activitiesState.sortOrder === 'DESC' ? '↓' : '↑'}</span>
        </button>
      </div>
      <div class="toolbar-right">
        <button class="btn btn-primary btn-sm" onclick="showActivityModal()">+ 新建活动</button>
      </div>
    </div>

    <div id="actTable"></div>
    <div id="actPagination"></div>
  `;

  try {
    const types = await api('GET', '/lookups?category=activity_type');
    const typeSel = document.getElementById('actType');
    if (typeSel) {
      const keep = activitiesState.type;
      typeSel.innerHTML =
        '<option value="">全部类型</option>' +
        types
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...typeSel.options].some((o) => o.value === keep)) typeSel.value = keep;
    }
  } catch (e) {
    console.warn('活动类型筛选项加载失败', e);
  }
  try {
    const periods = await api('GET', '/lookups?category=activity_period');
    const periodSel = document.getElementById('actFilterPeriod');
    if (periodSel) {
      const keep = activitiesState.period;
      periodSel.innerHTML =
        '<option value="">全部时段</option>' +
        periods
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...periodSel.options].some((o) => o.value === keep)) periodSel.value = keep;
    }
  } catch (e) {
    console.warn('活动时段筛选项加载失败', e);
  }
  try {
    const regions = await api('GET', '/lookups?category=activity_region');
    const regionSel = document.getElementById('actFilterRegion');
    if (regionSel) {
      const keep = activitiesState.region;
      regionSel.innerHTML =
        '<option value="">全部区域</option>' +
        regions
          .map(
            (r) =>
              `<option value="${escapeHtml(String(r.value))}">${escapeHtml(String(r.label || r.value))}</option>`
          )
          .join('');
      if (keep && [...regionSel.options].some((o) => o.value === keep)) regionSel.value = keep;
    }
  } catch (e) {
    console.warn('活动区域筛选项加载失败', e);
  }
  renderBrandOptions();
  const bsel = document.getElementById('actBrand');
  const bk = activitiesState.brand;
  if (bsel && bk && [...bsel.options].some((o) => o.value === bk)) bsel.value = bk;

  await loadActivities();
}

let searchTimer = null;
function debounceSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    activitiesState.search = document.getElementById('actSearch')?.value || '';
    activitiesState.page = 1;
    loadActivities();
  }, 400);
}

function filterActivities() {
  activitiesState.type = document.getElementById('actType')?.value || '';
  activitiesState.period = document.getElementById('actFilterPeriod')?.value || '';
  activitiesState.region = document.getElementById('actFilterRegion')?.value || '';
  activitiesState.brand = document.getElementById('actBrand')?.value || '';
  activitiesState.year = document.getElementById('actYear')?.value || '';
  activitiesState.month = document.getElementById('actMonth')?.value || '';
  activitiesState.page = 1;
  loadActivities();
}

function toggleSortOrder() {
  activitiesState.sortOrder = activitiesState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
  const icon = document.getElementById('sortIcon');
  if (icon) icon.textContent = activitiesState.sortOrder === 'DESC' ? '↓' : '↑';
  loadActivities();
}

async function loadActivities() {
  const container = document.getElementById('actTable');
  if (!container) return;

  // 清理删除确认状态（超时后恢复按钮文案）
  if (pendingDeleteActivityId && (Date.now() - pendingDeleteActivityAt) > DELETE_CONFIRM_MS) {
    pendingDeleteActivityId = null;
    pendingDeleteActivityAt = 0;
  }

  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';

  try {
    let qs = `?sortBy=activity_date&sortOrder=${activitiesState.sortOrder}`;
    if (currentYearFrameId) qs += `&yearFrameId=${currentYearFrameId}`;
    if (activitiesState.type) qs += `&activityType=${activitiesState.type}`;
    if (activitiesState.brand) qs += `&brand=${encodeURIComponent(activitiesState.brand)}`;

    const data = await api('GET', `/activities${qs}`);

    // 前端搜索过滤
    let filtered = data;
    if (activitiesState.search) {
      const kw = activitiesState.search.toLowerCase();
      filtered = filtered.filter(a =>
        (a.city || '').toLowerCase().includes(kw) ||
        (a.client || '').toLowerCase().includes(kw) ||
        (a.client_name || '').toLowerCase().includes(kw) ||
        (a.project_code || '').toLowerCase().includes(kw) ||
        (a.venue || '').toLowerCase().includes(kw)
      );
    }

    // 年份筛选
    if (activitiesState.year) {
      filtered = filtered.filter(a => {
        const d = new Date(a.date || a.activity_date);
        return d.getFullYear().toString() === activitiesState.year;
      });
    }

    // 月份筛选
    if (activitiesState.month) {
      filtered = filtered.filter(a => {
        const d = new Date(a.date || a.activity_date);
        return (d.getMonth() + 1).toString() === activitiesState.month;
      });
    }
    // 时段筛选
    if (activitiesState.period) {
      filtered = filtered.filter(a => (a.period || '日常') === activitiesState.period);
    }
    // 区域筛选
    if (activitiesState.region) {
      filtered = filtered.filter(a => (a.region || '') === activitiesState.region);
    }

    activitiesState.data = filtered;

    // 分页
    const pageSize = 50;
    const total = filtered.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (activitiesState.page - 1) * pageSize;
    const pageData = filtered.slice(start, start + pageSize);

    // 按月分组
    const grouped = {};
    pageData.forEach(a => {
      const d = new Date(a.date || a.activity_date);
      const key = isNaN(d) ? '未知日期' : `${d.getFullYear()}年${d.getMonth()+1}月`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(a);
    });

    // 新列顺序：日期、时段、品牌、项目编号、区域、城市、客户、类型、执行、报价、成本、操作
    let html = `<div class="table-wrapper"><table>
      <thead><tr>
        <th>日期</th><th>时段</th><th>品牌</th><th>项目编号</th><th>区域</th><th>城市</th><th>客户</th>
        <th>类型</th><th>执行</th><th>报价</th><th>成本</th><th>操作</th>
      </tr></thead><tbody>`;

    Object.entries(grouped).forEach(([month, acts]) => {
      html += `<tr><td colspan="12" class="group-title">${month}（${acts.length}场）</td></tr>`;
      acts.forEach(a => {
        html += `
          <tr onclick="showActivityDetail(${a.id})" style="cursor:pointer">
            <td>${fmtDateShort(a.date || a.activity_date)}</td>
            <td><span class="badge badge-gray">${a.period || '日常'}</span></td>
            <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
            <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
            <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
            <td><strong>${a.city||'—'}</strong></td>
            <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${a.client||a.client_name||'—'}</td>
            <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
            <td><span class="badge badge-${a.executor==='有'?'success':'gray'}">${a.executor||'无'}</span></td>
            <td class="amount amount-revenue">${fmtMoney(a.quoted_price)}</td>
            <td class="amount ${parseFloat(a.total_cost)>0?'amount-cost':'amount-neutral'}">${parseFloat(a.total_cost)>0?fmtMoney(a.total_cost):'—'}</td>
            <td onclick="event.stopPropagation()">
              <div style="display:flex;gap:4px">
                <button class="btn btn-secondary btn-sm" onclick="showActivityModal(${a.id})">编辑</button>
                <button class="btn btn-success btn-sm" onclick="showCostFill(${a.id})">成本</button>
                <button class="btn btn-danger btn-sm" onclick="requestDeleteActivity(${a.id})">${a.id===pendingDeleteActivityId && (Date.now()-pendingDeleteActivityAt) < DELETE_CONFIRM_MS ? '确认删除' : '删除'}</button>
              </div>
            </td>
          </tr>`;
      });
    });

    html += `</tbody></table></div>`;
    container.innerHTML = html;
    renderLucideIcons();

    // 分页
    const pgEl = document.getElementById('actPagination');
    if (pgEl) {
      pgEl.innerHTML = renderPagination(activitiesState.page, totalPages, total, 'goActPage');
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}

async function deleteActivity(id) {
  try {
    await api('DELETE', `/activities/${id}`);
    showToast('活动已删除', 'success');
    pendingDeleteActivityId = null;
    pendingDeleteActivityAt = 0;
    closeModal();
    if (currentPage === 'activities') loadActivities();
    else if (currentPage === 'calendar' && typeof window._calYear === 'number') drawCalendar(window._calYear, window._calMonth);
    else if (currentPage === 'cost') renderCost();
    else loadActivities();
    void updateBadges();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

function requestDeleteActivity(id) {
  const now = Date.now();
  if (pendingDeleteActivityId === id && (now - pendingDeleteActivityAt) < DELETE_CONFIRM_MS) {
    return deleteActivity(id);
  }
  pendingDeleteActivityId = id;
  pendingDeleteActivityAt = now;
  showToast('再次点击确认删除该活动', 'warning');
  loadActivities(); // 让按钮文案切到“确认删除”
}

function goActPage(p) {
  activitiesState.page = p;
  loadActivities();
}

function renderPagination(current, total, count, fn) {
  if (total <= 1) return `<div class="pagination"><span>共 ${count} 条</span></div>`;
  let btns = '';
  btns += `<button class="page-btn" onclick="${fn}(${current-1})" ${current===1?'disabled':''}>‹</button>`;
  // 显示10页
  let start = Math.max(1, current - 4);
  let end = Math.min(total, current + 5);
  if (end - start < 9) {
    start = Math.max(1, end - 9);
  }
  for (let i = start; i <= end; i++) {
    btns += `<button class="page-btn ${i===current?'active':''}" onclick="${fn}(${i})">${i}</button>`;
  }
  btns += `<button class="page-btn" onclick="${fn}(${current+1})" ${current===total?'disabled':''}>›</button>`;
  return `<div class="pagination"><span>共 ${count} 条，第 ${current}/${total} 页</span><div class="page-btns">${btns}</div></div>`;
}

// 生成项目编号
function genProjectCode() {
  const code = document.getElementById('actYearFrameCode')?.value || '';
  const date = document.getElementById('actDate')?.value || '';
  const city = document.getElementById('actCity')?.value || '';
  const brand = document.getElementById('actBrandField')?.value || '';
  const type = document.getElementById('actActivityType')?.value || '';
  const client = document.getElementById('actClient')?.value || '';

  let dateStr = '';
  if (date) {
    const d = new Date(date);
    dateStr = `${String(d.getFullYear()).slice(2)}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  }

  const pc = `${code} ${dateStr}${city}${client}${brand}${type}`.trim();
  const el = document.getElementById('actProjectCode');
  if (el) el.value = pc;
}

// ----- 活动表单下拉（lookup_options /api/lookups）-----
const ACTIVITY_LOOKUP_DEFS = [
  { category: 'activity_year_frame_code', selectId: 'actYearFrameCode', allowEmpty: false },
  { category: 'activity_type', selectId: 'actActivityType', allowEmpty: false },
  { category: 'activity_period', selectId: 'actPeriod', allowEmpty: false },
  { category: 'activity_region', selectId: 'actRegion', allowEmpty: true, emptyLabel: '请选择' },
  { category: 'activity_executor', selectId: 'actExecutor', allowEmpty: false },
  { category: 'activity_status', selectId: 'actStatus', allowEmpty: false },
];

const LOOKUP_EDITOR_LABELS = {
  activity_year_frame_code: '编辑：年框编号',
  activity_type: '编辑：活动类型',
  activity_period: '编辑：时段',
  activity_region: '编辑：区域',
  activity_executor: '编辑：执行人员',
  activity_status: '编辑：状态',
};

let _lookupEditCategory = '';

function populateLookupSelect(el, rows, def, rawDesired) {
  el.innerHTML = '';
  if (def.allowEmpty) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = def.emptyLabel || '请选择';
    el.appendChild(o);
  }
  const seen = new Set();
  (rows || []).forEach((r) => {
    if (!r || r.value == null) return;
    seen.add(String(r.value));
    const o = document.createElement('option');
    o.value = r.value;
    o.textContent = r.label || r.value;
    el.appendChild(o);
  });

  let desired;
  if (rawDesired !== undefined && rawDesired !== null && String(rawDesired) !== '') {
    desired = String(rawDesired);
  } else if (def.allowEmpty) {
    desired = '';
  } else if (rows && rows.length) {
    desired = String(rows[0].value);
  } else {
    desired = '';
  }

  if (desired !== '' && !seen.has(desired)) {
    const o = document.createElement('option');
    o.value = desired;
    o.textContent = `${desired}（未在列表中）`;
    el.appendChild(o);
  }

  el.value = desired;
  if (el.value !== desired && el.options.length) {
    el.selectedIndex = 0;
  }
}

async function fillActivityLookupSelects(valueMap = {}) {
  const pairs = await Promise.all(
    ACTIVITY_LOOKUP_DEFS.map(async (def) => {
      const rows = await api('GET', `/lookups?category=${encodeURIComponent(def.category)}`);
      return [def, rows];
    })
  );
  for (const [def, rows] of pairs) {
    const el = document.getElementById(def.selectId);
    if (!el) continue;
    const hasKey = Object.prototype.hasOwnProperty.call(valueMap, def.selectId);
    const raw = hasKey ? valueMap[def.selectId] : undefined;
    populateLookupSelect(el, rows, def, raw);
  }
}

function applyNewActivityLookupDefaults() {
  const p = document.getElementById('actPeriod');
  if (p && [...p.options].some((o) => o.value === '日常')) p.value = '日常';
  const ex = document.getElementById('actExecutor');
  if (ex && [...ex.options].some((o) => o.value === '无')) ex.value = '无';
  const st = document.getElementById('actStatus');
  if (st && [...st.options].some((o) => o.value === 'pending')) st.value = 'pending';
}

function getActivityLookupFormSnapshot() {
  return {
    actYearFrameCode: document.getElementById('actYearFrameCode')?.value,
    actActivityType: document.getElementById('actActivityType')?.value,
    actPeriod: document.getElementById('actPeriod')?.value,
    actRegion: document.getElementById('actRegion')?.value,
    actExecutor: document.getElementById('actExecutor')?.value,
    actStatus: document.getElementById('actStatus')?.value,
  };
}

async function refreshActivityLookupsBehindLookupModal() {
  try {
    await fillActivityLookupSelects(getActivityLookupFormSnapshot());
  } catch (e) {
    console.error(e);
  }
}

function lookupEditorRowHtml(r) {
  const active = r.is_active ? '启用' : '停用';
  return `<tr>
    <td><code style="font-size:12px">${escapeHtml(String(r.value))}</code></td>
    <td><input type="text" class="form-control lookup-edit-label" data-id="${r.id}" value="${escapeHtml(String(r.label || ''))}" style="font-size:13px;padding:4px 8px"></td>
    <td><input type="number" class="form-control lookup-edit-sort" data-id="${r.id}" value="${Number(r.sort_order) || 0}" style="font-size:13px;padding:4px 8px;width:64px"></td>
    <td style="font-size:12px;color:${r.is_active ? 'var(--success)' : 'var(--text-muted)'}">${active}</td>
    <td style="white-space:nowrap">
      <button type="button" class="btn btn-xs btn-ghost" onclick="saveLookupOptionRow(${r.id})">保存</button>
      ${r.is_active ? `<button type="button" class="btn btn-xs btn-ghost" onclick="deactivateLookupOption(${r.id})">停用</button>` : `<button type="button" class="btn btn-xs btn-ghost" onclick="reactivateLookupOption(${r.id})">启用</button>`}
    </td>
  </tr>`;
}

async function showLookupEditModal(category) {
  _lookupEditCategory = category;
  const title = document.getElementById('modalLookupTitle');
  if (title) title.textContent = LOOKUP_EDITOR_LABELS[category] || '编辑选项';
  const body = document.getElementById('lookupEditorContent');
  if (body) body.innerHTML = '<div style="padding:16px;color:var(--text-muted)">加载中...</div>';
  openModal('modalLookup');
  await renderLookupEditor(category);
}

async function renderLookupEditor(category) {
  const body = document.getElementById('lookupEditorContent');
  if (!body) return;
  try {
    const rows = await api('GET', `/lookups?category=${encodeURIComponent(category)}&includeInactive=1`);
    body.innerHTML = `
      <div style="margin-bottom:12px">
        <button type="button" class="btn btn-primary btn-sm" onclick="toggleLookupAddForm()">+ 新增选项</button>
      </div>
      <div id="lookupAddForm" style="display:none;margin-bottom:12px;padding:12px;background:var(--bg-primary);border-radius:var(--radius-sm)">
        <div class="form-grid" style="grid-template-columns:1fr 1fr 80px;gap:8px;margin-bottom:8px">
          <input type="text" id="lookupNewValue" class="form-control" placeholder="存储值（写入数据库）" style="font-size:13px">
          <input type="text" id="lookupNewLabel" class="form-control" placeholder="显示名称" style="font-size:13px">
          <input type="number" id="lookupNewSort" class="form-control" placeholder="排序" value="0" style="font-size:13px">
        </div>
        <button type="button" class="btn btn-primary btn-sm" onclick="confirmAddLookupOption()">保存</button>
      </div>
      <table class="data-table" style="font-size:13px">
        <thead><tr><th>值</th><th>显示</th><th>排序</th><th>状态</th><th></th></tr></thead>
        <tbody id="lookupEditorTbody">${rows.map((r) => lookupEditorRowHtml(r)).join('')}</tbody>
      </table>
    `;
  } catch (err) {
    body.innerHTML = `<div style="color:var(--danger);padding:12px">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function toggleLookupAddForm() {
  const f = document.getElementById('lookupAddForm');
  if (!f) return;
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
}

async function confirmAddLookupOption() {
  const category = _lookupEditCategory;
  const value = document.getElementById('lookupNewValue')?.value?.trim();
  const label = document.getElementById('lookupNewLabel')?.value?.trim();
  const sort_order = parseInt(document.getElementById('lookupNewSort')?.value, 10) || 0;
  if (!value || !label) {
    showToast('请填写存储值与显示名称', 'warning');
    return;
  }
  try {
    await api('POST', '/lookups', { category, value, label, sort_order });
    showToast('已新增', 'success');
    const form = document.getElementById('lookupAddForm');
    if (form) form.style.display = 'none';
    await renderLookupEditor(category);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function saveLookupOptionRow(id) {
  const category = _lookupEditCategory;
  const labelInp = document.querySelector(`.lookup-edit-label[data-id="${id}"]`);
  const sortInp = document.querySelector(`.lookup-edit-sort[data-id="${id}"]`);
  try {
    await api('PUT', `/lookups/${id}`, {
      label: labelInp?.value?.trim(),
      sort_order: parseInt(sortInp?.value, 10) || 0,
    });
    showToast('已保存', 'success');
    await renderLookupEditor(category);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deactivateLookupOption(id) {
  try {
    await api('DELETE', `/lookups/${id}`);
    showToast('已停用', 'success');
    await renderLookupEditor(_lookupEditCategory);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function reactivateLookupOption(id) {
  try {
    await api('PUT', `/lookups/${id}`, { is_active: 1 });
    await renderLookupEditor(_lookupEditCategory);
    await refreshActivityLookupsBehindLookupModal();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// 打开新建/编辑弹窗
async function showActivityModal(id = null) {
  document.getElementById('modalActivityTitle').textContent = id ? '编辑活动' : '新建活动';
  document.getElementById('actId').value = id || '';

  let a = null;
  if (id) {
    try {
      a = await api('GET', `/activities/${id}`);
    } catch (err) {
      showToast('加载活动数据失败', 'error');
      return;
    }
  }

  const lookupSnap = a
    ? {
        actYearFrameCode: a.year_frame_code || '',
        actActivityType: a.activity_type || '',
        actPeriod: a.period || '日常',
        actRegion: a.region != null && a.region !== undefined ? a.region : '',
        actExecutor: a.executor != null && String(a.executor).trim() !== '' ? a.executor : '无',
        actStatus: a.status || 'pending',
      }
    : {};

  try {
    await fillActivityLookupSelects(lookupSnap);
  } catch (err) {
    const detail = err && err.message ? String(err.message) : String(err);
    showToast(
      `加载下拉选项失败：${detail}。若已执行迁移，请重启后端（结束旧 node 进程后重新 npm start），再硬刷新页面。`,
      'error'
    );
    console.error(err);
  }

  ['actCity', 'actBrandField', 'actDate', 'actClient', 'actVenue', 'actQuotedPrice', 'actGuestCount', 'actProjectCode', 'actRemarks'].forEach((fid) => {
    const el = document.getElementById(fid);
    if (el) el.value = '';
  });

  if (a) {
    document.getElementById('actCity').value = a.city || '';
    document.getElementById('actBrandField').value = a.brand || 'PHD';
    if (a.date || a.activity_date) {
      const d = new Date(a.date || a.activity_date);
      document.getElementById('actDate').value = d.toISOString().split('T')[0];
    }
    document.getElementById('actClient').value = a.client || a.client_name || '';
    document.getElementById('actVenue').value = a.venue || '';
    document.getElementById('actQuotedPrice').value = a.quoted_price || '';
    document.getElementById('actGuestCount').value = a.guest_count || '';
    document.getElementById('actProjectCode').value = a.project_code || '';
    document.getElementById('actRemarks').value = a.remarks || '';
  } else {
    applyNewActivityLookupDefaults();
    document.getElementById('actBrandField').value = 'PHD';
    genProjectCode();
  }

  openModal('modalActivity');

  loadWineInventoryForForm();
}

function toggleWineSection() {
  const area = document.getElementById('wineSelectionArea');
  const icon = document.getElementById('wineToggleIcon');
  if (area.style.display === 'none') {
    area.style.display = 'block';
    icon.textContent = '▲';
  } else {
    area.style.display = 'none';
    icon.textContent = '▼';
  }
}

async function loadWineInventoryForForm() {
  try {
    const wines = await api('GET', '/wine');
    const tbody = document.getElementById('wineSelectBody');
    if (!tbody) return;
    
    tbody.innerHTML = wines.map(w => `
      <tr>
        <td style="font-weight:500">${w.wine_name}</td>
        <td>${w.spec}</td>
        <td style="color:${w.quantity > 0 ? 'var(--success)' : 'var(--text-muted)'}">${w.quantity} 瓶</td>
        <td><input type="number" class="wine-qty-input" data-wine-code="${w.wine_code}" data-wine-name="${w.wine_name}" data-spec="${w.spec}" value="0" min="0" placeholder="0" style="width:70px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;text-align:right"></td>
      </tr>
    `).join('');
    
    document.getElementById('wineInventoryLoading').style.display = 'none';
    document.getElementById('wineSelectTable').style.display = 'table';
    
    // 如果是编辑模式，加载已有用酒数据
    const actId = document.getElementById('actId').value;
    if (actId) {
      const act = await api('GET', `/activities/${actId}`);
      const wineDetails = parseWineDetails(act.wine_details);
      Object.entries(wineDetails).forEach(([key, val]) => {
        if (val && val.qty > 0) {
          const input = tbody.querySelector(`[data-wine-code="${key}"]`);
          if (input) input.value = val.qty;
        }
      });
    }
  } catch (err) {
    document.getElementById('wineInventoryLoading').textContent = '加载失败，请重试';
    console.error('加载酒品库存失败:', err);
  }
}

// 收集表单中的用酒数据
function collectWineDetails() {
  const details = {};
  document.querySelectorAll('.wine-qty-input').forEach(input => {
    const qty = parseInt(input.value) || 0;
    if (qty > 0) {
      details[input.dataset.wineCode] = {
        wine_name: input.dataset.wineName,
        spec: input.dataset.spec,
        qty: qty
      };
    }
  });
  return details;
}

async function saveActivity() {
  const id = document.getElementById('actId').value;
  const body = {
    year_frame_id: currentYearFrameId || 1,
    year_frame_code: document.getElementById('actYearFrameCode').value,
    project_code: document.getElementById('actProjectCode').value,
    activity_type: document.getElementById('actActivityType').value,
    city: document.getElementById('actCity').value,
    brand: document.getElementById('actBrandField').value,
    date: document.getElementById('actDate').value || null,
    client: document.getElementById('actClient').value,
    client_name: document.getElementById('actClient').value,
    region: document.getElementById('actRegion').value,
    period: document.getElementById('actPeriod').value,
    venue: document.getElementById('actVenue').value,
    quoted_price: parseFloat(document.getElementById('actQuotedPrice').value) || 0,
    guest_count: parseInt(document.getElementById('actGuestCount').value) || null,
    executor: document.getElementById('actExecutor').value,
    status: document.getElementById('actStatus').value,
    remarks: document.getElementById('actRemarks').value,
    wine_details: collectWineDetails(),
  };

  try {
    if (id) {
      await api('PUT', `/activities/${id}`, body);
      showToast('活动已更新', 'success');
    } else {
      await api('POST', '/activities', body);
      showToast('活动已创建', 'success');
    }
    closeModal();
    loadActivities();
    void updateBadges();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function showActivityDetail(id) {
  try {
    const a = await api('GET', `/activities/${id}`);
    const content = document.getElementById('activityDetailContent');
    if (!content) {
      showToast('找不到活动详情弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }
    const wines = parseWineDetails(a.wine_details);

    content.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
        <div><div class="form-label">项目编号</div><div class="project-code" style="max-width:100%;font-size:12px">${a.project_code||'—'}</div></div>
        <div><div class="form-label">活动日期</div><div>${fmtDate(a.date||a.activity_date)}</div></div>
        <div><div class="form-label">时段</div><div>${a.period||'日常'}</div></div>
        <div><div class="form-label">城市</div><div>${a.city||'—'}</div></div>
        <div><div class="form-label">客户</div><div>${a.client||a.client_name||'—'}</div></div>
        <div><div class="form-label">品牌</div><div><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></div></div>
        <div><div class="form-label">类型</div><div><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></div></div>
        <div><div class="form-label">区域</div><div>${a.region||'—'}</div></div>
        <div><div class="form-label">场地</div><div>${a.venue||'—'}</div></div>
        <div><div class="form-label">报价</div><div class="amount amount-revenue">${fmtMoney(a.quoted_price)}</div></div>
        <div><div class="form-label">成本</div><div class="amount ${parseFloat(a.total_cost)>0?'amount-cost':'amount-neutral'}">${parseFloat(a.total_cost)>0?fmtMoney(a.total_cost):'未填写'}</div></div>
        <div><div class="form-label">执行人员</div><div>${a.executor||'无'}</div></div>
        <div><div class="form-label">状态</div><div>${statusBadge(a.status)}</div></div>
      </div>
      ${a.remarks ? `<div style="margin-bottom:12px"><div class="form-label">备注</div><div style="color:var(--text-secondary);font-size:13px">${a.remarks}</div></div>` : ''}
      ${Object.keys(wines).length > 0 ? `<div><div class="form-section-title">用酒明细</div><table><thead><tr><th>酒品</th><th>规格</th><th>数量</th></tr></thead><tbody>${Object.entries(wines).filter(([k,v])=>v&&v.qty>0).map(([k,v])=>`<tr><td>${k}</td><td>${v.spec||'—'}</td><td>${v.qty}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div style="margin-top:16px;display:flex;gap:8px">
        <button class="btn btn-success btn-sm" onclick="closeModal();setTimeout(()=>showCostFill(${id}),100)"><i data-lucide="wallet" style="width:13px;height:13px"></i>填写成本</button>
      </div>
    `;

    const editBtn = document.getElementById('detailEditBtn');
    if (editBtn) {
      editBtn.onclick = () => {
        closeModal();
        setTimeout(() => showActivityModal(id), 100);
      };
    }

    openModal('modalActivityDetail');
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

// 成本填写弹窗
async function showCostFill(actId) {
  try {
    const a = await api('GET', `/activities/${actId}`);
    const details = parseActivityCostDetails(a);
    const cost = calcCostDetailsTotal(details);

    const content = document.getElementById('costFillContent');
    if (!content) {
      showToast('找不到成本弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }
    content.innerHTML = `
      <input type="hidden" id="costActId" value="${actId}">
      <div style="margin-bottom:12px;padding:10px;background:var(--bg-input);border-radius:var(--radius-sm)">
        <div style="font-size:12px;color:var(--text-secondary)">${a.project_code||a.city+a.activity_type}</div>
        <div style="font-size:13px;color:var(--text-primary);margin-top:2px">当前成本：<span class="amount amount-cost">${cost>0?fmtMoney(cost):'未填写'}</span></div>
      </div>
      ${renderCostDetailSections('cost-field', details, 'updateCostTotal()')}
      <div style="margin-top:14px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--text-secondary);font-size:13px">成本合计</span>
        <span class="amount" style="font-size:18px;font-weight:700;color:var(--accent)" id="costTotal">${fmtMoney(cost)}</span>
      </div>
    `;

    openModal('modalCostFill');
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function updateCostTotal() {
  let total = 0;
  document.querySelectorAll('.cost-field').forEach(el => {
    total += parseFloat(el.value) || 0;
  });
  const el = document.getElementById('costTotal');
  if (el) el.textContent = fmtMoney(total);
}

async function saveCostFromModal() {
  const actId = document.getElementById('costActId').value;
  const details = collectCostDetails('cost-field');
  const total = calcCostDetailsTotal(details);

  try {
    await api('PUT', `/activities/${actId}`, { total_cost: total, cost_details: details });
    showToast('成本已保存', 'success');
    closeModal();
    if (currentPage === 'activities') loadActivities();
    else if (currentPage === 'calendar' && typeof window._calYear === 'number') drawCalendar(window._calYear, window._calMonth);
    else if (currentPage === 'cost') renderCost();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

/* =============================================
   页面：排期日历
   ============================================= */
async function renderCalendar() {
  const container = document.getElementById('pageContainer');
  const now = new Date();
  let calYear = now.getFullYear();
  let calMonth = now.getMonth(); // 0-indexed

  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:12px">
        <button class="btn btn-secondary" onclick="prevCalMonth()">‹ 上月</button>
        <h2 id="calTitle" style="font-size:18px;font-weight:700;min-width:120px;text-align:center"></h2>
        <button class="btn btn-secondary" onclick="nextCalMonth()">下月 ›</button>
      </div>
      <button class="btn btn-secondary btn-sm" onclick="goCalToday()">今天</button>
    </div>
    <div class="calendar-grid" id="calHeader"></div>
    <div id="calGrid" style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:4px"></div>
  `;

  window._calYear = calYear;
  window._calMonth = calMonth;
  drawCalendar(calYear, calMonth);
}

async function drawCalendar(year, month) {
  const title = document.getElementById('calTitle');
  if (title) title.textContent = `${year}年 ${month+1}月`;

  // 星期头
  const header = document.getElementById('calHeader');
  if (header) {
    header.innerHTML = ['一','二','三','四','五','六','日'].map(d => `<div class="cal-header-cell">${d}</div>`).join('');
  }

  const grid = document.getElementById('calGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1/-1">加载中...</div>';

  try {
    const qs = `?year=${year}&month=${month+1}${currentYearFrameId?'&yearFrameId='+currentYearFrameId:''}`;
    const calResp = await api('GET', `/calendar${qs}`);
    const activities = Array.isArray(calResp) ? calResp : (calResp.data || []);

    // 按日期索引
    const actMap = {};
    activities.forEach(a => {
      const d = new Date(a.activity_date || a.date);
      if (!isNaN(d)) {
        // 日期是UTC存储，需要+1天修正时区（UTC+8）
        const local = new Date(d.getTime() + 8*3600*1000);
        const key = `${local.getUTCFullYear()}-${local.getUTCMonth()+1}-${local.getUTCDate()}`;
        if (!actMap[key]) actMap[key] = [];
        actMap[key].push(a);
      }
    });

    const firstDay = new Date(year, month, 1);
    let startWeekDay = firstDay.getDay(); // 0=Sun
    startWeekDay = startWeekDay === 0 ? 6 : startWeekDay - 1; // Mon=0

    const daysInMonth = new Date(year, month+1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    let html = '';

    // 上月填充
    for (let i = startWeekDay - 1; i >= 0; i--) {
      html += `<div class="cal-cell other-month"><div class="cal-date">${daysInPrevMonth-i}</div></div>`;
    }

    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = today.getFullYear()===year && today.getMonth()===month && today.getDate()===d;
      const key = `${year}-${month+1}-${d}`;
      const acts = actMap[key] || [];

      html += `<div class="cal-cell ${isToday?'today':''}">
        <div class="cal-date">${d}</div>
        ${acts.slice(0,3).map(a => `
          <div class="cal-event brand-${(a.brand||'').toLowerCase().replace('.','')}" title="${a.city}｜${a.client||a.client_name||''}｜${a.activity_type}"
            onclick="showActivityDetail(${a.id})">
            ${a.city||''} ${a.brand||''} ${a.activity_type||''}
          </div>
        `).join('')}
        ${acts.length > 3 ? `<div class="cal-event" style="background:var(--bg-input);color:var(--text-muted)">+${acts.length-3}场</div>` : ''}
      </div>`;
    }

    // 下月填充
    const totalCells = startWeekDay + daysInMonth;
    const remaining = (7 - totalCells % 7) % 7;
    for (let d = 1; d <= remaining; d++) {
      html += `<div class="cal-cell other-month"><div class="cal-date">${d}</div></div>`;
    }

    grid.innerHTML = html;
  } catch (err) {
    grid.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);grid-column:1/-1">加载失败: ${err.message}</div>`;
  }
}

function prevCalMonth() {
  window._calMonth--;
  if (window._calMonth < 0) { window._calMonth = 11; window._calYear--; }
  drawCalendar(window._calYear, window._calMonth);
}

function nextCalMonth() {
  window._calMonth++;
  if (window._calMonth > 11) { window._calMonth = 0; window._calYear++; }
  drawCalendar(window._calYear, window._calMonth);
}

function goCalToday() {
  const n = new Date();
  window._calYear = n.getFullYear();
  window._calMonth = n.getMonth();
  drawCalendar(window._calYear, window._calMonth);
}

/* =============================================
   页面：成本管理
   ============================================= */
function setCostNoCostYMFilter(key) {
  costNoCostYMFilter = key;
  localStorage.setItem('remy_costNoCostYMFilter', key);
  renderCost();
}

async function renderCost() {
  const container = document.getElementById('pageContainer');

  try {
    const qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '';
    const [activities, warehouse, logistics, reimbursements] = await Promise.all([
      api('GET', `/activities${qs}`),
      api('GET', `/warehouse${qs}`),
      api('GET', `/logistics${qs}`),
      api('GET', `/reimbursements${qs}`),
    ]);

    // 计算统计
    const actCost = activities.reduce((s, a) => s + (parseFloat(a.total_cost)||0), 0);
    const warCost = warehouse.reduce((s, w) => s + (parseFloat(w.actual_cost)||0), 0);
    const warRev = warehouse.reduce((s, w) => s + (parseFloat(w.quoted_price)||0), 0);
    const logCost = logistics.reduce((s, l) => s + (parseFloat(l.fee)||0), 0);
    const reimCost = reimbursements.reduce((s, r) => s + (parseFloat(r.amount)||0), 0);
    const totalCost = actCost + warCost + logCost + reimCost;
    const totalRev = activities.reduce((s, a) => s + (parseFloat(a.quoted_price)||0), 0) + warRev;

    // 有成本的活动
    const actsWithCost = activities.filter(a => parseFloat(a.total_cost) > 0);
    const actsNoCost = activities.filter(a => !(parseFloat(a.total_cost) > 0));

    const ymKeyFor = (a) => {
      const dt = new Date(a.date || a.activity_date);
      if (isNaN(dt)) return 'unknown';
      // UTC 存储，需要+8小时修正到本地日期
      const local = new Date(dt.getTime() + 8 * 3600 * 1000);
      const y = local.getUTCFullYear();
      const m = String(local.getUTCMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    };

    const uniqueNoCostYMKeys = Array.from(new Set(actsNoCost.map(ymKeyFor)))
      .filter(k => k !== 'unknown')
      .sort((a, b) => b.localeCompare(a)); // YYYY-MM 逆序

    const filteredActsNoCost = costNoCostYMFilter === 'all'
      ? actsNoCost
      : actsNoCost.filter(a => ymKeyFor(a) === costNoCostYMFilter);

    container.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card success">
          <div class="stat-icon"><i data-lucide="wallet" style="width:16px;height:16px"></i></div>
          <div class="stat-label">总报价</div>
          <div class="stat-value sm">${fmtMoney(totalRev)}</div>
          <div class="stat-sub">场次 ${fmtMoney(totalRev-warRev)} ｜ 仓储 ${fmtMoney(warRev)}</div>
        </div>
        <div class="stat-card warning">
          <div class="stat-icon"><i data-lucide="hand-coins" style="width:16px;height:16px"></i></div>
          <div class="stat-label">总成本</div>
          <div class="stat-value sm">${fmtMoney(totalCost)}</div>
          <div class="stat-sub">场次 ${fmtMoney(actCost)} ｜ 仓储 ${fmtMoney(warCost)} ｜ 物流 ${fmtMoney(logCost)}</div>
        </div>
        <div class="stat-card accent">
          <div class="stat-icon"><i data-lucide="chart-column" style="width:16px;height:16px"></i></div>
          <div class="stat-label">毛利润</div>
          <div class="stat-value sm">${fmtMoney(totalRev - totalCost)}</div>
          <div class="stat-sub">毛利率 ${totalRev > 0 ? ((totalRev-totalCost)/totalRev*100).toFixed(1) : 0}%</div>
        </div>
        <div class="stat-card blue">
          <div class="stat-icon"><i data-lucide="clipboard-list" style="width:16px;height:16px"></i></div>
          <div class="stat-label">已填成本场次</div>
          <div class="stat-value">${actsWithCost.length}</div>
          <div class="stat-sub">待填 ${actsNoCost.length} 场</div>
        </div>
      </div>

      <!-- 未填成本的活动 -->
      <div class="card" style="margin-bottom:20px">
        <div class="card-header">
          <div style="flex:1">
            <div class="card-title"><i data-lucide="hourglass" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>待填写成本（${filteredActsNoCost.length}场）</div>
            <div class="card-sub">
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                <button class="btn btn-secondary btn-sm" style="${costNoCostYMFilter === 'all' ? 'background:var(--accent);color:white' : ''}" onclick="setCostNoCostYMFilter('all')">全部</button>
                ${uniqueNoCostYMKeys.map(k => {
                  const [y, m] = k.split('-');
                  return `<button class="btn btn-secondary btn-sm" style="${costNoCostYMFilter === k ? 'background:var(--accent);color:white' : ''}" onclick="setCostNoCostYMFilter('${k}')">${y}年${parseInt(m, 10)}月</button>`;
                }).join('')}
              </div>
              <div style="margin-top:8px">点击"填写"按钮添加成本明细</div>
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" onclick="toggleNoCostTable()">展开/收起</button>
        </div>
        <div id="noCostTable">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>项目编号</th>
                  <th>区域</th>
                  <th>品牌</th>
                  <th>类型</th>
                  <th>报价</th>
                  <th>成本</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${filteredActsNoCost.slice(0,30).map(a => `
                  <tr>
                    <td>${fmtDateShort(a.date||a.activity_date)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
                    <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
                    <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
                    <td class="amount amount-revenue">${fmtMoney(a.quoted_price)}</td>
                    <td class="amount amount-neutral">—</td>
                    <td><button class="btn btn-success btn-sm" onclick="showCostFillFromCost(${a.id})">+ 填写</button></td>
                  </tr>
                `).join('')}
                ${filteredActsNoCost.length > 30 ? `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:10px">还有 ${filteredActsNoCost.length-30} 条，请在活动记录中查看</td></tr>` : ''}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 已填成本活动 -->
      <div class="card">
        <div class="card-header">
          <div><div class="card-title"><i data-lucide="circle-check-big" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>已填成本（${actsWithCost.length}场）</div></div>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>项目编号</th>
                <th>区域</th>
                <th>品牌</th>
                <th>类型</th>
                <th>报价</th>
                <th>成本</th>
                <th>利润</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${actsWithCost.map(a => {
                const profit = (parseFloat(a.quoted_price)||0) - (parseFloat(a.total_cost)||0);
                return `
                  <tr>
                    <td>${fmtDateShort(a.date||a.activity_date)}</td>
                    <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px" title="${a.project_code||''}">${a.project_code||'—'}</td>
                    <td><span style="font-size:11px;color:var(--text-secondary)">${a.region||'—'}</span></td>
                    <td><span class="badge badge-${brandColor(a.brand)}">${a.brand||'—'}</span></td>
                    <td><span class="badge badge-${typeColor(a.activity_type)}">${a.activity_type||'—'}</span></td>
                    <td class="amount amount-revenue">${fmtMoney(a.quoted_price)}</td>
                    <td class="amount amount-cost">${fmtMoney(a.total_cost)}</td>
                    <td class="amount ${profit>=0?'amount-revenue':'amount-cost'}">${fmtMoney(profit)}</td>
                    <td><button class="btn btn-secondary btn-sm" onclick="showCostFillFromCost(${a.id})">修改</button></td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}

function toggleNoCostTable() {
  const el = document.getElementById('noCostTable');
  if (el) el.style.display = el.style.display === 'none' ? '' : 'none';
}

const COST_DETAIL_GROUPS = [
  {
    title: '一、人员',
    items: [
      { key: 'supervisor', label: '督导' },
      { key: 'pg', label: 'PG礼仪' },
      { key: 'parttime', label: '兼职' },
      { key: 'bartender', label: '调酒师' },
      { key: 'photo', label: '摄影师' },
      { key: 'cloud_album_edit', label: '云相册修图' },
      { key: 'performance', label: '演职人员' },
    ],
  },
  {
    title: '二、差旅',
    items: [
      { key: 'travel_supervisor', label: '督导差旅（交通及食宿）' },
      { key: 'travel_company', label: '盛融差旅（交通及食宿）' },
    ],
  },
  {
    title: '三、舞美制作',
    items: [
      { key: 'structure', label: '结构搭建' },
      { key: 'print', label: '印刷' },
      { key: 'spray', label: '写真喷绘' },
    ],
  },
  {
    title: '四、采购',
    items: [
      { key: 'floral', label: '场地方（场地/餐饮）' },
      { key: 'payment', label: '活动物料' },
      { key: 'tasting', label: '闻香物料' },
    ],
  },
  {
    title: '五、物流仓储',
    items: [
      { key: 'warehouse', label: '仓储' },
      { key: 'express', label: '快递（闪送）' },
      { key: 'logistics', label: '物流' },
    ],
  },
];

function parseActivityCostDetails(activity) {
  const out = {};
  let raw = activity && activity.cost_details;
  if (raw && typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch (_) { raw = null; }
  }
  if (!raw || typeof raw !== 'object') raw = {};
  COST_DETAIL_GROUPS.forEach((g) => {
    g.items.forEach((it) => {
      const v = raw[it.key] != null ? raw[it.key] : (activity ? activity[it.key] : null);
      out[it.key] = Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0;
    });
  });
  return out;
}

function renderCostDetailSections(fieldClass, details, onInputExpr) {
  return COST_DETAIL_GROUPS.map((g) => `
    <div class="card" style="margin-bottom:12px;border:1px dashed var(--border)">
      <div class="card-header" style="padding:10px 12px">
        <div class="card-title" style="font-size:14px">${g.title}</div>
      </div>
      <div class="card-body" style="padding:10px 12px">
        <div class="cost-grid">
          ${g.items.map((f) => `
            <div class="form-group">
              <label class="form-label">${f.label}</label>
              <input type="number" class="form-control ${fieldClass}" data-key="${f.key}" value="${details[f.key] || ''}" placeholder="0" step="0.01" oninput="${onInputExpr}">
            </div>
          `).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

function collectCostDetails(fieldClass) {
  const details = {};
  document.querySelectorAll(`.${fieldClass}`).forEach((el) => {
    const key = el.getAttribute('data-key');
    if (!key) return;
    details[key] = parseFloat(el.value) || 0;
  });
  return details;
}

function calcCostDetailsTotal(details) {
  if (!details || typeof details !== 'object') return 0;
  return Object.values(details).reduce((s, v) => s + (parseFloat(v) || 0), 0);
}

async function showCostFillFromCost(actId) {
  try {
    const a = await api('GET', `/activities/${actId}`);
    const details = parseActivityCostDetails(a);
    const content = document.getElementById('costFillContent2');
    if (!content) {
      showToast('找不到成本弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }
    const total = calcCostDetailsTotal(details);
    content.innerHTML = `
      <input type="hidden" id="costActId2" value="${actId}">
      <div style="margin-bottom:12px;padding:10px;background:var(--bg-input);border-radius:var(--radius-sm)">
        <div style="font-size:12px;color:var(--text-secondary)">${a.project_code||a.city+(a.activity_type||'')}</div>
        <div style="font-size:13px;color:var(--text-primary);margin-top:2px">报价：<span class="amount amount-revenue">${fmtMoney(a.quoted_price)}</span></div>
      </div>
      ${renderCostDetailSections('cost-field2', details, 'updateCostTotal2()')}
      <div style="margin-top:14px;padding:12px;background:var(--accent-soft);border-radius:var(--radius-sm);display:flex;justify-content:space-between;align-items:center">
        <span style="color:var(--text-secondary);font-size:13px">成本合计</span>
        <span class="amount" style="font-size:18px;font-weight:700;color:var(--accent)" id="costTotal2">${fmtMoney(total)}</span>
      </div>
    `;
    openModal('modalCostFill2');
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function updateCostTotal2() {
  let total = 0;
  document.querySelectorAll('.cost-field2').forEach(el => { total += parseFloat(el.value)||0; });
  const el = document.getElementById('costTotal2');
  if (el) el.textContent = fmtMoney(total);
}

async function saveCostFromModal2() {
  const actId = document.getElementById('costActId2').value;
  const details = collectCostDetails('cost-field2');
  const total = calcCostDetailsTotal(details);
  try {
    await api('PUT', `/activities/${actId}`, { total_cost: total, cost_details: details });
    showToast('成本已保存', 'success');
    closeModal();
    renderCost();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

/* =============================================
   页面：物流记录
   ============================================= */
async function renderLogistics() {
  const container = document.getElementById('pageContainer');

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <input type="text" class="search-input" id="logSearch" placeholder="搜索单号/城市/项目编号..." oninput="filterLogistics()">
      </div>
      <div class="toolbar-right" style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-danger btn-sm" id="logBatchDeleteBtn" disabled onclick="deleteSelectedLogistics()">一键删除</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="showLogisticsModal()">+ 新建物流</button>
      </div>
    </div>
    <div id="logTable"></div>
  `;

  await loadLogistics();
}

/** 与物流表格一致：当前已加载数据 + 搜索框过滤后的可见行 */
function getLogisticsVisibleRows() {
  const search = (document.getElementById('logSearch')?.value || '').toLowerCase();
  const data = logisticsState.data || [];
  if (!search) return data;
  return data.filter((l) =>
    (l.tracking_number || '').toLowerCase().includes(search) ||
    (l.origin_city || '').toLowerCase().includes(search) ||
    (l.destination_city || '').toLowerCase().includes(search) ||
    (l.related_project_code || '').toLowerCase().includes(search) ||
    (l.project_code || '').toLowerCase().includes(search)
  );
}

async function loadLogistics() {
  const container = document.getElementById('logTable');
  if (!container) return;
  try {
    const qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '';
    const data = await api('GET', `/logistics${qs}`);
    logisticsState.data = data;

    const filtered = getLogisticsVisibleRows();

    const idSetVisible = new Set(filtered.map((l) => Number(l.id)));
    const nextSel = new Set();
    logisticsState.selectedIds.forEach((id) => {
      if (idSetVisible.has(id)) nextSel.add(id);
    });
    logisticsState.selectedIds = nextSel;

    const totalFee = filtered.reduce((s,l) => s+(parseFloat(l.fee)||0), 0);

    container.innerHTML = `
      <div style="margin-bottom:12px;display:flex;gap:12px">
        <div class="stat-card blue" style="flex:0 0 160px;padding:14px">
          <div class="stat-label">共 ${filtered.length} 条</div>
          <div class="stat-value sm">${fmtMoney(totalFee)}</div>
          <div class="stat-sub">物流费用合计</div>
        </div>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr>
              <th style="width:44px;text-align:center" title="多选">
                <input type="checkbox" id="logSelectAll" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)" onchange="toggleLogisticsSelectAll(this.checked)" aria-label="全选当前列表">
              </th>
              <th>日期</th><th>物流公司</th><th>单号</th><th>路线</th><th>费用</th><th>关联项目</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${filtered.length ? filtered.map(l => {
              const lid = Number(l.id);
              const isSel = logisticsState.selectedIds.has(lid);
              return `
              <tr>
                <td style="text-align:center;vertical-align:middle">
                  <input type="checkbox" class="log-row-cb" data-log-id="${lid}" ${isSel ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)" onchange="toggleLogisticsRowSelect(${lid}, this.checked)" aria-label="选择该条物流记录">
                </td>
                <td>${fmtDateShort(l.shipping_date)}</td>
                <td><span class="badge badge-blue">${l.logistics_company||'—'}</span></td>
                <td>
                  ${l.tracking_number
                    ? `<a href="https://www.sf-express.com/cn/sc/dynamic_function/waybill/#search/bill-number/${l.tracking_number}" target="_blank" style="color:var(--accent);font-family:monospace;font-size:12px">${l.tracking_number}</a>`
                    : '—'}
                </td>
                <td style="font-size:12px">${l.origin_city||''}→${l.destination_city||''}</td>
                <td class="amount ${parseFloat(l.fee)>0?'amount-cost':'amount-neutral'}">${parseFloat(l.fee)>0?fmtMoney(l.fee):'—'}</td>
                <td class="project-code">${formatLogisticsRelatedProject(l)}</td>
                <td>
                  <div style="display:flex;gap:4px">
                    <button class="btn btn-secondary btn-sm" onclick="showLogisticsModal(${l.id})">编辑</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteLogistics(${l.id})">删</button>
                  </div>
                </td>
              </tr>
            `;
            }).join('') : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:30px">暂无数据</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
    updateLogisticsSelectUi();
    void updateBadges();
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon"><i data-lucide="triangle-alert" style="width:20px;height:20px"></i></div><div class="empty-title">加载失败</div><div class="empty-sub">${err.message}</div></div>`;
    renderLucideIcons();
  }
}

function toggleLogisticsRowSelect(id, checked) {
  const n = Number(id);
  if (!Number.isFinite(n)) return;
  if (checked) logisticsState.selectedIds.add(n);
  else logisticsState.selectedIds.delete(n);
  updateLogisticsSelectUi();
}

function toggleLogisticsSelectAll(checked) {
  const filtered = getLogisticsVisibleRows();
  const ids = filtered.map((l) => Number(l.id)).filter(Number.isFinite);
  if (checked) ids.forEach((id) => logisticsState.selectedIds.add(id));
  else ids.forEach((id) => logisticsState.selectedIds.delete(id));
  document.querySelectorAll('.log-row-cb').forEach((cb) => {
    const id = Number(cb.getAttribute('data-log-id'));
    cb.checked = logisticsState.selectedIds.has(id);
  });
  updateLogisticsSelectUi();
}

function updateLogisticsSelectUi() {
  const allCb = document.getElementById('logSelectAll');
  const filtered = getLogisticsVisibleRows();
  if (allCb) {
    if (!filtered.length) {
      allCb.checked = false;
      allCb.indeterminate = false;
    } else {
      const ids = filtered.map((l) => Number(l.id));
      const selCount = ids.filter((id) => logisticsState.selectedIds.has(id)).length;
      allCb.checked = selCount === ids.length;
      allCb.indeterminate = selCount > 0 && selCount < ids.length;
    }
  }
  const btn = document.getElementById('logBatchDeleteBtn');
  if (btn) {
    const n = logisticsState.selectedIds.size;
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? `一键删除（已选 ${n} 条）` : '一键删除';
  }
}

async function deleteSelectedLogistics() {
  const ids = Array.from(logisticsState.selectedIds).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请先勾选要删除的记录', 'warning');
    return;
  }
  if (!confirm(`确定删除选中的 ${ids.length} 条物流记录？`)) return;
  if (!confirm('再次确认：删除后不可恢复，是否继续？')) return;
  try {
    for (const id of ids) {
      await api('DELETE', `/logistics/${id}`);
    }
    logisticsState.selectedIds = new Set();
    showToast(`已删除 ${ids.length} 条记录`, 'success');
    await loadLogistics();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
    await loadLogistics();
  }
}

function filterLogistics() {
  loadLogistics();
}

/** 列表/弹窗展示用：关联项目编号（兼容接口字段） */
function formatLogisticsRelatedProject(l) {
  const a =
    l.related_project_code != null && String(l.related_project_code).trim() !== ''
      ? String(l.related_project_code).trim()
      : l.project_code != null && String(l.project_code).trim() !== ''
        ? String(l.project_code).trim()
        : '';
  if (!a) return '—';
  return escapeHtml(a);
}

// 物流：关联项目编号索引（当前年度活动 project_code → activity.id）
const logisticsProjectIndex = {
  codes: new Set(),
  codeToId: new Map(),
};

/** 打开物流弹窗时填充「关联项目编号」下拉建议（当前年度活动 project_code） */
async function loadLogProjectDatalist() {
  const dl = document.getElementById('logProjectList');
  if (!dl) return;
  try {
    let qs = '?sortBy=date&sortOrder=DESC';
    if (currentYearFrameId) qs += `&yearFrameId=${currentYearFrameId}`;
    const acts = await api('GET', `/activities${qs}`);
    const codes = (acts || [])
      .map((x) => ({ id: Number(x.id), code: (x.project_code || '').replace(/^\uFEFF/, '').trim() }))
      .filter((x) => x.code);
    logisticsProjectIndex.codes = new Set(codes.map((x) => x.code));
    logisticsProjectIndex.codeToId = new Map(codes.map((x) => [x.code, x.id]).filter(([, id]) => Number.isFinite(id)));
    const uniqSorted = [...new Set(codes.map((x) => x.code))].sort();
    dl.innerHTML = uniqSorted.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
  } catch (_) {
    dl.innerHTML = '';
    logisticsProjectIndex.codes = new Set();
    logisticsProjectIndex.codeToId = new Map();
  }
}

async function showLogisticsModal(id = null) {
  document.getElementById('logModalTitle').textContent = id ? '编辑物流记录' : '新建物流记录';
  document.getElementById('logId').value = id || '';
  ['logCompany', 'logTrack', 'logOrigin', 'logDest', 'logDate', 'logFee', 'logProject', 'logRemarks'].forEach((f) => {
    const el = document.getElementById(f);
    if (el) el.value = '';
  });
  document.getElementById('logCompany').value = '顺丰';

  await loadLogProjectDatalist();

  const nid = id != null && id !== '' ? Number(id) : NaN;
  if (Number.isFinite(nid)) {
    let item = null;
    try {
      item = await api('GET', `/logistics/${nid}`);
    } catch (e) {
      item = logisticsState.data.find((l) => Number(l.id) === nid) || null;
    }
    if (item) {
      document.getElementById('logCompany').value = item.logistics_company || '顺丰';
      document.getElementById('logTrack').value = item.tracking_number || '';
      document.getElementById('logOrigin').value = item.origin_city || '';
      document.getElementById('logDest').value = item.destination_city || '';
      if (item.shipping_date) document.getElementById('logDate').value = new Date(item.shipping_date).toISOString().split('T')[0];
      document.getElementById('logFee').value = item.fee != null && item.fee !== '' ? item.fee : '';
      const rpc =
        item.related_project_code != null && String(item.related_project_code).trim() !== ''
          ? String(item.related_project_code).trim()
          : item.project_code != null && String(item.project_code).trim() !== ''
            ? String(item.project_code).trim()
            : '';
      document.getElementById('logProject').value = rpc;
      document.getElementById('logRemarks').value = item.remarks || '';
    }
  }
  openModal('modalLogistics');
}

async function saveLogistics() {
  const id = document.getElementById('logId').value;
  const rpcRaw = (document.getElementById('logProject')?.value || '').replace(/^\uFEFF/, '').trim();
  if (rpcRaw) {
    // 强制：必须来自活动项目编号，防止手误输入
    if (!logisticsProjectIndex.codes.has(rpcRaw)) {
      showToast('关联项目编号必须从活动项目编号中选择（请从下拉建议中选中）', 'error');
      return;
    }
  }
  const body = {
    year_frame_id: currentYearFrameId || 1,
    logistics_company: document.getElementById('logCompany').value,
    tracking_number: document.getElementById('logTrack').value,
    origin_city: document.getElementById('logOrigin').value,
    destination_city: document.getElementById('logDest').value,
    shipping_date: document.getElementById('logDate').value || null,
    fee: parseFloat(document.getElementById('logFee').value) || 0,
    related_project_code: rpcRaw || null,
    remarks: document.getElementById('logRemarks').value,
  };
  try {
    if (id) {
      await api('PUT', `/logistics/${id}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/logistics', body);
      showToast('已创建', 'success');
    }
    closeModal();
    loadLogistics();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function deleteLogistics(id) {
  if (!confirm('确认删除此物流记录？')) return;
  try {
    await api('DELETE', `/logistics/${id}`);
    showToast('已删除', 'success');
    loadLogistics();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

/* =============================================
   页面：仓储记录
   ============================================= */
async function renderWarehouse() {
  const container = document.getElementById('pageContainer');

  container.innerHTML = `
    <div class="toolbar">
      <div class="toolbar-left">
        <select class="filter-select" id="warMonth" onchange="loadWarehouse()">
          <option value="">全部月份</option>
          ${Array.from({length:12},(_,i)=>`<option value="${i+1}月">${i+1}月</option>`).join('')}
        </select>
      </div>
      <div class="toolbar-right" style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-danger btn-sm" id="warBatchDeleteBtn" disabled onclick="deleteSelectedWarehouse()">一键删除</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="showWarehouseModal()">+ 新建仓储</button>
      </div>
    </div>
    <div id="warSummary"></div>
    <div id="warTable"></div>
  `;

  await loadWarehouse();
}

const WAREHOUSE_REGION_OPTIONS = ['东区', '北区', '南区'];
const WAREHOUSE_TRAD_TO_SIMP = { '東區': '东区', '北區': '北区', '南區': '南区' };

/** 与后端一致：去 BOM、NFKC、繁体「東區」等映射为简体选项值 */
function normalizeWarehouseRegion(v) {
  if (v == null || v === '') return '';
  let s = (typeof v === 'string' ? v : String(v)).replace(/^\uFEFF/, '').trim().normalize('NFKC');
  if (WAREHOUSE_TRAD_TO_SIMP[s]) s = WAREHOUSE_TRAD_TO_SIMP[s];
  return s;
}

/** 从下拉框读取区域（按选中项 value，避免部分浏览器只显示文字未改 value） */
function readWarRegionSelect() {
  const sel = document.getElementById('warRegion');
  if (!sel || sel.selectedIndex < 0) return '';
  const raw = sel.options[sel.selectedIndex].value;
  return normalizeWarehouseRegion(raw);
}

async function loadWarehouse() {
  try {
    const month = document.getElementById('warMonth')?.value || '';
    let qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '?';
    if (month) qs += `&month=${encodeURIComponent(month)}`;

    const data = await api('GET', `/warehouse${qs}`);
    warehouseState.data = data;
    const idSetOnPage = new Set(data.map((w) => Number(w.id)));
    const nextSel = new Set();
    warehouseState.selectedIds.forEach((id) => {
      if (idSetOnPage.has(id)) nextSel.add(id);
    });
    warehouseState.selectedIds = nextSel;

    const sumEl = document.getElementById('warSummary');
    if (sumEl) {
      const REGION_META = [
        { key: '东区', label: '东区（上海）', tone: 'accent' },
        { key: '北区', label: '北区（天津）', tone: 'blue' },
        { key: '南区', label: '南区（广州）', tone: 'warning' },
      ];

      const TAX_RATE = 0.06; // 报价含税 6%
      const taxDiv = 1 + TAX_RATE;
      const rowsByRegion = new Map(REGION_META.map((r) => [r.key, []]));
      data.forEach((w) => {
        const r = normalizeWarehouseRegion(w.region);
        if (rowsByRegion.has(r)) rowsByRegion.get(r).push(w);
      });

      const calc = (rows) => {
        const quoted = rows.reduce((s, w) => s + (parseFloat(w.quoted_price) || 0), 0);
        const cost = rows.reduce((s, w) => s + (parseFloat(w.actual_cost) || 0), 0);
        const profit = quoted / taxDiv - cost;
        return { quoted, cost, profit };
      };

      sumEl.innerHTML = `
        <div class="stats-grid three" style="margin-bottom:16px">
          ${REGION_META.map((r) => {
            const rows = rowsByRegion.get(r.key) || [];
            const { quoted, cost, profit } = calc(rows);
            return `
              <div class="stat-card ${r.tone}">
                <div class="stat-icon"><i data-lucide="warehouse" style="width:16px;height:16px"></i></div>
                <div class="stat-label">${r.label}</div>
                <div style="display:flex;flex-direction:column;gap:6px;margin-top:6px">
                  <div style="display:flex;justify-content:space-between;gap:10px">
                    <span style="font-size:12px;color:var(--text-secondary)">报价（含税）</span>
                    <span class="amount amount-revenue" style="font-weight:700">${fmtMoney(quoted)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;gap:10px">
                    <span style="font-size:12px;color:var(--text-secondary)">成本</span>
                    <span class="amount ${cost > 0 ? 'amount-cost' : 'amount-neutral'}" style="font-weight:700">${fmtMoney(cost)}</span>
                  </div>
                  <div style="display:flex;justify-content:space-between;gap:10px">
                    <span style="font-size:12px;color:var(--text-secondary)">利润（不含税）</span>
                    <span class="amount ${profit >= 0 ? 'amount-revenue' : 'amount-cost'}" style="font-weight:800">${fmtMoney(profit)}</span>
                  </div>
                </div>
                <div class="stat-sub">利润 = 报价 ÷ 1.06 − 成本</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    const tableEl = document.getElementById('warTable');
    if (tableEl) {
      tableEl.innerHTML = `
        <div class="table-wrapper">
          <table>
            <thead><tr>
              <th style="width:44px;text-align:center" title="多选">
                <input type="checkbox" id="warSelectAll" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)" onchange="toggleWarehouseSelectAll(this.checked)" aria-label="全选当前列表">
              </th>
              <th>年份</th>
              <th>月份</th>
              <th>区域</th>
              <th>数量<br><span style="font-size:10px;font-weight:500;color:var(--text-muted);text-transform:none;letter-spacing:0">（月）</span></th>
              <th>单价</th>
              <th>报价<br><span style="font-size:10px;font-weight:500;color:var(--text-muted);text-transform:none;letter-spacing:0">（数量×单价）</span></th>
              <th>实际成本</th>
              <th>备注</th>
              <th>操作</th>
            </tr></thead>
            <tbody>
              ${data.length ? data.map(w => {
                const qty = parseFloat(w.quantity);
                const qtySafe = Number.isFinite(qty) ? qty : 0;
                const upNum = parseFloat(w.unit_price);
                const hasUnitPrice = w.unit_price != null && w.unit_price !== '' && Number.isFinite(upNum);
                const quoteSub = hasUnitPrice
                  ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${qtySafe}月×${fmtMoney(upNum)}</div>`
                  : '';
                const wid = Number(w.id);
                const isSel = warehouseState.selectedIds.has(wid);
                return `
                <tr>
                  <td style="text-align:center;vertical-align:middle">
                    <input type="checkbox" class="war-row-cb" data-war-id="${wid}" ${isSel ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent)" onchange="toggleWarehouseRowSelect(${wid}, this.checked)" aria-label="选择该条仓储记录">
                  </td>
                  <td><span class="badge badge-gray" style="font-weight:600">${w.year_frame_name != null && String(w.year_frame_name).trim() !== '' ? escapeHtml(String(w.year_frame_name)) : '—'}</span></td>
                  <td><span class="badge badge-blue">${escapeHtml(w.month||'—')}</span></td>
                  <td><span class="badge badge-accent">${(() => { const r = normalizeWarehouseRegion(w.region); return r ? escapeHtml(r) : '—'; })()}</span></td>
                  <td>${qtySafe}<span style="font-size:11px;color:var(--text-muted);margin-left:3px">月</span></td>
                  <td>${hasUnitPrice ? fmtMoney(upNum) : '—'}</td>
                  <td class="amount amount-revenue" style="vertical-align:top">
                    <div>${fmtMoney(w.quoted_price)}</div>
                    ${quoteSub}
                  </td>
                  <td class="amount ${parseFloat(w.actual_cost)>0?'amount-cost':'amount-neutral'}">${parseFloat(w.actual_cost)>0?fmtMoney(w.actual_cost):'—'}</td>
                  <td style="font-size:12px;color:var(--text-muted)">${escapeHtml(w.remarks||'')}</td>
                  <td>
                    <div style="display:flex;gap:4px">
                      <button class="btn btn-secondary btn-sm" onclick="showWarehouseModal(${w.id})">编辑</button>
                      <button class="btn btn-danger btn-sm" onclick="deleteWarehouse(${w.id})">删</button>
                    </div>
                  </td>
                </tr>
              `;
              }).join('') : '<tr><td colspan="10" style="text-align:center;color:var(--text-muted);padding:30px">暂无数据</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
      updateWarehouseSelectUi();
    }
    void updateBadges();
  } catch (err) {
    showToast('加载失败: ' + err.message, 'error');
  }
}

function toggleWarehouseRowSelect(id, checked) {
  const n = Number(id);
  if (!Number.isFinite(n)) return;
  if (checked) warehouseState.selectedIds.add(n);
  else warehouseState.selectedIds.delete(n);
  updateWarehouseSelectUi();
}

function toggleWarehouseSelectAll(checked) {
  const ids = (warehouseState.data || []).map((w) => Number(w.id)).filter(Number.isFinite);
  if (checked) ids.forEach((id) => warehouseState.selectedIds.add(id));
  else ids.forEach((id) => warehouseState.selectedIds.delete(id));
  document.querySelectorAll('.war-row-cb').forEach((cb) => {
    const id = Number(cb.getAttribute('data-war-id'));
    cb.checked = warehouseState.selectedIds.has(id);
  });
  updateWarehouseSelectUi();
}

function updateWarehouseSelectUi() {
  const allCb = document.getElementById('warSelectAll');
  const data = warehouseState.data || [];
  if (allCb) {
    if (!data.length) {
      allCb.checked = false;
      allCb.indeterminate = false;
    } else {
      const ids = data.map((w) => Number(w.id));
      const selCount = ids.filter((id) => warehouseState.selectedIds.has(id)).length;
      allCb.checked = selCount === ids.length;
      allCb.indeterminate = selCount > 0 && selCount < ids.length;
    }
  }
  const btn = document.getElementById('warBatchDeleteBtn');
  if (btn) {
    const n = warehouseState.selectedIds.size;
    btn.disabled = n === 0;
    btn.textContent = n > 0 ? `一键删除（已选 ${n} 条）` : '一键删除';
  }
}

async function deleteSelectedWarehouse() {
  const ids = Array.from(warehouseState.selectedIds).filter(Number.isFinite);
  if (!ids.length) {
    showToast('请先勾选要删除的记录', 'warning');
    return;
  }
  if (!confirm(`确定删除选中的 ${ids.length} 条仓储记录？`)) return;
  if (!confirm('再次确认：删除后不可恢复，是否继续？')) return;
  try {
    for (const id of ids) {
      await api('DELETE', `/warehouse/${id}`);
    }
    warehouseState.selectedIds = new Set();
    showToast(`已删除 ${ids.length} 条记录`, 'success');
    await loadWarehouse();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
    await loadWarehouse();
  }
}

function updateWarQuotedPrice() {
  const elQ = document.getElementById('warQty');
  const elU = document.getElementById('warUnitPrice');
  const elP = document.getElementById('warQuotedPrice');
  if (!elQ || !elU || !elP) return;
  const qn = Math.max(0, parseFloat(elQ.value) || 0);
  const un = Math.max(0, parseFloat(elU.value) || 0);
  const total = Math.round(qn * un * 100) / 100;
  elP.value = total.toFixed(2);
}

async function fillWarehouseYearFrameSelect(preferredFrameId) {
  const sel = document.getElementById('warYearFrameId');
  if (!sel) return;
  const frames = await api('GET', '/year-frames');
  sel.innerHTML = frames.map(f => {
    const label = [f.year, f.name].filter(Boolean).join(' · ');
    return `<option value="${f.id}">${escapeHtml(label || String(f.id))}</option>`;
  }).join('');
  const want = preferredFrameId || currentYearFrameId;
  if (want && frames.some(f => String(f.id) === String(want))) {
    sel.value = String(want);
  } else if (frames[0]) {
    sel.value = String(frames[0].id);
  }
}

async function showWarehouseModal(id = null) {
  const wid = id != null && id !== '' ? Number(id) : NaN;
  const editing = Number.isFinite(wid);

  document.getElementById('warModalTitle').textContent = editing ? '编辑仓储记录' : '新建仓储记录';
  document.getElementById('warId').value = editing ? String(wid) : '';
  ['warQty', 'warUnitPrice', 'warQuotedPrice', 'warActualCost', 'warRemarks'].forEach(fid => {
    const el = document.getElementById(fid);
    if (el) el.value = '';
  });
  const reg = document.getElementById('warRegion');
  if (reg) reg.value = '';
  const mf = document.getElementById('warMonthField');
  if (mf) mf.value = '1月';

  let preferredYf = currentYearFrameId;
  let item = null;
  if (editing) {
    try {
      item = await api('GET', `/warehouse/${wid}`);
    } catch (e) {
      item = warehouseState.data.find(w => Number(w.id) === wid) || null;
      if (!item) {
        showToast('加载记录失败: ' + (e.message || ''), 'error');
      }
    }
  }

  if (item) {
    preferredYf = item.year_frame_id;
    if (mf) mf.value = item.month || '1月';
    const rSel = normalizeWarehouseRegion(item.region);
    if (reg) reg.value = WAREHOUSE_REGION_OPTIONS.includes(rSel) ? rSel : '';
    document.getElementById('warQty').value = item.quantity != null && item.quantity !== '' ? item.quantity : '';
    document.getElementById('warUnitPrice').value = item.unit_price != null && item.unit_price !== '' ? item.unit_price : '';
    document.getElementById('warQuotedPrice').value = item.quoted_price != null && item.quoted_price !== '' ? item.quoted_price : '';
    document.getElementById('warActualCost').value = item.actual_cost != null && item.actual_cost !== '' ? item.actual_cost : '';
    document.getElementById('warRemarks').value = item.remarks || '';
  }

  try {
    await fillWarehouseYearFrameSelect(preferredYf);
  } catch (e) {
    showToast('加载年框失败: ' + (e.message || ''), 'error');
  }
  if (item) {
    const rSel = normalizeWarehouseRegion(item.region);
    if (reg) reg.value = WAREHOUSE_REGION_OPTIONS.includes(rSel) ? rSel : '';
  }
  updateWarQuotedPrice();
  openModal('modalWarehouse');
}

async function saveWarehouse() {
  const id = document.getElementById('warId').value;
  const yearFrameId = parseInt(document.getElementById('warYearFrameId').value, 10);
  const region = readWarRegionSelect();
  if (!yearFrameId) {
    showToast('请选择年份', 'error');
    return;
  }
  if (!region || !WAREHOUSE_REGION_OPTIONS.includes(region)) {
    showToast('请选择区域：东区 / 北区 / 南区', 'error');
    return;
  }
  updateWarQuotedPrice();
  const qty = parseInt(document.getElementById('warQty').value, 10) || 0;
  const unitPrice = parseFloat(document.getElementById('warUnitPrice').value) || 0;
  if (qty <= 0) {
    showToast('数量（月）须大于 0', 'error');
    return;
  }
  if (unitPrice <= 0) {
    showToast('单价须大于 0', 'error');
    return;
  }
  const body = {
    year_frame_id: yearFrameId,
    month: document.getElementById('warMonthField').value,
    region,
    wine_name: '',
    specifications: '',
    quantity: qty,
    unit_price: unitPrice,
    quoted_price: parseFloat(document.getElementById('warQuotedPrice').value) || 0,
    actual_cost: parseFloat(document.getElementById('warActualCost').value) || 0,
    remarks: document.getElementById('warRemarks').value,
  };
  try {
    if (id) {
      await api('PUT', `/warehouse/${id}`, body);
      showToast('已更新', 'success');
    } else {
      await api('POST', '/warehouse', body);
      showToast('已创建', 'success');
    }
    closeModal();
    await loadWarehouse();
  } catch (err) {
    showToast('保存失败: ' + err.message, 'error');
  }
}

async function deleteWarehouse(id) {
  if (!confirm('确认删除此仓储记录？')) return;
  try {
    await api('DELETE', `/warehouse/${id}`);
    showToast('已删除', 'success');
    await loadWarehouse();
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

/* =============================================
   页面：数据备份
   ============================================= */
async function renderBackup() {
  const container = document.getElementById('pageContainer');
  container.innerHTML = `
    <div class="card" style="max-width:600px;margin:0 auto">
      <div class="card-header">
        <div class="card-title"><i data-lucide="database-backup" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>数据备份与导出</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div style="padding:16px;background:var(--bg-input);border-radius:var(--radius-sm)">
          <div style="font-weight:600;margin-bottom:6px">导出当前数据</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">导出所有活动、物流、仓储、报销数据为 JSON 格式</div>
          <button class="btn btn-primary" onclick="exportData()"><i data-lucide="download" style="width:14px;height:14px"></i>导出 JSON 备份</button>
        </div>

        <div style="padding:16px;background:var(--bg-input);border-radius:var(--radius-sm)">
          <div style="font-weight:600;margin-bottom:6px">服务器状态</div>
          <div id="serverStatus" style="font-size:13px;color:var(--text-secondary)">检查中...</div>
        </div>
      </div>
    </div>
  `;

  try {
    const health = await api('GET', '/health');
    document.getElementById('serverStatus').innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;color:var(--success)">
        <span class="status-dot"></span>
        <span>MySQL 已连接，API 服务正常（${window.location.host}）</span>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">上次检查: ${new Date().toLocaleTimeString()}</div>
    `;
  } catch (err) {
    document.getElementById('serverStatus').innerHTML = `<span style="color:var(--danger)"><i data-lucide="triangle-alert" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px"></i>服务异常: ${err.message}</span>`;
    renderLucideIcons();
  }
}

async function exportData() {
  try {
    const qs = currentYearFrameId ? `?yearFrameId=${currentYearFrameId}` : '';
    const [activities, logistics, warehouse, reimbursements] = await Promise.all([
      api('GET', `/activities${qs}`),
      api('GET', `/logistics${qs}`),
      api('GET', `/warehouse${qs}`),
      api('GET', `/reimbursements${qs}`),
    ]);
    const data = { exportTime: new Date().toISOString(), year: currentYear, activities, logistics, warehouse, reimbursements };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `remy-backup-${currentYear}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('备份导出成功', 'success');
  } catch (err) {
    showToast('导出失败: ' + err.message, 'error');
  }
}

/* =============================================
   页面：客户用酒
   ============================================= */
async function renderWine() {
  const container = document.getElementById('pageContainer');
  
  container.innerHTML = `
    <div class="page-header" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" onclick="showWineStockInModal()"><i data-lucide="download" style="width:14px;height:14px"></i>酒品入库</button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row" id="wineStats" style="margin-bottom:20px"></div>

    <!-- 库存总览 -->
    <div class="card" style="margin-bottom:16px">
      <div class="card-header">
        <h3><i data-lucide="wine" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>酒品库存</h3>
      </div>
      <div class="card-body" id="wineInventoryList">
        <div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>
      </div>
    </div>

    <!-- 入库记录 -->
    <div class="card">
      <div class="card-header">
        <div class="card-title"><i data-lucide="package" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>入库记录</div>
      </div>
      <div class="card-body" id="wineRecordsContent">
        <div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>
      </div>
    </div>
  `;

  await loadWineInventory();
  await loadWineRecords('stockIn');
}

async function loadWineInventory() {
  try {
    const wines = await api('GET', '/wine');
    const LOW_STOCK_THRESHOLD = 5;
    const stats = wines.reduce((acc, w) => {
      acc.totalQty += w.quantity;
      return acc;
    }, { totalQty: 0, lowStock: 0 });

    document.getElementById('wineStats').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">总库存</div>
        <div class="stat-value">${stats.totalQty} <span style="font-size:13px;color:var(--text-muted)">瓶</span></div>
      </div>
      <div class="stat-card">
        <div class="stat-label">品种数</div>
        <div class="stat-value">${wines.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">有库存品种</div>
        <div class="stat-value" style="color:${wines.filter(w=>w.quantity>0).length>0?'var(--success)':'var(--text-muted)'}">${wines.filter(w=>w.quantity>0).length}</div>
      </div>
    `;

    // 按酒品名称分组，卡片化展示
    const grouped = {};
    wines.forEach((w) => {
      const key = w.wine_name || '未命名酒品';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(w);
    });

    const inventoryHtml = Object.entries(grouped).map(([name, specs]) => {
      const total = specs.reduce((sum, s) => sum + (parseInt(s.quantity, 10) || 0), 0);
      const hasStock = total > 0;
      const hasLowStockSpec = specs.some((s) => {
        const q = parseInt(s.quantity, 10) || 0;
        return q > 0 && q <= LOW_STOCK_THRESHOLD;
      });
      return `
        <div class="wine-inventory-card">
          <div class="wine-card-header">
            <div class="wine-card-title">${escapeHtml(name)}</div>
            <div class="wine-card-total ${hasLowStockSpec ? 'low-stock' : (hasStock ? 'has-stock' : 'no-stock')}">
              ${total} 瓶${hasLowStockSpec ? `<span class="wine-low-stock-tag">低库存</span>` : ''}
            </div>
          </div>
          <div class="wine-card-spec-list">
            ${specs.map((s) => `
              <div class="wine-card-spec-item">
                <div class="wine-card-spec-name">${escapeHtml(s.spec || '默认规格')}</div>
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="wine-card-spec-qty ${
                    (() => {
                      const q = parseInt(s.quantity, 10) || 0;
                      if (q > 0 && q <= LOW_STOCK_THRESHOLD) return 'low-stock';
                      return q > 0 ? 'has-stock' : 'no-stock';
                    })()
                  }">${parseInt(s.quantity, 10) || 0} 瓶</div>
                  <button class="btn btn-secondary btn-xs" onclick="editWineInventory('${escapeHtml(String(s.wine_code || ''))}', ${parseInt(s.quantity, 10) || 0})">编辑</button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('wineInventoryList').innerHTML = `
      <div class="wine-inventory-grid">
        ${inventoryHtml || '<div class="wine-inventory-empty">暂无酒品库存数据</div>'}
      </div>
    `;
  } catch (err) {
    document.getElementById('wineInventoryList').innerHTML = `<div style="color:var(--danger);padding:20px">加载失败: ${err.message}</div>`;
    console.error('加载酒品库存失败:', err);
  }
}

async function editWineInventory(wineCode, currentQty) {
  const code = (wineCode || '').trim();
  if (!code) {
    showToast('缺少酒品编码，无法编辑库存', 'error');
    return;
  }
  const input = prompt(`手动修改库存（编码：${code}）\n请输入最新库存数量（整数，>= 0）`, String(currentQty || 0));
  if (input == null) return;
  const qty = parseInt(String(input).trim(), 10);
  if (!Number.isFinite(qty) || qty < 0) {
    showToast('库存数量必须是大于等于 0 的整数', 'error');
    return;
  }
  try {
    await api('PUT', `/wine/${encodeURIComponent(code)}`, { quantity: qty });
    showToast('库存已更新', 'success');
    await loadWineInventory();
  } catch (err) {
    showToast('更新库存失败: ' + err.message, 'error');
  }
}

async function loadWineRecords(tab) {
  const content = document.getElementById('wineRecordsContent');
  content.innerHTML = `<div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>`;
  
  try {
    const qs = currentYearFrameId ? `?year_frame_id=${currentYearFrameId}` : '';
    const records = tab === 'stockIn'
      ? await api('GET', `/wine/stock-in${qs}`)
      : await api('GET', `/wine/usage${qs}`);
    
    if (records.length === 0) {
      content.innerHTML = `<div style="color:var(--text-muted);padding:30px;text-align:center">暂无${tab === 'stockIn' ? '入库' : '使用'}记录</div>`;
      return;
    }

    if (tab === 'stockIn') {
      content.innerHTML = `
        <table class="data-table">
          <thead><tr><th>日期</th><th>酒品</th><th>规格</th><th>数量</th><th>金额</th><th>供应商</th></tr></thead>
          <tbody>
            ${records.slice(0, 50).map(r => `
              <tr>
                <td>${fmtDate(r.stock_in_date)}</td>
                <td>${r.wine_name}</td>
                <td>${r.spec}</td>
                <td style="color:var(--success);font-weight:600">+${r.quantity}</td>
                <td>${fmtMoney(r.total_amount)}</td>
                <td style="color:var(--text-muted)">${r.supplier || '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      renderLucideIcons();
    } else {
      content.innerHTML = `
        <table class="data-table">
          <thead><tr><th>日期</th><th>酒品</th><th>规格</th><th>数量</th><th>客户</th><th>关联活动</th><th>操作</th></tr></thead>
          <tbody>
            ${records.slice(0, 50).map(r => `
              <tr>
                <td>${fmtDate(r.usage_date)}</td>
                <td>${r.wine_name}</td>
                <td>${r.spec}</td>
                <td style="color:var(--danger);font-weight:600">-${r.quantity}</td>
                <td>${r.client_name || '—'}</td>
                <td>${r.activity_id ? `<a href="#" onclick="event.preventDefault();showActivityDetail(${r.activity_id})">#${r.activity_id}</a>` : '—'}</td>
                <td>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-secondary btn-sm" onclick="showWineUsageModal(${r.id})" title="修改">编辑</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteWineUsage(${r.id})" title="删除"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      renderLucideIcons();
    }
  } catch (err) {
    content.innerHTML = `<div style="color:var(--danger);padding:20px">加载失败: ${err.message}</div>`;
  }
}

// 显示酒品入库弹窗
async function showWineStockInModal() {
  const content = document.getElementById('wineStockInContent');
  content.innerHTML = `<div style="color:var(--text-muted);padding:10px">加载中...</div>`;
  openModal('modalWineStockIn');
  
  try {
    const wines = await api('GET', '/wine');
    content.innerHTML = `
      <form id="wineStockInForm" style="display:flex;flex-direction:column;gap:12px">
        <div class="form-group">
          <label class="form-label">酒品 <span class="required">*</span></label>
          <select class="form-control" id="wineSel" required onchange="updateWineStockInInfo()">
            <option value="">请选择酒品</option>
            ${wines.map(w => `<option value="${w.wine_code}" data-name="${w.wine_name}" data-spec="${w.spec}" data-qty="${w.quantity}">${w.wine_name} ${w.spec}（库存: ${w.quantity}瓶）</option>`).join('')}
          </select>
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="form-group">
            <label class="form-label">入库数量（瓶）<span class="required">*</span></label>
            <input type="number" class="form-control" id="wineQty" min="1" value="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">入库日期 <span class="required">*</span></label>
            <input type="date" class="form-control" id="wineDate" value="${new Date().toISOString().split('T')[0]}" required>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">供应商</label>
          <input type="text" class="form-control" id="wineSupplier" placeholder="供应商名称">
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <input type="text" class="form-control" id="wineRemarks" placeholder="批次号/备注...">
        </div>
        <div style="padding:10px;background:var(--bg-primary);border-radius:var(--radius-sm);font-size:13px;color:var(--text-muted)">
          <i data-lucide="lightbulb" style="width:13px;height:13px;vertical-align:-2px;margin-right:4px"></i>入库后将自动更新酒品库存
        </div>
      </form>
    `;
    renderLucideIcons();
  } catch (err) {
    content.innerHTML = `<div style="color:var(--danger)">加载失败: ${err.message}</div>`;
  }
}

async function confirmWineStockIn() {
  const sel = document.getElementById('wineSel');
  const opt = sel.options[sel.selectedIndex];
  if (!sel.value) { showToast('请选择酒品', 'error'); return; }
  
  const body = {
    year_frame_id: currentYearFrameId || 1,
    wine_code: sel.value,
    wine_name: opt.dataset.name,
    spec: opt.dataset.spec,
    quantity: parseInt(document.getElementById('wineQty').value) || 0,
    stock_in_date: document.getElementById('wineDate').value,
    supplier: document.getElementById('wineSupplier').value,
    remarks: document.getElementById('wineRemarks').value,
  };
  
  if (!body.stock_in_date || !body.quantity) { showToast('请填写必填项', 'error'); return; }
  
  try {
    await api('POST', '/wine/stock-in', body);
    closeModal();
    showToast('入库成功', 'success');
    renderWine();
  } catch (err) {
    showToast('入库失败: ' + err.message, 'error');
  }
}

// 显示酒品使用记录弹窗
async function showWineUsageModal(editId = null) {
  const content = document.getElementById('wineUsageContent');
  content.innerHTML = `<div style="color:var(--text-muted);padding:10px">加载中...</div>`;
  openModal('modalWineUsage');
  
  try {
    const wines = await api('GET', '/wine');
    content.innerHTML = `
      <form id="wineUsageForm" style="display:flex;flex-direction:column;gap:12px">
        <input type="hidden" id="wineUsageId" value="${editId || ''}">
        <div class="form-group">
          <label class="form-label">酒品 <span class="required">*</span></label>
          <select class="form-control" id="wineUseSel" required>
            <option value="">请选择酒品</option>
            ${wines.map(w => `<option value="${w.wine_code}" data-name="${w.wine_name}" data-spec="${w.spec}" data-qty="${w.quantity}">${w.wine_name} ${w.spec}（库存: ${w.quantity}瓶）</option>`).join('')}
          </select>
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="form-group">
            <label class="form-label">使用数量（瓶）<span class="required">*</span></label>
            <input type="number" class="form-control" id="wineUseQty" min="1" value="1" required>
          </div>
          <div class="form-group">
            <label class="form-label">使用日期 <span class="required">*</span></label>
            <input type="date" class="form-control" id="wineUseDate" value="${new Date().toISOString().split('T')[0]}" required>
          </div>
        </div>
        <div class="form-grid" style="grid-template-columns:1fr 1fr">
          <div class="form-group">
            <label class="form-label">关联活动ID</label>
            <input type="number" class="form-control" id="wineActId" placeholder="留空表示手动记录">
          </div>
          <div class="form-group">
            <label class="form-label">客户名称</label>
            <input type="text" class="form-control" id="wineClient" placeholder="客户/场所名称">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">备注</label>
          <input type="text" class="form-control" id="wineUseRemarks" placeholder="备注...">
        </div>
        <div id="wineUseWarning" style="display:none;padding:10px;background:#FEF3C7;border-radius:var(--radius-sm);font-size:13px;color:#92400E">
          库存不足，无法记录使用
        </div>
      </form>
    `;

    if (editId) {
      const qs = currentYearFrameId ? `?year_frame_id=${currentYearFrameId}` : '';
      const records = await api('GET', `/wine/usage${qs}`);
      const target = records.find((r) => Number(r.id) === Number(editId));
      if (!target) {
        showToast('未找到要编辑的使用记录', 'error');
        return;
      }
      const sel = document.getElementById('wineUseSel');
      if (sel) sel.value = target.wine_code || '';
      document.getElementById('wineUseQty').value = target.quantity || 1;
      document.getElementById('wineUseDate').value = target.usage_date ? new Date(target.usage_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      document.getElementById('wineActId').value = target.activity_id || '';
      document.getElementById('wineClient').value = target.client_name || '';
      document.getElementById('wineUseRemarks').value = target.remarks || '';
      const modalTitle = document.querySelector('#modalWineUsage .modal-title');
      if (modalTitle) modalTitle.textContent = '修改酒品使用';
    } else {
      const modalTitle = document.querySelector('#modalWineUsage .modal-title');
      if (modalTitle) modalTitle.textContent = '记录酒品使用';
    }
  } catch (err) {
    content.innerHTML = `<div style="color:var(--danger)">加载失败: ${err.message}</div>`;
  }
}

async function confirmWineUsage() {
  const usageId = document.getElementById('wineUsageId')?.value || '';
  const sel = document.getElementById('wineUseSel');
  const opt = sel.options[sel.selectedIndex];
  if (!sel.value) { showToast('请选择酒品', 'error'); return; }
  
  const body = {
    year_frame_id: currentYearFrameId || 1,
    wine_code: sel.value,
    wine_name: opt.dataset.name,
    spec: opt.dataset.spec,
    quantity: parseInt(document.getElementById('wineUseQty').value) || 0,
    usage_date: document.getElementById('wineUseDate').value,
    activity_id: parseInt(document.getElementById('wineActId').value) || null,
    client_name: document.getElementById('wineClient').value,
    remarks: document.getElementById('wineUseRemarks').value,
  };
  
  if (!body.usage_date || !body.quantity) { showToast('请填写必填项', 'error'); return; }
  
  try {
    if (usageId) await api('PUT', `/wine/usage/${usageId}`, body);
    else await api('POST', '/wine/usage', body);
    closeModal();
    showToast(usageId ? '使用记录已更新' : '使用记录已保存', 'success');
    renderWine();
  } catch (err) {
    showToast(err.message || '记录失败', 'error');
  }
}

async function deleteWineUsage(id) {
  if (!confirm('确定删除此使用记录？库存将自动回补。')) return;
  try {
    await api('DELETE', `/wine/usage/${id}`);
    showToast('已删除，库存已回补', 'success');
    loadWineRecords('usage');
  } catch (err) {
    showToast('删除失败: ' + err.message, 'error');
  }
}

/* =============================================
   品牌管理
   ============================================= */
let _brandCache = [];

// 初始化时加载品牌列表
async function initBrands() {
  try {
    _brandCache = await api('GET', '/brand');
    renderBrandOptions();
  } catch (err) {
    console.error('加载品牌列表失败:', err);
    // 降级使用默认选项
    _brandCache = [
      { brand_code: 'PHD', brand_name: 'PHD' },
      { brand_code: 'X.O', brand_name: 'X.O' },
      { brand_code: 'CLUB', brand_name: 'CLUB' },
      { brand_code: 'REMY', brand_name: 'REMY' },
    ];
    renderBrandOptions();
  }
}

function renderBrandOptions() {
  const selects = [
    document.getElementById('actBrandField'),
    document.getElementById('actBrand'),
  ];
  selects.forEach(sel => {
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">全部品牌</option>' +
      _brandCache.map(b => `<option value="${b.brand_code}">${b.brand_name}</option>`).join('');
    if (currentVal && _brandCache.find(b => b.brand_code === currentVal)) {
      sel.value = currentVal;
    }
  });
}

async function showBrandModal() {
  const content = document.getElementById('brandContent');
  content.innerHTML = `<div style="color:var(--text-muted);padding:20px;text-align:center">加载中...</div>`;
  openModal('modalBrand');

  try {
    const brands = await api('GET', '/brand');
    _brandCache = brands;

    const COLORS = ['gray', 'blue', 'green', 'orange', 'purple', 'pink', 'red', 'cyan'];
    content.innerHTML = `
      <div style="margin-bottom:16px">
        <button class="btn btn-primary btn-sm" onclick="showAddBrandForm()">+ 新增品牌</button>
      </div>
      <div id="addBrandForm" style="display:none;padding:12px;background:var(--bg-primary);border-radius:var(--radius-sm);margin-bottom:16px">
        <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
          <input type="text" id="newBrandCode" class="form-control" placeholder="品牌编码（如 PHD12年）" style="font-size:13px">
          <input type="text" id="newBrandName" class="form-control" placeholder="显示名称" style="font-size:13px">
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <span style="font-size:12px;color:var(--text-muted)">颜色:</span>
          ${COLORS.map(c => `<span class="brand-color-dot ${c}" data-color="${c}" onclick="selectBrandColor('${c}')" style="width:18px;height:18px;border-radius:50%;background:var(--${c === 'gray' ? 'text-muted' : c});cursor:pointer;border:2px solid transparent;display:inline-block"></span>`).join('')}
          <input type="hidden" id="newBrandColor" value="gray">
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" onclick="confirmAddBrand()">保存</button>
          <button class="btn btn-secondary btn-sm" onclick="hideAddBrandForm()">取消</button>
        </div>
      </div>
      <div id="brandList">
        <table class="data-table" style="font-size:13px">
          <thead>
            <tr>
              <th>编码</th>
              <th>名称</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${brands.map(b => `
              <tr id="brand-row-${b.id}">
                <td><span class="badge badge-${b.brand_color || 'gray'}">${b.brand_code}</span></td>
                <td>${b.brand_name}</td>
                <td><span style="font-size:11px;color:${b.is_active ? 'var(--success)' : 'var(--text-muted)'}">${b.is_active ? '✓ 启用' : '✗ 停用'}</span></td>
                <td style="white-space:nowrap">
                  <button class="btn btn-xs btn-ghost" onclick="showEditBrand(${b.id})" title="编辑"><i data-lucide="pencil" style="width:12px;height:12px"></i></button>
                  ${b.is_active ? `<button class="btn btn-xs btn-ghost" onclick="toggleBrandActive(${b.id}, false)" title="停用"><i data-lucide="pause" style="width:12px;height:12px"></i></button>` : `<button class="btn btn-xs btn-ghost" onclick="toggleBrandActive(${b.id}, true)" title="启用"><i data-lucide="play" style="width:12px;height:12px"></i></button>`}
                </td>
              </tr>
              <tr id="brand-edit-${b.id}" style="display:none;background:var(--bg-primary)">
                <td colspan="4" style="padding:12px">
                  <div class="form-grid" style="grid-template-columns:1fr 1fr 80px;gap:8px;align-items:center">
                    <input type="text" id="editBrandCode-${b.id}" class="form-control" value="${b.brand_code}" style="font-size:13px">
                    <input type="text" id="editBrandName-${b.id}" class="form-control" value="${b.brand_name}" style="font-size:13px">
                    <button class="btn btn-primary btn-sm" onclick="confirmEditBrand(${b.id})">保存</button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    renderBrandOptions();
    renderLucideIcons();
  } catch (err) {
    content.innerHTML = `<div style="color:var(--danger)">加载失败: ${err.message}</div>`;
  }
}

function showAddBrandForm() {
  document.getElementById('addBrandForm').style.display = 'block';
  document.getElementById('newBrandCode').value = '';
  document.getElementById('newBrandName').value = '';
  document.getElementById('newBrandColor').value = 'gray';
}

function hideAddBrandForm() {
  document.getElementById('addBrandForm').style.display = 'none';
}

function selectBrandColor(color) {
  document.querySelectorAll('.brand-color-dot').forEach(el => {
    el.style.border = '2px solid transparent';
  });
  document.querySelector(`[data-color="${color}"]`).style.border = '2px solid var(--text)';
  document.getElementById('newBrandColor').value = color;
}

async function confirmAddBrand() {
  const code = document.getElementById('newBrandCode').value.trim();
  const name = document.getElementById('newBrandName').value.trim();
  const color = document.getElementById('newBrandColor').value;

  if (!code || !name) {
    showToast('品牌编码和名称不能为空', 'error');
    return;
  }

  try {
    await api('POST', '/brand', { brand_code: code, brand_name: name, brand_color: color });
    showToast('品牌已添加', 'success');
    showBrandModal();
  } catch (err) {
    showToast(err.message || '添加失败', 'error');
  }
}

function showEditBrand(id) {
  const row = document.getElementById(`brand-edit-${id}`);
  if (row) {
    row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
  }
}

async function confirmEditBrand(id) {
  const code = document.getElementById(`editBrandCode-${id}`).value.trim();
  const name = document.getElementById(`editBrandName-${id}`).value.trim();

  if (!code || !name) {
    showToast('品牌编码和名称不能为空', 'error');
    return;
  }

  try {
    await api('PUT', `/brand/${id}`, { brand_code: code, brand_name: name });
    showToast('品牌已更新', 'success');
    showBrandModal();
  } catch (err) {
    showToast(err.message || '更新失败', 'error');
  }
}

async function toggleBrandActive(id, active) {
  try {
    await api('PUT', `/brand/${id}`, { is_active: active });
    showToast(active ? '品牌已启用' : '品牌已停用', 'success');
    showBrandModal();
  } catch (err) {
    showToast(err.message || '操作失败', 'error');
  }
}


