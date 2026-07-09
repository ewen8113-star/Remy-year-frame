/**
 * 1) 禁止聚焦中的 <input type="number"> 随滚轮改变数值
 * 2) 数量/金额：0 或 0.00 以暗色 placeholder 提示，聚焦时清空便于直接输入
 */
(function installNumberInputWheelGuard() {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.numberInputWheelGuard === '1') return;
  document.documentElement.dataset.numberInputWheelGuard = '1';

  function activeNumberInput() {
    const el = document.activeElement;
    if (!el || el.tagName !== 'INPUT') return null;
    if (String(el.type || '').toLowerCase() !== 'number') return null;
    return el;
  }

  function onWheel(evt) {
    const inp = activeNumberInput();
    if (!inp) return;
    evt.preventDefault();
    inp.blur();
  }

  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
})();

(function installNumberInputHintBehavior() {
  if (typeof document === 'undefined') return;
  if (document.documentElement.dataset.numberInputHint === '1') return;
  document.documentElement.dataset.numberInputHint = '1';

  const MONEY_PLACEHOLDER = '0.00';
  const QTY_PLACEHOLDER = '0';

  function shouldSkip(el) {
    if (!el || el.tagName !== 'INPUT') return true;
    if (String(el.type || '').toLowerCase() !== 'number') return true;
    if (el.disabled || el.readOnly) return true;
    if (el.dataset.noNumHint === '1') return true;
    return false;
  }

  function inferNumKind(el) {
    const hint = String(el.dataset.numKind || el.dataset.numHint || '').toLowerCase();
    if (hint === 'money' || hint === 'amount' || hint === 'price') return 'money';
    if (hint === 'qty' || hint === 'quantity') return 'qty';
    const step = el.getAttribute('step');
    if (step === 'any') return 'qty';
    if (step != null && step !== '') {
      const s = parseFloat(step);
      if (Number.isFinite(s) && s > 0 && s < 1) return 'money';
    }
    const hay = `${el.id || ''} ${el.className || ''} ${el.name || ''}`;
    if (/(price|amount|amt|fee|money|单价|金额|quoted|cost)/i.test(hay)) return 'money';
    return 'qty';
  }

  function defaultPlaceholder(el) {
    return inferNumKind(el) === 'money' ? MONEY_PLACEHOLDER : QTY_PLACEHOLDER;
  }

  function isZeroDisplay(val) {
    const v = String(val ?? '').trim();
    if (v === '') return true;
    const n = parseFloat(v);
    return Number.isFinite(n) && n === 0;
  }

  function onFocus(el) {
    if (isZeroDisplay(el.value)) {
      el.value = '';
    } else {
      try {
        el.select();
      } catch (_) {
        /* ignore */
      }
    }
  }

  function onBlur(el) {
    if (String(el.value).trim() === '') el.value = '';
  }

  function enhanceNumberInput(el) {
    if (shouldSkip(el)) return;
    if (el.dataset.numHintEnhanced === '1') return;
    el.dataset.numHintEnhanced = '1';
    el.classList.add('num-hint-inp');
    if (inferNumKind(el) === 'money') el.classList.add('num-hint-inp--money');

    if (!String(el.placeholder || '').trim()) {
      el.placeholder = defaultPlaceholder(el);
    }

    if (isZeroDisplay(el.value)) el.value = '';

    el.addEventListener('focus', () => onFocus(el));
    el.addEventListener('blur', () => onBlur(el));
  }

  function scan(root) {
    const scope = root && root.querySelectorAll ? root : document;
    scope.querySelectorAll('input[type="number"]').forEach(enhanceNumberInput);
  }

  function boot() {
    scan(document);
    const obs = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches('input[type="number"]')) enhanceNumberInput(node);
          scan(node);
        });
      });
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
