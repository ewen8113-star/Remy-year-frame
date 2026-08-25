/* 物料采购/统筹成本页面模块：从 app.js 机械迁移，保持原有展示和保存逻辑。 */

/* =============================================
   页面：物料采购（20260414 规格：固定项 + 自定义项）
   ============================================= */
/** 物料采购品牌归桶：从任意字符串里识别 PHD / X.O / CLUB / RC / 其他
 *  优先级：PHD > X.O > CLUB > RC > 其他（避免「N220630-RC PHD」被错判为 RC）
 *  说明：项目编码型字符串（如「N230530-RM Club」「Remy-RC」）也能正确识别。
 */
const MATERIAL_BRAND_BUCKETS = ['PHD', 'X.O', 'CLUB', 'RC', '其他'];

/** 统筹成本品牌卡：空心酒瓶轮廓（stroke 风格对齐 Lucide） */
const MATERIAL_BRAND_BUCKET_BOTTLE_ICONS = {
  PHD:
    '<svg class="mp-brand-bottle-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 2.2h2v2.1h-2z"/><path d="M10 5.2h4"/><path d="M9.4 5.8h5.2v13.2H9.4V5.8z"/><path d="M9.4 19h5.2"/></svg>',
  'X.O':
    '<svg class="mp-brand-bottle-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2v1.6"/><path d="M10.2 3.8h3.6"/><path d="M11.2 5.4h1.6"/><path d="M10.6 6.2c-1.2 0-1.8 2.2-1.8 5.3 0 2.4.5 4.2 1.2 5.2.8 1.2 2.2 1.8 3.8 1.8s3-.6 3.8-1.8c.7-1 1.2-2.8 1.2-5.2 0-3.1-.6-5.3-1.8-5.3H10.6z"/></svg>',
  CLUB:
    '<svg class="mp-brand-bottle-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.2 2.2h1.6v2h-1.6z"/><path d="M10.4 4.4h3.2"/><path d="M10.1 5.4h3.8v13.2h-3.8V5.4z"/><path d="M10.1 18.6h3.8"/></svg>',
};

function materialBrandBucketIconHtml(key, lucideFallback) {
  const svg = MATERIAL_BRAND_BUCKET_BOTTLE_ICONS[key];
  if (svg) return svg;
  return `<i data-lucide="${lucideFallback}" style="width:16px;height:16px"></i>`;
}

function detectBrandBucket(...inputs) {
  const raw = inputs
    .filter((x) => x !== undefined && x !== null && x !== '')
    .map((x) => String(x))
    .join(' ')
    .toUpperCase();
  const compact = raw.replace(/\s+/g, '');
  if (!raw) return '其他';
  if (compact.includes('PHD')) return 'PHD';
  if (compact.includes('X.O') || /(^|[^A-Z])XO([^A-Z]|$)/.test(raw)) return 'X.O';
  if (compact.includes('CLUB')) return 'CLUB';
  if (compact.includes('RC') || compact.includes('REMY')) return 'RC';
  return '其他';
}

/** 兼容旧调用名 */
function materialPurchaseBrandBucket(brandCode, brandName) {
  return detectBrandBucket(brandCode, brandName);
}

/** 按"明细行级"或"整条级"统一聚合，输入数组每项必须有 brandBucket + total_amount/subtotal */
function materialPurchaseAggFiveBuckets(items) {
  const totals = {};
  const counts = {};
  MATERIAL_BRAND_BUCKETS.forEach((k) => { totals[k] = 0; counts[k] = 0; });
  (items || []).forEach((it) => {
    const k = MATERIAL_BRAND_BUCKETS.includes(it.brandBucket) ? it.brandBucket : '其他';
    const amt = roundMoney2(it.subtotal != null ? it.subtotal : it.total_amount);
    totals[k] = roundMoney2(totals[k] + amt);
    counts[k] += 1;
  });
  return { totals, counts };
}

/** 旧名兼容（4 桶接口）：返回 5 桶但保留对外 keys，调用方需改用新逻辑 */
function materialPurchaseAggFourBuckets(rowsAllYear) {
  const items = (rowsAllYear || []).map((r) => ({
    brandBucket: detectBrandBucket(r.brand_code, r.brand_name, r.brand),
    total_amount: r.total_amount,
  }));
  return materialPurchaseAggFiveBuckets(items);
}

