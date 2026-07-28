/* 物流成本页面模块：从 app.js 机械迁移，包含物流页和被成本模块复用的项目/供应商工具。 */

/* =============================================
   页面：物流成本（原物流记录）
   ============================================= */
const LOGISTICS_UNITS = ['东区仓库', '北区仓库', '南区仓库', '快递', '物流'];
const LOGISTICS_METHODS_BY_UNIT = {
  东区仓库: ['顺丰', '物流', '其他'],
  北区仓库: ['顺丰', '物流', '其他'],
  南区仓库: ['顺丰', '物流', '其他'],
  快递: ['顺丰', '京东', '圆通', '申通', '中通', '韵达', '其他'],
  物流: ['德邦', '跨越', 'EMS', '其他'],
};
const LOGISTICS_LEGACY_UNIT_MAP = {
  '东区仓库（叶老板）': '东区仓库',
  '南区仓库（天空）': '南区仓库',
  '北区仓库（叶老板）': '北区仓库',
};

function parseLogisticsAddrMeta(remarks) {
  const empty = () => ({
    shipName: '',
    shipPhone: '',
    shipAddr: '',
    recvName: '',
    recvPhone: '',
    recvAddr: '',
    purpose: '',
    sender: '',
    recipient: '',
    address: '',
  });
  const raw = String(remarks || '');
  const m = raw.match(/^\[LOG_ADDR\]([^\n]*)/);
  if (!m) return empty();
  const kv = {};
  m[1].split('|').forEach((part) => {
    const idx = part.indexOf(':');
    if (idx <= 0) return;
    const k = part.slice(0, idx);
    const v = part.slice(idx + 1).replace(/｜/g, '|');
    kv[k] = v;
  });
  const purpose = kv['用途'] || '';
  const hasAddrFields = ['发件人', '发件电话', '发件地址', '收件人', '收件电话', '收件地址'].some((key) =>
    Object.prototype.hasOwnProperty.call(kv, key),
  );
  if (hasAddrFields || purpose) {
    const shipName = kv['发件人'] || '';
    const shipPhone = kv['发件电话'] || '';
    const shipAddr = kv['发件地址'] || '';
    const recvName = kv['收件人'] || '';
    const recvPhone = kv['收件电话'] || '';
    const recvAddr = kv['收件地址'] || '';
    return {
      shipName,
      shipPhone,
      shipAddr,
      recvName,
      recvPhone,
      recvAddr,
      purpose,
      sender: [shipName, shipPhone].filter(Boolean).join(' '),
      recipient: [recvName, recvPhone].filter(Boolean).join(' '),
      address: recvAddr,
    };
  }
  const out = empty();
  if (Object.prototype.hasOwnProperty.call(kv, '发件')) {
    out.sender = kv['发件'] || '';
    out.recipient = kv['收件'] || '';
    out.address = kv['地址'] || '';
    out.recvAddr = out.address;
    const sJoin = out.sender.match(/^(.+?)\s+(1[3-9]\d{9}|\d{2,4}-\d{7,9})$/);
    if (sJoin) {
      out.shipName = sJoin[1].trim();
      out.shipPhone = sJoin[2].replace(/\s/g, '');
    } else {
      out.shipName = out.sender;
    }
    const rJoin = out.recipient.match(/^(.+?)\s+(1[3-9]\d{9}|\d{2,4}-\d{7,9})$/);
    if (rJoin) {
      out.recvName = rJoin[1].trim();
      out.recvPhone = rJoin[2].replace(/\s/g, '');
    } else {
      out.recvName = out.recipient;
    }
  }
  return out;
}

function buildLogisticsAddrMetaV2(shipName, shipPhone, shipAddr, recvName, recvPhone, recvAddr, purpose) {
  const esc = (v) => String(v || '').replace(/\|/g, '｜').replace(/\n/g, ' ');
  const parts = [];
  if (String(shipName || '').trim()) parts.push(`发件人:${esc(shipName)}`);
  if (String(shipPhone || '').trim()) parts.push(`发件电话:${esc(shipPhone)}`);
  if (String(shipAddr || '').trim()) parts.push(`发件地址:${esc(shipAddr)}`);
  if (String(recvName || '').trim()) parts.push(`收件人:${esc(recvName)}`);
  if (String(recvPhone || '').trim()) parts.push(`收件电话:${esc(recvPhone)}`);
  if (String(recvAddr || '').trim()) parts.push(`收件地址:${esc(recvAddr)}`);
  if (String(purpose || '').trim()) parts.push(`用途:${esc(purpose)}`);
  if (!parts.length) return '';
  return `[LOG_ADDR]${parts.join('|')}\n`;
}

/** 旧三字段（发件/收件/地址）→ 新键；仅保留给极少数兼容调用 */
function buildLogisticsAddrMeta(sender, recipient, address) {
  const s = String(sender || '').trim();
  const r = String(recipient || '').trim();
  const a = String(address || '').trim();
  if (!s && !r && !a) return '';
  return buildLogisticsAddrMetaV2(s, '', '', r, '', a, '');
}

async function copyTextToClipboard(text) {
  const s = String(text || '');
  if (!s.trim()) {
    showToast('没有可复制内容', 'warning');
    return;
  }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(s);
    } else {
      throw new Error('no clipboard');
    }
  } catch (_) {
    try {
      const ta = document.createElement('textarea');
      ta.value = s;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (e2) {
      showToast('复制失败', 'error');
      return;
    }
  }
  showToast('已复制', 'success');
}

function copyLogisticsShipBundle() {
  const name = document.getElementById('logShipName')?.value?.trim() || '';
  const phone = document.getElementById('logShipPhone')?.value?.trim() || '';
  const addr = document.getElementById('logShipAddr')?.value?.trim() || '';
  const text = [name, phone, addr].filter(Boolean).join('\n');
  copyTextToClipboard(text);
}

