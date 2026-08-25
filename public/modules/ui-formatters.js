/* 无状态的通用展示格式化函数。 */

function statusBadge(status) {
  if (status === 'cancelled') return '<span class="badge badge-danger">已取消</span>';
  if (status === 'deferred') return '<span class="badge badge-warning">延期</span>';
  if (status === 'pending' || status == null || status === '') {
    return '<span class="badge badge-gray">待执行</span>';
  }
  if (status === 'completed' || status === 'done') {
    return '<span class="badge badge-success">已完成</span>';
  }
  return '<span class="badge badge-gray">待执行</span>';
}

function brandColor(brand) {
  const colors = { XO: 'warning', PHD: 'accent', CLUB: 'blue', REMY: 'success' };
  return colors[brand] || 'gray';
}

function typeColor(type) {
  const colors = {
    '晚宴': 'accent',
    '品鉴': 'blue',
    '培训': 'success',
    '婚宴': 'warning',
    '宴会': 'danger',
  };
  return colors[type] || 'gray';
}
