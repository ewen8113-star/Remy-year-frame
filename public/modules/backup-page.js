/* 数据备份页面：依赖 app.js 暴露的 api / escapeHtml / showToast / renderLucideIcons / canManageUsers / currentYearFrameId */

let backupRestoreConfirmPhrase = '确认恢复';

async function renderBackup() {
  const container = document.getElementById('pageContainer');
  container.innerHTML = `
    <div class="card" style="max-width:760px;margin:0 auto">
      <div class="card-header">
        <div class="card-title"><i data-lucide="database-backup" style="width:14px;height:14px;vertical-align:-2px;margin-right:6px"></i>数据备份与导出</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div style="padding:16px;background:var(--bg-input);border-radius:var(--radius-sm)">
          <div style="font-weight:600;margin-bottom:6px">导出当前年框 JSON</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
            仅导出<strong>当前年框</strong>四类业务表全量行：场次（含虚拟）、仓储、物流、报销。<br>
            不含库存/酒品/报价/用户等。文件保存到项目目录 <code>Date Backup/</code>。
          </div>
          <button class="btn btn-primary" onclick="exportData()"><i data-lucide="download" style="width:14px;height:14px"></i>导出 JSON 备份</button>
          <div id="jsonBackupResult" style="margin-top:10px;font-size:12px;color:var(--text-secondary)"></div>
        </div>

        <div style="padding:16px;background:var(--bg-input);border-radius:var(--radius-sm)">
          <div style="font-weight:600;margin-bottom:6px">全局数据备份（推荐）</div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">备份全库所有表 + 上传图片目录（inventory、wine-catalog），写入服务器 backups 目录，并尝试打包为 tar.gz。</div>
          <button class="btn btn-primary" onclick="fullExportData()"><i data-lucide="shield-check" style="width:14px;height:14px"></i>执行全局备份</button>
          <div id="fullBackupResult" style="margin-top:10px;font-size:12px;color:var(--text-secondary)"></div>
        </div>

        <div style="padding:16px;background:var(--bg-input);border-radius:var(--radius-sm)">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px">
            <div style="font-weight:600">从备份恢复</div>
            <button type="button" class="btn btn-secondary btn-sm" onclick="refreshFullBackupList()">刷新列表</button>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:12px">
            将覆盖当前数据库与上传图片。点击恢复需连续两次确认。列表仅保留最近 5 次全局备份。仅管理员可操作。
          </div>
          <div id="fullBackupList" style="font-size:13px;color:var(--text-secondary)">加载中...</div>
          <div id="fullRestoreResult" style="margin-top:10px;font-size:12px;color:var(--text-secondary)"></div>
        </div>

        <div style="padding:16px;background:var(--bg-input);border-radius:var(--radius-sm)">
          <div style="font-weight:600;margin-bottom:6px">服务器状态</div>
          <div id="serverStatus" style="font-size:13px;color:var(--text-secondary)">检查中...</div>
        </div>
      </div>
    </div>
  `;

  try {
    await api('GET', '/health');
    document.getElementById('serverStatus').innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;color:var(--success)">
        <span class="status-dot"></span>
        <span>MySQL 已连接，API 服务正常（${window.location.host}）</span>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--text-muted)">上次检查: ${new Date().toLocaleTimeString()}</div>
    `;
  } catch (err) {
    document.getElementById('serverStatus').innerHTML = `<span style="color:var(--danger)"><i data-lucide="triangle-alert" style="width:12px;height:12px;vertical-align:-2px;margin-right:4px"></i>服务异常: ${err.message}</span>`;
    renderLucideIcons();
  }

  await refreshFullBackupList();
  renderLucideIcons();
}

function formatBackupListTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch (_) {
    return String(iso);
  }
}

async function refreshFullBackupList() {
  const host = document.getElementById('fullBackupList');
  if (!host) return;
  host.textContent = '加载中...';
  try {
    const ret = await api('GET', '/backup/full-list');
    const rows = Array.isArray(ret?.data) ? ret.data : [];
    if (ret?.confirmPhrase) backupRestoreConfirmPhrase = String(ret.confirmPhrase);
    if (!rows.length) {
      host.innerHTML = '<div style="color:var(--text-muted)">暂无可用备份。请先执行全局备份。</div>';
      return;
    }
    const canRestore = canManageUsers();
    host.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px">
        ${rows.map((b) => {
          const typeLabel = '全局备份';
          const meta = [
            formatBackupListTime(b.exportTime || b.mtime),
            b.tableCount != null ? `${b.tableCount} 表` : null,
            b.totalRows != null ? `${b.totalRows} 行` : null,
            b.hasUploads ? '含图片' : null,
            b.hasArchive ? '含压缩包' : null,
          ].filter(Boolean).join(' · ');
          return `
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-card)">
              <div style="min-width:0">
                <div style="font-weight:600;word-break:break-all">${escapeHtml(b.folderName || '')}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:4px">${escapeHtml(typeLabel)} · ${escapeHtml(meta)}</div>
              </div>
              ${canRestore ? `<button type="button" class="btn btn-secondary btn-sm" onclick="restoreFullBackup(${JSON.stringify(String(b.folderName || ''))})">恢复</button>` : ''}
            </div>
          `;
        }).join('')}
      </div>
    `;
  } catch (err) {
    host.innerHTML = `<span style="color:var(--danger)">读取备份列表失败：${escapeHtml(err.message || '')}</span>`;
  }
}

