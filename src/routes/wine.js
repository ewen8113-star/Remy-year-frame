const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();
const db = require('../config/database');
const { ensureWineCatalog } = require('../wine/ensureWineCatalog');

let wineReturnTableReady = null;
function ensureWineReturnTable() {
  if (!wineReturnTableReady) {
    wineReturnTableReady = db.query(`
      CREATE TABLE IF NOT EXISTS wine_return_logs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        year_frame_id INT NOT NULL,
        usage_id INT NULL,
        activity_id INT NULL,
        wine_code VARCHAR(64) NOT NULL,
        wine_name VARCHAR(100) NOT NULL,
        spec VARCHAR(64) NULL,
        quantity INT NOT NULL,
        return_date DATE NOT NULL,
        operator VARCHAR(64) NULL,
        remarks TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
  }
  return wineReturnTableReady;
}

function parseCatalogImageUrls(row) {
  if (!row || row.image_urls == null) return [];
  try {
    const j = typeof row.image_urls === 'string' ? JSON.parse(row.image_urls) : row.image_urls;
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

router.use(async (req, res, next) => {
  try {
    await ensureWineCatalog(db);
    next();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || '酒品目录表初始化失败' });
  }
});

/** 酒品目录图片：物理目录 public/uploads/wine-catalog；静态 /uploads；DB wine_catalog.image_urls 存 /uploads/wine-catalog/文件名 */
const wineCatalogUploadDir = path.join(__dirname, '../../public/uploads/wine-catalog');
if (!fs.existsSync(wineCatalogUploadDir)) fs.mkdirSync(wineCatalogUploadDir, { recursive: true });
const wineCatalogStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, wineCatalogUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    const safe = `wc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, safe);
  },
});
const wineCatalogUploadMulter = multer({
  storage: wineCatalogStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('仅支持 jpeg/png/gif/webp 图片'), ok);
  },
});

router.post('/catalog/upload', (req, res) => {
  wineCatalogUploadMulter.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || '上传失败' });
    try {
      if (!req.file) return res.status(400).json({ error: '未选择文件' });
      const url = `/uploads/wine-catalog/${req.file.filename}`;
      res.json({ url, filename: req.file.filename });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: e.message || '上传失败' });
    }
  });
});

/** 酒品目录列表（无库存数量） */
router.get('/catalog', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM wine_catalog ORDER BY sort_order DESC, brand, name, id'
    );
    res.json(
      rows.map((r) => ({
        ...r,
        image_urls: parseCatalogImageUrls(r),
      }))
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '获取酒品目录失败' });
  }
});

/** 单条目录 */
router.get('/catalog/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [rows] = await db.query('SELECT * FROM wine_catalog WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    const r = rows[0];
    res.json({ ...r, image_urls: parseCatalogImageUrls(r) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '获取失败' });
  }
});

