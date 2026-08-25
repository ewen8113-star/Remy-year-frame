/* 仓储成本页面模块：从 app.js 机械迁移，保持原有展示和保存逻辑。 */

/* =============================================
   页面：仓储成本（原仓储记录）
   ============================================= */
async function renderWarehouse() {
  const container = document.getElementById('pageContainer');

  container.innerHTML = `
    <div class="warehouse-page">
    <div class="toolbar" style="justify-content:space-between">
      <div class="toolbar-left">
        <select class="filter-select" id="warMergeFilter" onchange="setWarehouseMergeFilter(this.value)">
          <option value="all">计入：全部</option>
          <option value="unmerged">计入：未计入</option>
          <option value="merged">计入：已计入</option>
        </select>
      </div>
      <div class="toolbar-right" style="display:flex;gap:8px;align-items:center">
        <button type="button" class="btn btn-secondary btn-sm" onclick="showWarehouseFixedCostModal()">生成固定成本</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="showWarehouseQuoteModal()">新建仓储报价</button>
      </div>
    </div>
    <div id="warSummary"></div>
    <div id="warTable"></div>
    </div>
  `;

  await loadWarehouse();
  const mf = document.getElementById('warMergeFilter');
  if (mf) mf.value = warehouseMergeFilter;
}

const WAREHOUSE_REGION_OPTIONS = ['东区', '北区', '南区'];
const WAREHOUSE_BRAND_OPTIONS = ['PHD', 'X.O', 'CLUB', 'REMY'];
const WAREHOUSE_TRAD_TO_SIMP = { '東區': '东区', '北區': '北区', '南區': '南区' };

/** 与后端一致：去 BOM、NFKC、繁体「東區」等映射为简体选项值 */
function normalizeWarehouseRegion(v) {
  if (v == null || v === '') return '';
  let s = (typeof v === 'string' ? v : String(v)).replace(/^\uFEFF/, '').trim().normalize('NFKC');
  if (WAREHOUSE_TRAD_TO_SIMP[s]) s = WAREHOUSE_TRAD_TO_SIMP[s];
  return s;
}

/** 北区按天计费，南区/东区按月 */
function warehouseQuantityUnit(region) {
  return normalizeWarehouseRegion(region) === '北区' ? '天' : '月';
}

function warehouseQuantityDisplay(w) {
  const qty = parseFloat(w?.quantity);
  const qtySafe = Number.isFinite(qty) ? qty : 0;
  const unit = warehouseQuantityUnit(w?.region);
  return { qty: qtySafe, unit };
}

function syncWarQuantityLabel() {
  if (warehouseFormMode === 'period_quote') return;
  const region = readWarRegionSelect();
  const unit = warehouseQuantityUnit(region);
  const qtyLabel = document.getElementById('warQtyLabel');
  if (qtyLabel) qtyLabel.innerHTML = `数量（${unit}） <span class="required">*</span>`;
  const unitPriceEl = document.getElementById('warUnitPrice');
  const upLabel = unitPriceEl?.closest('.form-group')?.querySelector('.form-label');
  if (upLabel) upLabel.innerHTML = `单价 (¥/${unit}) <span class="required">*</span>`;
}

/** 从下拉框读取区域（按选中项 value，避免部分浏览器只显示文字未改 value） */
function readWarRegionSelect() {
  const sel = document.getElementById('warRegion');
  if (!sel || sel.selectedIndex < 0) return '';
  const raw = sel.options[sel.selectedIndex].value;
  return normalizeWarehouseRegion(raw);
}

function readWarBrandSelect() {
  const sel = document.getElementById('warBrand');
  if (!sel || sel.selectedIndex < 0) return '';
  const v = String(sel.options[sel.selectedIndex].value || '').trim();
  return WAREHOUSE_BRAND_OPTIONS.includes(v) ? v : '';
}

function warehousePeriodMonthCount(startYmd, endYmd) {
  const s = String(startYmd || '').slice(0, 10);
  const e = String(endYmd || '').slice(0, 10);
  if (!s || !e || s > e) return 0;
  const ds = new Date(`${s}T12:00:00`);
  const de = new Date(`${e}T12:00:00`);
  if (Number.isNaN(ds.getTime()) || Number.isNaN(de.getTime())) return 0;
  return (de.getFullYear() - ds.getFullYear()) * 12 + (de.getMonth() - ds.getMonth()) + 1;
}

function warehouseMonthLabelFromPeriodDates(startYmd, endYmd) {
  const s = String(startYmd || '').slice(0, 7);
  const e = String(endYmd || '').slice(0, 7);
  if (!s || !e) return '';
  return s === e ? s : `${s}~${e}`;
}

function parseWarehouseMonthRangeToDates(monthStr) {
  const raw = String(monthStr || '').trim();
  const idx = raw.indexOf('~');
  if (idx < 0) return null;
  const a = raw.slice(0, idx).trim();
  const b = raw.slice(idx + 1).trim();
  if (!/^\d{4}-\d{2}$/.test(a) || !/^\d{4}-\d{2}$/.test(b)) return null;
  const [y2, m2] = b.split('-').map((x) => parseInt(x, 10));
  const lastD = new Date(y2, m2, 0).getDate();
  return { start: `${a}-01`, end: `${b}-${String(lastD).padStart(2, '0')}` };
}

