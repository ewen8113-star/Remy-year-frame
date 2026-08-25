/**
 * 成本管理路由
 *
 * 口径：场次成本为 activities.total_cost；各板块「公共池」为 merged_into_activity=0 的仓储/物流/采购/维修/报销金额。
 * 已合并进场次的报销同步写入 cost_details，不在此重复加计 reimb 公共池；看板场次维度仅解析活动 cost_details。
 */

const express = require('express');
const router = express.Router();
const summaryRoutes = require('../cost/summaryRoutes');
const analyticsRoutes = require('../cost/analyticsRoutes');

router.use('/', summaryRoutes);
router.use('/', analyticsRoutes);

module.exports = router;
