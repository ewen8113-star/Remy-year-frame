/**
 * 物流回收费用：回收日期、回收运费、回收操作费（fee 为出货+回收合计）
 * 用法：npm run migrate:logistics-return-fees
 */
require('dotenv').config();
const db = require('../config/database');

const columns = [
  "ALTER TABLE logistics ADD COLUMN return_date DATE NULL COMMENT '物料回收日期' AFTER handling_fee",
  "ALTER TABLE logistics ADD COLUMN return_shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '回收运费' AFTER return_date",
  "ALTER TABLE logistics ADD COLUMN return_handling_fee DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '回收操作费' AFTER return_shipping_fee",
];

(async () => {
  try {
    for (const sql of columns) {
      try {
        await db.query(sql);
        console.log('OK:', sql.slice(0, 90) + '…');
      } catch (e) {
        const code = e && (e.code || e.errno);
        if (code === 'ER_DUP_FIELDNAME' || code === 1060) {
          console.log('列已存在，跳过');
        } else {
          throw e;
        }
      }
    }
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
  process.exit(0);
})();