function copyLogisticsRecvBundle() {
  const name = document.getElementById('logRecvName')?.value?.trim() || '';
  const phone = document.getElementById('logRecvPhone')?.value?.trim() || '';
  const addr = document.getElementById('logRecvAddr')?.value?.trim() || '';
  const text = [name, phone, addr].filter(Boolean).join('\n');
  copyTextToClipboard(text);
}

let logisticsSmartFillTarget = 'ship';

function parseLogisticsContactPaste(raw) {
  const t = String(raw || '').trim().replace(/\u00a0/g, ' ');
  if (!t) return { name: '', phone: '', addr: '' };
  const phoneRe = /(1[3-9]\d{9})|(\d{2,4}[- ]?\d{7,9}\b)/;
  const lines = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2) {
    let pi = -1;
    let phone = '';
    lines.forEach((ln, i) => {
      if (pi < 0 && phoneRe.test(ln)) {
        const m = ln.match(phoneRe);
        if (m) {
          phone = m[0].replace(/\s/g, '');
          pi = i;
        }
      }
    });
    if (pi < 0) {
      return { name: lines[0] || '', phone: '', addr: lines.slice(1).join('\n') };
    }
    const namePart = lines.slice(0, pi).join(' ') || lines[pi].replace(phoneRe, '').trim();
    const addrPart = lines.slice(pi + 1).join('\n');
    return { name: namePart.trim(), phone: phone.trim(), addr: addrPart.trim() };
  }
  const m = t.match(phoneRe);
  const phone = m ? m[0].replace(/\s/g, '') : '';
  const rest = t.replace(phoneRe, ' ').replace(/\s+/g, ' ').trim();
  const parts = rest.split(/\s+/).filter(Boolean);
  if (!phone) {
    return { name: parts[0] || '', phone: '', addr: parts.slice(1).join(' ') };
  }
  if (parts.length <= 1) {
    return { name: parts[0] || '', phone, addr: '' };
  }
  return { name: (parts[0] || '').trim(), phone, addr: parts.slice(1).join(' ').trim() };
}

function openLogisticsSmartFill(which) {
  logisticsSmartFillTarget = which === 'recv' ? 'recv' : 'ship';
  const ta = document.getElementById('logisticsSmartFillPaste');
  if (ta) ta.value = '';
  const title = document.getElementById('logisticsSmartFillTitle');
  if (title) {
    title.textContent =
      logisticsSmartFillTarget === 'ship' ? '智能填写 · 发件信息' : '智能填写 · 收件信息';
  }
  openModal('modalLogisticsSmartFill');
}

function applyLogisticsSmartFill() {
  const ta = document.getElementById('logisticsSmartFillPaste');
  const { name, phone, addr } = parseLogisticsContactPaste(ta?.value || '');
  if (logisticsSmartFillTarget === 'recv') {
    const n = document.getElementById('logRecvName');
    const p = document.getElementById('logRecvPhone');
    const a = document.getElementById('logRecvAddr');
    if (n) n.value = name;
    if (p) p.value = phone;
    if (a) a.value = addr;
  } else {
    const n = document.getElementById('logShipName');
    const p = document.getElementById('logShipPhone');
    const a = document.getElementById('logShipAddr');
    if (n) n.value = name;
    if (p) p.value = phone;
    if (a) a.value = addr;
  }
  closeModal();
}

/** 物品出库「物流方式」→ 成本模块物流单位/方式（与 LOGISTICS_METHODS_BY_UNIT 一致） */
function invOutboundMethodToLogisticsUnitExpress(methodRaw) {
  const m = String(methodRaw || '').trim();
  if (!m || m === '其他') return { unit: '快递', express: '其他' };
  if (m === '物流') return { unit: '物流', express: '其他' };
  const expressSet = new Set(LOGISTICS_METHODS_BY_UNIT['快递']);
  const logisticsSet = new Set(LOGISTICS_METHODS_BY_UNIT['物流']);
  if (logisticsSet.has(m)) return { unit: '物流', express: m };
  if (expressSet.has(m)) return { unit: '快递', express: m };
  return { unit: '快递', express: m };
}

function preserveInvObSuffix(remarks) {
  const m = String(remarks || '').match(/\[INV-OB:\d+\][^\n]*$/);
  return m ? m[0].trim() : '';
}

function logisticsOutboundIdFromRemarks(remarks) {
  const m = String(remarks || '').match(/\[INV-OB:(\d+)\]/);
  if (!m) return null;
  const id = parseInt(m[1], 10);
  return Number.isFinite(id) ? id : null;
}

function logisticsRowHasOutboundLink(row) {
  return logisticsOutboundIdFromRemarks(row?.remarks) != null;
}

function logisticsRowClick(ev, logId) {
  if (ev.target.closest('button') || ev.target.closest('a') || ev.target.closest('input')) return;
  void logisticsOpenShipmentDetail(logId);
}

async function logisticsOpenShipmentDetail(logId) {
  const lid = Number(logId);
  if (!Number.isFinite(lid)) return;
  const row = (logisticsState.data || []).find((l) => Number(l.id) === lid);
  if (!row) {
    showToast('记录不存在', 'warning');
    return;
  }
  const outboundId = logisticsOutboundIdFromRemarks(row.remarks);
  if (outboundId) {
    await invOpenOutboundOrderDetail(outboundId, {
      title: `发货详情 · 出库单 #${outboundId}`,
      logisticsId: lid,
      logisticsRow: row,
    });
    return;
  }
  logisticsOpenManualShipDetail(row);
}
