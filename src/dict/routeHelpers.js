/** 已知通讯录类别（前端 UI 内置，后端不强制校验，允许管理员自定义 category） */
const KNOWN_CATEGORIES = ['recipient', 'sender', 'supplier', 'payee', 'reimburser', 'personal_payee'];

/**
 * 安全解析 JSON：mysql2 在 JSON 列上通常返回对象，但若是字符串（驱动版本差异）也兜底解析。
 */
function parseContent(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw)) || {};
  } catch {
    return {};
  }
}

/** dict_categories.fields_schema：必须是数组 */
function parseFieldsSchema(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'object') return [];
  try {
    const v = JSON.parse(String(raw));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** 把行转成接口稳定结构：content 总是对象、pinned/is_active 总是布尔 */
function mapRow(r) {
  return {
    id: r.id,
    category: r.category,
    name: r.name,
    short_label: r.short_label || '',
    content: parseContent(r.content),
    tags: r.tags || '',
    pinned: !!r.pinned,
    use_count: Number(r.use_count || 0),
    last_used_at: r.last_used_at,
    is_active: !!r.is_active,
    remarks: r.remarks || '',
    created_by: r.created_by || '',
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

module.exports = { KNOWN_CATEGORIES, mapRow, parseContent, parseFieldsSchema };
