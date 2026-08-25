function invParseOutboundRecipientPaste(raw) {
  const text0 = String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/[\t\f\v]/g, ' ')
    .trim();
  if (!text0) return { name: '', phone: '', address: '', city: '' };

  // 去掉常见字段标签前缀（不影响内容）：将 "收件人：xxx" 中的 "收件人：" 直接抹掉
  const labelRe = /(收件人|发件人|联系人|姓名|客户|电话|手机|联系电话|联系方式|tel|phone|地址|收货地址|收件地址|address)\s*[:：]\s*/gi;
  const cleaned = text0.replace(labelRe, ' ');

  // 1) 抽取手机号 / 固话
  const mobileRe = /1[3-9]\d{9}/g;
  const landlineRe = /\b\d{3,4}[-\s]?\d{7,8}\b/g;
  let phone = '';
  const mobs = cleaned.match(mobileRe);
  if (mobs && mobs.length) {
    phone = mobs[0];
  } else {
    const lls = cleaned.match(landlineRe);
    if (lls && lls.length) phone = lls[0].replace(/[\s-]/g, '');
  }

  // 2) 把所有手机号 / 固话从文本中移除（统一变空格）
  const withoutPhone = cleaned
    .replace(mobileRe, ' ')
    .replace(landlineRe, ' ')
    .replace(/[，,;；、|｜]/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // 3) 切片：按空白分；保留每个 token
  const tokens = withoutPhone.split(/\s+/).filter(Boolean);

  // 4) 分类判定
  const addrKeywordRe = /(省|市|区|县|镇|乡|村|街道|大道|街|路|弄|巷|号|楼|层|室|栋|苑|园|单元|大厦|广场|花园|公寓|小区|商业|开发区|新区|工业园|科技园|路口|站)/;
  const companyRe = /(公司|集团|有限|股份|工厂|工作室|事务所|商行|商贸|餐厅|酒店|店|铺|超市|药房|医院|学校|大学|中学|小学|大酒店|分公司|总公司)/;
  const purelyChineseNameRe = /^[\u4e00-\u9fa5·•．\.]{2,6}$/;
  const englishNameRe = /^[A-Za-z][A-Za-z\.\-]{0,20}(\s+[A-Za-z][A-Za-z\.\-]{0,20}){0,3}$/;

  const addrParts = [];
  const nameParts = [];
  const unknownParts = [];

  for (const tok of tokens) {
    if (!tok) continue;
    // 含地址关键字 → 地址
    if (addrKeywordRe.test(tok)) {
      addrParts.push(tok);
      continue;
    }
    // 含数字（如 "45-7" "1号" "6层"）但无地址关键字 → 倾向地址兜底
    if (/\d/.test(tok) && tok.length >= 2) {
      // 但纯数字小段（如门牌 "12"）单独可能是姓名前的编号，仍归地址
      addrParts.push(tok);
      continue;
    }
    // 公司名 → 姓名（作为收件单位）
    if (companyRe.test(tok)) {
      nameParts.push(tok);
      continue;
    }
    // 2-6 字纯中文 → 姓名
    if (purelyChineseNameRe.test(tok)) {
      nameParts.push(tok);
      continue;
    }
    // 英文姓名（首字母大写）→ 姓名
    if (englishNameRe.test(tok) && tok.length <= 24) {
      nameParts.push(tok);
      continue;
    }
    // 长 token（≥8）兜底为地址
    if (tok.length >= 8) {
      addrParts.push(tok);
      continue;
    }
    unknownParts.push(tok);
  }

  // 兜底 1：没有地址命中，但 unknown 里有长字符串 → 当作地址
  if (!addrParts.length) {
    for (let i = unknownParts.length - 1; i >= 0; i--) {
      if (unknownParts[i].length >= 4) {
        addrParts.unshift(unknownParts.splice(i, 1)[0]);
      }
    }
  }
  // 剩余 unknown 进入 name
  for (const u of unknownParts) nameParts.push(u);

  // 兜底 2：完全没识别出 name，但 address 里包含明显的人名子串（首段 2-4 字中文 + 后续大量地址关键字）
  if (!nameParts.length && addrParts.length) {
    const first = addrParts[0];
    const m = first.match(/^([\u4e00-\u9fa5]{2,4})(?=[\u4e00-\u9fa5]*(省|市|区|县|镇))/);
    if (m && !addrKeywordRe.test(m[1])) {
      nameParts.push(m[1]);
      addrParts[0] = first.slice(m[1].length).trim();
      if (!addrParts[0]) addrParts.shift();
    }
  }

  let name = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  let address = addrParts.join(' ').replace(/\s+/g, ' ').trim();
  const city = invExtractCityFromChineseAddress(address);
  const addrNorm = invStripUsedCityPrefixFromAddress(address, city);
  return {
    name,
    phone,
    city,
    address: (addrNorm || address).trim(),
  };
}

