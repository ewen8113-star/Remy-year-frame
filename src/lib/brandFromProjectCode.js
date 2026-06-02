/** 从项目编号字符串提取品牌线（与 inventory 导出逻辑一致） */
function extractBrandFromProjectCode(projectCodeRaw) {
  const s = String(projectCodeRaw || '').toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (s.includes('CLUB')) return 'CLUB';
  if (s.includes('PHD')) return 'PHD';
  if (s.includes('X.O') || s.includes('XO')) return 'X.O';
  if (s.includes('REMY')) return 'REMY';
  if (s.includes('RC')) return 'RC';
  return '';
}

const BRAND_SORT_ORDER = ['PHD', 'X.O', 'CLUB', 'REMY', 'RC'];

/** 从明细行汇总品牌标签（多场次合并时用逗号连接） */
function brandsLabelFromRows(rows, fallbackBrand) {
  const brands = new Set();
  (rows || []).forEach((row) => {
    const pc = String(row.project_code || row.line_project || '').trim();
    const fromPc = extractBrandFromProjectCode(pc);
    if (fromPc) brands.add(fromPc);
    else {
      const b = String(row.brand || '').trim();
      if (b && b !== '内部') brands.add(b);
    }
  });
  const fb = String(fallbackBrand || '').trim();
  if (!brands.size && fb && fb !== '内部') {
    fb.split(/[,，、/]+/).forEach((p) => {
      const t = p.trim();
      if (t) brands.add(t);
    });
  }
  if (!brands.size) return '';
  return [...brands]
    .sort((a, b) => {
      const ia = BRAND_SORT_ORDER.indexOf(a);
      const ib = BRAND_SORT_ORDER.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b, 'zh-CN');
    })
    .join('，');
}

module.exports = {
  extractBrandFromProjectCode,
  brandsLabelFromRows,
  BRAND_SORT_ORDER,
};
