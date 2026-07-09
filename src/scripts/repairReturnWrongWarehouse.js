/**
 * 归还登记误入统一仓库：将库存从错误仓挪回各行物料原出库仓，并修正 return_item_id。
 *
 * 诊断（仅查看，不写库）：
 *   node src/scripts/repairReturnWrongWarehouse.js 79
 *
 * 执行修复：
 *   node src/scripts/repairReturnWrongWarehouse.js 79 --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const db = require('../config/database');

const MISMATCH_SQL = `
  SELECT
    rb.id AS batch_id,
    rb.outbound_order_id,
    rl.id AS return_line_id,
    rl.qty_return,
    ol.id AS outbound_line_id,
    src_it.id AS source_item_id,
    src_it.name AS item_name,
    src_wh.id AS should_wh_id,
    src_bi.brand_code AS should_brand,
    src_wh.region AS should_region,
    ret_it.id AS return_item_id,
    ret_wh.id AS actual_wh_id,
    ret_bi.brand_code AS actual_brand,
    ret_wh.region AS actual_region
  FROM inv_return_batches rb
  JOIN inv_return_lines rl ON rl.batch_id = rb.id
  JOIN inv_outbound_lines ol ON ol.id = rl.outbound_line_id
  JOIN inv_items src_it ON src_it.id = ol.item_id
  JOIN inv_warehouses src_wh ON src_wh.id = src_it.inv_warehouse_id
  JOIN brand_inventory src_bi ON src_bi.id = src_wh.brand_id
  JOIN inv_items ret_it ON ret_it.id = rl.return_item_id
  JOIN inv_warehouses ret_wh ON ret_wh.id = ret_it.inv_warehouse_id
  JOIN brand_inventory ret_bi ON ret_bi.id = ret_wh.brand_id
  WHERE rb.outbound_order_id = ?
    AND rl.qty_return > 0
    AND ret_wh.id <> src_wh.id
  ORDER BY rl.id
`;

async function main() {
  const orderId = parseInt(process.argv[2], 10);
  const apply = process.argv.includes('--apply');
  if (!Number.isFinite(orderId)) {
    console.error('用法: node src/scripts/repairReturnWrongWarehouse.js <出库单ID> [--apply]');
    process.exit(1);
  }

  const [rows] = await db.query(MISMATCH_SQL, [orderId]);
  if (!rows.length) {
    console.log(`出库单 #${orderId}：未发现归还仓错误的明细（qty_return>0 且 return_item 不在原出库仓）。`);
    process.exit(0);
  }

  console.log(`出库单 #${orderId}：共 ${rows.length} 行归还仓错误\n`);
  for (const r of rows) {
    const should = `${r.should_brand} ${r.should_region} (item#${r.source_item_id})`;
    const actual = `${r.actual_brand} ${r.actual_region} (item#${r.return_item_id})`;
    console.log(
      `  批次#${r.batch_id} 行#${r.return_line_id} 「${r.item_name}」 归还×${r.qty_return}\n` +
        `    应在: ${should}\n` +
        `    实际: ${actual}`
    );
  }

  if (!apply) {
    console.log('\n以上为预览。确认后执行: node src/scripts/repairReturnWrongWarehouse.js', orderId, '--apply');
    process.exit(0);
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let fixed = 0;
    for (const r of rows) {
      const qty = Number(r.qty_return) || 0;
      if (qty <= 0) continue;
      await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand - ? WHERE id = ?', [
        qty,
        r.return_item_id,
      ]);
      await conn.query('UPDATE inv_items SET quantity_on_hand = quantity_on_hand + ? WHERE id = ?', [
        qty,
        r.source_item_id,
      ]);
      await conn.query('UPDATE inv_return_lines SET return_item_id = ? WHERE id = ?', [
        r.source_item_id,
        r.return_line_id,
      ]);
      fixed += 1;
      console.log(`  ✓ 已修正 return_line #${r.return_line_id}：${qty} 件 ${r.item_name}`);
    }
    await conn.commit();
    console.log(`\n完成：已修正 ${fixed} 行归还明细，库存已从错误仓挪回原出库仓。`);
    console.log('提示：X.O 仓自动复制的物料行（如 item#371+）若库存已为 0 可后续手动清理，不影响业务。');
  } catch (e) {
    await conn.rollback();
    console.error('修复失败，已回滚:', e.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
