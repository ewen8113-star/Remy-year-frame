/**
 * 出库单：物流公司（字典供应商名称）
 * 用法：npm run migrate:inv-outbound-logistics-supplier
 */
require('dotenv').config();
const db = require('../config/database');

(async () => {
  try {
    await db.query(
      "ALTER TABLE inv_outbound_orders ADD COLUMN logistics_supplier VARCHAR(120) NULL COMMENT '物流公司（字典供应商）' AFTER contact_phone"
    );
    console.log('已添加列 inv_outbound_orders.logistics_supplier');
  } catch (e) {
    const code = e && (e.code || e.errno);
    if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
      console.log('列 logistics_supplier 已存在，跳过');
    } else {
      console.error(e.message || e);
      process.exit(1);
    }
  }
  process.exit(0);
})();
