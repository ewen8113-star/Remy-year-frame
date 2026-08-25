/* 用户管理页面：依赖 app.js 暴露的 api / escapeHtml / showToast / canManageUsers / currentUser / fmtDateTime */

async function renderUsers() {
  const container = document.getElementById('pageContainer');
  if (!container) return;
  if (!canManageUsers()) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">无权限</div><div class="empty-sub">仅管理员可访问用户管理</div></div>`;
    return;
  }
  container.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-muted)">加载中...</div>';
  try {
    const rows = await api('GET', '/users');
    const meId = Number(currentUser?.id || 0);
    const html = `
      <div class="card">
        <div class="card-header">
          <div class="card-title">用户管理</div>
          <div class="card-sub">注册用户默认 operator；管理员可提升/降级与启停用</div>
        </div>
        <div class="card-body">
          <div class="table-wrapper"><table>
            <thead><tr><th>ID</th><th>用户名</th><th>角色</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
            <tbody>
              ${(rows || []).map((u) => {
                const isMe = Number(u.id) === meId;
                const roleBtn = u.role === 'admin'
                  ? `<button class="btn btn-secondary btn-sm" ${isMe ? 'disabled title="当前账号不可自降级"' : ''} onclick="setUserRole(${u.id}, 'operator')">降级为 operator</button>`
                  : `<button class="btn btn-primary btn-sm" onclick="setUserRole(${u.id}, 'admin')">提升为 admin</button>`;
                const statusBtn = Number(u.is_active) === 1
                  ? `<button class="btn btn-danger btn-sm" ${isMe ? 'disabled title="当前账号不可自停用"' : ''} onclick="setUserStatus(${u.id}, 0)">停用</button>`
                  : `<button class="btn btn-secondary btn-sm" onclick="setUserStatus(${u.id}, 1)">启用</button>`;
                const resetPwdBtn = `<button type="button" class="btn btn-secondary btn-sm" onclick="openAdminResetPasswordModal(${u.id}, ${JSON.stringify(String(u.username || ''))})">重置密码</button>`;
                return `<tr>
                  <td>${u.id}</td>
                  <td>${escapeHtml(u.username || '')}${isMe ? ' <span class="badge badge-blue">我</span>' : ''}</td>
                  <td><span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}">${u.role}</span></td>
                  <td>${Number(u.is_active) === 1 ? '<span class="badge badge-success">启用</span>' : '<span class="badge badge-gray">停用</span>'}</td>
                  <td>${fmtDateTime(u.last_login_at)}</td>
                  <td style="white-space:nowrap;display:flex;flex-wrap:wrap;gap:6px;">${roleBtn}${statusBtn}${resetPwdBtn}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table></div>
        </div>
      </div>
    `;
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">加载失败</div><div class="empty-sub">${escapeHtml(err.message || '')}</div></div>`;
  }
}

async function setUserRole(id, role) {
  try {
    await api('PUT', `/users/${id}/role`, { role });
    showToast('角色更新成功', 'success');
    await renderUsers();
  } catch (err) {
    showToast(err.message || '角色更新失败', 'error');
  }
}

async function setUserStatus(id, is_active) {
  try {
    await api('PUT', `/users/${id}/status`, { is_active });
    showToast('状态更新成功', 'success');
    await renderUsers();
  } catch (err) {
    showToast(err.message || '状态更新失败', 'error');
  }
}
