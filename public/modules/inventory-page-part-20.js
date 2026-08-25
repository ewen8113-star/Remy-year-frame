function invOutboundPdfUrl(id, download) {
  const base = `${API}/inventory/outbound/${id}/pdf`;
  return download ? `${base}?download=1` : base;
}

let invPdfPreviewBlob = null;

function invRevokePdfPreviewBlobUrl() {
  const frame = document.getElementById('invOutboundPdfFrame');
  if (frame && frame.dataset.pdfBlobUrl) {
    URL.revokeObjectURL(frame.dataset.pdfBlobUrl);
    delete frame.dataset.pdfBlobUrl;
  }
  invPdfPreviewBlob = null;
}

function invResetOutboundPdfModal() {
  invRevokePdfPreviewBlobUrl();
  const frame = document.getElementById('invOutboundPdfFrame');
  if (frame) frame.src = 'about:blank';
  const body = document.getElementById('invOutboundPdfBody');
  if (body) {
    body.classList.add('inv-pdf-loading');
    const ld = document.getElementById('invOutboundPdfLoading');
    if (ld) ld.textContent = '加载中…';
  }
  const dlBtn = document.getElementById('invOutboundPdfDownloadBtn');
  if (dlBtn) {
    dlBtn.disabled = true;
    dlBtn.onclick = null;
  }
}

async function invDownloadPdf(id) {
  const titleEl = document.getElementById('invOutboundPdfTitle');
  const frame = document.getElementById('invOutboundPdfFrame');
  const dlBtn = document.getElementById('invOutboundPdfDownloadBtn');
  const body = document.getElementById('invOutboundPdfBody');
  const loadingEl = document.getElementById('invOutboundPdfLoading');

  if (titleEl) titleEl.textContent = `出库单 #${id} 预览`;
  invRevokePdfPreviewBlobUrl();
  if (frame) frame.src = 'about:blank';
  if (body) body.classList.remove('inv-pdf-loading');
  if (loadingEl) loadingEl.textContent = '加载中…';
  if (dlBtn) {
    dlBtn.disabled = true;
    dlBtn.onclick = null;
  }

  try {
    const res = await fetch(invOutboundPdfUrl(id, false), { credentials: 'include' });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      let msg = `加载失败 (${res.status})`;
      if (ct.includes('json')) {
        try {
          const j = await res.json();
          if (j && j.error) msg = j.error;
        } catch (_) { /* ignore */ }
      }
      throw new Error(msg);
    }
    if (!ct.includes('pdf') && !ct.includes('octet-stream')) {
      const t = await res.text();
      throw new Error(t.slice(0, 160) || '服务器未返回 PDF');
    }
    const downloadName = invFilenameFromDisposition(
      res.headers.get('content-disposition'),
      `出库单_${id}.pdf`
    );
    const blob = await res.blob();
    invPdfPreviewBlob = blob;
    const blobUrl = URL.createObjectURL(blob);
    if (frame) {
      frame.dataset.pdfBlobUrl = blobUrl;
      frame.src = blobUrl;
    }
    if (body) body.classList.remove('inv-pdf-loading');
    if (dlBtn) {
      dlBtn.disabled = false;
      dlBtn.onclick = () => {
        if (!invPdfPreviewBlob) return;
        const url = URL.createObjectURL(invPdfPreviewBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = downloadName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      };
    }
    requestAnimationFrame(() => {
      openModal('modalInvOutboundPdf');
    });
  } catch (e) {
    if (loadingEl) loadingEl.textContent = e.message || '加载失败';
    if (body) body.classList.add('inv-pdf-loading');
    showToast(e.message || 'PDF 加载失败', 'error');
  }
}