/** 仓储报价记录（对客报价，无实际成本） */
function warehouseIsQuoteRecord(w) {
  if (!w) return false;
  const noCost = w.no_actual_cost === true || w.no_actual_cost === 1 || String(w.no_actual_cost) === '1';
  const remarks = String(w.remarks || '');
  const month = String(w.month || '');
  if (noCost && roundMoney2(w.quoted_price) > 0) return true;
  if (remarks.includes('仓储报价')) return true;
  if (month.includes('~') && noCost) return true;
  return false;
}

function warehouseQuoteMonthSpan(monthStr) {
  const raw = String(monthStr || '').trim();
  if (!raw) return null;
  if (raw.includes('~')) {
    const p = parseWarehouseMonthRangeToDates(raw);
    if (!p) return null;
    return { startYm: p.start.slice(0, 7), endYm: p.end.slice(0, 7) };
  }
  const ym = raw.slice(0, 7);
  return ym.length === 7 ? { startYm: ym, endYm: ym } : null;
}

function warehouseMonthWithinQuoteSpan(costMonth, quoteMonthField) {
  const costYm = String(costMonth || '').trim().slice(0, 7);
  const span = warehouseQuoteMonthSpan(quoteMonthField);
  if (!costYm || !span) return false;
  return costYm >= span.startYm && costYm <= span.endYm;
}

function warehouseQuoteMonthCount(quoteRow) {
  const qn = parseInt(quoteRow?.quantity, 10);
  if (Number.isFinite(qn) && qn > 0) return qn;
  const span = warehouseQuoteMonthSpan(quoteRow?.month);
  if (!span) return 1;
  const p = parseWarehouseMonthRangeToDates(quoteRow.month);
  if (p) return Math.max(1, warehousePeriodMonthCount(p.start, p.end));
  return 1;
}

function warehouseFindMatchingClientQuotes(costRow, allRows) {
  return (allRows || []).filter((q) => {
    if (!warehouseIsQuoteRecord(q)) return false;
    if (Number(q.year_frame_id) !== Number(costRow.year_frame_id)) return false;
    if (normalizeWarehouseRegion(q.region) !== normalizeWarehouseRegion(costRow.region)) return false;
    const qb = String(q.brand || '').trim() || 'PHD';
    const cb = String(costRow.brand || '').trim() || 'PHD';
    if (qb !== cb) return false;
    return warehouseMonthWithinQuoteSpan(costRow.month, q.month);
  });
}

/** 列表「报价」列：对客报价（来自仓储报价记录分摊）；无报价时为 0 */
function warehouseClientQuotedPrice(costRow, allRows) {
  if (!costRow) return 0;
  if (warehouseIsQuoteRecord(costRow)) return roundMoney2(costRow.quoted_price);
  const quotes = warehouseFindMatchingClientQuotes(costRow, allRows);
  if (!quotes.length) return 0;
  const q = quotes.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
  const total = roundMoney2(q.quoted_price);
  const months = warehouseQuoteMonthCount(q);
  return roundMoney2(total / months);
}

function onWarehousePeriodChange() {
  if (warehouseFormMode !== 'period_quote') return;
  const ps = document.getElementById('warPeriodStart')?.value || '';
  const pe = document.getElementById('warPeriodEnd')?.value || '';
  const n = warehousePeriodMonthCount(ps, pe);
  const elQ = document.getElementById('warQty');
  if (elQ) elQ.value = n > 0 ? String(n) : '';
  updateWarQuotedPrice();
}

function applyWarehouseFormMode(mode) {
  warehouseFormMode = mode;
  const periodWrap = document.getElementById('warPeriodWrap');
  const monthLegacy = document.getElementById('warMonthLegacyWrap');
  const yfWrap = document.getElementById('warYearFrameWrap');
  const yfHint = document.getElementById('warYearFrameHint');
  const qtyLabel = document.getElementById('warQtyLabel');
  const qtyEl = document.getElementById('warQty');
  const proj = document.getElementById('warProjectBlock');
  const merge = document.getElementById('warMergeBlock');
  if (!periodWrap || !monthLegacy) return;
  if (mode === 'period_quote') {
    periodWrap.style.display = '';
    monthLegacy.style.display = 'none';
    if (qtyLabel) {
      qtyLabel.innerHTML =
        '数量（月） <span class="required">*</span> <span style="font-size:11px;color:var(--text-muted);font-weight:400">（按账期自动计算）</span>';
    }
    if (qtyEl) qtyEl.readOnly = true;
    if (proj) proj.style.display = 'none';
    if (merge) merge.style.display = 'none';
  } else {
    periodWrap.style.display = 'none';
    monthLegacy.style.display = '';
    if (qtyLabel) qtyLabel.innerHTML = '数量（月） <span class="required">*</span>';
    if (qtyEl) qtyEl.readOnly = false;
    if (yfHint) yfHint.style.display = 'none';
    if (yfWrap) yfWrap.style.display = '';
    if (proj) proj.style.display = '';
    if (merge) merge.style.display = '';
    syncWarQuantityLabel();
  }
}