function materialPurchaseBrandMatchesFilter(row, brandId, brands) {
  if (!brandId) return true;
  if (String(row.brand_id || '') === String(brandId)) return true;
  const b = (brands || []).find((x) => String(x.id) === String(brandId));
  if (!b) return false;
  const rowBrand = String(row.brand_code || row.brand_name || row.brand || '').trim().toUpperCase();
  const brandCode = String(b.brand_code || '').trim().toUpperCase();
  const brandName = String(b.brand_name || '').trim().toUpperCase();
  return !!rowBrand && (rowBrand === brandCode || rowBrand === brandName);
}

function materialPurchaseRowsFromReimbursements(rows, brands, brandId = '') {
  return (rows || [])
    .filter((r) => {
      const m = String(r.cost_module || '');
      return m && m !== 'activity';
    })
    .map((r) => {
      const brand = String(r.brand || '').trim();
      const brandInfo = (brands || []).find((b) => {
        const code = String(b.brand_code || '').trim().toUpperCase();
        const name = String(b.brand_name || '').trim().toUpperCase();
        const rb = brand.toUpperCase();
        return rb && (rb === code || rb === name);
      });
      const meta = reimbReadDetailMeta(r.remarks || '');
      const detailRows = Array.isArray(meta.rows) ? meta.rows : [];
      const items = detailRows
        .filter((row) => row && row.block)
        .map((row) => {
          const blockLabel = (REIMB_DETAIL_BLOCKS.find((b) => b.value === row.block) || {}).label || row.block;
          const catLabel = (REIMB_DETAIL_CATEGORY_OPTIONS[row.block] || []).find(([v]) => v === row.category)?.[1] || row.category || '';
          const composedName = [blockLabel, catLabel].filter(Boolean).join(' · ');
          return {
            name: composedName || '其他',
            amount: roundMoney2(row.subtotal),
          };
        })
        .filter((row) => row.name && row.amount > 0);
      const mapped = {
        ...r,
        source_type: 'reimbursement',
        source_label: '报销申请',
        id: r.id,
        brand_id: brandInfo ? brandInfo.id : null,
        brand_code: brandInfo?.brand_code || brand,
        brand_name: brandInfo?.brand_name || brand,
        purchase_date: r.date,
        total_amount: roundMoney2(r.amount),
        activity_project_code: r.related_project_code || '',
        allocation_note: '报销申请',
        remarks: reimbVisibleRemarks(r.remarks || ''),
        items,
      };
      return mapped;
    })
    .filter((row) => materialPurchaseBrandMatchesFilter(row, brandId, brands));
}

/** 财年范围（每年 4 月 1 日 - 次年 3 月 31 日）；优先跟随侧边栏所选年度 */
function currentFiscalYearRange(now = new Date()) {
  const yy = parseInt(String(currentYear || '').replace(/\D/g, ''), 10);
  const startYear = Number.isFinite(yy) ? (yy >= 100 ? yy : 2000 + yy) : (() => {
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    return m >= 4 ? y : y - 1;
  })();
  const pad = (n) => String(n).padStart(2, '0');
  const shortYear = String(startYear).slice(-2);
  return {
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
    // 中文短标签（如「26财年」），用于仪表盘标题旁的小字
    label: `${shortYear}财年`,
    // 完整跨度文本（如「2026-04 ~ 2027-03」），用于 tooltip 或长描述
    fullLabel: `${startYear}-04 ~ ${startYear + 1}-03`,
    inRange(dateStr) {
      const s = String(dateStr || '').slice(0, 10);
      if (!s) return false;
      return s >= this.start && s <= this.end;
    },
    monthsList() {
      const arr = [];
      for (let i = 0; i < 12; i++) {
        const mm = 4 + i;
        const yy = startYear + Math.floor((mm - 1) / 12);
        const m2 = ((mm - 1) % 12) + 1;
        arr.push(`${yy}-${pad(m2)}`);
      }
      return arr;
    },
  };
}

/** 从报销列表里抽出"额外成本"——所有 cost_module ≠ 'activity' 报销单的全部明细行，扁平化成统计单元。
 *  额外成本：不计入具体活动场次（无项目编号）的成本支出，含物料采购 / 物流 / 道具维修 / 统筹等。
 */
