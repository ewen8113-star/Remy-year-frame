const { extractBrandFromProjectCode, brandsLabelFromRows } = require('../lib/brandFromProjectCode');

const META_MARKER = '[REIMB_DETAIL_JSON]';

function readMetaFromRemarks(raw) {
  const text = raw != null ? String(raw) : '';
  const idx = text.indexOf(META_MARKER);
  if (idx < 0) return {};
  try {
    return JSON.parse(text.slice(idx + META_MARKER.length).trim()) || {};
  } catch {
    return {};
  }
}

function isPlaceholderProjectCode(pc) {
  const s = String(pc || '').trim();
  return !s || s === '—' || s === '内部';
}

/**
 * 合并报销：按 merge_sources 顺序为各行补回来源记录的 related_project_code
 */
function enrichDetailRowsWithMergeSources(rows, meta) {
  const list = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [];
  const sources = Array.isArray(meta?.merge_sources) ? meta.merge_sources : [];
  if (!sources.length) return list;

  const needsEnrich = list.some((r) => isPlaceholderProjectCode(r.project_code || r.line_project));
  if (!needsEnrich) return list;

  const enriched = [];
  let rowIdx = 0;
  for (const src of sources) {
    const srcMeta = readMetaFromRemarks(src.remarks);
    const srcRows = Array.isArray(srcMeta.rows) ? srcMeta.rows.filter(Boolean) : [];
    const srcRowCount = srcRows.length || 1;
    const pc = String(src.related_project_code || '').trim();
    const pcBrand = extractBrandFromProjectCode(pc);
    for (let i = 0; i < srcRowCount && rowIdx < list.length; i += 1) {
      const row = list[rowIdx];
      const existingPc = String(row.project_code || row.line_project || '').trim();
      const usePc = isPlaceholderProjectCode(existingPc) ? pc : existingPc;
      enriched.push({
        ...row,
        project_code: usePc || row.project_code,
        brand: (!row.brand || row.brand === '内部') && pcBrand ? pcBrand : row.brand,
      });
      rowIdx += 1;
    }
  }
  while (rowIdx < list.length) {
    enriched.push(list[rowIdx]);
    rowIdx += 1;
  }
  return enriched.length ? enriched : list;
}

function lineProjectForRow(row, recordProjectCode, recordBrand) {
  const rowPc = String(row.project_code || row.line_project || '').trim();
  if (rowPc && !isPlaceholderProjectCode(rowPc)) return rowPc;
  const rowBrand = String(row.brand || '').trim();
  const projectCode = String(recordProjectCode || '').trim();
  if (projectCode) return projectCode;
  if (rowBrand && rowBrand !== '内部') return rowBrand;
  return '';
}

module.exports = {
  enrichDetailRowsWithMergeSources,
  lineProjectForRow,
  isPlaceholderProjectCode,
  brandsLabelFromRows,
  extractBrandFromProjectCode,
};
