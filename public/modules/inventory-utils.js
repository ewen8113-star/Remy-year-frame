/* 库存模块通用工具：仅放展示判断和纯格式化逻辑，不写入业务数据。 */

function invStockClass(item) {
  const q = Number(item.quantity_on_hand || 0);
  const a = item.alert_below != null ? Number(item.alert_below) : null;
  if (q <= 0) return 'inv-stock-out';
  if (a != null && Number.isFinite(a) && q <= a) return 'inv-stock-low';
  return 'inv-stock-ok';
}

function invStockLabel(item) {
  const q = Number(item.quantity_on_hand || 0);
  const a = item.alert_below != null ? Number(item.alert_below) : null;
  if (q <= 0) return '缺货';
  if (a != null && Number.isFinite(a) && q <= a) return '低于预警';
  return '正常';
}

function invItemIsCommon(it) {
  return Number(it.is_common) === 1;
}

/** 与目录、入库行一致：名称 + 规格行，用于判断「酒」类库存行 */
function invItemWineCatalogKey(it) {
  const n = String(it.name || '').trim();
  const d = it.dimensions;
  const ds = d == null ? '' : String(d).trim();
  return `${n}\0${ds}`;
}

/** 与酒品目录入库、后端排查一致：仅用容量 volume_label 作为规格键 */
function invWineCatalogMatchSpec(c) {
  return String(c?.volume_label || '').trim();
}

function invCatalogRowWineKey(c) {
  const n = String(c.name || '').trim();
  const ds = invWineCatalogMatchSpec(c);
  return `${n}\0${ds}`;
}

function invItemIsWineTagged(it) {
  if (!it) return false;
  if (Number(it.is_wine) === 1 || it.is_wine === true) return true;
  return false;
}

function invWineBadgeHtml(it) {
  if (!invItemIsWineTagged(it)) return '';
  const lbl = String(it.wine_label || it.name || '参与用酒统计').trim();
  return `<span class="inv-badge-wine" title="${escapeHtml(lbl)}">酒</span>`;
}

function invGridViewToggleTitle(mode) {
  if (mode === 'list') return '卡片视图（再点此图标可切换为缩略图）';
  if (mode === 'cards') return '当前：卡片 — 点击切换为缩略图';
  return '当前：缩略图 — 点击切换为卡片';
}

function invItemImageInnerHtml(it) {
  const u = it.image_urls && it.image_urls[0];
  if (u) return `<img src="${escapeHtml(u)}" alt="">`;
  return '<span class="inv-no-img">无图</span>';
}

/** 出库左侧物料列表：名称前缩略图，便于辨认 */
function invObItemThumbHtml(it) {
  const u = it && it.image_urls && it.image_urls[0];
  if (u) {
    return `<img src="${escapeHtml(u)}" alt="${escapeHtml(it.name || '物料')}" loading="lazy">`;
  }
  return '<span class="inv-no-img">无图</span>';
}

function invStatQty(n) {
  if (n == null || n === '') return 0;
  if (typeof n === 'bigint') return Number(n);
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function invWarehouseBrandDisplay(w) {
  const code = String(w?.brand_code || '').trim().toUpperCase();
  const region = String(w?.region || '').trim();
  // X.O 的「北区/南区」是公司级跨品牌备货仓，单独显示 brand 时省略 X.O 前缀
  if (code === 'X.O' && (region === '北区' || region === '南区')) {
    return region;
  }
  return String(w?.brand_code || '').trim();
}

/**
 * 仓库统一展示标签：用于「品牌 · 区域」组合显示，所有 UI 位置保持一致
 *   X.O 北区 -> 「北区仓库」
 *   X.O 南区 -> 「南区仓库」
 *   其余 -> 「{brand_code} {region}」
 * 入参可为 inv_warehouses 行或仅有 brand_code/region 字段的对象（如出库单 join 结果）。
 */
function invWarehouseFullLabel(w) {
  const code = String(w?.brand_code || '').trim();
  const region = String(w?.region || '').trim();
  if (code.toUpperCase() === 'X.O' && (region === '北区' || region === '南区')) {
    return `${region}仓库`;
  }
  if (!code && !region) return '—';
  if (!code) return region;
  if (!region) return code;
  return `${code} ${region}`;
}

function invReorderWarehouseCards(warehouses) {
  const arr = Array.isArray(warehouses) ? warehouses.slice() : [];
  const northIdx = arr.findIndex((w) => String(w?.region || '') === '北区');
  const clubEastIdx = arr.findIndex(
    (w) => String(w?.brand_code || '').toUpperCase() === 'CLUB' && String(w?.region || '') === '东区',
  );
  if (northIdx >= 0 && clubEastIdx >= 0 && northIdx !== clubEastIdx) {
    const tmp = arr[northIdx];
    arr[northIdx] = arr[clubEastIdx];
    arr[clubEastIdx] = tmp;
  }
  return arr;
}

function invFilenameFromDisposition(cd, fallbackName) {
  const raw = String(cd || '');
  if (!raw) return fallbackName;
  // RFC 5987: filename*=UTF-8''...
  const star = raw.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star && star[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, ''));
    } catch (_) {
      return star[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  // fallback: filename="..."
  const normal = raw.match(/filename\s*=\s*("?)([^";]+)\1/i);
  if (normal && normal[2]) return normal[2].trim();
  return fallbackName;
}

