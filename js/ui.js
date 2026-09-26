// DOM 기반 UI (방명록 팝업, 토스트)

const UI = (() => {
  const modal = document.getElementById('modal');
  const toast = document.getElementById('toast');
  let openedAt = 0;
  let toastTimer = null;

  function openGuestbook({ name, shortMsg, longMsg, avatarUrl }) {
    document.getElementById('modal-name').textContent = name;
    document.getElementById('modal-short').textContent = shortMsg ? `“${shortMsg}”` : '';
    document.getElementById('modal-long').textContent = longMsg || '';
    const avatar = document.getElementById('modal-avatar');
    avatar.hidden = !avatarUrl;
    if (avatarUrl) avatar.src = avatarUrl;
    modal.hidden = false;
    openedAt = Date.now();
  }

  function close() {
    modal.hidden = true;
  }

  // 모바일에서 캐릭터 터치 직후 따라오는 click 이벤트가 배경에 맞아 바로 닫히는 것 방지
  modal.addEventListener('click', (e) => {
    if (Date.now() - openedAt < 400) return;
    if (e.target === modal || e.target.closest('[data-close]')) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  function showToast(message, duration = 2000) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), duration);
  }

  document.getElementById('write-btn').addEventListener('click', () => {
    showToast('방명록 작성은 곧 오픈됩니다!');
  });

  return { openGuestbook, close, showToast };
})();
