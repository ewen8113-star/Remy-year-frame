/**
 * 报价区块编号排序：A < B < C；A-1 < A-2；1.01 < 1.02 < 2.01
 */
function compareQuotationCodes(a, b) {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  const letterNum = /^([A-Za-z]+)-(\d+)$/;
  const ma = sa.match(letterNum);
  const mb = sb.match(letterNum);
  if (ma && mb) {
    const lc = ma[1].toUpperCase().localeCompare(mb[1].toUpperCase());
    if (lc !== 0) return lc;
    return parseInt(ma[2], 10) - parseInt(mb[2], 10);
  }
  if (/^[A-Za-z]+$/.test(sa) && /^[A-Za-z]+$/.test(sb)) {
    return sa.toUpperCase().localeCompare(sb.toUpperCase());
  }
  const pa = sa.split('.').map((x) => parseFloat(x));
  const pb = sb.split('.').map((x) => parseFloat(x));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = Number.isFinite(pa[i]) ? pa[i] : 0;
    const db = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (da !== db) return da - db;
  }
  return sa.localeCompare(sb, 'zh');
}

function formatSectionHeaderLabel(sectionCode, sectionName) {
  const code = String(sectionCode || '').trim();
  const name = String(sectionName || '').trim();
  if (!code) return name || '—';
  if (!name) return code;
  return `${code}-${name}`;
}

function sortOrderFromSubsectionCode(subCode) {
  const m = String(subCode || '').trim().match(/^([A-Za-z]+)-(\d+)$/);
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const num = parseInt(m[2], 10);
  if (!Number.isFinite(num)) return null;
  return (letter.charCodeAt(0) - 64) * 100 + num;
}

function sectionLetterAt(index) {
  let n = index;
  let s = '';
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s || 'A';
}

/** 大板块删除后按当前顺序重排 A/B/C… 与 A-1、A-2（仅字母区块 EVENT 明细） */
function renumberEventQuotationSections(items) {
  if (!Array.isArray(items) || !items.length) return items;
  const groups = [];
  const seen = new Map();
  items.forEach((it) => {
    const sk = String(it.section_code || '').trim().toUpperCase();
    if (!seen.has(sk)) {
      const g = {
        section_code: it.section_code,
        section_name: it.section_name,
        items: [],
      };
      seen.set(sk, g);
      groups.push(g);
    }
    seen.get(sk).items.push(it);
  });
  groups.sort((a, b) => compareQuotationCodes(a.section_code, b.section_code));

  const out = [];
  groups.forEach((g, secIdx) => {
    const newLetter = sectionLetterAt(secIdx);
    const subMap = new Map();
    const subOrder = [];
    g.items.forEach((it) => {
      const sub = String(it.subsection_code || '').trim();
      if (!subMap.has(sub)) {
        subMap.set(sub, []);
        subOrder.push(sub);
      }
      subMap.get(sub).push(it);
    });
    subOrder.sort((a, b) => compareQuotationCodes(a, b));
    subOrder.forEach((oldSub, subIdx) => {
      const newSub = `${newLetter}-${subIdx + 1}`;
      const sortOrder = sortOrderFromSubsectionCode(newSub);
      subMap.get(oldSub).forEach((it) => {
        out.push({
          ...it,
          section_code: newLetter,
          section_name: g.section_name,
          subsection_code: newSub,
          sort_order: sortOrder != null ? sortOrder : it.sort_order,
        });
      });
    });
  });
  return out;
}

module.exports = {
  compareQuotationCodes,
  formatSectionHeaderLabel,
  sortOrderFromSubsectionCode,
  renumberEventQuotationSections,
};
