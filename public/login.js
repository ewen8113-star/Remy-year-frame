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
const LOGIN_REMEMBER_KEY = 'remy_login_username';

function applyAuthPageTheme() {
  const saved = localStorage.getItem('remy_theme');
  const prefersDark = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = saved || (prefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
}

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
    const remember = !!document.getElementById('rememberUsername')?.checked;
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '登录失败');
    if (remember && username) localStorage.setItem(LOGIN_REMEMBER_KEY, username);
    else localStorage.removeItem(LOGIN_REMEMBER_KEY);
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
  applyAuthPageTheme();
  const remembered = localStorage.getItem(LOGIN_REMEMBER_KEY) || '';
  const usernameEl = document.getElementById('username');
  const rememberEl = document.getElementById('rememberUsername');
  if (usernameEl && remembered) usernameEl.value = remembered;
  if (rememberEl) rememberEl.checked = !!remembered;
  if (await authMe()) window.location.href = '/';
});
