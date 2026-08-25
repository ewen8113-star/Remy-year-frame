const path = require('path');
const fs = require('fs');
const multer = require('multer');

/** 物料图片物理目录（相对项目根：public/uploads/inventory）；静态由 express 提供 /uploads；DB inv_items.image_urls 存 /uploads/inventory/文件名 */
const uploadDir = path.join(__dirname, '../../public/uploads/inventory');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    const safe = `inv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, safe);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
    cb(ok ? null : new Error('仅支持 jpeg/png/gif/webp 图片'), ok);
  },
});

module.exports = {
  upload,
  uploadDir,
};
