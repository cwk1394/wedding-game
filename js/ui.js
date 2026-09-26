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
  const generateBtn = form.querySelector('.generate-btn');
  const genStatus = form.querySelector('.gen-status');

  let sources = { front: null, walk: null }; // 캐릭터 원본 (File 또는 data URL)
  let preparing = null; // 업로드용 이미지 처리 Promise → { front, walk } | null
  let generating = false;
  let generationCount = 0;

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  /** sources가 바뀌면 배경 제거·축소를 다시 하고 미리보기를 갱신 */
  async function setSources(next) {
    sources = next;
    const current = (preparing = prepareSpriteImages(sources.front, sources.walk));
    let prepared = null;
    try {
      prepared = await current;
    } catch (err) {
      showError(err.message);
    }
    if (current !== preparing) return; // 그 사이 다른 이미지로 바뀜
    preview.hidden = !prepared;
    const [frontImg, walkImg] = preview.querySelectorAll('img');
    frontImg.toggleAttribute('src', Boolean(prepared?.front));
    walkImg.toggleAttribute('src', Boolean(prepared?.walk));
    if (prepared?.front) frontImg.src = prepared.front;
    if (prepared?.walk) walkImg.src = prepared.walk;
  }

  // 직접 올리기
  const onManualChange = () => {
    showError('');
    setSources({ front: fields.front.files[0] || null, walk: fields.walk.files[0] || null });
  };
  fields.front.addEventListener('change', onManualChange);
  fields.walk.addEventListener('change', onManualChange);

  // AI 생성
  function setBusy(busy, text = '') {
    generating = busy;
    generateBtn.disabled = busy;
    submitBtn.disabled = busy;
    genStatus.hidden = !busy;
    genStatus.querySelector('.gen-text').textContent = text;
  }

  function updateGenerateLabel() {
    const left = CONFIG.ai.maxGenerations - generationCount;
    generateBtn.textContent = generationCount === 0 ? '캐릭터 생성' : `다시 만들기 (${left}회 남음)`;
    if (left <= 0) generateBtn.disabled = true;
  }

  /** 경과 시간을 붙여서 진행 문구를 보여준다 (오래 걸려도 멈춘 게 아니라는 표시) */
  async function withProgress(text, task) {
    const started = Date.now();
    const render = () => setBusy(true, `${text} ${Math.floor((Date.now() - started) / 1000)}초`);
    render();
    const timer = setInterval(render, 1000);
    try {
      return await task();
    } finally {
      clearInterval(timer);
    }
  }

  generateBtn.addEventListener('click', async () => {
    showError('');
    const photo = fields.photo.files[0];
    if (!photo) return showError('사진을 먼저 골라 주세요.');
    if (generationCount >= CONFIG.ai.maxGenerations) return showError('생성 가능 횟수를 모두 썼어요.');
    generationCount++;

    try {
      const front = await withProgress('캐릭터 도트 찍는 중... (1/2)', async () =>
        generateCharacter('front', await resizePhoto(photo))
      );
      await setSources({ front, walk: null });
      try {
        const walk = await withProgress('걷는 모션 만드는 중... (2/2)', () => generateCharacter('walk', front));
        await setSources({ front, walk });
      } catch (err) {
        showError(`걷는 모션은 만들지 못했어요. 이대로 등록하거나 다시 만들어 주세요. (${err.message})`);
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
      updateGenerateLabel();
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (generating) return;
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
      sources = { front: null, walk: null };
      preparing = null;
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
