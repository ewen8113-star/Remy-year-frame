const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { ensureInventoryTables } = require('../inventory/ensureInventoryTables');
const warehouseRoutes = require('../inventory/warehouseRoutes');
const wineAuditRoutes = require('../inventory/wineAuditRoutes');
const uploadRoutes = require('../inventory/uploadRoutes');
const hintRoutes = require('../inventory/hintRoutes');
const ledgerRoutes = require('../inventory/ledgerRoutes');
const wineUsageStatsRoutes = require('../inventory/wineUsageStatsRoutes');
const outboundPdfRoutes = require('../inventory/outboundPdfRoutes');
const outboundRepairRoutes = require('../inventory/outboundRepairRoutes');
const inboundRoutes = require('../inventory/inboundRoutes');
const inboundReceiptRoutes = require('../inventory/inboundReceiptRoutes');
const emptyBottleRoutes = require('../inventory/emptyBottleRoutes');
const itemUsageRoutes = require('../inventory/itemUsageRoutes');
const itemReadRoutes = require('../inventory/itemReadRoutes');
const outboundReadRoutes = require('../inventory/outboundReadRoutes');
const maintenanceRoutes = require('../inventory/maintenanceRoutes');
const itemWriteRoutes = require('../inventory/itemWriteRoutes');
const itemCatalogRoutes = require('../inventory/itemCatalogRoutes');
const outboundReturnRoutes = require('../inventory/outboundReturnRoutes');
const wineCatalogImportRoutes = require('../inventory/wineCatalogImportRoutes');
const outboundCreateRoutes = require('../inventory/outboundCreateRoutes');
const outboundUpdateRoutes = require('../inventory/outboundUpdateRoutes');

router.use(async (req, res, next) => {
  try {
    await ensureInventoryTables(db);
    next();
  } catch (e) {
    console.error('物资库存表初始化失败:', e);
    res.status(500).json({ error: e.message || '物资库存表初始化失败' });
  }
});

router.use('/warehouses', warehouseRoutes);
router.use('/wine-audit', wineAuditRoutes);
router.use('/upload', uploadRoutes);
router.use('/hints', hintRoutes);
router.use('/', ledgerRoutes);
router.use('/', wineUsageStatsRoutes);
router.use('/', outboundPdfRoutes);
router.use('/', outboundRepairRoutes);
router.use('/', inboundRoutes);
router.use('/', inboundReceiptRoutes);
router.use('/', emptyBottleRoutes);
router.use('/', itemUsageRoutes);
router.use('/', itemReadRoutes);
router.use('/', outboundReadRoutes);
router.use('/', maintenanceRoutes);
router.use('/', itemWriteRoutes);
router.use('/', itemCatalogRoutes);
router.use('/', outboundReturnRoutes);
router.use('/', wineCatalogImportRoutes);
router.use('/', outboundCreateRoutes);
router.use('/', outboundUpdateRoutes);

module.exports = router;
