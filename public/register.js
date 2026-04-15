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

async function submitRegister(e) {
  e.preventDefault();
  const errorEl = document.getElementById('registerError');
  const btn = document.getElementById('registerBtn');
  if (errorEl) {
    errorEl.style.display = 'none';
    errorEl.textContent = '';
  }
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirm = document.getElementById('regConfirmPassword').value;
  if (password !== confirm) {
    errorEl.textContent = '两次密码输入不一致';
    errorEl.style.display = 'block';
    return;
  }
  if (password.length < 8) {
    errorEl.textContent = '密码至少 8 位';
    errorEl.style.display = 'block';
    return;
  }
  btn.disabled = true;
  btn.textContent = '注册中...';
  try {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || '注册失败');
    window.location.href = '/login.html';
  } catch (err) {
    errorEl.textContent = err.message || '注册失败';
    errorEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = '注册';
  }
}
