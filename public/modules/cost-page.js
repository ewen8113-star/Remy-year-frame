/* 活动成本页面模块：从 app.js 机械迁移，包含付款申请复用的成本明细工具。 */

/* =============================================
   页面：活动成本（原成本管理）
   ============================================= */
function ymKeyForCostActivity(a) {
  const dt = new Date(a.date || a.activity_date);
  if (isNaN(dt)) return 'unknown';
  const local = new Date(dt.getTime() + 8 * 3600 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function uniqueCostYmKeys(rows) {
  return Array.from(new Set((rows || []).map(ymKeyForCostActivity)))
    .filter((k) => k !== 'unknown')
    .sort((a, b) => b.localeCompare(a));
}

function applyCostYmFilter(rows, key) {
  if (key === 'all') return rows || [];
  return (rows || []).filter((a) => ymKeyForCostActivity(a) === key);
}

function renderCostYmFilterButtons(section, keys, selected) {
  const allBtn = `<button class="btn btn-secondary btn-sm" style="${selected === 'all' ? 'background:var(--accent);color:white' : ''}" onclick="setCostYmFilter('${section}','all')">全部</button>`;
  const monthBtns = (keys || []).map((k) => {
    const [y, m] = k.split('-');
    return `<button class="btn btn-secondary btn-sm" style="${selected === k ? 'background:var(--accent);color:white' : ''}" onclick="setCostYmFilter('${section}','${k}')">${y}年${parseInt(m, 10)}月</button>`;
  }).join('');
  return `${allBtn}${monthBtns}`;
}

function setCostYmFilter(section, key) {
  if (section === 'pending') {
    costPendingYMFilter = key;
    localStorage.setItem('remy_costPendingYMFilter', key);
    // 兼容历史 key
    localStorage.setItem('remy_costNoCostYMFilter', key);
  } else if (section === 'withCost') {
    costWithCostYMFilter = key;
    localStorage.setItem('remy_costWithCostYMFilter', key);
  } else if (section === 'noCost') {
    costMarkedNoCostYMFilter = key;
    localStorage.setItem('remy_costMarkedNoCostYMFilter', key);
  }
  renderCost();
}

function toggleCostSection(section) {
  const idMap = {
    pending: 'pendingCostTable',
    withCost: 'withCostTable',
    noCost: 'noCostTable',
  };
  const panelId = idMap[section];
  if (!panelId) return;
  const el = document.getElementById(panelId);
  if (!el) return;
  const willCollapse = el.style.display !== 'none';
  el.style.display = willCollapse ? 'none' : '';
  costSectionCollapsed[section] = willCollapse;
  localStorage.setItem(`remy_costSectionCollapsed_${section}`, willCollapse ? '1' : '0');
}

const COST_STATS_CARD_ORDER_KEY = 'remy_costStatsCardOrder';
const COST_STATS_CARD_KEYS = ['totalRev', 'totalCost', 'allocatedCost', 'pooledCost', 'grossProfit', 'filledCount', 'propRepairCost', 'logisticsCost', 'materialCost', 'reimbursementCost'];

function normalizeCostStatsCardOrder(input) {
  const arr = Array.isArray(input) ? input.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const seen = new Set();
  const out = [];
  arr.forEach((k) => {
    if (COST_STATS_CARD_KEYS.includes(k) && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  });
  COST_STATS_CARD_KEYS.forEach((k) => {
    if (!seen.has(k)) out.push(k);
  });
  return out;
}

function readCostStatsCardOrder() {
  try {
    const raw = localStorage.getItem(COST_STATS_CARD_ORDER_KEY);
    if (!raw) return [...COST_STATS_CARD_KEYS];
    return normalizeCostStatsCardOrder(JSON.parse(raw));
  } catch {
    return [...COST_STATS_CARD_KEYS];
  }
}

function writeCostStatsCardOrder(order) {
  try {
    localStorage.setItem(COST_STATS_CARD_ORDER_KEY, JSON.stringify(normalizeCostStatsCardOrder(order)));
  } catch {}
}

function applySavedCostStatsCardOrder(grid) {
  if (!grid) return;
  const order = readCostStatsCardOrder();
  order.forEach((key) => {
    const card = grid.querySelector(`[data-cost-card-key="${key}"]`);
    if (card) grid.appendChild(card);
  });
}

function bindCostStatsCardDrag(grid) {
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll('[data-cost-card-key]'));
  cards.forEach((card) => {
    card.draggable = true;
    card.style.cursor = 'grab';
    card.addEventListener('dragstart', (e) => {
      const key = card.getAttribute('data-cost-card-key') || '';
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
      }
      card.classList.add('dragging');
      card.style.opacity = '0.6';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.style.opacity = '';
      const orderedKeys = Array.from(grid.querySelectorAll('[data-cost-card-key]')).map((el) => el.getAttribute('data-cost-card-key'));
      writeCostStatsCardOrder(orderedKeys);
    });
  });

  grid.addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = grid.querySelector('[data-cost-card-key].dragging');
    if (!dragging) return;
    const target = e.target.closest('[data-cost-card-key]');
    if (!target || target === dragging || !grid.contains(target)) return;
    const rect = target.getBoundingClientRect();
    const after = e.clientY > rect.top + rect.height / 2;
    if (after) grid.insertBefore(dragging, target.nextSibling);
    else grid.insertBefore(dragging, target);
  });
}

let _activityNoCostPendingId = null;

function openActivityNoCostConfirm(actId) {
  if (!hasWriteAccess()) {
    showToast('仅管理员可标记无成本场次', 'warning');
    return;
  }
  _activityNoCostPendingId = Number(actId);
  openModal('modalActivityNoCost');
  renderLucideIcons();
}

async function submitActivityNoCostConfirm() {
  const id = _activityNoCostPendingId;
  if (!id || !Number.isFinite(id)) {
    closeModal();
    return;
  }
  try {
    await api('PUT', `/activities/${id}`, { no_cost: 1, total_cost: 0, cost_details: {} });
    showToast('已标记为无成本场次', 'success');
    closeModal();
    _activityNoCostPendingId = null;
    if (currentPage === 'cost') await renderCost();
  } catch (e) {
    showToast(e.message || '保存失败', 'error');
  }
}
