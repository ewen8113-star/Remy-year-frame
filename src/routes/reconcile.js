/**
 * 临时对账 API：物流入账（报销入账二期）
 */
const express = require('express');
const router = express.Router();
const readRoutes = require('../reconcile/readRoutes');
const batchRoutes = require('../reconcile/batchRoutes');
const lineUpdateRoutes = require('../reconcile/lineUpdateRoutes');
const commitRoutes = require('../reconcile/commitRoutes');

router.use('/', readRoutes);
router.use('/', batchRoutes);
router.use('/', lineUpdateRoutes);
router.use('/', commitRoutes);

module.exports = router;
