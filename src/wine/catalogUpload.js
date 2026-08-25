const path = require('path');
const fs = require('fs');
const multer = require('multer');

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

module.exports = {
  wineCatalogUploadMulter,
};
