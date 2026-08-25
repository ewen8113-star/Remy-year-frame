const express = require('express');
const router = express.Router();
const optionsRoutes = require('../dashboard/optionsRoutes');
const { getDashboard } = require('../dashboard/dataHandler');

router.use('/', optionsRoutes);
router.get('/', getDashboard);

module.exports = router;
