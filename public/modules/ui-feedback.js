/* 前端全局轻提示。依赖主入口提供动画与 Lucide 图标刷新函数。 */

function showToast(msg, type = 'info') {
  const normalizedType = type === 'danger' ? 'error' : type;
  const icons = {
    success: '<i data-lucide="circle-check-big" style="width:14px;height:14px"></i>',
    error: '<i data-lucide="circle-x" style="width:14px;height:14px"></i>',
    warning: '<i data-lucide="triangle-alert" style="width:14px;height:14px"></i>',
    info: '<i data-lucide="info" style="width:14px;height:14px"></i>',
  };
  const element = document.createElement('div');
  element.className = `toast ${normalizedType}`;
  element.innerHTML = `<span>${icons[normalizedType] || ''}</span><span>${msg}</span>`;
  const toastContainer = document.getElementById('toastContainer');
  toastContainer.appendChild(element);
  applyHarmonySurfaceAnimations(toastContainer);
  renderLucideIcons();
  setTimeout(() => {
    element.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => element.remove(), 300);
  }, 3000);
}
