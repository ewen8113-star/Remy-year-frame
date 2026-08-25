/* 通用弹窗栈、遮罩和 Escape 关闭行为。 */

let activeModal = null;
const modalStack = [];

function openModal(id) {
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.add('active');
  document.body.classList.add('modal-open');
  if (activeModal && activeModal !== id) {
    modalStack.push(activeModal);
  }
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.add('active');
    applyHarmonySurfaceAnimations(modal);
    activeModal = id;
  }
}

function bindModalEscapeClose() {
  if (bindModalEscapeClose._bound) return;
  bindModalEscapeClose._bound = true;
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !activeModal) return;
    if (typeof isModalEscapeBlocked === 'function' && isModalEscapeBlocked()) return;
    event.preventDefault();
    closeModal();
  });
}

function closeModal() {
  const overlay = document.getElementById('modalOverlay');
  if (!activeModal) {
    overlay.classList.remove('active');
    document.body.classList.remove('modal-open');
    return;
  }

  if (typeof cleanupModalBeforeClose === 'function') {
    cleanupModalBeforeClose(activeModal);
  }

  const currentModal = document.getElementById(activeModal);
  if (currentModal) currentModal.classList.remove('active');
  const previousModal = modalStack.length ? modalStack.pop() : null;
  if (previousModal) {
    activeModal = previousModal;
  } else {
    activeModal = null;
    overlay.classList.remove('active');
    document.body.classList.remove('modal-open');
  }
}
