/**
 * 物资库存改为「全财年共用」：去掉 inv_warehouses / inv_outbound_orders 的 year_frame_id。
 * 若同一品牌+区域在多个财年各有一条仓，会合并到最小 id 的仓库并迁移物料与出库单引用。
 * 用法: npm run migrate:inventory-global-fiscal
 */
require('dotenv').config();
const db = require('../config/database');

async function columnExists(conn, table, col) {
  const [r] = await conn.query(
    `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, col]
  );
  return Number(r[0].c) > 0;
}

async function dropForeignKeyIfExists(conn, table, constraintName) {
  try {
    await conn.query(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${constraintName}\``);
    console.log(`  已删除外键 ${table}.${constraintName}`);
  } catch (e) {
    if (e && (e.code === 'ER_CANT_DROP_FIELD_OR_KEY' || String(e.message).includes('check that column/key exists'))) {
      console.log(`  跳过外键 ${constraintName}（不存在）`);
    } else throw e;
  }
}

async function mergeDuplicateWarehouses(conn) {
  const [dups] = await conn.query(`
    SELECT brand_id, region
    FROM inv_warehouses
    GROUP BY brand_id, region
    HAVING COUNT(*) > 1
  `);
  for (const r of dups) {
    const [whs] = await conn.query(
      'SELECT id FROM inv_warehouses WHERE brand_id = ? AND region = ? ORDER BY id ASC',
      [r.brand_id, r.region]
    );
    if (whs.length < 2) continue;
    const keeper = whs[0].id;
    for (let i = 1; i < whs.length; i++) {
      const oid = whs[i].id;
      await conn.query('UPDATE inv_items SET inv_warehouse_id = ? WHERE inv_warehouse_id = ?', [keeper, oid]);
      await conn.query('UPDATE inv_outbound_orders SET inv_warehouse_id = ? WHERE inv_warehouse_id = ?', [keeper, oid]);
      await conn.query('DELETE FROM inv_warehouses WHERE id = ?', [oid]);
      console.log(`  合并仓库 id ${oid} → ${keeper}（brand_id=${r.brand_id}, region=${r.region}）`);
    }
  }
}

async function run() {
  const conn = await db.getConnection();
  let ok = false;
  try {
    const hasWhYf = await columnExists(conn, 'inv_warehouses', 'year_frame_id');
    const hasObYf = await columnExists(conn, 'inv_outbound_orders', 'year_frame_id');
    if (!hasWhYf && !hasObYf) {
      console.log('ℹ️  inv_* 已是全财年共用结构，跳过');
      ok = true;
    } else {
      await conn.beginTransaction();

      if (hasWhYf) {
        await mergeDuplicateWarehouses(conn);
        await dropForeignKeyIfExists(conn, 'inv_warehouses', 'fk_inv_wh_yf');
        try {
          await conn.query('ALTER TABLE inv_warehouses DROP INDEX uq_inv_wh');
        } catch (e) {
          console.log('  跳过删除 uq_inv_wh:', e.message);
        }
        await conn.query('ALTER TABLE inv_warehouses DROP COLUMN year_frame_id');
        try {
          await conn.query(
            'ALTER TABLE inv_warehouses ADD UNIQUE KEY uq_inv_wh_global (brand_id, region)'
          );
        } catch (e) {
          if (e && e.code === 'ER_DUP_KEYNAME') {
            console.log('  唯一索引 uq_inv_wh_global 已存在，跳过');
          } else throw e;
        }
        console.log('✅ inv_warehouses 已去掉 year_frame_id');
      }

      if (hasObYf) {
        await dropForeignKeyIfExists(conn, 'inv_outbound_orders', 'fk_inv_ob_yf');
        await conn.query('ALTER TABLE inv_outbound_orders DROP COLUMN year_frame_id');
        console.log('✅ inv_outbound_orders 已去掉 year_frame_id');
      }

      await conn.commit();
      console.log('✅ 物资库存全财年共用迁移完成');
      ok = true;
    }
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error(e);
    ok = false;
  } finally {
    conn.release();
  }
  process.exit(ok ? 0 : 1);
}

run();
