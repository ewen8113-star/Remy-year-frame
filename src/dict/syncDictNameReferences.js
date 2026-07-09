/**
 * 字典条目改名后，将业务表中已存的收款方/供应商名称同步为新名称。
 * 业务表存的是 name 快照（非 dict_entry_id），因此在 PUT /api/dict/:id 时级联更新。
 */

function parseContent(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw)) || {};
  } catch {
    return {};
  }
}

/** 各通讯录类别在业务中使用的展示名 */
function canonicalDisplayName(entry) {
  const c = parseContent(entry.content);
  const category = String(entry.category || '').trim();
  if (category === 'supplier' || category === 'payee') {
    return String(c.company_name || entry.name || '').trim();
  }
  if (category === 'personal_payee') {
    return String(c.payee_name || entry.name || '').trim();
  }
  if (category === 'reimburser') {
    return String(c.employee_name || entry.name || '').trim();
  }
  return String(entry.name || '').trim();
}

/** 历史上可能写入业务表的所有别名（旧 name、content 主字段、简称） */
function collectAliases(entry) {
  const c = parseContent(entry.content);
  const category = String(entry.category || '').trim();
  const aliases = new Set();
  const add = (v) => {
    const s = String(v || '').trim();
    if (s) aliases.add(s);
  };
  add(entry.name);
  add(entry.short_label);
  if (category === 'supplier' || category === 'payee') add(c.company_name);
  else if (category === 'personal_payee') add(c.payee_name);
  else if (category === 'reimburser') add(c.employee_name);
  return aliases;
}

const SYNC_CATEGORIES = new Set(['supplier', 'payee', 'personal_payee', 'reimburser']);

const PAYEE_NAME_TARGETS = [
  { table: 'reimbursements', column: 'payee_name' },
  { table: 'warehouse', column: 'payee_name' },
  { table: 'logistics', column: 'payee_name' },
  { table: 'material_purchases', column: 'payee_name' },
  { table: 'prop_repairs', column: 'payee_name' },
  { table: 'payment_orders', column: 'payee_name' },
];

const SUPPLIER_EXTRA_TARGETS = [
  { table: 'inv_outbound_orders', column: 'logistics_supplier' },
  { table: 'logistics', column: 'logistics_company' },
];

const _columnExistsCache = new Map();

async function tableColumnExists(db, tableName, columnName) {
  const key = `${tableName}.${columnName}`;
  if (_columnExistsCache.has(key)) return _columnExistsCache.get(key);
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  const ok = Number(rows[0].c) > 0;
  _columnExistsCache.set(key, ok);
  return ok;
}

async function syncNameInTable(db, table, column, oldNames, newName) {
  if (!newName) return 0;
  const olds = [...oldNames].filter((n) => n && n !== newName);
  if (!olds.length) return 0;
  if (!(await tableColumnExists(db, table, column))) return 0;
  const placeholders = olds.map(() => '?').join(', ');
  const [r] = await db.query(
    `UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`${column}\` IN (${placeholders})`,
    [newName, ...olds]
  );
  return Number(r.affectedRows || 0);
}

async function syncReimbursementBankFromDict(db, payeeName, entry) {
  const c = parseContent(entry.content);
  const bankName = String(c.bank_name || '').trim();
  const bankAccount = String(c.bank_account || '').trim();
  if (!payeeName || (!bankName && !bankAccount)) return 0;
  if (!(await tableColumnExists(db, 'reimbursements', 'payee_name'))) return 0;

  const sets = [];
  const params = [];
  if (bankName && (await tableColumnExists(db, 'reimbursements', 'payee_bank_name'))) {
    sets.push('payee_bank_name = ?');
    params.push(bankName);
  }
  if (bankAccount && (await tableColumnExists(db, 'reimbursements', 'payee_bank_account'))) {
    sets.push('payee_bank_account = ?');
    params.push(bankAccount);
  }
  if (!sets.length) return 0;
  params.push(payeeName);
  const [r] = await db.query(
    `UPDATE reimbursements SET ${sets.join(', ')} WHERE payee_name = ?`,
    params
  );
  return Number(r.affectedRows || 0);
}

/**
 * @param {import('mysql2/promise').Pool} db
 * @param {object} oldEntry 更新前的 dict_entries 行
 * @param {object} newEntry 更新后的 dict_entries 行
 * @returns {Promise<{ total: number, byTable: Record<string, number>, newName: string }>}
 */
async function syncDictEntryNameReferences(db, oldEntry, newEntry) {
  const category = String(oldEntry.category || newEntry.category || '').trim();
  if (!SYNC_CATEGORIES.has(category)) {
    return { total: 0, byTable: {}, newName: canonicalDisplayName(newEntry) };
  }

  const newName = canonicalDisplayName(newEntry);
  const oldCanonical = canonicalDisplayName(oldEntry);
  const namesToReplace = new Set([...collectAliases(oldEntry), oldCanonical]);
  namesToReplace.delete(newName);

  if (!newName || !namesToReplace.size) {
    return { total: 0, byTable: {}, newName };
  }

  const byTable = {};
  let total = 0;

  for (const { table, column } of PAYEE_NAME_TARGETS) {
    const n = await syncNameInTable(db, table, column, namesToReplace, newName);
    if (n > 0) {
      const key = `${table}.${column}`;
      byTable[key] = (byTable[key] || 0) + n;
      total += n;
    }
  }

  if (category === 'supplier') {
    for (const { table, column } of SUPPLIER_EXTRA_TARGETS) {
      const n = await syncNameInTable(db, table, column, namesToReplace, newName);
      if (n > 0) {
        const key = `${table}.${column}`;
        byTable[key] = (byTable[key] || 0) + n;
        total += n;
      }
    }
  }

  if (category === 'supplier' || category === 'payee') {
    const bankN = await syncReimbursementBankFromDict(db, newName, newEntry);
    if (bankN > 0) {
      byTable['reimbursements.bank'] = bankN;
      total += bankN;
    }
  }

  return { total, byTable, newName };
}

/**
 * 按旧名 → 新名批量修复（一次性脚本 / 手工修复用）
 */
async function syncPayeeNameGlobally(db, oldName, newName) {
  const olds = new Set([String(oldName || '').trim()].filter(Boolean));
  const newN = String(newName || '').trim();
  if (!olds.size || !newN || olds.has(newN)) {
    return { total: 0, byTable: {} };
  }

  const byTable = {};
  let total = 0;
  const targets = [...PAYEE_NAME_TARGETS, ...SUPPLIER_EXTRA_TARGETS];
  for (const { table, column } of targets) {
    const n = await syncNameInTable(db, table, column, olds, newN);
    if (n > 0) {
      byTable[`${table}.${column}`] = n;
      total += n;
    }
  }
  return { total, byTable };
}

module.exports = {
  canonicalDisplayName,
  collectAliases,
  syncDictEntryNameReferences,
  syncPayeeNameGlobally,
};
