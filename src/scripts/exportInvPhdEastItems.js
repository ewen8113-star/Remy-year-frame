/**
 * 导出指定物资仓库物料清单为 Excel（含首图嵌入）。
 * 用法：
 *   node src/scripts/exportInvPhdEastItems.js
 *   OUT=/path/to/out.xlsx node src/scripts/exportInvPhdEastItems.js
 *
 * 默认仓库：PHD + 东区（inv_warehouses.brand_id → brand_inventory.brand_code、region）
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const { imageSize } = require('image-size');
const db = require('../config/database');

const PROJECT_ROOT = path.join(__dirname, '../..');
const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public');

const BRAND_CODE = 'PHD';
const REGION = '东区';

/** 嵌入图片最大像素框（保持比例缩放，避免拉伸变形） */
const MAX_EMBED_W = 120;
const MAX_EMBED_H = 96;

/**
 * 按比例缩放到 max 框内（不变形）；ExcelJS ext 使用像素近似值。
 */
function fitImagePixels(nw, nh, maxW, maxH) {
  const w = Number(nw) || maxW;
  const h = Number(nh) || maxH;
  if (w <= 0 || h <= 0) return { width: maxW, height: maxH };
  const scale = Math.min(maxW / w, maxH / h, 1);
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/** 图片像素高度 → Excel 行高（points），略加边距避免裁切 */
function rowHeightPointsForImagePx(pxH) {
  const pts = Math.ceil((pxH * 72) / 96) + 4;
  return Math.min(130, Math.max(22, pts));
}

function parseImageUrls(raw) {
  if (raw == null || raw === '') return [];
  try {
    const j = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(j) ? j.filter(Boolean).map(String) : [];
  } catch {
    return [];
  }
}

function resolveLocalImagePath(url) {
  const u = String(url || '').trim();
  if (!u.startsWith('/')) return null;
  const rel = u.replace(/^\//, '');
  const full = path.join(PUBLIC_ROOT, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return null;
  return full;
}

function imageExtForExcel(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  if (['jpeg', 'jpg', 'png', 'gif'].includes(ext)) return ext === 'jpg' ? 'jpeg' : ext;
  return null;
}

async function main() {
  const outArg = process.env.OUT || '';
  const desktop =
    process.env.HOME ? path.join(process.env.HOME, 'Desktop') : path.join(PROJECT_ROOT, 'exports');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').slice(0, 12);
  const defaultName = `PHD东区仓库物料清单_${stamp}.xlsx`;
  const outPath = outArg.trim() ? path.resolve(outArg) : path.join(desktop, defaultName);

  const [warehouses] = await db.query(
    `SELECT w.id, w.label, b.brand_code
     FROM inv_warehouses w
     INNER JOIN brand_inventory b ON b.id = w.brand_id
     WHERE b.brand_code = ? AND w.region = ?
     LIMIT 2`,
    [BRAND_CODE, REGION]
  );

  if (!warehouses.length) {
    console.error(`未找到仓库：品牌 ${BRAND_CODE} · 区域 ${REGION}`);
    process.exit(1);
  }
  if (warehouses.length > 1) {
    console.warn(
      `警告：存在多条 ${BRAND_CODE}/${REGION} 仓库记录，仅导出 id=${warehouses[0].id}（${warehouses[0].label || ''}）`,
    );
  }

  const whId = warehouses[0].id;

  const [items] = await db.query(
    `SELECT id, name, quantity_on_hand, image_urls
     FROM inv_items
     WHERE inv_warehouse_id = ?
     ORDER BY name ASC, id ASC`,
    [whId]
  );

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'remy-year-frame';
  workbook.created = new Date();

  const ws = workbook.addWorksheet(`${BRAND_CODE}${REGION}`, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { key: 'img', width: 22 },
    { key: 'name', width: 42 },
    { key: 'qty', width: 18 },
  ];

  const header = ws.getRow(1);
  header.values = ['图片', '物品名称', '可用数量（好的）'];
  header.font = { bold: true };
  header.height = 22;

  let maxEmbedW = 0;
  let rowIdx = 2;
  for (const it of items) {
    const qty = Math.max(0, parseInt(it.quantity_on_hand, 10) || 0);
    const urls = parseImageUrls(it.image_urls);
    const first = urls[0] || '';
    const localPath = first ? resolveLocalImagePath(first) : null;

    const row = ws.getRow(rowIdx);
    row.getCell(2).value = it.name || '';
    row.getCell(3).value = qty;
    row.getCell(2).alignment = { vertical: 'middle', wrapText: true };
    row.getCell(3).alignment = { vertical: 'middle', horizontal: 'center' };

    if (localPath) {
      const ext = imageExtForExcel(localPath);
      if (ext) {
        try {
          const buf = fs.readFileSync(localPath);
          let nw = 0;
          let nh = 0;
          try {
            const dim = imageSize(buf);
            nw = dim.width || 0;
            nh = dim.height || 0;
          } catch (_) {
            /* 无法解析尺寸时用中等占位，仍保持固定比例框内居中由 ext 决定 */
          }
          const { width: ew, height: eh } =
            nw && nh ? fitImagePixels(nw, nh, MAX_EMBED_W, MAX_EMBED_H) : { width: MAX_EMBED_W, height: MAX_EMBED_H };
          if (ew > maxEmbedW) maxEmbedW = ew;

          row.height = rowHeightPointsForImagePx(eh);
          const imageId = workbook.addImage({ buffer: buf, extension: ext });
          ws.addImage(imageId, {
            tl: { col: 0, row: rowIdx - 1 },
            ext: { width: ew, height: eh },
          });
        } catch (e) {
          row.getCell(1).value = `读取图片失败：${first}`;
          row.height = 28;
        }
      } else {
        row.getCell(1).value = first || '';
        row.height = 28;
      }
    } else if (first) {
      row.getCell(1).value = first;
      row.height = 28;
    } else {
      row.getCell(1).value = '—';
      row.height = 28;
    }

    rowIdx += 1;
  }

  if (maxEmbedW > 0) {
    // 列宽约与最大图宽匹配（字符单位近似，避免图比列更宽）
    const wch = Math.min(40, Math.max(18, maxEmbedW / 6.2 + 1.5));
    ws.getColumn(1).width = wch;
  }

  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await workbook.xlsx.writeFile(outPath);

  console.log(`已导出 ${items.length} 条 → ${outPath}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
