// DOM 기반 UI (방명록 팝업, 작성 폼, 토스트)

const UI = (() => {
  const toast = document.getElementById('toast');
  let toastTimer = null;

  /** 모달 공통 동작: 배경/닫기 버튼/ESC로 닫기 */
  function setupModal(el) {
    let openedAt = 0;
    // 모바일에서 캐릭터 터치 직후 따라오는 click 이벤트가 배경에 맞아 바로 닫히는 것 방지
    el.addEventListener('click', (e) => {
      if (Date.now() - openedAt < 400) return;
      if (e.target === el || e.target.closest('[data-close]')) el.hidden = true;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') el.hidden = true;
    });
    return {
      open() {
        el.hidden = false;
        openedAt = Date.now();
      },
      close() {
        el.hidden = true;
      },
    };
  }

  // ---------- 방명록 보기 ----------
  const viewModal = setupModal(document.getElementById('modal'));

  function openGuestbook({ name, shortMsg, longMsg, avatarUrl }) {
    document.getElementById('modal-name').textContent = name;
    document.getElementById('modal-short').textContent = shortMsg ? `“${shortMsg}”` : '';
    document.getElementById('modal-long').textContent = longMsg || '';
    const avatar = document.getElementById('modal-avatar');
    avatar.hidden = !avatarUrl;
    if (avatarUrl) avatar.src = avatarUrl;
    viewModal.open();
  }

  // ---------- 방명록 작성 ----------
  const writeModal = setupModal(document.getElementById('write-modal'));
  const form = document.getElementById('write-form');
  const fields = form.elements;
  const preview = form.querySelector('.preview');
  const errorBox = form.querySelector('.form-error');
  const submitBtn = form.querySelector('[type="submit"]');
  let prepared = null; // 처리된 이미지 { front, walk } (data URL)
  let preparing = null; // 이미지 처리 중인 Promise

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  async function updatePreview() {
    showError('');
    prepared = null;
    preparing = prepareSpriteImages(fields.front.files[0], fields.walk.files[0]);
    try {
      prepared = await preparing;
    } catch (err) {
      showError(err.message);
    }
    preview.hidden = !prepared;
    const [frontImg, walkImg] = preview.querySelectorAll('img');
    frontImg.toggleAttribute('src', Boolean(prepared?.front));
    walkImg.toggleAttribute('src', Boolean(prepared?.walk));
    if (prepared?.front) frontImg.src = prepared.front;
    if (prepared?.walk) walkImg.src = prepared.walk;
  }

  fields.front.addEventListener('change', updatePreview);
  fields.walk.addEventListener('change', updatePreview);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const name = fields.name.value.trim();
    const shortMsg = fields.shortMsg.value.trim();
    const longMsg = fields.longMsg.value.trim();
    if (!name || !shortMsg || !longMsg) return showError('이름, 한줄 멘트, 방명록을 모두 입력해 주세요.');

    submitBtn.disabled = true;
    submitBtn.textContent = '등록 중...';
    try {
      const images = await (preparing ?? Promise.resolve(null));
      const guest = await submitGuestbook({ name, shortMsg, longMsg, images });
      // 저장소 반영(배포)까지 1~2분 걸리므로, 방금 처리한 이미지로 바로 맵에 띄운다
      UI.onGuestCreated?.({
        ...guest,
        spriteUrl: images?.front ?? null,
        walkUrl: images?.walk ?? null,
      });
      form.reset();
      prepared = preparing = null;
      preview.hidden = true;
      writeModal.close();
      showToast('방명록이 등록되었어요! 🎉');
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '등록하기';
    }
  });

  document.getElementById('write-btn').addEventListener('click', () => {
    if (!CONFIG.apiUrl) return showToast('방명록 작성은 곧 오픈됩니다!');
    writeModal.open();
  });

  // ---------- 토스트 ----------
  function showToast(message, duration = 2000) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), duration);
  }

  return { openGuestbook, showToast, onGuestCreated: null };
})();
