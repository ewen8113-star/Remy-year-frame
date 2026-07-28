/* 数据看板页面模块：从 app.js 机械迁移，保持原有展示逻辑。 */

/* =============================================
   页面：数据看板
   ============================================= */
function getDashboardDefaultDateRange() {
  const yy = parseInt(String(currentYear || '').replace(/\D/g, ''), 10);
  const fiscalStartYear = Number.isFinite(yy) ? (yy >= 100 ? yy : 2000 + yy) : new Date().getFullYear();
  const start = `${fiscalStartYear}-04-01`;
  const end = `${fiscalStartYear + 1}-03-31`;
  return { start, end };
}

let dashboardState = {
  brand: '',
  region: '',
  activityType: '',
  executionFlag: '',
  pgFlag: '',
  period: '',
  dateStart: getDashboardDefaultDateRange().start,
  dateEnd: getDashboardDefaultDateRange().end,
  /** 右侧对比：空=不对比；「全国」或其它区域 value */
  compareRegion: '',
};
let dashboardDatePickerState = {
  open: false,
  leftMonth: '',
  draftStart: '',
  draftEnd: '',
  hoverDate: '',
};
/** 区域环形图下钻：选中的区域名，与数据详情筛选独立 */
let dashboardDrillRegion = null;
let dashboardChartMetric = localStorage.getItem('remy_dashboardChartMetric') === 'revenue' ? 'revenue' : 'count';
let dashboardLastPayload = null;
let dashboardLastQuery = '';
let dashboardAnalysisTab = 'trend';
/** 全链路成本选项卡：overview | activity | warehouse | logistics | material_purchase | prop_repair | reimbursement */
let dashboardCostTab = 'overview';
let dashboardDetailFilters = { region: '', city: '', costType: '' };

const DASHBOARD_COST_TAB_DEFS = [
  { key: 'overview', label: '利润总览' },
  { key: 'activity', label: '场次成本' },
  { key: 'warehouse', label: '仓储成本' },
  { key: 'logistics', label: '物流成本' },
  { key: 'material_purchase', label: '统筹成本' },
  { key: 'prop_repair', label: '道具维修' },
  { key: 'reimbursement', label: '报销成本池' },
];

const DASHBOARD_FULL_COST_CHART_COLORS = ['#6366f1', '#3b82f6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a78bfa'];

/** 与后端 ALLOWED_TYPES 一致，用于区域对比时类别柱图类目顺序 */
const DASHBOARD_ACTIVITY_TYPES = ['晚宴', '品鉴', '培训', '纯设计'];

/** 左侧主口径序列（深色）与右侧对比口径序列（浅色） */
const DASHBOARD_COMPARE_COLOR_REGION = '#5b21b6';
const DASHBOARD_COMPARE_COLOR_NATIONAL = '#94a3b8';

function dashboardMetricText() {
  return dashboardChartMetric === 'revenue' ? '金额' : '场次';
}

function dashboardMetricValue(row) {
  if (!row) return 0;
  return dashboardChartMetric === 'revenue'
    ? parseFloat(row.revenue) || 0
    : parseInt(row.count, 10) || 0;
}

function formatDashboardDateRangeLabel() {
  const s = dashboardState.dateStart || '';
  const e = dashboardState.dateEnd || '';
  const fiscalYear = getDashboardDefaultDateRange();
  if (s === fiscalYear.start && e === fiscalYear.end) return '全年（财年）';
  if (s && e) return `${s} 至 ${e}`;
  if (s) return `${s} 起`;
  if (e) return `至 ${e}`;
  return '选择日期区间';
}

function formatDashboardMonthTitle(monthKey) {
  const [y, m] = String(monthKey || '').split('-').map((x) => parseInt(x, 10));
  if (!y || !m) return '';
  return `${y}年${m}月`;
}

function addMonthsToMonthKey(monthKey, delta) {
  const [y, m] = String(monthKey || '').split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y || new Date().getFullYear(), (m || 1) - 1 + delta, 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

function buildDashboardCalendarMonth(monthKey, side) {
  const [y, m] = String(monthKey || '').split('-').map((x) => parseInt(x, 10));
  const base = new Date(y, (m || 1) - 1, 1);
  const firstWeekday = base.getDay();
  const daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const today = todayDateInputValue();
  const start = dashboardDatePickerState.draftStart || '';
  const end = dashboardDatePickerState.draftEnd || '';
  const cells = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push('<div class="dashboard-date-cell empty"></div>');
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isStart = start === dateStr;
    const isEnd = end === dateStr;
    const inRange = start && end && dateStr > start && dateStr < end;
    const isToday = today === dateStr;
    const cls = ['dashboard-date-cell', isStart ? 'is-start' : '', isEnd ? 'is-end' : '', inRange ? 'in-range' : '', isToday ? 'is-today' : '']
      .filter(Boolean)
      .join(' ');
    cells.push(`<button type="button" class="${cls}" data-date="${dateStr}" onmouseenter="setDashboardDateHover('${dateStr}')" onclick="pickDashboardDate('${dateStr}')">${day}</button>`);
  }
  return `
    <div class="dashboard-date-month">
      <div class="dashboard-date-month-head">
        ${side === 'left' ? `<button type="button" class="btn btn-secondary btn-xs" onclick="shiftDashboardDatePicker(-1)">‹</button>` : '<span></span>'}
        <strong>${formatDashboardMonthTitle(monthKey)}</strong>
        ${side === 'right' ? `<button type="button" class="btn btn-secondary btn-xs" onclick="shiftDashboardDatePicker(1)">›</button>` : '<span></span>'}
      </div>
      <div class="dashboard-date-weekdays">
        <span>日</span><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span>
      </div>
      <div class="dashboard-date-grid" onmouseleave="clearDashboardDateHover()">${cells.join('')}</div>
    </div>
  `;
}

