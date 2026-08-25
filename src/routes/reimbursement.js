const express = require('express');
const router = express.Router();
const importRoutes = require('../reimbursement/importRoutes');
const readRoutes = require('../reimbursement/readRoutes');
const actionRoutes = require('../reimbursement/actionRoutes');
const createRoutes = require('../reimbursement/createRoutes');
const updateRoutes = require('../reimbursement/updateRoutes');

router.use('/', importRoutes);
router.use('/', readRoutes);
router.use('/', actionRoutes);
router.use('/', createRoutes);
router.use('/', updateRoutes);

module.exports = router;
