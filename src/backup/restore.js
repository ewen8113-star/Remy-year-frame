const fs = require('fs');
const db = require('../config/database');

const INSERT_BATCH_SIZE = 80;

function safeTableName(name) {
  return /^[a-zA-Z0-9_]+$/.test(String(name || ''));
}

function mysqlDatetimeFromIso(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function normalizeCellValue(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object' && v && v.type === 'Buffer' && Array.isArray(v.data)) {
    return Buffer.from(v.data);
  }
  // mysql2 读出的 JSON 列在备份文件里是 object/array，写回必须再 stringify
  if (typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v)) {
    return JSON.stringify(v);
  }
  if (v instanceof Date) {
    return mysqlDatetimeFromIso(v.toISOString());
  }
  // JSON 备份里的 ISO 时间（含 Z）需转为 MySQL DATETIME
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(v)) {
    return mysqlDatetimeFromIso(v);
  }
  return v;
}

async function restoreTableRows(conn, table, rows) {
  if (!safeTableName(table)) throw new Error(`非法表名: ${table}`);
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
  const dbCols = cols.map((c) => c.Field);
  await conn.query(`TRUNCATE TABLE \`${table}\``);
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const sampleKeys = new Set();
  for (const row of rows.slice(0, 20)) {
    Object.keys(row || {}).forEach((k) => sampleKeys.add(k));
  }
  const keys = dbCols.filter((c) => sampleKeys.has(c));
  if (!keys.length) return 0;

  let inserted = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + INSERT_BATCH_SIZE);
    const placeholders = chunk.map(() => `(${keys.map(() => '?').join(',')})`).join(',');
    const values = [];
    for (const row of chunk) {
      for (const k of keys) values.push(normalizeCellValue(row[k]));
    }
    await conn.query(
      `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(',')}) VALUES ${placeholders}`,
      values,
    );
    inserted += chunk.length;
  }
  return inserted;
}

async function restoreDatabaseFromJson(dbJsonPath) {
  const payload = JSON.parse(fs.readFileSync(dbJsonPath, 'utf8'));
  const tables = payload.tables || {};
  const tableNames = Object.keys(tables).filter(safeTableName).sort();

  const [existingRows] = await db.query(
    `SELECT TABLE_NAME AS table_name
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  );
  const existing = new Set(existingRows.map((r) => String(r.table_name)));

  const conn = await db.getConnection();
  const restored = [];
  const skipped = [];
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tableNames) {
      if (!existing.has(table)) {
        skipped.push({ table, reason: '当前库无此表' });
        continue;
      }
      const count = await restoreTableRows(conn, table, tables[table]);
      restored.push({ table, rows: count });
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } catch (err) {
    try {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } catch (_) {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }

  return {
    restored,
    skipped,
    totalRows: restored.reduce((s, x) => s + x.rows, 0),
    tableCount: restored.length,
  };
}

module.exports = {
  restoreDatabaseFromJson,
};
