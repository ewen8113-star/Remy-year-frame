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
      { key: 'makeup', label: '化妆师' },
    ],
  },
  {
    title: '二、差旅',
    items: [
      { key: 'travel_supervisor', label: '督导差旅' },
      { key: 'travel_company', label: '盛融差旅' },
    ],
  },
  {
    title: '三、舞美制作',
    items: [
      { key: 'structure', label: '结构制作/搭建' },
      { key: 'av', label: 'AV灯光音响' },
    ],
  },
  {
    title: '四、画面制作',
    items: [
      { key: 'print', label: '印刷/快印' },
      { key: 'spray', label: '写真/喷绘' },
    ],
  },
  {
    title: '五、采购',
    items: [
      { key: 'floral_design', label: '花艺' },
      { key: 'floral', label: '花艺' },
      { key: 'payment', label: '活动物料' },
      { key: 'tasting', label: '品鉴物料' },
    ],
  },
  {
    title: '六、物流',
    items: [
      { key: 'express', label: '快递（闪送）' },
      { key: 'logistics', label: '物流' },
    ],
  },
  {
    title: '七、垫付',
    items: [
      { key: 'venue_fee', label: '场地费' },
      { key: 'meal_fee', label: '餐费' },
      { key: 'other_advance', label: '其他' },
      { key: 'advance_offset', label: '备用金抵扣' },
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
      out[it.key] = Number.isFinite(parseFloat(v)) ? roundMoney2(v) : 0;
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
          ${g.items.map((f) => {
            const raw = roundMoney2(details[f.key]);
            // 备用金抵扣为负数，必须原样回显；其余类别仅显示正数
            const showVal = f.key === 'advance_offset'
              ? (raw !== 0 ? raw.toFixed(2) : '')
              : (raw > 0 ? raw.toFixed(2) : '');
            return `
            <div class="form-group">
              <label class="form-label">${f.label}${f.key === 'advance_offset' ? '（填负数）' : ''}</label>
              <input type="number" class="form-control ${fieldClass}" data-key="${f.key}" value="${showVal}" step="0.01" oninput="${onInputExpr}">
            </div>`;
          }).join('')}
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
    details[key] = roundMoney2(el.value);
  });
  return details;
}

function calcCostDetailsTotal(details) {
  if (!details || typeof details !== 'object') return 0;
  return roundMoney2(Object.values(details).reduce((s, v) => s + roundMoney2(v), 0));
}