/** 从收件地址文本中识别直辖市、省市或市级前缀。 */
function invExtractCityFromChineseAddress(address) {
  const text = String(address || '').trim();
  if (!text) return '';
  const municipalities = [
    ['北京市', '北京'],
    ['上海市', '上海'],
    ['天津市', '天津'],
    ['重庆市', '重庆'],
  ];
  for (const [fullName, shortName] of municipalities) {
    if (text.startsWith(fullName)) return shortName;
    if (
      text.startsWith(shortName)
      && text.length > shortName.length
      && /[市区县省]/.test(text[shortName.length])
    ) {
      return shortName;
    }
  }
  const provinceCity = text.match(/^([\u4e00-\u9fa5]{2,8}省)([\u4e00-\u9fa5]{2,12}市)/);
  if (provinceCity) return provinceCity[2].replace(/市$/, '') || provinceCity[2];
  const city = text.match(/^([\u4e00-\u9fa5]{2,14}市)/);
  if (city) return city[1].replace(/市$/, '') || city[1];
  return '';
}

function invStripUsedCityPrefixFromAddress(address, cityShort) {
  const text = String(address || '').trim();
  const city = String(cityShort || '').trim();
  if (!text || !city) return text;
  const municipalityNames = { 北京: '北京市', 上海: '上海市', 天津: '天津市', 重庆: '重庆市' };
  const prefixes = [];
  if (municipalityNames[city]) prefixes.push(municipalityNames[city]);
  prefixes.push(city.endsWith('市') ? city : `${city}市`, city);
  for (const prefix of prefixes) {
    if (prefix && text.startsWith(prefix)) {
      const remaining = text.slice(prefix.length).replace(/^[，,、\s]+/, '');
      return remaining || text;
    }
  }
  const provinceCity = text.match(/^[\u4e00-\u9fa5]{2,8}省([\u4e00-\u9fa5]{2,12}市)/);
  if (provinceCity && (provinceCity[1] === `${city}市` || provinceCity[1].startsWith(city))) {
    const remaining = text.slice(provinceCity[0].length).replace(/^[，,、\s]+/, '');
    return remaining || text;
  }
  return text;
}

function invFilterOutboundOrders(orders, query) {
  const rows = Array.isArray(orders) ? orders : [];
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return rows;
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  return rows.filter((order) => {
    const searchableText = [
      order.items_summary,
      order.project_code,
      order.purpose,
      order.contact_name,
      order.contact_phone,
      order.tracking_number,
      order.logistics_method,
      order.logistics_supplier,
      order.recipient_city,
      order.recipient_address,
      order.brand_code,
      order.region,
      order.remarks,
      invWarehouseFullLabel(order),
      invBusinessYmd(order.shipped_at),
      `#${order.id}`,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return terms.every((term) => searchableText.includes(term));
  });
}

function invOutboundMonthKeys(orders) {
  const months = new Set();
  (orders || []).forEach((order) => {
    const date = invBusinessYmd(order.shipped_at || order.created_at);
    if (date) months.add(date.slice(0, 7));
  });
  return [...months].sort().reverse();
}

function invFilterOutboundByMonth(orders, monthKey) {
  if (!monthKey || monthKey === 'all') return orders;
  return (orders || []).filter((order) => {
    const date = invBusinessYmd(order.shipped_at || order.created_at);
    return date ? date.slice(0, 7) === monthKey : false;
  });
}

function invRenderOutboundMonthButtons(keys, selected) {
  return invRenderInvMonthBar(keys, selected, 'invSetOutboundMonth');
}

function invRenderInvMonthBar(keys, selected, setterFn) {
  const allActive = selected === 'all';
  const allButton = `<button type="button" class="btn btn-secondary btn-sm${allActive ? ' inv-ob-month-active' : ''}" onclick="${setterFn}('all')">全部</button>`;
  const monthButtons = (keys || []).map((key) => {
    const [year, month] = key.split('-');
    const active = selected === key;
    return `<button type="button" class="btn btn-secondary btn-sm${active ? ' inv-ob-month-active' : ''}" onclick="${setterFn}('${key}')">${year}年${parseInt(month, 10)}月</button>`;
  }).join('');
  return `<div class="inv-ob-month-bar">${allButton}${monthButtons}</div>`;
}

function invInboundLedgerDateKey(row) {
  const date = invBusinessYmd(row.return_date || row.inbound_date || row.created_at);
  return date ? date.slice(0, 7) : '';
}

function invInboundPendingDateKey(row) {
  const date = invBusinessYmd(row.shipped_at || row.created_at);
  return date ? date.slice(0, 7) : '';
}

function invMonthKeysFromRows(rows, dateKeyFn) {
  const months = new Set();
  (rows || []).forEach((row) => {
    const month = dateKeyFn(row);
    if (month) months.add(month);
  });
  return [...months].sort().reverse();
}

function invFilterRowsByMonth(rows, monthKey, dateKeyFn) {
  if (!monthKey || monthKey === 'all') return rows || [];
  return (rows || []).filter((row) => dateKeyFn(row) === monthKey);
}

function invPaginateSlice(rows, page, pageSize) {
  const sourceRows = rows || [];
  const total = sourceRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    rows: sourceRows.slice(start, start + pageSize),
    page: currentPage,
    totalPages,
    total,
  };
}