function renderDashboardDatePicker() {
  const host = document.getElementById('dashboardDateRangeHost');
  if (!host) return;
  const left = dashboardDatePickerState.leftMonth || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const right = addMonthsToMonthKey(left, 1);
  host.innerHTML = `
    <div class="dashboard-date-range-wrap">
      <button type="button" class="dash-control dashboard-date-trigger" onclick="toggleDashboardDatePicker(event)">
        <span>${escapeHtml(formatDashboardDateRangeLabel())}</span>
        <span class="dash-date-trigger__hint">日期区间</span>
      </button>
      ${dashboardDatePickerState.open ? `
        <div class="dashboard-date-popover">
          <div class="dashboard-date-popover-head">
            <div class="card-sub" style="margin:0">左侧开始日期，右侧结束日期</div>
            <button type="button" class="btn btn-secondary btn-xs" onclick="toggleDashboardDatePicker(false)">关闭</button>
          </div>
          <div class="dashboard-date-months">
            ${buildDashboardCalendarMonth(left, 'left')}
            ${buildDashboardCalendarMonth(right, 'right')}
          </div>
          <div class="dashboard-date-popover-foot">
            <div class="card-sub" style="margin:0">${escapeHtml(dashboardDatePickerState.draftStart || '未选开始')} ${dashboardDatePickerState.draftEnd ? `至 ${escapeHtml(dashboardDatePickerState.draftEnd)}` : ''}</div>
            <div style="display:flex;gap:8px">
              <button type="button" class="btn btn-secondary btn-sm" onclick="clearDashboardDatePicker()">清空</button>
              <button type="button" class="btn btn-primary btn-sm" onclick="applyDashboardDatePicker()">确定</button>
            </div>
          </div>
        </div>` : ''}
    </div>
  `;
}

function toggleDashboardDatePicker(eventOrForceOpen, maybeForceOpen) {
  if (eventOrForceOpen && typeof eventOrForceOpen.stopPropagation === 'function') {
    eventOrForceOpen.stopPropagation();
  }
  const forceOpen = typeof eventOrForceOpen === 'boolean' ? eventOrForceOpen : maybeForceOpen;
  const nextOpen = typeof forceOpen === 'boolean' ? forceOpen : !dashboardDatePickerState.open;
  if (nextOpen) {
    const base = dashboardState.dateStart || todayDateInputValue();
    dashboardDatePickerState.leftMonth = String(base).slice(0, 7);
    dashboardDatePickerState.draftStart = dashboardState.dateStart || '';
    dashboardDatePickerState.draftEnd = dashboardState.dateEnd || '';
    dashboardDatePickerState.hoverDate = '';
  }
  dashboardDatePickerState.open = nextOpen;
  renderDashboardDatePicker();
}

function shiftDashboardDatePicker(delta) {
  dashboardDatePickerState.leftMonth = addMonthsToMonthKey(dashboardDatePickerState.leftMonth, delta);
  renderDashboardDatePicker();
}

function updateDashboardDateHoverPreview() {
  const buttons = Array.from(document.querySelectorAll('.dashboard-date-cell[data-date]'));
  if (!buttons.length) return;
  const start = dashboardDatePickerState.draftStart || '';
  const end = dashboardDatePickerState.draftEnd || '';
  const hover = dashboardDatePickerState.hoverDate || '';
  const previewStart = start && !end && hover ? (hover < start ? hover : start) : '';
  const previewEnd = start && !end && hover ? (hover < start ? start : hover) : '';
  buttons.forEach((btn) => {
    const dateStr = btn.getAttribute('data-date') || '';
    const inPreview = previewStart && previewEnd && dateStr >= previewStart && dateStr <= previewEnd && dateStr !== start;
    btn.classList.toggle('in-preview-range', !!inPreview);
  });
}

function setDashboardDateHover(dateStr) {
  if (!dashboardDatePickerState.draftStart || dashboardDatePickerState.draftEnd) return;
  dashboardDatePickerState.hoverDate = dateStr || '';
  updateDashboardDateHoverPreview();
}

function clearDashboardDateHover() {
  if (!dashboardDatePickerState.hoverDate) return;
  dashboardDatePickerState.hoverDate = '';
  updateDashboardDateHoverPreview();
}

function pickDashboardDate(dateStr) {
  const start = dashboardDatePickerState.draftStart || '';
  const end = dashboardDatePickerState.draftEnd || '';
  let shouldAutoApply = false;
  if (!start || (start && end)) {
    dashboardDatePickerState.draftStart = dateStr;
    dashboardDatePickerState.draftEnd = '';
    dashboardDatePickerState.hoverDate = '';
  } else if (dateStr < start) {
    dashboardDatePickerState.draftEnd = start;
    dashboardDatePickerState.draftStart = dateStr;
    dashboardDatePickerState.hoverDate = '';
    shouldAutoApply = true;
  } else {
    dashboardDatePickerState.draftEnd = dateStr;
    dashboardDatePickerState.hoverDate = '';
    shouldAutoApply = true;
  }
  renderDashboardDatePicker();
  if (shouldAutoApply) {
    applyDashboardDatePicker();
  }
}

function clearDashboardDatePicker() {
  dashboardDatePickerState.draftStart = '';
  dashboardDatePickerState.draftEnd = '';
  dashboardDatePickerState.hoverDate = '';
  dashboardState.dateStart = '';
  dashboardState.dateEnd = '';
  dashboardDatePickerState.open = false;
  dashboardDatePickerState.hoverDate = '';
  renderDashboardDatePicker();
  renderDashboard();
}