router.post('/catalog', async (req, res) => {
  try {
    const { brand, name, category, volume_label, image_urls, sku_code, sort_order } = req.body;
    const n = String(name || '').trim();
    if (!n) return res.status(400).json({ error: '请填写酒品名称' });
    let urls = image_urls;
    if (urls != null && !Array.isArray(urls)) urls = [];
    const sku = sku_code != null && String(sku_code).trim() !== '' ? String(sku_code).trim() : null;
    const [ret] = await db.query(
      `INSERT INTO wine_catalog (brand, name, category, volume_label, image_urls, sku_code, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        String(brand || '').trim(),
        n,
        category != null ? String(category).trim() || null : null,
        volume_label != null ? String(volume_label).trim() || null : null,
        JSON.stringify(Array.isArray(urls) ? urls : []),
        sku,
        Number.isFinite(parseInt(sort_order, 10)) ? parseInt(sort_order, 10) : 0,
      ]
    );
    const [rows] = await db.query('SELECT * FROM wine_catalog WHERE id = ?', [ret.insertId]);
    const r = rows[0];
    res.json({ ...r, image_urls: parseCatalogImageUrls(r) });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'SKU 编码已存在' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || '保存失败' });
  }
});

router.put('/catalog/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const { brand, name, category, volume_label, image_urls, sku_code, sort_order } = req.body;
    const n = name != null ? String(name).trim() : '';
    if (name !== undefined && !n) return res.status(400).json({ error: '名称不能为空' });
    const patches = [];
    const vals = [];
    if (brand !== undefined) {
      patches.push('brand = ?');
      vals.push(String(brand || '').trim());
    }
    if (name !== undefined) {
      patches.push('name = ?');
      vals.push(n);
    }
    if (category !== undefined) {
      patches.push('category = ?');
      vals.push(category != null ? String(category).trim() || null : null);
    }
    if (volume_label !== undefined) {
      patches.push('volume_label = ?');
      vals.push(volume_label != null ? String(volume_label).trim() || null : null);
    }
    if (image_urls !== undefined) {
      let arr = image_urls;
      if (arr != null && !Array.isArray(arr)) arr = [];
      patches.push('image_urls = ?');
      vals.push(JSON.stringify(Array.isArray(arr) ? arr : []));
    }
    if (sku_code !== undefined) {
      patches.push('sku_code = ?');
      vals.push(sku_code != null && String(sku_code).trim() !== '' ? String(sku_code).trim() : null);
    }
    if (sort_order !== undefined) {
      patches.push('sort_order = ?');
      vals.push(Number.isFinite(parseInt(sort_order, 10)) ? parseInt(sort_order, 10) : 0);
    }
    if (!patches.length) return res.status(400).json({ error: '无更新字段' });
    vals.push(id);
    await db.query(`UPDATE wine_catalog SET ${patches.join(', ')} WHERE id = ?`, vals);
    const [rows] = await db.query('SELECT * FROM wine_catalog WHERE id = ?', [id]);
    if (!rows.length) return res.status(404).json({ error: '记录不存在' });
    const r = rows[0];
    res.json({ ...r, image_urls: parseCatalogImageUrls(r) });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'SKU 编码已存在' });
    }
    console.error(err);
    res.status(500).json({ error: err.message || '更新失败' });
  }
});

router.delete('/catalog/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: '无效 ID' });
    const [r] = await db.query('DELETE FROM wine_catalog WHERE id = ?', [id]);
    if (!r.affectedRows) return res.status(404).json({ error: '记录不存在' });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '删除失败' });
  }
});

// 获取当前酒品库存列表（旧全局库存；新流程以酒品目录 + 分仓为准）
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT id, wine_code, wine_name, spec, quantity, unit_price, created_at, updated_at
      FROM wine_inventory
      ORDER BY wine_name, spec
    `);
    res.json(rows);
  } catch (err) {
    console.error('获取酒品库存失败:', err);
    res.status(500).json({ error: '获取酒品库存失败' });
  }
});

// 获取酒品入库记录
router.get('/stock-in', async (req, res) => {
  try {
    const { year_frame_id } = req.query;
    let sql = `
      SELECT id, year_frame_id, wine_code, wine_name, spec, quantity, supplier, batch_no,
             unit_price, total_amount, stock_in_date, operator, remarks, created_at
      FROM wine_stock_in
    `;
    const params = [];
    if (year_frame_id) {
      sql += ' WHERE year_frame_id = ?';
      params.push(year_frame_id);
    }
    sql += ' ORDER BY stock_in_date DESC, id DESC';
    
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('获取入库记录失败:', err);
    res.status(500).json({ error: '获取入库记录失败' });
  }
});

