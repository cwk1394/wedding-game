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
    if (top?.matches('.lobby, .fullscreen, .select-screen')) return; // 로비·캐릭터 만들기·선택 화면은 닫지 않음
    closers.get(top)?.();
  });

  /** 모달 공통 동작: 닫기 버튼/ESC로 닫기 */
  function setupModal(el) {
    let openedAt = 0;
    const setOpen = (open) => {
      el.hidden = !open;
      if (open) openedAt = Date.now();
      notifyModalChange();
    };
    // 닫기 버튼으로만 닫는다 (바깥 맵을 눌러도 안 닫힘).
    // 모바일에서 캐릭터 터치 직후 따라오는 click이 같은 자리의 닫기 버튼에 맞는 것 방지로 400ms는 무시
    el.addEventListener('click', (e) => {
      if (Date.now() - openedAt < 400) return;
      if (e.target.closest('[data-close]')) setOpen(false);
    });
    closers.set(el, () => setOpen(false));
    return { open: () => setOpen(true), close: () => setOpen(false) };
  }

  // ---------- 관계·성향 목록, 능력치 ----------
  // 모든 관계/성향 선택 칸(작성·수정 폼)을 CONFIG 목록으로 채운다
  const fillSelect = (name, map) =>
    document.querySelectorAll(`select[name="${name}"]`).forEach((sel) => {
      sel.replaceChildren(new Option('선택해 주세요', ''), ...Object.entries(map).map(([k, v]) => new Option(typeof v === 'string' ? v : v.label, k)));
    });
  fillSelect('side', CONFIG.sides);
  fillSelect('relation', CONFIG.relations);
  fillSelect('personality', CONFIG.personalities);
  // 캐릭터 만들기 창은 선택 칸 대신 눌러서 고르는 칩 (라디오라 form.elements[name].value로 읽힘)
  const fillChips = (name, map) =>
    document.querySelectorAll(`[data-chips="${name}"]`).forEach((box) => {
      box.replaceChildren(
        ...Object.entries(map).map(([k, v]) => {
          const chip = document.createElement('label');
          chip.className = 'chip';
          const input = Object.assign(document.createElement('input'), { type: 'radio', name, value: k });
          const text = Object.assign(document.createElement('span'), { textContent: typeof v === 'string' ? v : v.label });
          chip.append(input, text);
          return chip;
        })
      );
    });
  fillChips('side', CONFIG.sides);
  fillChips('relation', CONFIG.relations);
  fillChips('personality', CONFIG.personalities);

  const STAT_LABELS = { str: 'STR', dex: 'DEX', int: 'INT', luk: 'LUK' };

  /** 주사위: 각 능력치 min에서 시작, 남은 점수를 한 점씩 무작위 능력치에 → 합은 항상 total, 끝값일수록 드묾 */
  function rollStats() {
    const { keys, min, total } = CONFIG.stats;
    const stats = Object.fromEntries(keys.map((k) => [k, min]));
    for (let i = 0; i < total - min * keys.length; i++) stats[keys[Math.floor(Math.random() * keys.length)]]++;
    return stats;
  }

  function renderStats(el, stats) {
    el.replaceChildren(
      ...CONFIG.stats.keys.map((k) => {
        const cell = document.createElement('div');
        cell.className = 'stat';
        cell.innerHTML = `<b>${STAT_LABELS[k]}</b><span></span>`;
        cell.querySelector('span').textContent = stats[k];
        return cell;
      })
    );
  }

  /** 관계 · 성향 한글 이름 */
  const profileTags = (info) => [...relationTags(info), CONFIG.personalities[info.personality]?.label].filter(Boolean);

  /** 어느 쪽 · 어떤 관계 한글 이름 (예전 데이터는 relation에 groom/bride/both가 들어 있을 수 있음) */
  function relationTags({ side, relation }) {
    return [CONFIG.sides[side ?? relation], CONFIG.relations[relation]].filter(Boolean);
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
    if (manageTarget?.onEdit) manageTarget.onEdit(); // 개발자 모드 신랑·신부: 멘트 수정 창
    else openEdit(manageTarget);
  });

  /**
   * 방명록 보기.
   * control: { controlling, onControl, onRelease } — 오른쪽 아래 버튼이 조종 중이면 "조종 끝내기", 아니면 "조종하기"
   * manage: { info, onUpdated(guest), onDeleted() } — 있으면 조종하기 왼쪽에 "수정" 버튼 (하객만)
   *         { onEdit() } — 개발자 모드 신랑·신부: "수정"을 누르면 onEdit (멘트·소개 글 창)
   */
  function openGuestbook({ name, shortMsg, longMsg, avatarUrl, title, titleStyle, side, relation, personality, stats }, control = null, manage = null) {
    controlBtn.hidden = !control;
    editBtn.hidden = !manage;
    manageTarget = manage;
    if (control) {
      controlBtn.textContent = control.controlling ? '조종 끝내기' : '조종하기';
      controlBtn.classList.toggle('btn-ghost', control.controlling);
      controlAction = control.controlling ? control.onRelease : control.onControl;
    }
    document.getElementById('modal-name').textContent = name;
    const titleEl = document.getElementById('modal-title');
    titleEl.hidden = !title;
    titleEl.textContent = title || '';
    titleEl.classList.toggle('gold', titleStyle === 'gold');
    document.getElementById('modal-tags').textContent = profileTags({ side, relation, personality }).join(' · ');
    const statsEl = document.getElementById('modal-stats');
    statsEl.hidden = !stats;
    if (stats) renderStats(statsEl, stats);
    document.getElementById('modal-short').textContent = shortMsg ? `“${shortMsg}”` : '';
    document.getElementById('modal-long').textContent = longMsg || '';
    const avatar = document.getElementById('modal-avatar');
    avatar.parentElement.hidden = !avatarUrl;
    if (avatarUrl) avatar.src = avatarUrl;
    viewModal.open();
  }

  // ---------- 개발자 모드: NPC 설정 ----------
  const npcModal = setupModal(document.getElementById('npc-modal'));
  const npcForm = document.getElementById('npc-form');
  let npcApply = null;
  const npcError = npcForm.querySelector('.form-error');
  const setNpcError = (msg) => {
    npcError.textContent = msg || '';
    npcError.hidden = !msg;
  };
  const npcCreate = npcForm.querySelector('.npc-create');
  const npcGenerate = npcForm.querySelector('.npc-generate');
  const npcSubmit = npcForm.querySelector('.npc-submit');
  const npcStatus = npcCreate.querySelector('.gen-status');
  const npcPhoto = npcCreate.querySelector('.photo-preview');
  const npcPreview = npcCreate.querySelector('.preview-front');
  let npcImages = null; // NPC 추가: 생성한 이미지 { front, idle?, walk? } (webp data URL)
  let npcPhotoUrl = null;
  let npcDelete = null; // 설정 창의 삭제 콜백
  const regenToggle = npcForm.querySelector('.npc-regen-toggle');
  regenToggle.addEventListener('click', () => {
    npcCreate.hidden = !npcCreate.hidden;
    regenToggle.textContent = npcCreate.hidden ? '이미지 새로 만들기 ▾' : '이미지 새로 만들기 ▴';
  });
  const npcDeleteBtn = npcForm.querySelector('.npc-delete');
  npcDeleteBtn.addEventListener('click', () => {
    if (!confirm(`"${npcForm.elements.name.value || 'NPC'}"를 삭제할까요? (저장 전엔 되돌리기로 살릴 수 있어요)`)) return;
    npcModal.close();
    npcDelete?.();
  });

  npcForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (npcGenerate.disabled) return; // 생성 중
    const f = npcForm.elements;
    const error = npcApply?.({
      name: f.name.value.trim(),
      dir: f.dir.value.trim(),
      shortMsg: f.shortMsg.value.trim(),
      longMsg: f.longMsg.value.trim(),
      mode: f.mode.value,
      album: f.kind.value === 'album' ? f.album.value.trim() : null, // 일반 NPC면 null
      // NPC 추가일 때만
      desc: f.desc.value.trim(),
      height: Number(f.height.value),
      moving: f.moving.value,
      images: npcImages, // 추가: 필수, 설정: 새로 만들었을 때만
    });
    if (error) return setNpcError(error);
    npcModal.close();
  });

  const setImgSrc = (img, src) => {
    img.hidden = !src;
    if (src) img.src = src;
    else img.removeAttribute('src');
  };

  npcForm.elements.photo.addEventListener('change', () => {
    if (npcPhotoUrl) URL.revokeObjectURL(npcPhotoUrl);
    const file = npcForm.elements.photo.files[0];
    npcPhotoUrl = file ? URL.createObjectURL(file) : null;
    setImgSrc(npcPhoto, npcPhotoUrl);
    npcCreate.querySelector('.photo-empty').hidden = Boolean(file);
  });
  // 분류가 앨범일 때만 앨범 디렉토리 칸
  let npcCreating = false; // NPC 추가 창이면 앨범 사진 칸은 숨김 (추가 후 설정에서)
  const showAlbum = () => {
    const album = npcForm.elements.kind.value === 'album';
    npcForm.querySelector('.npc-album').hidden = !album;
    npcForm.querySelector('.npc-album-photos').hidden = !album || npcCreating;
  };

  // ---------- 앨범 사진 올리기 (NPC 설정, 개발자 모드) ----------
  const albumBtn = npcForm.querySelector('.album-upload-btn');
  const albumStatus = npcForm.querySelector('.album-status');

  /** 지금 앨범 사진 수 (배포된 gallery.json 기준) */
  async function showAlbumCount() {
    const album = npcForm.elements.album.value.trim();
    const el = npcForm.querySelector('.album-count');
    el.textContent = '';
    if (!album) return;
    const photos = await loadPhotos();
    el.textContent = `(지금 ${photos.filter((p) => p.album === album).length}장)`;
  }
  npcForm.elements.album.addEventListener('change', showAlbumCount);

  // ---------- 앨범 사진 관리 (순서 바꾸기·지우기) ----------
  // 사진 목록은 저장소 기준(API album-list), 썸네일은 배포된 gallery.json에서 이름으로 찾음 (막 올린 사진은 이름만)
  const albumEl = document.getElementById('album-modal');
  const albumModal = setupModal(albumEl);
  const albumGrid = albumEl.querySelector('.album-grid');
  const albumSave = albumEl.querySelector('.album-save');
  const albumError = albumEl.querySelector('.form-error');
  let albumState = null; // { album, password, items: [{ name, thumb, removed }] }

  const setAlbumError = (msg) => {
    albumError.textContent = msg || '';
    albumError.hidden = !msg;
  };
  const baseName = (name) => decodeURIComponent(name).replace(/\.[^.]*$/, '');

  npcForm.querySelector('.album-manage-btn').addEventListener('click', async () => {
    const album = npcForm.elements.album.value.trim();
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(album)) return setNpcError('앨범 디렉토리 이름(영문 소문자·숫자·-)을 먼저 입력해 주세요.');
    const password = devPassword();
    if (!password) return setNpcError('개발자 비밀번호를 입력해야 사진을 관리할 수 있어요.');
    albumState = { album, password, items: [] };
    document.getElementById('album-title').textContent = `앨범 사진 관리 (${album})`;
    setAlbumError('');
    albumGrid.replaceChildren();
    albumEl.querySelector('.empty-note').hidden = true;
    const loading = albumEl.querySelector('.album-loading');
    loading.hidden = false;
    loading.querySelector('.gen-text').textContent = '사진 목록 불러오는 중...';
    albumSave.disabled = true;
    albumModal.open();
    try {
      const [{ files }, photos] = await Promise.all([postJson('/api/map', { password, action: 'album-list', album }), loadPhotos()]);
      rememberDevPassword(password);
      const thumbs = new Map(photos.filter((p) => p.album === album).map((p) => [baseName(p.thumb.split('/').pop()), p.thumb]));
      albumState.items = files.map((name) => ({ name, thumb: thumbs.get(baseName(name)) ?? null, removed: false }));
      renderAlbum();
    } catch (err) {
      rememberDevPassword(password, err);
      setAlbumError(err.message);
    } finally {
      loading.hidden = true;
      albumSave.disabled = false;
    }
  });

  function renderAlbum() {
    const { items } = albumState;
    albumEl.querySelector('.empty-note').hidden = items.length > 0;
    let n = 0;
    albumGrid.replaceChildren(
      ...items.map((item, i) => {
        const li = document.createElement('li');
        li.className = 'album-item' + (item.removed ? ' removed' : '');
        const pic = item.thumb ? Object.assign(document.createElement('img'), { src: item.thumb, alt: item.name, loading: 'lazy' }) : Object.assign(document.createElement('span'), { className: 'album-noimg', textContent: item.name });
        const num = Object.assign(document.createElement('b'), { className: 'album-num', textContent: item.removed ? '삭제' : ++n });
        const btn = (label, title, onClick, disabled = false) => {
          const b = Object.assign(document.createElement('button'), { type: 'button', textContent: label, title, disabled });
          b.addEventListener('click', onClick);
          return b;
        };
        const move = (d) => () => {
          [items[i], items[i + d]] = [items[i + d], items[i]];
          renderAlbum();
        };
        const tools = document.createElement('div');
        tools.className = 'album-tools';
        tools.append(
          btn('◀', '앞으로', move(-1), i === 0 || item.removed),
          btn(item.removed ? '↺' : '✕', item.removed ? '되살리기' : '지우기', () => {
            item.removed = !item.removed;
            renderAlbum();
          }),
          btn('▶', '뒤로', move(1), i === items.length - 1 || item.removed)
        );
        li.append(pic, num, tools);
        return li;
      })
    );
  }

  albumSave.addEventListener('click', async () => {
    if (!albumState?.items.length) return albumModal.close();
    const { album, password, items } = albumState;
    const order = items.filter((it) => !it.removed).map((it) => it.name);
    const remove = items.filter((it) => it.removed).map((it) => it.name);
    if (remove.length && !confirm(`사진 ${remove.length}장을 지울까요? (git 기록에는 남아요)`)) return;
    setAlbumError('');
    albumSave.disabled = true;
    albumSave.textContent = '저장 중...';
    try {
      await postJson('/api/map', { password, action: 'album-arrange', album, order, remove });
      albumModal.close();
      showToast(`앨범을 정리했어요 (${order.length}장${remove.length ? `, ${remove.length}장 삭제` : ''}). 1~2분 뒤 반영돼요`, 3500);
    } catch (err) {
      setAlbumError(err.message);
    } finally {
      albumSave.disabled = false;
      albumSave.textContent = '저장';
    }
  });

  albumBtn.addEventListener('click', async () => {
    const f = npcForm.elements;
    const album = f.album.value.trim();
    const files = [...f.albumPhotos.files];
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(album)) return setNpcError('앨범 디렉토리 이름(영문 소문자·숫자·-)을 먼저 입력해 주세요.');
    if (!files.length) return setNpcError('올릴 사진을 골라 주세요.');
    const password = devPassword();
    if (!password) return setNpcError('개발자 비밀번호를 입력해야 사진을 올릴 수 있어요.');
    setNpcError('');
    albumBtn.disabled = npcSubmit.disabled = true;
    albumStatus.hidden = false;
    const text = albumStatus.querySelector('.gen-text');
    let done = 0;
    try {
      // 3장씩 나눠 보낸다 (Vercel 요청 크기 한도 4.5MB)
      for (let i = 0; i < files.length; i += 3) {
        const batch = files.slice(i, i + 3);
        text.textContent = `사진 줄이는 중... ${done}/${files.length}`;
        const photos = await Promise.all(batch.map(async (file) => ({ name: file.name, data: await resizePhoto(file, 2000) })));
        text.textContent = `사진 올리는 중... ${done}/${files.length}`;
        await postJson('/api/map', { password, action: 'album-photos', album, photos });
        rememberDevPassword(password);
        done += batch.length;
      }
      f.albumPhotos.value = '';
      showToast(`앨범에 ${done}장 올렸어요. 1~2분 뒤 앨범에 보여요`, 3500);
    } catch (err) {
      rememberDevPassword(password, err);
      setNpcError(`${done}장까지 올렸어요. ${err.message}`);
    } finally {
      albumStatus.hidden = true;
      albumBtn.disabled = npcSubmit.disabled = false;
    }
  });
  npcForm.elements.kind.addEventListener('change', showAlbum);
  // 사물은 보통 가만히 서 있으니 배치도 고정으로
  npcForm.elements.moving.addEventListener('change', (e) => {
    npcForm.elements.mode.value = e.target.value === 'static' ? 'fixed' : 'random';
  });

  // 캐릭터 생성: (사진) + 설명 → 정면, 걸어다니면 정면을 기준으로 제자리(idle)·걷기(walk)를 동시에
  npcGenerate.addEventListener('click', async () => {
    const f = npcForm.elements;
    const desc = f.desc.value.trim();
    if (!desc) return setNpcError('NPC 설명(무엇인지)을 입력해 주세요.');
    const password = devPassword(); // NPC 캐릭터 생성은 개발자 비밀번호 필요 (dev.js)
    if (!password) return setNpcError('개발자 비밀번호를 입력해야 캐릭터를 만들 수 있어요.');
    setNpcError('');
    const started = Date.now();
    let text = '';
    const render = () => (npcStatus.querySelector('.gen-text').textContent = `${text} ${Math.floor((Date.now() - started) / 1000)}초`);
    const timer = setInterval(render, 1000);
    const step = (t) => {
      text = t;
      render();
    };
    npcGenerate.disabled = npcSubmit.disabled = true;
    npcStatus.hidden = false;
    try {
      const photo = f.photo.files[0];
      step('NPC 도트 찍는 중... (1/2)');
      const front = await generateCharacter('npc-front', photo ? await resizePhoto(photo) : null, { desc, password });
      rememberDevPassword(password);
      npcImages = { front };
      setImgSrc(npcPreview, front);
      npcCreate.querySelector('.preview-empty').hidden = true;
      if (f.moving.value === 'walk') {
        step('움직임 만드는 중... (2/2)');
        const failed = [];
        await Promise.all(
          ['idle', 'walk'].map((m) =>
            generateCharacter(`npc-${m}`, front, { desc, password })
              .then((img) => (npcImages[m] = img))
              .catch(() => failed.push(m === 'idle' ? '제자리' : '걷기'))
          )
        );
        if (failed.length) setNpcError(`${failed.join('·')} 움직임은 만들지 못했어요. 그대로 추가하거나 다시 생성해 주세요.`);
      }
      npcGenerate.textContent = '다시 만들기';
    } catch (err) {
      rememberDevPassword(password, err);
      setNpcError(err.message);
    } finally {
      clearInterval(timer);
      npcStatus.hidden = true;
      npcGenerate.disabled = npcSubmit.disabled = false;
    }
  });

  /**
   * NPC 설정 창. onApply({ name, dir, shortMsg, longMsg, mode, (추가일 때) desc, height, images }) → 오류 문구를 돌려주면 창을 닫지 않고 보여줌
   * opts.create = NPC 추가 (사진·설명·캐릭터 생성 칸), opts.dirLocked = 디렉토리 칸 잠금 (아직 저장 안 한 추가 NPC)
   * opts.onDelete = 있으면 왼쪽 아래 "NPC 삭제" 버튼, opts.textsOnly = 이름·멘트·소개 글만 (신랑·신부)
   */
  /**
   * regen: NPC 설정에서 "이미지 새로 만들기" 칸 { desc, moving, height, heightLocked } — 사진·설명으로 다시 만들면 onApply에 images가 온다
   */
  function openNpcSettings({ name, dir, shortMsg, longMsg, mode, album, avatarUrl }, onApply, { create = false, dirLocked = false, onDelete = null, textsOnly = false, regen = null } = {}) {
    npcForm.elements.dir.closest('label').hidden = textsOnly;
    npcForm.querySelector('.npc-kind').hidden = textsOnly;
    npcForm.elements.kind.value = album ? 'album' : 'normal';
    npcForm.elements.album.value = album ?? '';
    npcForm.elements.albumPhotos.value = '';
    npcCreating = create;
    showAlbum();
    if (album && !create) showAlbumCount();
    npcForm.querySelector('.npc-modes').hidden = textsOnly;
    npcDelete = onDelete;
    npcDeleteBtn.hidden = !onDelete;
    const f = npcForm.elements;
    setNpcError('');
    document.getElementById('npc-title').textContent = create ? 'NPC 추가' : textsOnly ? `${name} 설정` : 'NPC 설정';
    npcForm.querySelector('.npc-profile').hidden = create;
    npcCreate.hidden = !create; // 설정일 땐 "이미지 새로 만들기"를 눌러야 펼쳐짐
    regenToggle.hidden = !regen;
    regenToggle.textContent = '이미지 새로 만들기 ▾';
    npcSubmit.textContent = create ? '추가' : '적용';
    f.dir.disabled = dirLocked;
    // 사진·설명·캐릭터 생성 칸 초기화 (추가: 빈 값, 설정: 지금 NPC 값)
    npcImages = null;
    f.photo.value = '';
    f.photo.dispatchEvent(new Event('change'));
    f.desc.value = regen?.desc ?? '';
    f.moving.value = regen?.moving ?? 'walk';
    f.height.value = regen?.height ?? 40;
    f.height.disabled = Boolean(regen?.heightLocked);
    setImgSrc(npcPreview, null);
    npcCreate.querySelector('.preview-empty').hidden = false;
    npcGenerate.textContent = '캐릭터 생성';
    document.getElementById('npc-name').textContent = name;
    f.name.value = name;
    f.dir.value = dir;
    if (avatarUrl) document.getElementById('npc-avatar').src = avatarUrl;
    f.shortMsg.value = shortMsg ?? '';
    f.longMsg.value = longMsg ?? '';
    f.mode.value = mode;
    npcApply = onApply;
    npcModal.open();
  }

  // ---------- 방명록 수정/삭제 ----------
  const editModal = setupModal(document.getElementById('edit-modal'));
  const editForm = document.getElementById('edit-form');
  const ef = editForm.elements;
  const editError = editForm.querySelector('.form-error');
  const editSubmit = editForm.querySelector('.edit-submit');
  const deleteBtn = editForm.querySelector('.delete-btn');
  let editing = null; // { target, letter, password, verified }

  const setEditError = (msg) => {
    editError.textContent = msg || '';
    editError.hidden = !msg;
  };
  function showEditStep(step) {
    const { letter } = editing;
    editForm.querySelectorAll('[data-edit-step]').forEach((el) => (el.hidden = el.dataset.editStep !== step));
    editForm.querySelector('.edit-char').hidden = letter;
    editForm.querySelector('.edit-letter').hidden = !letter;
    deleteBtn.hidden = step !== 'form' || letter;
    editSubmit.textContent = step === 'form' ? '저장' : '확인';
    document.getElementById('edit-title').textContent = step !== 'form' ? '비밀번호 확인' : letter ? '방명록 수정' : '캐릭터 수정';
  }

  /** 비밀번호 확인 → 수정 폼. letter면 방명록 글만(방명록 목록의 내 방명록), 아니면 캐릭터 정보만 */
  function openEdit(target, { letter = false } = {}) {
    if (!target) return;
    editing = { target, letter, password: '', verified: false };
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
        ef.side.value = info.side ?? (CONFIG.sides[info.relation] ? info.relation : ''); // 예전 데이터 호환
        ef.relation.value = CONFIG.relations[info.relation] ? info.relation : '';
        ef.personality.value = info.personality ?? '';
        ef.title.value = info.title ?? '';
        ef.shortMsg.value = info.shortMsg ?? '';
        ef.longMsg.value = info.longMsg ?? '';
        showEditStep('form');
      });
    }
    // 한 번에 한쪽만 고치고, 나머지 칸은 폼에 불러온 지금 값 그대로 보냄 (API는 전부 받음)
    const name = ef.name.value.trim();
    const shortMsg = ef.shortMsg.value.trim();
    const longMsg = ef.longMsg.value.trim();
    const side = ef.side.value;
    const relation = ef.relation.value;
    const personality = ef.personality.value;
    const title = ef.title.value.trim();
    if (editing.letter) {
      if (!longMsg) return setEditError('방명록을 입력해 주세요.');
      if (!side || !relation || !personality) return setEditError('예전에 쓴 글이라 관계·성향이 비어 있어요. 메뉴 "캐릭터 수정"에서 먼저 정해 주세요.');
    } else {
      if (!name || !shortMsg) return setEditError('이름과 한줄 멘트를 입력해 주세요.');
      if (!side || !relation || !personality) return setEditError('관계(두 가지)와 캐릭터 성향을 골라 주세요.');
    }
    return busy(editSubmit, '저장 중...', async () => {
      const { guest } = await request('update', { name, shortMsg, longMsg, side, relation, personality, title });
      editing.target.onUpdated?.(guest);
      editModal.close();
      showToast(editing.letter ? '방명록을 수정했어요' : '캐릭터를 수정했어요');
    });
  });

  deleteBtn.addEventListener('click', () => {
    if (!confirm('이 캐릭터와 방명록을 삭제할까요? 되돌릴 수 없어요.')) return;
    setEditError('');
    busy(deleteBtn, '삭제 중...', async () => {
      await request('delete');
      editing.target.onDeleted?.();
      editModal.close();
      showToast('캐릭터를 삭제했어요');
    });
  });

  // ---------- 캐릭터 만들기 (4단계: 내 정보 → 캐릭터 → 한마디·방명록 → 비밀번호·등록) ----------
  // 한 단계씩 옆으로 밀려 들어옴. AI 생성(1~3분)은 기다리지 않고 다음 단계로 넘어갈 수 있고, 등록만 생성이 끝날 때까지 막음
  const writeEl = document.getElementById('write-modal');
  const writeModal = setupModal(writeEl);
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
  const statGrid = form.querySelector('.stat-grid');
  const diceBtn = form.querySelector('.dice-btn');
  let stats = rollStats();
  renderStats(statGrid, stats);
  // 주사위: 잠깐 숫자가 굴러가다가 멈춘다
  diceBtn.addEventListener('click', () => {
    if (diceBtn.disabled) return;
    diceBtn.disabled = true;
    diceBtn.classList.add('rolling');
    let n = 0;
    const timer = setInterval(() => {
      stats = rollStats();
      renderStats(statGrid, stats);
      if (++n < 8) return;
      clearInterval(timer);
      diceBtn.disabled = false;
      diceBtn.classList.remove('rolling');
    }, 70);
  });

  function showError(message) {
    errorBox.textContent = message || '';
    errorBox.hidden = !message;
  }

  const LAST_STEP = 4;
  function showStep(n) {
    const dir = n >= step ? 'fwd' : 'back';
    step = n;
    showError('');
    form.querySelectorAll('[data-step]').forEach((el) => {
      const on = Number(el.dataset.step) === n;
      el.hidden = !on;
      el.classList.remove('slide-fwd', 'slide-back');
      if (on) {
        void el.offsetWidth; // 같은 방향으로 연달아 넘어가도 애니메이션이 다시 돌게
        el.classList.add(`slide-${dir}`);
      }
    });
    form.querySelectorAll('.wiz-progress span').forEach((el, i) => el.classList.toggle('on', i < n));
    form.querySelector('.wiz-count b').textContent = n;
    prevBtn.hidden = n === 1;
    nextBtn.hidden = n === LAST_STEP;
    submitBtn.hidden = n !== LAST_STEP;
    if (n === LAST_STEP) renderSummary();
    form.querySelector('.modal-body').scrollTop = 0;
  }

  /** 단계별 필수 입력 확인 → 틀린 곳 안내 문구 (없으면 '') */
  function checkStep(n) {
    const { name, shortMsg, longMsg, password, side, relation, personality } = readTexts();
    if (n === 1) {
      if (!name) return '이름을 입력해 주세요.';
      if (!side) return '누구의 하객인지 골라 주세요.';
      if (!relation) return '어떤 사이인지 골라 주세요.';
    }
    if (n === 2 && !personality) return '캐릭터 성향을 골라 주세요.';
    if (n === 3 && (!shortMsg || !longMsg)) return '한줄 멘트와 방명록을 모두 입력해 주세요.';
    if (n === 4 && [...password].length < 4) return '비밀번호를 4자 이상 입력해 주세요.';
    return '';
  }

  /** 4단계 위쪽: 지금까지 입력한 내용 확인용 카드 */
  function renderSummary() {
    const t = readTexts();
    const q = (sel) => form.querySelector(sel);
    q('.summary-name').textContent = t.name;
    q('.summary-tags').textContent = profileTags(t).join(' · ');
    q('.summary-short').textContent = t.shortMsg;
    q('.summary-title').textContent = t.title;
    q('.summary-title').hidden = !t.title;
    setImg(q('.summary-avatar'), frontPreview.hidden ? null : frontPreview.src);
    q('.wiz-summary .modal-avatar').hidden = frontPreview.hidden; // 캐릭터 없이 등록하면 빈 원 대신 글만
  }

  function readTexts() {
    return {
      name: fields.name.value.trim(),
      shortMsg: fields.shortMsg.value.trim(),
      longMsg: fields.longMsg.value.trim(),
      password: fields.password.value,
      side: fields.side.value,
      relation: fields.relation.value,
      personality: fields.personality.value,
      title: fields.title.value.trim(),
    };
  }

  function goNext() {
    const err = checkStep(step);
    if (err) return showError(err);
    if (step < LAST_STEP) showStep(step + 1);
  }

  nextBtn.addEventListener('click', goNext);
  form.querySelector('.to-lobby').addEventListener('click', () => {
    writeModal.close();
    openLobby();
  });
  prevBtn.addEventListener('click', () => showStep(step - 1));
  // 칩을 고르면 남아 있던 "골라 주세요" 안내를 지움
  form.addEventListener('change', (e) => {
    if (e.target.type === 'radio') showError('');
  });
  const longCount = form.querySelector('.long-count');
  fields.longMsg.addEventListener('input', () => (longCount.textContent = [...fields.longMsg.value].length));
  showStep(1);

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
    submitBtn.textContent = busy ? '캐릭터 완성 기다리는 중...' : '방명록 등록하기';
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
    stats = rollStats();
    renderStats(statGrid, stats);
    setPhoto(null);
    preparing = null;
    setImg(frontPreview, null);
    previewEmpty.hidden = false;
    longCount.textContent = '0';
    step = 1;
    showStep(1);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (step < LAST_STEP) return goNext(); // 입력 칸에서 엔터 = 다음
    if (generating) return;
    showError('');
    // 앞 단계에서 빠진 게 있으면 그 단계로 돌아가서 안내
    for (let n = 1; n <= LAST_STEP; n++) {
      const err = checkStep(n);
      if (!err) continue;
      if (n !== step) showStep(n);
      return showError(err);
    }
    const { name, shortMsg, longMsg, password, side, relation, personality, title } = readTexts();

    submitBtn.disabled = true;
    prevBtn.disabled = true;
    submitBtn.textContent = '등록 중...';
    try {
      const images = await (preparing ?? Promise.resolve(null));
      const guest = await submitGuestbook({ name, shortMsg, longMsg, password, side, relation, personality, title, stats, images });
      myGuest.set(guest.id);
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
          ? '방명록이 등록되었어요! 🎉\n스틱과 점프 버튼으로 움직여 보세요'
          : '방명록이 등록되었어요! 🎉\n방향키와 Space(점프)로 움직여 보세요',
        3500
      );
    } catch (err) {
      showError(err.message);
    } finally {
      submitBtn.disabled = false;
      prevBtn.disabled = false;
      submitBtn.textContent = '방명록 등록하기';
    }
  });

  function openWrite() {
    if (!CONFIG.apiUrl) return showToast('방명록 작성은 곧 오픈됩니다!');
    writeModal.open();
    return true;
  }

  // ---------- 방명록 목록 ----------
  const listModal = setupModal(document.getElementById('list-modal'));
  const listEl = document.querySelector('#list-modal .guest-list');

  const listSearch = document.querySelector('#list-modal .list-search');

  /** 이 기기에서 만들거나 고른 내 캐릭터 id (다음 접속 때 캐릭터 선택 화면 맨 위에) */
  const myGuest = {
    get: () => {
      try {
        return localStorage.getItem('myGuestId');
      } catch {
        return null;
      }
    },
    set: (id) => {
      try {
        localStorage.setItem('myGuestId', id);
      } catch {}
    },
  };

  /** UI.getGuests()가 돌려주는 맵 위 하객 [{ info, avatarUrl() }]로 목록을 그린다 (최신순, 이름 검색) */
  function openList() {
    listSearch.value = '';
    renderList();
    listModal.open();
  }

  // 내 방명록(이 기기의 내 캐릭터)은 맨 위 따로 + 수정 버튼, 그 아래 다른 하객 방명록
  function renderList() {
    const all = sortedGuests();
    const query = listSearch.value.trim();
    const guests = query ? all.filter((g) => g.info.name.includes(query)) : all;
    document.getElementById('list-title').textContent = `방명록 목록 (${all.length})`;
    const empty = document.querySelector('#list-modal .empty-note');
    empty.hidden = guests.length > 0;
    empty.innerHTML = query ? '찾는 이름이 없어요.' : '아직 등록된 방명록이 없어요.<br />첫 번째 하객이 되어 주세요!';
    const mineId = myGuest.get();
    const mine = guests.filter((g) => g.info.id === mineId);
    const others = guests.filter((g) => g.info.id !== mineId);
    const section = (label) => Object.assign(document.createElement('li'), { className: 'list-section', textContent: label });
    listEl.replaceChildren(
      ...(mine.length ? [section('내 방명록'), ...mine.map((g) => listItem(g, true))] : []),
      ...(mine.length && others.length ? [section('다른 하객 방명록')] : []),
      ...others.map((g) => listItem(g, false))
    );
  }

  function listItem(g, isMine) {
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
    // 칭호 · 이름 / 관계 / 한줄 멘트
    if (g.info.title) {
      const title = document.createElement('span');
      title.className = 'guest-title';
      title.textContent = g.info.title;
      text.append(title);
    }
    const meta = document.createElement('small');
    meta.className = 'guest-meta';
    meta.textContent = relationTags(g.info).join(' · ');
    const msg = document.createElement('small');
    msg.textContent = g.info.shortMsg || g.info.longMsg || '';
    text.append(name, ...(meta.textContent ? [meta] : []), msg);
    btn.append(avatar, text);
    btn.addEventListener('click', () => openLetter(g.info, avatar.src));
    li.append(btn);
    if (isMine) {
      li.classList.add('mine');
      const edit = Object.assign(document.createElement('button'), { type: 'button', className: 'guest-edit', textContent: '수정' });
      edit.addEventListener('click', () => {
        if (!g.info.number) return showToast('이 방명록은 수정할 수 없어요');
        openEdit({ info: g.info, onUpdated: (guest) => (g.update(guest), renderList()) }, { letter: true });
      });
      li.append(edit);
    }
    return li;
  }
  listSearch.addEventListener('input', renderList);

  // ---------- 방명록 보기 (목록에서 누르면) ----------
  const letterEl = document.getElementById('letter-modal');
  const letterModal = setupModal(letterEl);

  /** 프로필(모습·칭호·이름·관계/성향) + 방명록 글 */
  function openLetter(info, avatarUrl) {
    letterEl.querySelector('.letter-avatar').src = avatarUrl;
    const title = letterEl.querySelector('.letter-title');
    title.hidden = !info.title;
    title.textContent = info.title || '';
    document.getElementById('letter-name').textContent = info.name;
    letterEl.querySelector('.letter-tags').textContent = profileTags(info).join(' · ');
    letterEl.querySelector('.letter-long').textContent = info.longMsg || info.shortMsg || '';
    letterModal.open();
  }

  /** 맵 위 하객 최신순 (mine이면 그 캐릭터를 맨 위로) */
  function sortedGuests(mine = null) {
    return (UI.getGuests?.() ?? []).slice().sort((a, b) =>
      (b.info.id === mine) - (a.info.id === mine) || String(b.info.createdAt ?? '9').localeCompare(String(a.info.createdAt ?? '9'))
    );
  }

  // ---------- 캐릭터 선택 (전체 화면) ----------
  // 카드를 고르고 "이 캐릭터로 시작" (카드를 두 번 눌러도 시작) → UI.onGuestPicked(info): 시작점에서 조종
  const selectEl = document.getElementById('select-modal');
  const selectModal = setupModal(selectEl);
  const selectGrid = selectEl.querySelector('.char-grid');
  const selectSearch = selectEl.querySelector('.list-search');
  const selectStart = selectEl.querySelector('.select-start');
  let selected = null; // 고른 캐릭터 info

  function openSelect() {
    selectSearch.value = '';
    selected = null;
    renderSelect();
    selectModal.open();
  }

  function renderSelect() {
    const mine = myGuest.get();
    const query = selectSearch.value.trim();
    const guests = sortedGuests(mine).filter((g) => !query || g.info.name.includes(query));
    if (selected && !guests.some((g) => g.info === selected)) selected = null;
    selectStart.disabled = !selected;
    const empty = selectEl.querySelector('.empty-note');
    empty.hidden = guests.length > 0;
    empty.textContent = query ? '찾는 이름이 없어요.' : '아직 만든 캐릭터가 없어요. 새 캐릭터를 만들어 주세요!';
    selectGrid.replaceChildren(
      ...guests.map((g) => {
        const { info } = g;
        const li = document.createElement('li');
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'char-card';
        card.classList.toggle('selected', info === selected);
        card.setAttribute('aria-pressed', String(info === selected));
        const add = (tag, cls, text) => {
          const el = document.createElement(tag);
          el.className = cls;
          if (text != null) el.textContent = text;
          card.append(el);
          return el;
        };
        if (info.id === mine) add('span', 'char-card-mine', '내 캐릭터');
        add('span', 'guest-title char-card-title', info.title || '').hidden = !info.title;
        const avatar = add('img', 'char-card-avatar');
        avatar.alt = '';
        avatar.loading = 'lazy';
        avatar.src = g.avatarUrl();
        add('b', 'char-card-name', info.name);
        add('small', 'char-card-meta', profileTags(info).join(' · '));
        if (info.stats) add('span', 'char-card-stats', CONFIG.stats.keys.map((k) => `${STAT_LABELS[k]} ${info.stats[k]}`).join('  '));
        card.addEventListener('click', () => {
          selected = info;
          renderSelect();
        });
        card.addEventListener('dblclick', startSelected);
        li.append(card);
        return li;
      })
    );
  }

  function startSelected() {
    if (!selected) return;
    myGuest.set(selected.id);
    selectModal.close();
    UI.onGuestPicked?.(selected);
  }

  selectSearch.addEventListener('input', renderSelect);
  selectStart.addEventListener('click', startSelected);
  selectEl.querySelector('.to-lobby').addEventListener('click', () => {
    selectModal.close();
    openLobby();
  });

  // ---------- 로비 (처음 접속, 메뉴 "로비로 돌아가기") ----------
  const lobbyEl = document.getElementById('lobby-modal');
  const lobbyModal = setupModal(lobbyEl);
  const openLobby = () => lobbyModal.open();
  lobbyEl.querySelector('.lobby-play').addEventListener('click', () => {
    lobbyModal.close();
    openSelect();
  });
  lobbyEl.querySelector('.lobby-new').addEventListener('click', () => {
    if (openWrite()) lobbyModal.close();
  });

  // ---------- 웨딩 갤러리 ----------
  // 사진 목록은 배포 때 img/gallery/ 폴더를 읽어 만든 data/gallery.json (scripts/build-gallery.mjs)
  // 메뉴 "웨딩 갤러리"는 모든 사진, 앨범 NPC를 누르면 그 앨범(img/gallery/<album>/)만
  const galleryEl = document.getElementById('gallery-modal');
  const galleryModal = setupModal(galleryEl);
  const grid = galleryEl.querySelector('.gallery-grid');
  const tabs = galleryEl.querySelector('.gallery-tabs');
  const viewer = galleryEl.querySelector('.gallery-viewer');
  const photo = galleryEl.querySelector('.gallery-photo');
  let allPhotos = null;
  let photos = []; // 지금 보는 사진들 (앨범이면 그 앨범만)
  let photoIndex = 0;

  async function loadPhotos() {
    if (allPhotos) return allPhotos;
    try {
      const res = await fetch(`data/gallery.json?t=${Date.now()}`);
      // 항목: { thumb: 목록용 썸네일, src: 크게 보기용, album: 하위 폴더 } (예전 형식인 문자열도 허용)
      const list = res.ok ? (await res.json()).photos ?? [] : [];
      allPhotos = list.map((p) => (typeof p === 'string' ? { thumb: p, src: p, album: '' } : p));
    } catch {
      allPhotos = [];
    }
    return allPhotos;
  }

  function showPhoto(i) {
    photoIndex = (i + photos.length) % photos.length;
    photo.src = photos[photoIndex].src;
    // 좌우 사진은 미리 받아 두어 넘길 때 바로 보이게
    for (const d of [-1, 1]) new Image().src = photos[(photoIndex + d + photos.length) % photos.length].src;
    galleryEl.querySelector('.gallery-count').textContent = `${photoIndex + 1} / ${photos.length}`;
    grid.hidden = tabs.hidden = true;
    viewer.hidden = false;
  }

  function showGrid() {
    viewer.hidden = true;
    grid.hidden = photos.length === 0;
    tabs.hidden = tabs.childElementCount < 2;
  }

  /** 앨범 탭 이름: 그 앨범을 연 NPC 이름, 없으면 폴더 이름 */
  function albumTitle(album) {
    const npc = Object.values(CONFIG.npcs ?? {}).find((n) => n.album === album && !n.deleted);
    return npc?.name ?? (album || '웨딩 사진');
  }

  /** 갤러리 열기. album이 있으면 그 앨범 사진만, title은 창 제목 (앨범 NPC 이름). 메뉴에서 열면 앨범별 탭 */
  async function openGallery(album = null, title = '웨딩 갤러리') {
    document.getElementById('gallery-title').textContent = title;
    grid.replaceChildren();
    tabs.replaceChildren();
    tabs.hidden = true;
    galleryModal.open();
    const all = await loadPhotos();
    if (album) return showPhotos(all.filter((p) => p.album === album));
    const albums = [...new Set(all.map((p) => p.album))];
    const tabBtns = albums.map((a) => {
      const btn = Object.assign(document.createElement('button'), { type: 'button', textContent: albumTitle(a) });
      btn.setAttribute('role', 'tab');
      btn.addEventListener('click', () => {
        tabBtns.forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
        showPhotos(all.filter((p) => p.album === a));
      });
      return btn;
    });
    tabs.append(...tabBtns);
    if (tabBtns.length) tabBtns[0].click();
    else showPhotos([]);
  }

  function showPhotos(list) {
    photos = list;
    grid.replaceChildren();
    galleryEl.querySelector('.empty-note').hidden = photos.length > 0;
    {
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
  const actions = {
    mode: () => UI.onToggleMode?.(),
    edit: () => UI.onEditMine?.(),
    list: openList,
    gallery: () => openGallery(),
    lobby: () => UI.onLobby?.(),
  };

  /** 메뉴의 모드 전환 글자: 지금 플레이 모드면 관람 모드로, 관람 모드면 플레이 모드로 */
  function setMode(playing) {
    menu.querySelector('.mode-label').textContent = playing ? '관람 모드로 보기' : '플레이 모드로 돌아가기';
  }
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

  return {
    openGuestbook,
    openAlbum: (album, title) => openGallery(album, title), // 앨범 NPC
    openEdit, // { info, onUpdated(guest), onDeleted() } → 비밀번호 확인 → 수정 폼
    openNpcSettings,
    openLobby,
    setMode,
    showToast,
    forgetMyGuest: () => myGuest.set(''),
    onGuestCreated: null,
    onGuestPicked: null,
    onToggleMode: null, // 메뉴 "모드 전환"
    onEditMine: null, // 메뉴 "캐릭터 수정"
    onLobby: null, // 메뉴 "로비로 돌아가기"
    onModalChange: null,
    getGuests: null,
  };
})();
