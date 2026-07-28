/* 排期日历页面模块：从 app.js 机械迁移，保持原有展示逻辑。 */

/** 排期日历单元格文案：城市+场地+客户+品牌+活动类型，缺项用 - */
function formatCalendarActivitySummary(a) {
  const part = (raw) => {
    const t = String(raw ?? '').trim();
    return t || '-';
  };
  if (!a) return '-----';
  const city = part(normalizeProjectCodeCity(a.city) || a.city);
  const venue = part(a.venue);
  const client = part(a.client || a.client_name);
  const brand = part(a.brand);
  const type = part(a.activity_type);
  return `${city}${venue}${client}${brand}${type}`;
}

/* =============================================
   页面：排期日历
   ============================================= */
async function renderCalendar() {
  const container = document.getElementById('pageContainer');
  const now = new Date();
  let calYear = now.getFullYear();
  let calMonth = now.getMonth(); // 0-indexed

  container.innerHTML = `
    <div class="cal-page">
      <div class="cal-sticky-head">
        <div class="cal-toolbar">
          <div class="cal-toolbar-nav">
            <button type="button" class="btn btn-secondary" onclick="prevCalMonth()">‹ 上月</button>
            <h2 id="calTitle" class="cal-toolbar-title"></h2>
            <button type="button" class="btn btn-secondary" onclick="nextCalMonth()">下月 ›</button>
          </div>
          <div class="cal-toolbar-actions">
            <button type="button" class="btn btn-primary btn-sm" onclick="showActivityModal()">+ 新建活动</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="goCalToday()">今天</button>
          </div>
        </div>
        <div class="calendar-grid cal-weekhead" id="calHeader"></div>
      </div>
      <div class="calendar-grid cal-body-grid" id="calGrid"></div>
    </div>
  `;

  window._calYear = calYear;
  window._calMonth = calMonth;
  drawCalendar(calYear, calMonth);
}

async function drawCalendar(year, month) {
  const title = document.getElementById('calTitle');
  if (title) title.textContent = `${year}年 ${month+1}月`;

  // 星期头
  const header = document.getElementById('calHeader');
  if (header) {
    header.innerHTML = ['一','二','三','四','五','六','日'].map(d => `<div class="cal-header-cell">${d}</div>`).join('');
  }

  const grid = document.getElementById('calGrid');
  if (!grid) return;
  grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);grid-column:1/-1">加载中...</div>';

  try {
    const qs = `?year=${year}&month=${month+1}${currentYearFrameId?'&yearFrameId='+currentYearFrameId:''}`;
    const calResp = await api('GET', `/calendar${qs}`);
    const activities = Array.isArray(calResp) ? calResp : (calResp.data || []);

    // 按日期索引
    const actMap = {};
    activities.forEach(a => {
      const d = new Date(a.activity_date || a.date);
      if (!isNaN(d)) {
        // 日期是UTC存储，需要+1天修正时区（UTC+8）
        const local = new Date(d.getTime() + 8*3600*1000);
        const key = `${local.getUTCFullYear()}-${local.getUTCMonth()+1}-${local.getUTCDate()}`;
        if (!actMap[key]) actMap[key] = [];
        actMap[key].push(a);
      }
    });

    const firstDay = new Date(year, month, 1);
    let startWeekDay = firstDay.getDay(); // 0=Sun
    startWeekDay = startWeekDay === 0 ? 6 : startWeekDay - 1; // Mon=0

    const daysInMonth = new Date(year, month+1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();

    const today = new Date();
    let html = '';

    function calBrandClass(brand) {
      return String(brand || '').toLowerCase().replace(/\./g, '');
    }
    function calEventTitle(a) {
      const lines = [formatCalendarActivitySummary(a)];
      if (a.project_code) lines.push(String(a.project_code).trim());
      if (a.status === 'deferred') lines.push('延期');
      return lines.filter(Boolean).join('｜');
    }
    function calEventLabel(a) {
      return formatCalendarActivitySummary(a);
    }
    function calDayCellHtml(dayNum, opts) {
      const { isToday, isOtherMonth, acts } = opts;
      const countBadge =
        !isOtherMonth && acts.length ? `<span class="cal-date-count">${acts.length}场</span>` : '';
      const eventsHtml = isOtherMonth
        ? ''
        : `<div class="cal-cell-events">${acts
            .map(
              (a) => `<div class="cal-event brand-${calBrandClass(a.brand)}${
                a.status === 'deferred' ? ' cal-event-deferred' : ''
              }" title="${escapeHtml(calEventTitle(a))}" onclick="showActivityDetail(${a.id})">${escapeHtml(
                calEventLabel(a)
              )}</div>`
            )
            .join('')}</div>`;
      return `<div class="cal-cell${isOtherMonth ? ' other-month' : ''}${isToday ? ' today' : ''}">
        <div class="cal-date-row">
          <span class="cal-date">${dayNum}</span>
          ${countBadge}
        </div>
        ${eventsHtml}
      </div>`;
    }

    // 上月填充
    for (let i = startWeekDay - 1; i >= 0; i--) {
      html += calDayCellHtml(daysInPrevMonth - i, { isOtherMonth: true, acts: [] });
    }

    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === d;
      const key = `${year}-${month + 1}-${d}`;
      const acts = actMap[key] || [];
      html += calDayCellHtml(d, { isToday, acts });
    }

    // 下月填充
    const totalCells = startWeekDay + daysInMonth;
    const remaining = (7 - totalCells % 7) % 7;
    for (let d = 1; d <= remaining; d++) {
      html += calDayCellHtml(d, { isOtherMonth: true, acts: [] });
    }

    grid.innerHTML = html;
  } catch (err) {
    grid.innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger);grid-column:1/-1">加载失败: ${err.message}</div>`;
  }
}

function prevCalMonth() {
  window._calMonth--;
  if (window._calMonth < 0) { window._calMonth = 11; window._calYear--; }
  drawCalendar(window._calYear, window._calMonth);
}

function nextCalMonth() {
  window._calMonth++;
  if (window._calMonth > 11) { window._calMonth = 0; window._calYear++; }
  drawCalendar(window._calYear, window._calMonth);
}

function goCalToday() {
  const n = new Date();
  window._calYear = n.getFullYear();
  window._calMonth = n.getMonth();
  drawCalendar(window._calYear, window._calMonth);
}
