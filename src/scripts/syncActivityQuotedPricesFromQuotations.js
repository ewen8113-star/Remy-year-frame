/**
 * 按年框将活动报价同步回 activities.quoted_price（幂等，可重复执行）
 * 用法：node src/scripts/syncActivityQuotedPricesFromQuotations.js [yearFrameId]
 */
require('dotenv').config();
const db = require('../config/database');
const { syncYearFrameQuotedPricesFromQuotations } = require('../quotation/syncQuotationToActivities');

(async () => {
  const arg = process.argv[2];
  let yearFrameIds = [];
  if (arg) {
    const id = parseInt(arg, 10);
    if (!Number.isFinite(id)) {
      console.error('yearFrameId 无效');
      process.exit(1);
    }
    yearFrameIds = [id];
  } else {
    const [frames] = await db.query('SELECT id, year, name FROM year_frames ORDER BY id');
    yearFrameIds = frames.map((f) => f.id);
    console.log('未指定 yearFrameId，将处理全部年框:', frames.map((f) => `${f.id}(${f.year})`).join(', '));
  }

  for (const yfId of yearFrameIds) {
    const result = await syncYearFrameQuotedPricesFromQuotations(db, yfId);
    const [sumRow] = await db.query(
      `SELECT COALESCE(SUM(quoted_price), 0) AS revenue, COUNT(*) AS cnt
       FROM activities WHERE year_frame_id = ? AND COALESCE(is_virtual, 0) = 0`,
      [yfId]
    );
    console.log(
      `年框 #${yfId}: 更新 ${result.updated}/${result.total} 条场次报价；当前报价合计 ¥${Number(sumRow[0].revenue).toFixed(2)}（${sumRow[0].cnt} 场）`
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