function invOpenOutboundSmartFill() {
  const ta = document.getElementById('invObSmartFillPaste');
  if (ta) ta.value = '';
  openModal('modalInvObSmartFill');
}

function invApplyOutboundSmartFill() {
  const ta = document.getElementById('invObSmartFillPaste');
  const { name, phone, address, city } = invParseOutboundRecipientPaste(ta?.value || '');
  const nEl = document.getElementById('invContactName');
  const pEl = document.getElementById('invContactPhone');
  const aEl = document.getElementById('invRecvAddr');
  const cEl = document.getElementById('invRecvCity');
  if (nEl) nEl.value = name;
  if (pEl) pEl.value = phone;
  if (aEl) aEl.value = address;
  if (cEl && city) cEl.value = city;
  closeModal();
  showToast(city ? '已填入（已识别收件城市）' : '已填入', 'success');
}

let invOutboundSupplierCache = [];

async function invLoadOutboundSupplierOptions(selectedName, opts = {}) {
  const sel = document.getElementById('invLogisticsSupplier');
  if (!sel) return;
  const autoPickForWarehouse = !!opts.autoPickForWarehouse;
  try {
    const rows = await api('GET', '/dict?category=supplier');
    invOutboundSupplierCache = (Array.isArray(rows) ? rows : [])
      .filter((e) => e.is_active !== false && e.is_active !== 0)
      .map((e) => {
        const c = e.content || {};
        const name = String(c.company_name || e.name || '').trim();
        return { id: e.id, name };
      })
      .filter((x) => x.name);
  } catch (_) {
    invOutboundSupplierCache = [];
  }
  let want = String(selectedName || '').trim();
  if (!want && autoPickForWarehouse) {
    const whId = Number(inventoryPageState.warehouseId || 0);
    const wh = (inventoryPageState.outboundWarehousesCache || []).find((w) => Number(w.id) === whId);
    want = invGuessSupplierForWarehouse(wh, invOutboundSupplierCache);
    if (want) inventoryPageState.outboundForm.logistics_supplier = want;
  }
  const options = ['<option value="">请选择供应商</option>'];
  let matched = false;
  invOutboundSupplierCache.forEach((e) => {
    const on = want && e.name === want;
    if (on) matched = true;
    options.push(`<option value="${escapeHtml(e.name)}"${on ? ' selected' : ''}>${escapeHtml(e.name)}</option>`);
  });
  if (want && !matched) {
    options.push(`<option value="${escapeHtml(want)}" selected>${escapeHtml(want)}（已保存）</option>`);
  }
  sel.innerHTML = options.join('');
}

function invGuessSupplierForWarehouse(wh, suppliers) {
  if (!wh || !suppliers?.length) return '';
  const label = String(wh.label || '').trim();
  const region = String(wh.region || '').trim();
  const brand = String(wh.brand_code || '').trim();
  const tokens = [label, region ? `${region}仓` : '', brand && region ? `${brand} ${region}` : '', region].filter(Boolean);
  for (const t of tokens) {
    const hit = suppliers.find((s) => s.name.includes(t) || (label && label.includes(s.name)));
    if (hit) return hit.name;
  }
  return '';
}

function invOutboundSupplierChanged() {
  const name = document.getElementById('invLogisticsSupplier')?.value?.trim() || '';
  inventoryPageState.outboundForm.logistics_supplier = name;
  const hit = invOutboundSupplierCache.find((s) => s.name === name);
  if (hit?.id) api('POST', `/dict/${hit.id}/touch`).catch(() => {});
}
