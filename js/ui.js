// DOM 기반 UI (방명록 팝업, 작성 폼, 토스트)

const UI = (() => {
  const toast = document.getElementById('toast');
  let toastTimer = null;

  /** 팝업이 하나라도 떠 있는지 → UI.onModalChange로 알림 (그동안 맵 입력을 막는 데 사용) */
  function notifyModalChange() {
    UI.onModalChange?.(Boolean(document.querySelector('.modal:not([hidden])')));
  }

  /** 모달 공통 동작: 배경/닫기 버튼/ESC로 닫기 */
  function setupModal(el) {
    let openedAt = 0;
    const setOpen = (open) => {
      el.hidden = !open;
      if (open) openedAt = Date.now();
      notifyModalChange();
    };
    // 모바일에서 캐릭터 터치 직후 따라오는 click 이벤트가 배경에 맞아 바로 닫히는 것 방지
    el.addEventListener('click', (e) => {
      if (Date.now() - openedAt < 400) return;
      if (e.target === el || e.target.closest('[data-close]')) setOpen(false);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !el.hidden) setOpen(false);
    });
    return { open: () => setOpen(true), close: () => setOpen(false) };
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

  // ---------- 방명록 작성 (1단계: 방명록 → 2단계: 캐릭터) ----------
  const writeModal = setupModal(document.getElementById('write-modal'));
  const form = document.getElementById('write-form');
  const fields = form.elements;
  const errorBox = form.querySelector('.form-error');
  const prevBtn = form.querySelector('.prev-btn');
  const nextBtn = form.querySelector('.next-btn');
  const submitBtn = form.querySelector('.submit-btn');
  const generateBtn = form.querySelector('.generate-btn');
  const genStatus = form.querySelector('.gen-status');
  const photoPreview = form.querySelector('.photo-preview');
  const photoEmpty = form.querySelector('.photo-empty');
  const [frontPreview, walkPreview] = form.querySelectorAll('.preview img');
  const previewEmpty = form.querySelector('.preview-empty');

  let step = 1;
  let preparing = null; // 업로드용 이미지 처리 Promise → { front, walk } | null
  let generating = false;
  let generationCount = 0;
  let photoUrl = null;

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  function showStep(n) {
    step = n;
    showError('');
    form.querySelectorAll('[data-step]').forEach((el) => (el.hidden = Number(el.dataset.step) !== n));
    form.querySelectorAll('[data-step-dot]').forEach((el) =>
      el.classList.toggle('active', Number(el.dataset.stepDot) <= n)
    );
    prevBtn.hidden = n === 1;
    nextBtn.hidden = n !== 1;
    submitBtn.hidden = n !== 2;
    form.querySelector('.modal-body').scrollTop = 0;
  }

  function readTexts() {
    return {
      name: fields.name.value.trim(),
      shortMsg: fields.shortMsg.value.trim(),
      longMsg: fields.longMsg.value.trim(),
    };
  }

  function goNext() {
    const { name, shortMsg, longMsg } = readTexts();
    if (!name || !shortMsg || !longMsg) return showError('이름, 한줄 멘트, 방명록을 모두 입력해 주세요.');
    showStep(2);
  }

  nextBtn.addEventListener('click', goNext);
  prevBtn.addEventListener('click', () => showStep(1));

  function setImg(img, src) {
    img.hidden = !src;
    if (src) img.src = src;
    else img.removeAttribute('src');
  }

  // 사진 선택 → 미리보기
  function setPhoto(file) {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = file ? URL.createObjectURL(file) : null;
    setImg(photoPreview, photoUrl);
    photoEmpty.hidden = Boolean(file);
  }
  fields.photo.addEventListener('change', () => {
    showError('');
    setPhoto(fields.photo.files[0] || null);
  });

  /** 캐릭터 원본 { front, walk, jump, ladder, rope }이 바뀌면 배경 제거·축소를 다시 하고 미리보기를 갱신 */
  async function setSources(sources) {
    const current = (preparing = prepareSpriteImages(sources));
    let prepared = null;
    try {
      prepared = await current;
    } catch (err) {
      showError(err.message);
    }
    if (current !== preparing) return; // 그 사이 다른 이미지로 바뀜
    setImg(frontPreview, prepared?.front);
    setImg(walkPreview, prepared?.walk);
    previewEmpty.hidden = Boolean(prepared);
  }

  function setBusy(busy, text = '') {
    generating = busy;
    generateBtn.disabled = busy;
    submitBtn.disabled = busy;
    prevBtn.disabled = busy;
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
    const label = typeof text === 'function' ? text : () => text;
    const render = () => setBusy(true, `${label()} ${Math.floor((Date.now() - started) / 1000)}초`);
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
      const sources = { front };
      await setSources(sources);

      // 나머지 동작(걷기·점프·사다리·로프)은 정면 캐릭터를 기준으로 2개씩 동시에 만든다 (API 속도 제한 대비).
      // 하나가 실패해도 나머지로 등록할 수 있다.
      const queue = [...CONFIG.sprite.motions];
      const failed = [];
      let done = 0;
      const total = queue.length;
      const worker = async () => {
        while (queue.length) {
          const motion = queue.shift();
          try {
            sources[motion] = await generateCharacter(motion, front);
          } catch (err) {
            failed.push({ motion, err });
          }
          done++;
        }
      };
      await withProgress(
        () => `움직임 만드는 중... (2/2, ${done}/${total})`,
        () => Promise.all([worker(), worker()])
      );
      await setSources({ ...sources });
      if (failed.length) {
        const labels = { walk: '걷기', jump: '점프', ladder: '사다리', rope: '로프' };
        showError(
          `${failed.map((f) => labels[f.motion]).join(', ')} 동작은 만들지 못했어요. ` +
            `이대로 등록해도 되고, 다시 만들 수도 있어요. (${failed[0].err.message})`
        );
      }
    } catch (err) {
      showError(err.message);
    } finally {
      setBusy(false);
      updateGenerateLabel();
    }
  });

  function resetForm() {
    form.reset();
    setPhoto(null);
    preparing = null;
    setImg(frontPreview, null);
    setImg(walkPreview, null);
    previewEmpty.hidden = false;
    showStep(1);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (step === 1) return goNext(); // 1단계에서 엔터
    if (generating) return;
    showError('');
    const { name, shortMsg, longMsg } = readTexts();
    if (!name || !shortMsg || !longMsg) {
      showStep(1);
      return goNext();
    }

    submitBtn.disabled = true;
    prevBtn.disabled = true;
    submitBtn.textContent = '등록 중...';
    try {
      const images = await (preparing ?? Promise.resolve(null));
      const guest = await submitGuestbook({ name, shortMsg, longMsg, images });
      // 저장소 반영(배포)까지 1~2분 걸리므로, 방금 처리한 이미지로 바로 맵에 띄운다
      UI.onGuestCreated?.({
        ...guest,
        spriteUrl: images?.front ?? null,
        ...Object.fromEntries(CONFIG.sprite.motions.map((m) => [`${m}Url`, images?.[m] ?? null])),
      });
      resetForm();
      writeModal.close();
      showToast('방명록이 등록되었어요! 🎉');
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
      prevBtn.disabled = false;
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

  return { openGuestbook, showToast, onGuestCreated: null, onModalChange: null };
})();