// 获取酒品使用记录
router.get('/usage', async (req, res) => {
  try {
    const { year_frame_id } = req.query;
    let sql = `
      SELECT id, year_frame_id, activity_id, wine_code, wine_name, spec, quantity,
             usage_date, client_name, operator, remarks, created_at
      FROM wine_usage
    `;
    const params = [];
    if (year_frame_id) {
      sql += ' WHERE year_frame_id = ?';
      params.push(year_frame_id);
    }
    sql += ' ORDER BY usage_date DESC, id DESC';
    
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('获取使用记录失败:', err);
    res.status(500).json({ error: '获取使用记录失败' });
  }
});

// 获取酒品归还记录
router.get('/returns', async (req, res) => {
  try {
    await ensureWineReturnTable();
    const { year_frame_id } = req.query;
    let sql = `
      SELECT id, year_frame_id, usage_id, activity_id, wine_code, wine_name, spec, quantity,
             return_date, operator, remarks, created_at
      FROM wine_return_logs
    `;
    const params = [];
    if (year_frame_id) {
      sql += ' WHERE year_frame_id = ?';
      params.push(year_frame_id);
    }
    sql += ' ORDER BY return_date DESC, id DESC';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error('获取归还记录失败:', err);
    res.status(500).json({ error: '获取归还记录失败' });
  }
});

