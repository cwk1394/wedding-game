// DOM 기반 UI (방명록 팝업, 작성 폼, 토스트)

const UI = (() => {
  const toast = document.getElementById('toast');
  let toastTimer = null;

  const menu = document.getElementById('menu');

  /** 팝업이나 메뉴가 하나라도 떠 있는지 → UI.onModalChange로 알림 (그동안 맵 입력을 막는 데 사용) */
  function notifyModalChange() {
    const open = Boolean(document.querySelector('.modal:not([hidden])')) || menu.classList.contains('open');
    UI.onModalChange?.(open);
  }

  // ESC는 맨 위(DOM에서 마지막)에 떠 있는 팝업 하나만 닫는다
  const closers = new Map(); // 팝업 요소 → 닫기 함수
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = [...document.querySelectorAll('.modal:not([hidden])')].pop();
    closers.get(top)?.();
  });

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
    closers.set(el, () => setOpen(false));
    return { open: () => setOpen(true), close: () => setOpen(false) };
  }

  // ---------- 방명록 보기 ----------
  const viewModal = setupModal(document.getElementById('modal'));

  const controlBtn = document.querySelector('#modal .control-btn');
  const editBtn = document.querySelector('#modal .edit-btn');
  let controlAction = null;
  let manageTarget = null;
  controlBtn.addEventListener('click', () => {
    viewModal.close();
    controlAction?.();
  });
  editBtn.addEventListener('click', () => {
    viewModal.close();
    openEdit(manageTarget);
  });

  /**
   * 방명록 보기.
   * control: { controlling, onControl, onRelease } — 오른쪽 아래 버튼이 조종 중이면 "조종 끝내기", 아니면 "조종하기"
   * manage: { info, onUpdated(guest), onDeleted() } — 있으면 조종하기 왼쪽에 "수정" 버튼 (하객만)
   */
  function openGuestbook({ name, shortMsg, longMsg, avatarUrl }, control = null, manage = null) {
    controlBtn.hidden = !control;
    editBtn.hidden = !manage;
    manageTarget = manage;
    if (control) {
      controlBtn.textContent = control.controlling ? '조종 끝내기' : '조종하기';
      controlBtn.classList.toggle('btn-ghost', control.controlling);
      controlAction = control.controlling ? control.onRelease : control.onControl;
    }
    document.getElementById('modal-name').textContent = name;
    document.getElementById('modal-short').textContent = shortMsg ? `“${shortMsg}”` : '';
    document.getElementById('modal-long').textContent = longMsg || '';
    const avatar = document.getElementById('modal-avatar');
    avatar.parentElement.hidden = !avatarUrl;
    if (avatarUrl) avatar.src = avatarUrl;
    viewModal.open();
  }

  // ---------- 방명록 수정/삭제 ----------
  const editModal = setupModal(document.getElementById('edit-modal'));
  const editForm = document.getElementById('edit-form');
  const ef = editForm.elements;
  const editError = editForm.querySelector('.form-error');
  const editSubmit = editForm.querySelector('.edit-submit');
  const deleteBtn = editForm.querySelector('.delete-btn');
  let editing = null; // { target, password, verified }

  const setEditError = (msg) => {
    editError.textContent = msg || '';
    editError.hidden = !msg;
  };
  function showEditStep(step) {
    editForm.querySelectorAll('[data-edit-step]').forEach((el) => (el.hidden = el.dataset.editStep !== step));
    deleteBtn.hidden = step !== 'form';
    editSubmit.textContent = step === 'form' ? '저장' : '확인';
    document.getElementById('edit-title').textContent = step === 'form' ? '방명록 수정' : '비밀번호 확인';
  }

  function openEdit(target) {
    if (!target) return;
    editing = { target, password: '', verified: false };
    editForm.reset();
    setEditError('');
    showEditStep('password');
    editModal.open();
    setTimeout(() => ef.password.focus(), 50);
  }

  const request = (action, extra = {}) =>
    manageGuestbook(action, { number: editing.target.info.number, id: editing.target.info.id, password: editing.password, ...extra });

  async function busy(btn, label, task) {
    const text = btn.textContent;
    btn.disabled = true;
    editSubmit.disabled = true;
    deleteBtn.disabled = true;
    btn.textContent = label;
    try {
      await task();
    } catch (err) {
      setEditError(err.message);
    } finally {
      btn.disabled = false;
      editSubmit.disabled = false;
      deleteBtn.disabled = false;
      if (btn.textContent === label) btn.textContent = text;
    }
  }

  editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    setEditError('');
    if (!editing.verified) {
      editing.password = ef.password.value;
      if (!editing.password) return setEditError('비밀번호를 입력해 주세요.');
      return busy(editSubmit, '확인 중...', async () => {
        await request('verify');
        editing.verified = true;
        const { info } = editing.target;
        ef.name.value = info.name;
        ef.shortMsg.value = info.shortMsg ?? '';
        ef.longMsg.value = info.longMsg ?? '';
        showEditStep('form');
      });
    }
    const name = ef.name.value.trim();
    const shortMsg = ef.shortMsg.value.trim();
    const longMsg = ef.longMsg.value.trim();
    if (!name || !shortMsg || !longMsg) return setEditError('이름, 한줄 멘트, 방명록을 모두 입력해 주세요.');
    return busy(editSubmit, '저장 중...', async () => {
      const { guest } = await request('update', { name, shortMsg, longMsg });
      editing.target.onUpdated?.(guest);
      editModal.close();
      showToast('방명록을 수정했어요');
    });
  });

  deleteBtn.addEventListener('click', () => {
    if (!confirm('이 캐릭터와 방명록을 삭제할까요? 되돌릴 수 없어요.')) return;
    setEditError('');
    busy(deleteBtn, '삭제 중...', async () => {
      await request('delete');
      editing.target.onDeleted?.();
      editModal.close();
      showToast('방명록을 삭제했어요');
    });
  });

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
  const frontPreview = form.querySelector('.preview-front'); // 미리보기는 정면만 (동작 이미지는 표시 안 함)
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
      password: fields.password.value,
    };
  }

  function goNext() {
    const { name, shortMsg, longMsg, password } = readTexts();
    if (!name || !shortMsg || !longMsg) return showError('이름, 한줄 멘트, 방명록을 모두 입력해 주세요.');
    if ([...password].length < 4) return showError('비밀번호를 4자 이상 입력해 주세요.');
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
    const photo = fields.photo.files[0]; // 없으면 사진 없이 무작위 캐릭터를 새로 그린다
    if (generationCount >= CONFIG.ai.maxGenerations) return showError('생성 가능 횟수를 모두 썼어요.');
    generationCount++;

    try {
      const front = await withProgress('캐릭터 도트 찍는 중... (1/2)', async () =>
        generateCharacter('front', photo ? await resizePhoto(photo) : null)
      );
      const sources = { front };
      await setSources(sources);

      // 나머지 동작(걷기·점프·사다리·로프)은 정면 캐릭터를 기준으로 전부 동시에 만든다.
      // 하나가 실패해도 나머지로 등록할 수 있다.
      const motions = CONFIG.sprite.motions;
      const failed = [];
      let done = 0;
      await withProgress(
        () => `움직임 만드는 중... (2/2, ${done}/${motions.length})`,
        () =>
          Promise.all(
            motions.map(async (motion) => {
              try {
                sources[motion] = await generateCharacter(motion, front);
              } catch (err) {
                failed.push({ motion, err });
              }
              done++;
            })
          )
      );
      await setSources({ ...sources });
      if (failed.length) {
        const labels = { walk: '걷기', jump: '점프', ladder: '사다리', rope: '로프', prone: '엎드리기' };
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
    previewEmpty.hidden = false;
    showStep(1);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (step === 1) return goNext(); // 1단계에서 엔터
    if (generating) return;
    showError('');
    const { name, shortMsg, longMsg, password } = readTexts();
    if (!name || !shortMsg || !longMsg || [...password].length < 4) {
      showStep(1);
      return goNext();
    }

    submitBtn.disabled = true;
    prevBtn.disabled = true;
    submitBtn.textContent = '등록 중...';
    try {
      const images = await (preparing ?? Promise.resolve(null));
      const guest = await submitGuestbook({ name, shortMsg, longMsg, password, images });
      // 저장소 반영(배포)까지 1~2분 걸리므로, 방금 처리한 이미지로 바로 맵에 띄운다
      UI.onGuestCreated?.({
        ...guest,
        spriteUrl: images?.front ?? null,
        ...Object.fromEntries(CONFIG.sprite.motions.map((m) => [`${m}Url`, images?.[m] ?? null])),
      });
      resetForm();
      writeModal.close();
      showToast(
        matchMedia('(pointer: coarse)').matches
          ? '방명록이 등록되었어요! 🎉 스틱과 점프 버튼으로 움직여 보세요'
          : '방명록이 등록되었어요! 🎉 방향키와 Space(점프)로 움직여 보세요',
        3500
      );
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
      prevBtn.disabled = false;
      submitBtn.textContent = '등록하기';
    }
  });

  function openWrite() {
    if (!CONFIG.apiUrl) return showToast('방명록 작성은 곧 오픈됩니다!');
    writeModal.open();
  }

  // ---------- 방명록 목록 ----------
  const listModal = setupModal(document.getElementById('list-modal'));
  const listEl = document.querySelector('#list-modal .guest-list');

  /** UI.getGuests()가 돌려주는 맵 위 하객 [{ info, avatarUrl() }]로 목록을 그린다 (최신순) */
  function openList() {
    const guests = (UI.getGuests?.() ?? []).slice().sort((a, b) =>
      String(b.info.createdAt ?? '9').localeCompare(String(a.info.createdAt ?? '9'))
    );
    document.getElementById('list-title').textContent = `방명록 목록 (${guests.length})`;
    document.querySelector('#list-modal .empty-note').hidden = guests.length > 0;
    listEl.replaceChildren(
      ...guests.map((g) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        const avatar = document.createElement('img');
        avatar.className = 'guest-avatar';
        avatar.alt = '';
        avatar.loading = 'lazy';
        avatar.src = g.avatarUrl();
        const text = document.createElement('span');
        text.className = 'guest-text';
        const name = document.createElement('b');
        name.textContent = g.info.name;
        const msg = document.createElement('small');
        msg.textContent = g.info.shortMsg || g.info.longMsg || '';
        text.append(name, msg);
        btn.append(avatar, text);
        btn.addEventListener('click', () => openGuestbook({ ...g.info, avatarUrl: avatar.src }));
        li.append(btn);
        return li;
      })
    );
    listModal.open();
  }

  // ---------- 웨딩 갤러리 ----------
  // 사진 목록은 배포 때 img/gallery/ 폴더를 읽어 만든 data/gallery.json (scripts/build-gallery.mjs)
  const galleryEl = document.getElementById('gallery-modal');
  const galleryModal = setupModal(galleryEl);
  const grid = galleryEl.querySelector('.gallery-grid');
  const viewer = galleryEl.querySelector('.gallery-viewer');
  const photo = galleryEl.querySelector('.gallery-photo');
  let photos = null;
  let photoIndex = 0;

  async function loadPhotos() {
    if (photos) return photos;
    try {
      const res = await fetch(`data/gallery.json?t=${Date.now()}`);
      // 항목: { thumb: 목록용 썸네일, src: 크게 보기용 } (예전 형식인 문자열도 허용)
      const list = res.ok ? (await res.json()).photos ?? [] : [];
      photos = list.map((p) => (typeof p === 'string' ? { thumb: p, src: p } : p));
    } catch {
      photos = [];
    }
    return photos;
  }

  function showPhoto(i) {
    photoIndex = (i + photos.length) % photos.length;
    photo.src = photos[photoIndex].src;
    // 좌우 사진은 미리 받아 두어 넘길 때 바로 보이게
    for (const d of [-1, 1]) new Image().src = photos[(photoIndex + d + photos.length) % photos.length].src;
    galleryEl.querySelector('.gallery-count').textContent = `${photoIndex + 1} / ${photos.length}`;
    grid.hidden = true;
    viewer.hidden = false;
  }

  function showGrid() {
    viewer.hidden = true;
    grid.hidden = photos.length === 0;
  }

  async function openGallery() {
    galleryModal.open();
    await loadPhotos();
    galleryEl.querySelector('.empty-note').hidden = photos.length > 0;
    if (!grid.childElementCount) {
      grid.append(
        ...photos.map(({ thumb }, i) => {
          const btn = document.createElement('button');
          btn.type = 'button';
          const img = document.createElement('img');
          img.src = thumb;
          img.decoding = 'async';
          img.alt = `웨딩 사진 ${i + 1}`;
          img.loading = 'lazy';
          btn.append(img);
          btn.addEventListener('click', () => showPhoto(i));
          return btn;
        })
      );
    }
    showGrid();
  }

  // 사진 좌우 가장자리 누르기 (방금 밀어서 넘겼으면 그 뒤에 따라오는 click은 무시)
  let lastSwipe = 0;
  const edgeTap = (d) => () => {
    if (Date.now() - lastSwipe > 350) showPhoto(photoIndex + d);
  };
  galleryEl.querySelector('.prev').addEventListener('click', edgeTap(-1));
  galleryEl.querySelector('.next').addEventListener('click', edgeTap(1));
  galleryEl.querySelector('.gallery-back').addEventListener('click', showGrid);
  // 사진을 좌우로 밀어서 넘기기
  let swipeX = null;
  viewer.addEventListener('pointerdown', (e) => (swipeX = e.clientX));
  viewer.addEventListener('pointerup', (e) => {
    if (swipeX === null) return;
    const dx = e.clientX - swipeX;
    swipeX = null;
    if (Math.abs(dx) > 40) {
      lastSwipe = Date.now();
      showPhoto(photoIndex + (dx < 0 ? 1 : -1));
    }
  });
  document.addEventListener('keydown', (e) => {
    if (galleryEl.hidden || viewer.hidden) return;
    if (e.key === 'ArrowLeft') showPhoto(photoIndex - 1);
    if (e.key === 'ArrowRight') showPhoto(photoIndex + 1);
  });

  // ---------- 메뉴 (오른쪽 아래) ----------
  const menuBtn = document.getElementById('menu-btn');
  function setMenu(open) {
    menu.classList.toggle('open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? '메뉴 닫기' : '메뉴 열기');
    notifyModalChange();
  }
  menuBtn.addEventListener('click', () => setMenu(!menu.classList.contains('open')));
  const actions = { write: openWrite, list: openList, gallery: openGallery };
  menu.querySelectorAll('[data-menu]').forEach((btn) =>
    btn.addEventListener('click', () => {
      setMenu(false);
      actions[btn.dataset.menu]();
    })
  );
  // 메뉴 밖을 누르면 닫기 (맵을 눌러도 캐릭터가 선택되지 않고 메뉴만 닫힘)
  document.addEventListener('click', (e) => {
    if (menu.classList.contains('open') && !menu.contains(e.target)) setMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu.classList.contains('open')) setMenu(false);
  });

  // ---------- 토스트 ----------
  function showToast(message, duration = 2000) {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), duration);
  }

  // ---------- 배경음악 ----------
  // 자동 재생을 시도하고, 브라우저가 막으면(소리 있는 자동 재생은 사용자 동작이 필요) 첫 터치/클릭/키 입력 때 시작.
  // 켜고 끈 상태는 이 브라우저에 기억. 음악 파일이 없으면 버튼을 숨긴다.
  (() => {
    const btn = document.getElementById('bgm-btn');
    const audio = new Audio(CONFIG.bgm.src);
    audio.loop = true;
    audio.volume = CONFIG.bgm.volume;
    audio.preload = 'auto';
    let on = true;
    try {
      on = localStorage.getItem('bgm') !== 'off';
    } catch {}

    const render = () => {
      btn.classList.toggle('off', !on);
      btn.setAttribute('aria-pressed', String(on));
      btn.setAttribute('aria-label', on ? '배경음악 끄기' : '배경음악 켜기');
    };
    const play = () => {
      if (on) audio.play().catch(() => {}); // 막히면 다음 사용자 동작 때 다시 시도
    };
    const onFirstGesture = () => {
      play();
      if (!audio.paused || !on) ['pointerdown', 'keydown'].forEach((t) => window.removeEventListener(t, onFirstGesture, true));
    };

    audio.addEventListener('error', () => (btn.hidden = true)); // 파일 없음
    audio.addEventListener('canplay', () => (btn.hidden = false), { once: true });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      on = !on;
      try {
        localStorage.setItem('bgm', on ? 'on' : 'off');
      } catch {}
      if (on) play();
      else audio.pause();
      render();
    });
    ['pointerdown', 'keydown'].forEach((t) => window.addEventListener(t, onFirstGesture, true));
    render();
    play();
  })();

  return { openGuestbook, showToast, onGuestCreated: null, onModalChange: null, getGuests: null };
})();