async function showCostDetailFromCost(actId, opts = {}) {
  const keepExpand = !!opts.keepExpand;
  try {
    const a = await api('GET', `/activities/${actId}`);
    const details = parseActivityCostDetails(a);
    const total = calcCostDetailsTotal(details);
    const noCost = a && (a.no_cost === true || a.no_cost === 1 || String(a.no_cost) === '1');
    let costSources = keepExpand && window._costDetailSources ? window._costDetailSources : null;
    if (!costSources) {
      try {
        const srcRes = await api('GET', `/activities/${actId}/cost-sources`);
        costSources = (srcRes && srcRes.data) || srcRes || {};
      } catch (_) {
        costSources = {};
      }
      window._costDetailSources = costSources;
    }
    if (!keepExpand) window._costDetailExpandedKey = null;
    const content = document.getElementById('costDetailContent');
    if (!content) {
      showToast('找不到成本详情弹窗，请强制刷新页面 (Cmd+Shift+R)', 'error');
      return;
    }

    const titleEl = document.getElementById('costDetailModalTitle');
    if (titleEl) {
      const pc = a.project_code ? String(a.project_code).trim() : '';
      titleEl.textContent = pc ? `成本详情 · ${pc}` : '成本详情';
    }

    const detailCards = COST_DETAIL_GROUPS.map((g) => {
      const rows = g.items
        .map((it) => {
          const v = roundMoney2(details[it.key] || 0);
          const abs = Math.abs(v);
          const cls = v < 0 ? 'amount amount-revenue' : v > 0 ? 'amount amount-cost' : 'amount amount-neutral';
          const text = abs > 0 ? (v < 0 ? `- ${fmtMoney(abs)}` : fmtMoney(v)) : '—';
          const sources = Array.isArray(costSources[it.key]) ? costSources[it.key] : [];
          const clickable = abs > 0 && sources.length > 0;
          const expanded = window._costDetailExpandedKey === it.key;
          const sourcePanel = expanded && sources.length
            ? `<div class="cost-source-panel">${sources.map((s) => {
                const label = s.payment_order_no
                  ? `付款单 ${escapeHtml(s.payment_order_no)}`
                  : `成本登记 #${s.source_id}`;
                return `<div class="cost-source-line">
                  <span class="cost-source-label">${label}</span>
                  <span class="cost-source-payee">${escapeHtml(s.payee_name || '—')}</span>
                  <span class="cost-source-amt ${s.amount < 0 ? 'amount-revenue' : 'amount-cost'}">${fmtMoney(s.amount)}</span>
                </div>`;
              }).join('')}</div>`
            : '';
          const hint = clickable ? (expanded ? '▾' : '▸') : '';
          return `<div class="activity-detail-row${clickable ? ' activity-detail-row--clickable' : ''}${expanded ? ' activity-detail-row--expanded' : ''}"${clickable ? ` onclick="costDetailToggleCategory('${it.key}')" title="点击查看数据来源"` : ''}>
            <div class="activity-detail-k">${escapeHtml(it.label)}${hint ? ` <span class="cost-source-hint">${hint}</span>` : ''}</div>
            <div class="activity-detail-v"><span class="${cls}">${text}</span></div>
          </div>${sourcePanel}`;
        })
        .join('');
      return `<section class="activity-detail-card"><h4>${escapeHtml(g.title)}</h4>${rows}</section>`;
    }).join('');

    content.innerHTML = `
      <input type="hidden" id="costDetailActId" value="${actId}">
      <div class="activity-detail">
        <div class="activity-detail-hero">
          <div class="activity-detail-hero-top">
            <div class="activity-detail-hero-code">${escapeHtml(a.project_code || '—')}</div>
            <div class="activity-detail-hero-date">${escapeHtml(fmtDate(a.date || a.activity_date))}</div>
          </div>
          <div class="activity-detail-hero-meta">
            <span><strong style="color:var(--text-primary)">${escapeHtml(a.city || '—')}</strong></span>
            <span class="badge badge-${brandColor(a.brand)}">${escapeHtml(a.brand || '—')}</span>
            <span class="badge badge-${typeColor(a.activity_type)}">${escapeHtml(a.activity_type || '—')}</span>
          </div>
        </div>
        <div class="activity-detail-grid">
          <section class="activity-detail-card">
            <h4>场次信息</h4>
            <div class="activity-detail-row"><div class="activity-detail-k">状态</div><div class="activity-detail-v">${statusBadge(a.status)}</div></div>
            <div class="activity-detail-row"><div class="activity-detail-k">报价</div><div class="activity-detail-v"><span class="amount amount-revenue">${fmtMoney(a.quoted_price || 0)}</span></div></div>
            <div class="activity-detail-row"><div class="activity-detail-k">成本</div><div class="activity-detail-v"><span class="${noCost ? 'amount amount-neutral' : 'amount amount-cost'}">${noCost ? '无成本' : fmtMoney(total)}</span></div></div>
            <div class="activity-detail-row"><div class="activity-detail-k">利润</div><div class="activity-detail-v"><span class="amount ${(Number(a.quoted_price || 0) - total) >= 0 ? 'amount-revenue' : 'amount-cost'}">${fmtMoney((Number(a.quoted_price || 0) - total))}</span></div></div>
          </section>
        </div>
        <div class="activity-detail-grid">
          ${detailCards}
        </div>
      </div>
    `;

    openModal('modalCostDetail');
    renderLucideIcons();
  } catch (err) {
    showToast('加载成本详情失败: ' + err.message, 'error');
  }
}