// 酒品入库
router.post('/stock-in', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    
    const {
      year_frame_id,
      wine_code, wine_name, spec,
      quantity, unit_price = 0,
      supplier = '', batch_no = '',
      stock_in_date, operator = '', remarks = ''
    } = req.body;
    
    if (!year_frame_id || !wine_code || !quantity || !stock_in_date) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    
    const total_amount = quantity * unit_price;
    
    // 插入入库记录
    const [result] = await conn.query(`
      INSERT INTO wine_stock_in 
        (year_frame_id, wine_code, wine_name, spec, quantity, supplier, batch_no, 
         unit_price, total_amount, stock_in_date, operator, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [year_frame_id, wine_code, wine_name, spec, quantity, supplier, batch_no,
        unit_price, total_amount, stock_in_date, operator, remarks]);
    
    // 更新库存
    const [updateResult] = await conn.query(`
      UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?
    `, [quantity, wine_code]);
    
    if (updateResult.affectedRows === 0) {
      // 如果库存记录不存在，插入新的
      await conn.query(`
        INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
        VALUES (?, ?, ?, ?, ?)
      `, [wine_code, wine_name, spec, quantity, unit_price]);
    }
    
    await conn.commit();
    res.json({ id: result.insertId, message: '入库成功' });
  } catch (err) {
    await conn.rollback();
    console.error('入库失败:', err);
    res.status(500).json({ error: '入库失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 删除酒品入库记录（回滚库存）
async function handleDeleteWineStockIn(req, res) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ error: '无效记录ID' });
    }

    const [rows] = await conn.query('SELECT * FROM wine_stock_in WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: '入库记录不存在' });
    }
    const row = rows[0];
    const qty = parseInt(row.quantity, 10) || 0;

    // 回滚库存（允许出现负库存，保持与当前业务口径一致）
    await conn.query('UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?', [qty, row.wine_code]);
    await conn.query('DELETE FROM wine_stock_in WHERE id = ?', [id]);

    await conn.commit();
    res.json({ message: '入库记录已删除并回滚库存' });
  } catch (err) {
    await conn.rollback();
    console.error('删除入库记录失败:', err);
    res.status(500).json({ error: '删除入库记录失败: ' + err.message });
  } finally {
    conn.release();
  }
}
router.delete('/stock-in/:id', handleDeleteWineStockIn);
// 兼容某些环境对 DELETE 方法的限制
router.post('/stock-in/:id/delete', handleDeleteWineStockIn);

// 批量酒品入库
router.post('/stock-in/batch', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    
    const { year_frame_id, items = [], stock_in_date, operator = '', remarks = '' } = req.body;
    
    if (!year_frame_id || items.length === 0 || !stock_in_date) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    
    const results = [];
    for (const item of items) {
      const { wine_code, wine_name, spec, quantity, unit_price = 0, supplier = '', batch_no = '' } = item;
      if (!wine_code || !quantity) continue;
      
      const total_amount = quantity * unit_price;
      
      const [result] = await conn.query(`
        INSERT INTO wine_stock_in 
          (year_frame_id, wine_code, wine_name, spec, quantity, supplier, batch_no,
           unit_price, total_amount, stock_in_date, operator, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [year_frame_id, wine_code, wine_name, spec, quantity, supplier, batch_no,
          unit_price, total_amount, stock_in_date, operator, remarks]);
      
      await conn.query(`
        UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?
      `, [quantity, wine_code]);
      
      results.push({ wine_code, inserted_id: result.insertId });
    }
    
    await conn.commit();
    res.json({ message: '批量入库成功', count: results.length, items: results });
  } catch (err) {
    await conn.rollback();
    console.error('批量入库失败:', err);
    res.status(500).json({ error: '批量入库失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 记录酒品使用（从活动调用）
router.post('/usage', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    
    const {
      year_frame_id,
      activity_id = null,
      wine_code, wine_name, spec,
      quantity,
      usage_date,
      client_name = '',
      operator = '',
      remarks = ''
    } = req.body;
    
    if (!year_frame_id || !wine_code || !quantity || !usage_date) {
      return res.status(400).json({ error: '缺少必填字段' });
    }
    
    // 扣减库存：允许出现负库存（用于先申请后归还的业务场景）
    const [updateResult] = await conn.query(`
      UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?
    `, [quantity, wine_code]);
    if (updateResult.affectedRows === 0) {
      // 若库存记录不存在，创建后直接记为负库存
      await conn.query(
        `INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
         VALUES (?, ?, ?, ?, 0)`,
        [wine_code, wine_name || wine_code, spec || '', -Number(quantity || 0)]
      );
    }
    
    // 插入使用记录
    const [result] = await conn.query(`
      INSERT INTO wine_usage 
        (year_frame_id, activity_id, wine_code, wine_name, spec, quantity, 
         usage_date, client_name, operator, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [year_frame_id, activity_id, wine_code, wine_name, spec, quantity,
        usage_date, client_name, operator, remarks]);
    
    await conn.commit();
    res.json({ id: result.insertId, message: '使用记录已保存' });
  } catch (err) {
    await conn.rollback();
    console.error('记录使用失败:', err);
    res.status(500).json({ error: '记录使用失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 删除使用记录（退货/回补库存）
router.delete('/usage/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    
    const { id } = req.params;
    
    // 获取使用记录
    const [rows] = await conn.query('SELECT * FROM wine_usage WHERE id = ?', [id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: '记录不存在' });
    }
    
    const record = rows[0];
    
    // 回补库存
    await conn.query(`
      UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?
    `, [record.quantity, record.wine_code]);
    
    // 删除记录
    await conn.query('DELETE FROM wine_usage WHERE id = ?', [id]);
    
    await conn.commit();
    res.json({ message: '已删除并回补库存' });
  } catch (err) {
    await conn.rollback();
    console.error('删除失败:', err);
    res.status(500).json({ error: '删除失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 修改使用记录（按差量修正库存）
router.put('/usage/:id', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { id } = req.params;
    const {
      year_frame_id,
      activity_id = null,
      wine_code, wine_name, spec,
      quantity,
      usage_date,
      client_name = '',
      operator = '',
      remarks = ''
    } = req.body;

    if (!year_frame_id || !wine_code || !quantity || !usage_date) {
      await conn.rollback();
      return res.status(400).json({ error: '缺少必填字段' });
    }

    const newQty = parseInt(quantity, 10) || 0;
    if (newQty <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: '使用数量必须大于 0' });
    }

    const [oldRows] = await conn.query('SELECT * FROM wine_usage WHERE id = ?', [id]);
    if (oldRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: '记录不存在' });
    }
    const old = oldRows[0];

    if (old.wine_code === wine_code) {
      // 同酒品：按增量扣减/回补库存
      const delta = newQty - (parseInt(old.quantity, 10) || 0);
      const [upd] = await conn.query('UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?', [delta, wine_code]);
      if (upd.affectedRows === 0) {
        await conn.query(
          `INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
           VALUES (?, ?, ?, ?, 0)`,
          [wine_code, wine_name || wine_code, spec || '', -delta]
        );
      }
    } else {
      // 变更酒品：先回补旧酒品，再扣减新酒品
      await conn.query('UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?', [old.quantity, old.wine_code]);
      const [upd] = await conn.query('UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?', [newQty, wine_code]);
      if (upd.affectedRows === 0) {
        await conn.query(
          `INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
           VALUES (?, ?, ?, ?, 0)`,
          [wine_code, wine_name || wine_code, spec || '', -newQty]
        );
      }
    }

    await conn.query(`
      UPDATE wine_usage SET
        year_frame_id = ?, activity_id = ?, wine_code = ?, wine_name = ?, spec = ?,
        quantity = ?, usage_date = ?, client_name = ?, operator = ?, remarks = ?
      WHERE id = ?
    `, [
      year_frame_id,
      activity_id,
      wine_code,
      wine_name,
      spec,
      newQty,
      usage_date,
      client_name,
      operator,
      remarks,
      id
    ]);

    await conn.commit();
    res.json({ message: '使用记录已更新' });
  } catch (err) {
    await conn.rollback();
    console.error('更新使用记录失败:', err);
    res.status(500).json({ error: '更新失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 部分归还使用量：回补库存并减少使用记录数量
router.post('/usage/:id/return', async (req, res) => {
  const conn = await db.getConnection();
  try {
    await ensureWineReturnTable();
    await conn.beginTransaction();
    const { id } = req.params;
    const returnQty = parseInt(req.body?.quantity, 10) || 0;
    const returnRemark = String(req.body?.remarks || '').trim();
    if (returnQty <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: '归还数量必须大于 0' });
    }

    const [rows] = await conn.query('SELECT * FROM wine_usage WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: '使用记录不存在' });
    }
    const old = rows[0];
    const oldQty = parseInt(old.quantity, 10) || 0;
    if (returnQty > oldQty) {
      await conn.rollback();
      return res.status(400).json({ error: '归还数量不能超过本条使用数量' });
    }

    const [upd] = await conn.query(
      'UPDATE wine_inventory SET quantity = quantity + ? WHERE wine_code = ?',
      [returnQty, old.wine_code]
    );
    if (upd.affectedRows === 0) {
      await conn.query(
        `INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
         VALUES (?, ?, ?, ?, 0)`,
        [old.wine_code, old.wine_name || old.wine_code, old.spec || '', returnQty]
      );
    }

    const remained = oldQty - returnQty;
    if (remained <= 0) {
      await conn.query('DELETE FROM wine_usage WHERE id = ?', [id]);
    } else {
      const mergedRemark = [old.remarks, returnRemark ? `归还${returnQty}瓶：${returnRemark}` : `归还${returnQty}瓶`]
        .filter(Boolean)
        .join('；');
      await conn.query(
        'UPDATE wine_usage SET quantity = ?, remarks = ? WHERE id = ?',
        [remained, mergedRemark, id]
      );
    }

    await conn.query(
      `INSERT INTO wine_return_logs
        (year_frame_id, usage_id, activity_id, wine_code, wine_name, spec, quantity, return_date, operator, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), ?, ?)`,
      [
        old.year_frame_id || 1,
        old.id,
        old.activity_id || null,
        old.wine_code,
        old.wine_name || old.wine_code,
        old.spec || '',
        returnQty,
        String(req.body?.operator || '').trim() || null,
        returnRemark || null,
      ]
    );

    await conn.commit();
    return res.json({ message: `已归还 ${returnQty} 瓶并回补库存` });
  } catch (err) {
    await conn.rollback();
    console.error('归还酒品失败:', err);
    return res.status(500).json({ error: '归还酒品失败: ' + err.message });
  } finally {
    conn.release();
  }
});

// 删除归还记录（回滚归还动作：库存减回、用酒数量补回）
async function handleDeleteWineReturn(req, res) {
  const conn = await db.getConnection();
  try {
    await ensureWineReturnTable();
    await conn.beginTransaction();
    const id = parseInt(req.params.id, 10);
    if (!id) {
      await conn.rollback();
      return res.status(400).json({ error: '无效记录ID' });
    }

    const [rows] = await conn.query('SELECT * FROM wine_return_logs WHERE id = ? FOR UPDATE', [id]);
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: '归还记录不存在' });
    }
    const row = rows[0];
    const qty = parseInt(row.quantity, 10) || 0;
    if (qty <= 0) {
      await conn.rollback();
      return res.status(400).json({ error: '归还数量异常，无法删除' });
    }

    // 1) 回滚库存增加：减回已归还数量
    const [invUpd] = await conn.query(
      'UPDATE wine_inventory SET quantity = quantity - ? WHERE wine_code = ?',
      [qty, row.wine_code]
    );
    if (invUpd.affectedRows === 0) {
      await conn.query(
        `INSERT INTO wine_inventory (wine_code, wine_name, spec, quantity, unit_price)
         VALUES (?, ?, ?, ?, 0)`,
        [row.wine_code, row.wine_name || row.wine_code, row.spec || '', -qty]
      );
    }

    // 2) 补回用酒记录数量（若原记录已删，则重建一条）
    let usagePatched = false;
    if (row.usage_id) {
      const [usageUpd] = await conn.query(
        'UPDATE wine_usage SET quantity = quantity + ? WHERE id = ? AND wine_code = ?',
        [qty, row.usage_id, row.wine_code]
      );
      usagePatched = usageUpd.affectedRows > 0;
    }
    if (!usagePatched) {
      await conn.query(
        `INSERT INTO wine_usage
          (year_frame_id, activity_id, wine_code, wine_name, spec, quantity, usage_date, client_name, operator, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
        [
          row.year_frame_id || 1,
          row.activity_id || null,
          row.wine_code,
          row.wine_name || row.wine_code,
          row.spec || '',
          qty,
          row.return_date || new Date(),
          String(req.body?.operator || '').trim() || null,
          `由删除归还记录 #${id} 自动恢复`,
        ]
      );
    }

    await conn.query('DELETE FROM wine_return_logs WHERE id = ?', [id]);
    await conn.commit();
    return res.json({ message: '归还记录已删除并回滚库存/用酒数据' });
  } catch (err) {
    await conn.rollback();
    console.error('删除归还记录失败:', err);
    return res.status(500).json({ error: '删除归还记录失败: ' + err.message });
  } finally {
    conn.release();
  }
}
router.delete('/returns/:id', handleDeleteWineReturn);
router.post('/returns/:id/delete', handleDeleteWineReturn);

// 更新库存（手动调整）
router.put('/:wine_code', async (req, res) => {
  try {
    const { wine_code } = req.params;
    const { quantity, unit_price } = req.body;
    
    const updates = [];
    const params = [];
    if (quantity !== undefined) { updates.push('quantity = ?'); params.push(quantity); }
    if (unit_price !== undefined) { updates.push('unit_price = ?'); params.push(unit_price); }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: '没有需要更新的字段' });
    }
    
    params.push(wine_code);
    await db.query(`UPDATE wine_inventory SET ${updates.join(', ')} WHERE wine_code = ?`, params);
    
    res.json({ message: '更新成功' });
  } catch (err) {
    console.error('更新失败:', err);
    res.status(500).json({ error: '更新失败' });
  }
});

module.exports = router;
