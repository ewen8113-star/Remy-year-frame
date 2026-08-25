const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { ensureQuotationTables } = require('../quotation/ensureQuotationTables');
const exportRoutes = require('../quotation/exportRoutes');
const readRoutes = require('../quotation/readRoutes');
const bundleExportRoutes = require('../quotation/bundleExportRoutes');
const bundleCreateRoutes = require('../quotation/bundleCreateRoutes');
const detailActionRoutes = require('../quotation/detailActionRoutes');
const createRoutes = require('../quotation/createRoutes');
const updateRoutes = require('../quotation/updateRoutes');

router.use(async (req, res, next) => {
  try {
    await ensureQuotationTables(db);
    next();
  } catch (e) {
    res.status(500).json({ error: e.message || '报价表初始化失败' });
  }
});

router.use('/', readRoutes);
router.use('/', exportRoutes);
router.use('/', bundleExportRoutes);
router.use('/', bundleCreateRoutes);
router.use('/', detailActionRoutes);
router.use('/', createRoutes);
router.use('/', updateRoutes);

module.exports = router;