async function restoreFullBackup(folderName) {
  const name = String(folderName || '').trim();
  if (!name) return;
  if (!canManageUsers()) {
    showToast('仅管理员可恢复', 'error');
    return;
  }

  if (!confirm(
    `【第一次确认】\n\n即将从备份恢复并覆盖当前全部数据：\n${name}\n\n恢复前会自动生成一份快照。是否继续？`,
  )) {
    return;
  }

  if (!confirm(
    `【第二次确认】\n\n此操作不可撤销（仅可通过恢复前快照再还原）。\n确定用「${name}」覆盖当前系统数据吗？`,
  )) {
    showToast('已取消恢复', 'info');
    return;
  }

  const host = document.getElementById('fullRestoreResult');
  if (host) host.textContent = '正在恢复，请稍候（可能需要几十秒）...';
  try {
    const ret = await api('POST', '/backup/full-restore', {
      folderName: name,
      confirmPhrase: backupRestoreConfirmPhrase,
      yearFrameId: currentYearFrameId || undefined,
    });
    if (host) {
      host.innerHTML = `
        <div style="color:var(--success)">恢复完成：${escapeHtml(String(ret.totalRows || 0))} 行 / ${escapeHtml(String(ret.tableCount || 0))} 张表</div>
        <div>来源：<code>${escapeHtml(ret.restoredFrom || name)}</code></div>
        <div>恢复前快照：<code>${escapeHtml(ret.preRestoreSnapshot || '')}</code></div>
      `;
    }
    showToast('全局恢复完成，建议刷新页面', 'success');
    await refreshFullBackupList();
    if (confirm('恢复完成。是否立即刷新页面以加载最新数据？')) {
      window.location.reload();
    }
  } catch (err) {
    if (host) host.innerHTML = `<span style="color:var(--danger)">恢复失败：${escapeHtml(err.message || '')}</span>`;
    showToast('全局恢复失败: ' + (err.message || ''), 'error');
  }
}

async function exportData() {
  const host = document.getElementById('jsonBackupResult');
  if (!currentYearFrameId) {
    showToast('请先选择年框', 'error');
    return;
  }
  if (host) host.textContent = '正在导出并保存到 Date Backup...';
  try {
    const ret = await api('POST', '/backup/export', {
      yearFrameId: currentYearFrameId,
    });
    const c = ret.counts || {};
    if (host) {
      host.innerHTML = `
        <div style="color:var(--success)">已保存：场次 ${escapeHtml(String(c.activities ?? '—'))} /
          仓储 ${escapeHtml(String(c.warehouse ?? '—'))} /
          物流 ${escapeHtml(String(c.logistics ?? '—'))} /
          报销 ${escapeHtml(String(c.reimbursements ?? '—'))}
          （合计 ${escapeHtml(String(ret.count ?? 0))} 行）</div>
        <div>目录：<code>${escapeHtml(ret.directory || 'Date Backup')}</code></div>
        <div>文件：<code>${escapeHtml(ret.filename || '')}</code></div>
      `;
    }
    showToast('JSON 备份已保存到 Date Backup', 'success');
  } catch (err) {
    if (host) host.innerHTML = `<span style="color:var(--danger)">导出失败：${escapeHtml(err.message || '')}</span>`;
    showToast('导出失败: ' + (err.message || ''), 'error');
  }
}

async function fullExportData() {
  const host = document.getElementById('fullBackupResult');
  if (host) host.textContent = '全局备份执行中，请稍候...';
  try {
    const ret = await api('POST', '/backup/full-export', {
      yearFrameId: currentYearFrameId || undefined,
    });
    const archive = ret.archivePath ? `压缩包：${ret.archivePath}` : '压缩包：未生成（目录备份仍可用）';
    if (host) {
      host.innerHTML = `
        <div style="color:var(--success)">备份完成：${escapeHtml(String(ret.totalRows || 0))} 行 / ${escapeHtml(String(ret.tableCount || 0))} 张表</div>
        <div>目录：<code>${escapeHtml(ret.backupDir || '')}</code></div>
        <div>${escapeHtml(archive)}</div>
      `;
    }
    showToast('全局备份完成', 'success');
    await refreshFullBackupList();
  } catch (err) {
    if (host) host.innerHTML = `<span style="color:var(--danger)">执行失败：${escapeHtml(err.message || '')}</span>`;
    showToast('全局备份失败: ' + err.message, 'error');
  }
}
