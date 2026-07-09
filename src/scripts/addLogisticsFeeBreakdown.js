/**
 * 物流费用拆分：运费 + 操作费（fee 仍为合计，兼容看板/成本汇总）
 * 用法：npm run migrate:logistics-fee-breakdown
 */
require('dotenv').config();
const db = require('../config/database');

const columns = [
  "ALTER TABLE logistics ADD COLUMN shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '运费' AFTER fee",
  "ALTER TABLE logistics ADD COLUMN handling_fee DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '操作费' AFTER shipping_fee",
];

(async () => {
  try {
    for (const sql of columns) {
      try {
        await db.query(sql);
        console.log('OK:', sql.slice(0, 80) + '…');
      } catch (e) {
        const code = e && (e.code || e.errno);
        if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
          console.log('列已存在，跳过');
        } else {
          throw e;
        }
      }
    }
    const [ret] = await db.query(
      `UPDATE logistics
       SET shipping_fee = COALESCE(fee, 0)
       WHERE COALESCE(shipping_fee, 0) = 0 AND COALESCE(handling_fee, 0) = 0 AND COALESCE(fee, 0) <> 0`
    );
    console.log(`历史数据回填 shipping_fee：${ret.affectedRows || 0} 条`);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
  process.exit(0);
})();
