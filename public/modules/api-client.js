/* 前端 API 基地址与 JSON 请求封装。 */

function resolveApiBase() {
  try {
    if (typeof window === 'undefined' || !window.location) return '/api';
    const { protocol } = window.location;
    if (protocol === 'file:') {
      const custom = localStorage.getItem('remy_apiBase');
      if (custom) return String(custom).replace(/\/$/, '');
      return 'http://127.0.0.1:3088/api';
    }
  } catch (e) { /* ignore */ }
  return '/api';
}

const API = resolveApiBase();

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
  };
  if (body != null) opts.body = JSON.stringify(body);
  try {
    const url = `${API}${path}`;
    const res = await fetch(url, opts);
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(
        res.ok ? '响应不是合法 JSON' : `请求失败 (${res.status})，URL：${url}`
      );
    }
    if (!res.ok) {
      const auth401NoRedirect = new Set(['/auth/me', '/auth/login', '/auth/register', '/auth/logout']);
      if (res.status === 401 && !auth401NoRedirect.has(String(path))) {
        if (typeof window !== 'undefined' && !window.location.pathname.endsWith('/login.html')) {
          window.location.href = '/login.html';
        }
      }
      throw new Error(data.error || data.message || `请求失败 (${res.status})，URL：${url}`);
    }
    return data;
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (err instanceof TypeError && (msg.includes('fetch') || msg.includes('Load failed') || msg.includes('Failed to fetch'))) {
      throw new Error(
        '连不上接口：请确认已运行 node src/server.js，并用浏览器打开 http://localhost 上的地址（不要 file:// 打开）。当前 API：' + API
      );
    }
    throw err;
  }
}
