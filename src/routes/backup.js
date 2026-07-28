const express = require('express');
const router = express.Router();
const fullBackupRoutes = require('../backup/fullBackupRoutes');
const legacyBackupRoutes = require('../backup/legacyBackupRoutes');

router.use('/', fullBackupRoutes);
router.use('/', legacyBackupRoutes);

module.exports = router;
