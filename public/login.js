function resolveApiBase() {
  try {
    if (typeof window === 'undefined' || !window.location) return '/api';
    const { protocol } = window.location;
    if (protocol === 'http:' || protocol === 'https:') return '/api';
    const custom = localStorage.getItem('remy_apiBase');
    return custom || 'http://127.0.0.1:3088/api';
  } catch (_) {
    return '/api';
  }
}

const API = resolveApiBase();

async function authMe() {
  const res = await fetch(`${API}/auth/me`, { credentials: 'include' });
  return res.ok;
}

async function submitLogin(e) {
  e.preventDefault();
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');
  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }
  btn.disabled = true;
  btn.textContent = '登录中...';
  try {
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '登录失败');
    window.location.href = '/';
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = err.message || '登录失败';
      errorEl.style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = '登录';
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (await authMe()) window.location.href = '/';
});
