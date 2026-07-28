const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { ensureActivityQuotedPriceFromQuotations, syncQuotationProjectCodesFromActivity } = require('../quotation/syncQuotationToActivities');
const {
  maybeAutoCompleteStatusByDate,
  resolveActivityStatusForWrite,
} = require('../activity/routeHelpers');
const maintenanceRoutes = require('../activity/maintenanceRoutes');
const readRoutes = require('../activity/readRoutes');

router.use('/', maintenanceRoutes);
router.use('/', readRoutes);

// 创建活动
router.post('/', async (req, res) => {
  try {
    const {
      year_frame_id, year_frame_code, project_code, activity_type,
      city, brand, client, client_name, venue, date, period, region, belonging, guest_count,
      quoted_price, executor, brand_ambassador, remarks, wine_details, cloud_album_url, cloudAlbumUrl,
      is_virtual,
    } = req.body;
    const cloudAlbumUrlFinal = String(cloud_album_url != null ? cloud_album_url : cloudAlbumUrl || '').trim() || null;
    const brandAmbassadorFinal = String(brand_ambassador || '').trim() || null;
    const virtualFlag = req.body && (is_virtual === 1 || is_virtual === true || String(is_virtual) === '1') ? 1 : 0;
    if (virtualFlag !== 1 && !String(date || '').trim()) {
      return res.status(400).json({ error: '活动日期为必填项' });
    }

    const finalStatus =
      virtualFlag === 1 ? 'pending' : maybeAutoCompleteStatusByDate('pending', date);
    const [result] = await db.query(`
      INSERT INTO activities (
        year_frame_id, year_frame_code, project_code, activity_type,
        city, brand, client, client_name, venue, date, period, region, belonging, guest_count,
        quoted_price, executor, brand_ambassador, status, remarks, wine_details, cloud_album_url,
        is_virtual
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      year_frame_id, year_frame_code, project_code, activity_type,
      city, brand, client, client_name, venue, date, period || '日常', region || null, belonging || null, guest_count,
      quoted_price, executor, brandAmbassadorFinal, finalStatus, remarks, JSON.stringify(wine_details || {}), cloudAlbumUrlFinal,
      virtualFlag,
    ]);
    
    res.json({ id: result.insertId, message: '创建成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 更新活动
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (req.body && req.body.status !== undefined) {
      if (req.body.status === '' || req.body.status === null) {
        delete req.body.status;
      } else {
        const out = await resolveActivityStatusForWrite(req.body.status);
        if (!out.ok) {
          return res.status(400).json({
            error:
              out.message ||
              `无效的状态：${req.body.status}（请执行 npm run migrate:activity-status-to-varchar 或 migrate:activity-status-deferred 后重启 Node）`,
          });
        }
        req.body.status = out.value;
      }
    }
    if (req.body && req.body.cloudAlbumUrl !== undefined && req.body.cloud_album_url === undefined) {
      req.body.cloud_album_url = req.body.cloudAlbumUrl;
    }
    if (req.body && req.body.brand_ambassador !== undefined) {
      req.body.brand_ambassador = String(req.body.brand_ambassador || '').trim() || null;
    }
    const [existingRows] = await db.query(
      'SELECT date, status, is_virtual FROM activities WHERE id = ? LIMIT 1',
      [id]
    );
    const current = existingRows && existingRows[0] ? existingRows[0] : {};
    const willBeVirtual =
      req.body && req.body.is_virtual !== undefined
        ? req.body.is_virtual === 1 || req.body.is_virtual === true || String(req.body.is_virtual) === '1'
          ? 1
          : 0
        : Number(current.is_virtual) === 1
          ? 1
          : 0;
    const effectiveDate = req.body && req.body.date !== undefined ? req.body.date : current.date;
    if (willBeVirtual !== 1 && !String(effectiveDate || '').trim()) {
      return res.status(400).json({ error: '活动日期为必填项' });
    }
    // 若用户把状态设为待执行，但日期已早于今天，则自动改为已完成
    if (req.body && (req.body.status !== undefined || req.body.date !== undefined)) {
      const effectiveStatus = req.body.status !== undefined ? req.body.status : current.status;
      const autoStatus = maybeAutoCompleteStatusByDate(effectiveStatus, effectiveDate);
      if (String(autoStatus) !== String(effectiveStatus)) {
        req.body.status = autoStatus;
      }
    }
    const allowedFields = [
      'year_frame_code',
      'project_code',
      'activity_type',
      'city',
      'brand',
      'client',
      'client_name',
      'venue',
      'date',
      'period',
      'region',
      'belonging',
      'guest_count',
      'quoted_price',
      'total_cost',
      'no_cost',
      'executor',
      'brand_ambassador',
      'status',
      'remarks',
      'wine_details',
      'cost_details',
      'cloud_album_url',
      'is_virtual',
    ];

    const keys = Object.keys(req.body || {}).filter(
      (k) => allowedFields.includes(k) && req.body[k] !== undefined
    );

    if (keys.length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }

    const setClause = keys.map((k) => `${k} = ?`).join(', ');
    const params = keys.map((k) => {
      if (k === 'wine_details' || k === 'cost_details') return JSON.stringify(req.body[k] || {});
      if (k === 'no_cost') return req.body[k] ? 1 : 0;
      if (k === 'is_virtual') return req.body[k] ? 1 : 0;
      return req.body[k];
    });

    params.push(id);

    await db.query(`UPDATE activities SET ${setClause} WHERE id = ?`, params);

    if (keys.includes('project_code')) {
      const pc = String(req.body.project_code || '').trim();
      if (pc) await syncQuotationProjectCodesFromActivity(db, id, pc);
    }
    await ensureActivityQuotedPriceFromQuotations(db, id);

    res.json({ message: '更新成功' });
  } catch (error) {
    const msg = error && error.message ? String(error.message) : '';
    if (/Data truncated|Incorrect.*status|1265|1366/i.test(msg)) {
      return res.status(400).json({
        error:
          '无法保存状态：当前库 activities.status 列仍为 ENUM 且不含「延期」。请执行 npm run migrate:activity-status-to-varchar（推荐）或 migrate:activity-status-deferred，然后重启 Node。',
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// 删除活动

module.exports = router;
