const express = require('express');
const multer = require('multer');
const db = require('../config/database');
const { importActivitiesFromExcelBuffer } = require('./importActivitiesFromExcel');
const { formatDateTimeMinute } = require('../lib/businessTime');
const { ensureActivityQuotedPriceFromQuotations } = require('../quotation/syncQuotationToActivities');

const router = express.Router();
const activityImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const ok = name.endsWith('.xlsx') || name.endsWith('.xls');
    cb(ok ? null : new Error('仅支持 .xlsx 或 .xls 文件'), ok);
  },
});

router.get('/', async (req, res) => {
  try {
    const {
      yearFrameId,
      activityType,
      city,
      brand,
      status,
      sortBy = 'date',
      sortOrder = 'DESC',
      isVirtual,
      region,
    } = req.query;

    let sql = `
      SELECT a.*, yf.year as year_frame_name
      FROM activities a
      LEFT JOIN year_frames yf ON a.year_frame_id = yf.id
      WHERE 1=1
    `;
    const params = [];

    if (String(isVirtual) === '1') {
      sql += ' AND COALESCE(a.is_virtual, 0) = 1';
    } else {
      sql += ' AND COALESCE(a.is_virtual, 0) = 0';
    }

    if (yearFrameId) {
      sql += ' AND a.year_frame_id = ?';
      params.push(yearFrameId);
    }
    if (region) {
      sql += " AND TRIM(COALESCE(a.region, '')) = ?";
      params.push(String(region).trim());
    }
    if (activityType) {
      sql += ' AND a.activity_type = ?';
      params.push(activityType);
    }
    if (city) {
      sql += ' AND a.city LIKE ?';
      params.push(`%${city}%`);
    }
    if (brand) {
      sql += ' AND a.brand = ?';
      params.push(brand);
    }
    if (status) {
      sql += ' AND a.status = ?';
      params.push(status);
    }

    // 排序
    const validSortColumns = ['date', 'activity_date', 'city', 'brand', 'quoted_price', 'total_cost', 'created_at'];
    const sortColumnRaw = validSortColumns.includes(sortBy) ? sortBy : 'date';
    const sortColumn = sortColumnRaw === 'activity_date' ? 'date' : sortColumnRaw;
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    sql += ` ORDER BY a.${sortColumn} ${order}`;

    const [rows] = await db.query(sql, params);
    res.setHeader('Cache-Control', 'no-store');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量导入场次（Excel，一行一场）
router.post('/import', (req, res) => {
  activityImportUpload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || '文件上传失败' });
    }
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: '请选择要导入的 Excel 文件' });
    }
    try {
      const defaultYearFrameId = req.body && req.body.yearFrameId != null ? Number(req.body.yearFrameId) : null;
      const result = await importActivitiesFromExcelBuffer(req.file.buffer, {
        defaultYearFrameId: Number.isFinite(defaultYearFrameId) ? defaultYearFrameId : null,
      });
      const atBj = formatDateTimeMinute(new Date());
      res.json({
        data: result,
        importedAtBeijing: atBj,
        message: `导入完成（北京时间 ${atBj}）：成功 ${result.createdCount} 条，跳过 ${result.skippedCount} 条，失败 ${result.failedCount} 条`,
      });
    } catch (error) {
      res.status(400).json({ error: error.message || '导入失败' });
    }
  });
});

// 场次成本明细来源（按类别汇总，用于成本详情点击展开）
router.get('/:id/cost-sources', async (req, res) => {
  try {
    const aid = parseInt(req.params.id, 10);
    if (!Number.isFinite(aid)) return res.status(400).json({ error: '无效场次 ID' });

    const COST_KEYS = [
      'supervisor', 'pg', 'parttime', 'bartender', 'photo', 'cloud_album_edit', 'performance', 'makeup',
      'travel_supervisor', 'travel_company',
      'structure', 'av', 'print', 'spray',
      'floral', 'payment', 'tasting', 'venue_fee', 'meal_fee', 'other_advance',
      'warehouse', 'express', 'logistics', 'advance_offset',
    ];

    function round2(n) {
      return Math.round((parseFloat(n) || 0) * 100) / 100;
    }
    function parseCostDetails(raw) {
      if (!raw) return {};
      if (typeof raw === 'object') return raw;
      try { return JSON.parse(raw) || {}; } catch { return {}; }
    }

    const [rows] = await db.query(
      `SELECT r.id, r.payee_name, r.amount, r.cost_details, r.payment_order_id, r.date,
              po.order_no AS payment_order_no
       FROM reimbursements r
       LEFT JOIN payment_orders po ON po.id = r.payment_order_id
       WHERE r.activity_id = ? AND COALESCE(r.merged_into_activity, 0) = 1
       ORDER BY r.date ASC, r.id ASC`,
      [aid]
    );

    const byCategory = {};
    COST_KEYS.forEach((k) => { byCategory[k] = []; });

    rows.forEach((r) => {
      const details = parseCostDetails(r.cost_details);
      COST_KEYS.forEach((key) => {
        const amt = round2(details[key]);
        if (amt === 0) return;
        const poId = r.payment_order_id ? Number(r.payment_order_id) : null;
        byCategory[key].push({
          source_type: 'reimbursement',
          source_id: Number(r.id),
          payee_name: String(r.payee_name || '').trim() || '（未填）',
          amount: amt,
          payment_order_id: poId,
          payment_order_no: r.payment_order_no ? String(r.payment_order_no) : null,
          label: poId && r.payment_order_no
            ? `付款单 ${r.payment_order_no}`
            : `成本登记 #${r.id}`,
        });
      });
    });

    res.json({ data: byCategory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 获取单个活动
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `
      SELECT a.*, yf.year as year_frame_name
      FROM activities a
      LEFT JOIN year_frames yf ON a.year_frame_id = yf.id
      WHERE a.id = ?
    `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: '活动不存在' });
    }

    const row = rows[0];
    if (Number(row.is_virtual) !== 1) {
      const synced = await ensureActivityQuotedPriceFromQuotations(db, id);
      if (synced != null) row.quoted_price = synced;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json(row);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
