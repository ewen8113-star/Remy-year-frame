const express = require('express');
const multer = require('multer');
const router = express.Router();
const db = require('../config/database');
const { importActivitiesFromExcelBuffer } = require('../activity/importActivitiesFromExcel');
const { todayYmd, formatDateTimeMinute } = require('../lib/businessTime');

const activityImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    const ok = name.endsWith('.xlsx') || name.endsWith('.xls');
    cb(ok ? null : new Error('仅支持 .xlsx 或 .xls 文件'), ok);
  },
});

/** 兼容全角字符、BOM、零宽；再 trim */
function cleanStatusInput(v) {
  if (v == null) return '';
  return String(v)
    .normalize('NFKC')
    .replace(/^\uFEFF+/, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
}

/** 允许写入库的状态（与 lookup activity_status 及业务一致）；列类型为 VARCHAR 或 ENUM 均按此白名单解析 */
const APP_STATUS_WHITELIST = new Set(['pending', 'deferred', 'completed', 'cancelled']);

function canonicalStatusFromInput(s) {
  const lo = s.toLowerCase();
  if (s === '延期') return 'deferred';
  if (lo === 'done') return 'completed';
  if (lo === 'canceled' || lo === 'cancelled') return 'cancelled';
  if (APP_STATUS_WHITELIST.has(lo)) return lo;
  return null;
}

function maybeAutoCompleteStatusByDate(status, dateStr) {
  const st = String(status || '').trim() || 'pending';
  const dt = String(dateStr || '').slice(0, 10);
  if (st !== 'pending' || !/^\d{4}-\d{2}-\d{2}$/.test(dt)) return st;
  return dt < todayYmd() ? 'completed' : st;
}

/**
 * 解析前端/lookup 提交的状态。
 * 不再依赖解析 SHOW COLUMNS（部分环境 Type 含 COLLATE 等导致 ENUM 解析为空，误判 deferred 无效）。
 * @returns {{ ok: true, value: string } | { ok: false, message: string } | { ok: false, message: null }}
 */
async function resolveActivityStatusForWrite(raw) {
  const s = cleanStatusInput(raw);
  if (s === '') return { ok: false, message: null };

  let v = canonicalStatusFromInput(s);
  if (v && APP_STATUS_WHITELIST.has(v)) return { ok: true, value: v };

  const [rows] = await db.query(
    `SELECT TRIM(value) AS value FROM lookup_options
     WHERE category = 'activity_status' AND is_active = 1
       AND (TRIM(value) = ? OR TRIM(label) = ? OR LOWER(TRIM(value)) = ?)
     LIMIT 1`,
    [s, s, s.toLowerCase()]
  );
  if (rows.length) {
    const val = String(rows[0].value).trim();
    const lo = val.toLowerCase();
    const mapped = canonicalStatusFromInput(val) || (APP_STATUS_WHITELIST.has(lo) ? lo : null);
    if (mapped && APP_STATUS_WHITELIST.has(mapped)) return { ok: true, value: mapped };
  }

  return { ok: false, message: null };
}

// 获取活动列表
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

    res.setHeader('Cache-Control', 'no-store');
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
    // 若用户把状态设为待执行，但日期已早于今天，则自动改为已完成
    if (req.body && (req.body.status !== undefined || req.body.date !== undefined)) {
      const [rows] = await db.query('SELECT date, status FROM activities WHERE id = ? LIMIT 1', [id]);
      const current = rows && rows[0] ? rows[0] : {};
      const effectiveDate = req.body.date !== undefined ? req.body.date : current.date;
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
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('DELETE FROM activities WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 自动将过期未完成场次置为已完成（仅 pending -> completed）
router.post('/auto-complete-overdue', async (req, res) => {
  try {
    const { yearFrameId } = req.body || {};
    const params = [];
    let sql = `
      UPDATE activities
      SET status = 'completed'
      WHERE status = 'pending'
        AND COALESCE(is_virtual, 0) = 0
        AND date IS NOT NULL
        AND date < CURDATE()
    `;
    if (yearFrameId) {
      sql += ' AND year_frame_id = ?';
      params.push(parseInt(yearFrameId, 10));
    }
    const [r] = await db.query(sql, params);
    res.json({
      updated: Number(r?.affectedRows || 0),
      message: `已自动完成 ${Number(r?.affectedRows || 0)} 条过期场次`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 批量更新状态
router.post('/batch-update-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: '请提供活动ID列表' });
    }
    if (status === undefined || status === null || String(status).trim() === '') {
      return res.status(400).json({ error: '请提供状态 status' });
    }
    const out = await resolveActivityStatusForWrite(status);
    if (!out.ok) {
      return res.status(400).json({
        error:
          out.message ||
          `无效的状态：${status}（请执行 npm run migrate:activity-status-to-varchar 或 migrate:activity-status-deferred 后重启 Node）`,
      });
    }

    const placeholders = ids.map(() => '?').join(',');
    await db.query(
      `UPDATE activities SET status = ? WHERE id IN (${placeholders})`,
      [out.value, ...ids]
    );
    
    res.json({ message: `成功更新 ${ids.length} 条记录` });
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

module.exports = router;