function materialPurchaseDetailRowsFromReimbursements(reimbursementRows, options = {}) {
  const { fiscalYear } = options;
  const out = [];
  (reimbursementRows || []).forEach((r) => {
    const costModule = String(r.cost_module || '');
    if (!costModule || costModule === 'activity') return;
    // 已按 year_frame_id 拉取，不再按申请日期财年过滤（日期可能跨自然财年边界）
    const meta = reimbReadDetailMeta(r.remarks || '');
    const detailRows = Array.isArray(meta.rows) ? meta.rows : [];
    detailRows.forEach((row, idx) => {
      if (!row || !row.block) return;
      const subtotal = roundMoney2(row.subtotal);
      if (!(subtotal > 0)) return;
      const dateStr = String(r.date || '').slice(0, 10);
      const month = dateStr ? dateStr.slice(0, 7) : '';
      const brandRaw = (typeof row.brand === 'string' && row.brand.trim()) ? row.brand.trim() : String(r.brand || '').trim();
      const brandBucket = detectBrandBucket(brandRaw, r.brand);
      const blockLabel = (REIMB_DETAIL_BLOCKS.find((b) => b.value === row.block) || {}).label || row.block;
      const catLabel = (REIMB_DETAIL_CATEGORY_OPTIONS[row.block] || []).find(([v]) => v === row.category)?.[1] || row.category || '';
      // 类别标签：优先「区块 · 子类」，子类缺省时回退到区块名
      const categoryLabel = catLabel ? `${blockLabel} · ${catLabel}` : blockLabel;
      out.push({
        reimbId: r.id,
        reimbDate: dateStr,
        month,
        brandRaw,
        brandBucket,
        block: row.block,
        blockLabel,
        // 类别 key 用「block:category」组合，确保下拉去重且能跨 block 同名 category 区分
        category: `${row.block}:${row.category || ''}`,
        categoryLabel,
        description: String(row.description || '').trim(),
        quantity: Number(row.quantity) || 0,
        unitPrice: roundMoney2(row.unit_price),
        subtotal,
        rowIndex: idx,
        applicantName: r.applicant_name || '',
        projectCode: r.related_project_code || '',
        costModule,
      });
    });
  });
  return out;
}

/** 聚合仪表盘指标 */
function aggregateMaterialDashboardData(detailRows, keyword = '') {
  const kw = String(keyword || '').trim().toLowerCase();
  // 关键字同时匹配「物品描述」和「类别标签（区块·子类）」
  const matched = kw
    ? (detailRows || []).filter((d) => {
        const desc = String(d.description || '').toLowerCase();
        const cat = String(d.categoryLabel || '').toLowerCase();
        const blk = String(d.blockLabel || '').toLowerCase();
        return desc.includes(kw) || cat.includes(kw) || blk.includes(kw);
      })
    : (detailRows || []).slice();
  const all = detailRows || [];
  const sum = (arr, pick = (x) => x.subtotal) => roundMoney2((arr || []).reduce((s, x) => s + roundMoney2(pick(x)), 0));
  const sumQty = (arr) => (arr || []).reduce((s, x) => s + (Number(x.quantity) || 0), 0);

  const overview = {
    totalAmount: sum(all),
    totalCount: all.length,
    matchedAmount: sum(matched),
    matchedCount: matched.length,
    matchedQty: sumQty(matched),
    distinctReimb: new Set(matched.map((x) => x.reimbId)).size,
  };

  const byMonthMap = new Map();
  matched.forEach((x) => {
    const k = x.month || '未知';
    byMonthMap.set(k, roundMoney2((byMonthMap.get(k) || 0) + x.subtotal));
  });
  const byBrand = MATERIAL_BRAND_BUCKETS.map((bucket) => {
    const rows = matched.filter((x) => x.brandBucket === bucket);
    return { bucket, amount: sum(rows), count: rows.length };
  });
  const byCategoryMap = new Map();
  matched.forEach((x) => {
    const k = x.categoryLabel || '其他';
    const cur = byCategoryMap.get(k) || { amount: 0, count: 0 };
    cur.amount = roundMoney2(cur.amount + x.subtotal);
    cur.count += 1;
    byCategoryMap.set(k, cur);
  });
  const byCategory = Array.from(byCategoryMap.entries())
    .map(([label, v]) => ({ label, amount: v.amount, count: v.count }))
    .sort((a, b) => b.amount - a.amount);

  const topItemMap = new Map();
  matched.forEach((x) => {
    const k = x.description || '（未填写）';
    const cur = topItemMap.get(k) || { name: k, amount: 0, qty: 0, count: 0 };
    cur.amount = roundMoney2(cur.amount + x.subtotal);
    cur.qty += Number(x.quantity) || 0;
    cur.count += 1;
    topItemMap.set(k, cur);
  });
  const topItems = Array.from(topItemMap.values()).sort((a, b) => b.amount - a.amount);

  return { overview, matched, byMonth: byMonthMap, byBrand, byCategory, topItems };
}

/* ===== 物料分析仪表盘 ===== */
