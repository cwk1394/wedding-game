// 이벤트 게임 창의 공통 영역 — 서버는 api/_lib/board.js
// 일반 랭킹·내 도전 기록·경품 연락처·개발자 관리 영역을 표시한다.
// 표시 이름만 최신 방명록 이름과 연결하며 기록·점수·순위는 변경하지 않는다.
// 경품 연락처는 서버의 자격 검사와 캐릭터 인증을 거쳐 등록·수정한다.

function eventBoard(el, { path, title, score, password, isPlaying, close }) {
  // score: 기록을 표시 문구로 변환
  // password: 이 창에서 확인된 캐릭터 비밀번호의 get·set
  // isPlaying: 도전 중인지 확인
  // close: 게임 창 닫기
  const root = el.querySelector('.event-board');

  root.innerHTML = `
    <section class="rps-contact-area" hidden>
      <div class="rps-contact-saved" hidden>
        <p class="rps-rule">
          ✅ <b>경품 연락처가 등록되어 있어요.</b><br />
          잘못 입력했다면 아래 버튼으로 수정해 주세요.<br />
          이 게임의 연락처만 변경됩니다.
        </p>
        <button type="button" class="btn btn-ghost rps-contact-edit">
          연락처 수정
        </button>
      </div>
      <form class="rps-contact" hidden novalidate>
        <p class="rps-rule rps-contact-guide"></p>
        <label class="field">
          <span>연락처 <small>(신랑·신부만 볼 수 있어요)</small></span>
          <input name="contact" type="text" autocomplete="tel"
                 maxlength="50" placeholder="010-0000-0000" />
        </label>
        <p class="note rps-contact-replace-note" hidden>
          기존 연락처는 표시하지 않아요. 새 연락처 전체를 입력해 주세요.
          저장하면 이 게임의 기존 연락처가 새 값으로 바뀝니다.
        </p>
        <label class="field rps-contact-pw">
          <span>내 캐릭터 비밀번호</span>
          <input name="password" type="password"
                 autocomplete="current-password" maxlength="30" />
        </label>
        <p class="form-error rps-contact-error" role="alert" hidden></p>
        <button type="submit" class="btn btn-primary rps-contact-submit">
          연락처 남기기
        </button>
        <button type="button" class="btn btn-ghost rps-contact-cancel" hidden>
          수정 취소
        </button>
      </form>
    </section>
    <section class="rps-admin" hidden>
      <h3>🔧 관리 (개발자 모드)</h3>
      <div class="rps-admin-btns">
        <button type="button" class="btn btn-ghost rps-admin-view">연락처 보기</button>
        <button type="button" class="btn btn-ghost rps-admin-reset">랭킹 초기화</button>
        <button type="button" class="btn btn-ghost rps-admin-npc">NPC 설정</button>
      </div>
      <ol class="rps-admin-list"></ol>
    </section>
    <section class="rps-board">
      <h3></h3>
      <ol class="rps-ranking"></ol>
      <p class="rps-empty" hidden></p>
      <h3 class="rps-prize-title" hidden></h3>
      <ol class="rps-ranking rps-prize-ranking" hidden></ol>
      <p class="rps-prize-empty" hidden></p>
      <h3 class="rps-mine-title" hidden>내 도전 기록</h3>
      <ul class="rps-mine"></ul>
    </section>`;

  const $ = (sel) => root.querySelector(sel);
  $('.rps-board h3').textContent = title;

  const contactArea = $('.rps-contact-area');
  const contactSavedBox = $('.rps-contact-saved');
  const contactForm = $('.rps-contact');
  const contactEditButton = $('.rps-contact-edit');
  const contactCancelButton = $('.rps-contact-cancel');
  const contactSubmitButton = $('.rps-contact-submit');
  const contactError = $('.rps-contact-error');
  const admin = $('.rps-admin');
  const api = (body) => postJson(path, body);

  let mine = null;
  let onSettings = null;
  let contactEligible = false;
  let contactSaved = false;
  let contactEditing = false;
  let contactBusy = false;
  let prizeClosed = false;

  // 다른 캐릭터로 바뀌거나 창을 다시 열었을 때 이전 응답을 적용하지 않는다.
  let screenVersion = 0;
  let loadVersion = 0;

  // 최신 이름은 페이지 메모리에만 보관한다.
  // 비밀번호·연락처를 이 목록이나 브라우저 저장소에 저장하지 않는다.
  let guestNames = new Map();
  let nameRequest = null;
  let nextNameRefreshAt = 0;

  const fmt = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}.${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  // 이름 연결에만 사용하는 ID 키. 원래 기록의 ID는 변경하지 않는다.
  function nameKey(id) {
    return typeof id === 'string' ? id.trim().toLowerCase() : '';
  }

  function displayName(id, recordedName) {
    const current = guestNames.get(nameKey(id));
    if (current) return current;

    return typeof recordedName === 'string' && recordedName.trim()
      ? recordedName
      : '이름 없음';
  }

  // 이름 조회가 끝나면 이름 부분만 갱신할 수 있도록 표시한다.
  function setNameNode(node, record) {
    node.dataset.boardName = '';
    node.dataset.guestId = typeof record.id === 'string' ? record.id : '';
    node.dataset.recordedName =
      typeof record.name === 'string' ? record.name : '';

    node.textContent = displayName(record.id, record.name);
  }

  // 순위·점수·연락처·입력 폼은 건드리지 않고 이름 글자만 갱신한다.
  function refreshVisibleNames() {
    root.querySelectorAll('[data-board-name]').forEach((node) => {
      node.textContent = displayName(
        node.dataset.guestId,
        node.dataset.recordedName
      );
    });
  }

  // 최신 방명록 조회는 읽기 전용이다.
  // 요청 중에는 중복 요청하지 않고 반복 렌더링에서는 30초 간격으로 제한한다.
  function refreshGuestNames(force = false) {
    if (nameRequest) return nameRequest;

    if (!force && Date.now() < nextNameRefreshAt) {
      return Promise.resolve();
    }

    nextNameRefreshAt = Date.now() + 30000;

    nameRequest = (async () => {
      let timer = null;

      try {
        const controller = new AbortController();
        timer = setTimeout(() => controller.abort(), 8000);

        const base = String(CONFIG.apiUrl || '').replace(/\/+$/, '');
        const res = await fetch(`${base}/api/guests`, {
          cache: 'no-store',
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error('최신 이름을 불러오지 못했어요.');
        }

        const data = await res.json();

        if (!Array.isArray(data?.guests)) {
          throw new Error('하객 목록 형식을 확인할 수 없어요.');
        }

        const names = new Map();

        for (const guest of data.guests) {
          const id = nameKey(guest?.id);
          const name =
            typeof guest?.name === 'string' ? guest.name.trim() : '';

          if (id && name) names.set(id, name);
        }

        guestNames = names;
        nextNameRefreshAt = Date.now() + 30000;
        refreshVisibleNames();
      } catch {
        // 조회 실패 때문에 게임 기록 표시를 중단하지 않는다.
        nextNameRefreshAt = Date.now() + 10000;
      } finally {
        if (timer !== null) clearTimeout(timer);
        nameRequest = null;
      }
    })();

    return nameRequest;
  }

  function clearContactInputs() {
    contactForm.elements.contact.value = '';
    contactForm.elements.password.value = '';
    contactError.hidden = true;
    contactError.textContent = '';
  }

  // 등록 여부와 서버가 알려준 경품 자격에 따라 연락처 영역을 표시한다.
  function updateContactView() {
    const visible = Boolean(mine && contactEligible && !isPlaying());
    const showForm = visible && (!contactSaved || contactEditing);

    contactArea.hidden = !visible;
    contactSavedBox.hidden = !visible || !contactSaved || contactEditing;
    contactForm.hidden = !showForm;

    // 수정 시에는 이전 도전에서 기억한 비밀번호 대신 다시 입력받는다.
    $('.rps-contact-pw').hidden =
      contactSaved ? false : Boolean(password.get());

    $('.rps-contact-replace-note').hidden = !contactSaved;
    contactCancelButton.hidden = !contactSaved;

    $('.rps-contact-guide').innerHTML = prizeClosed
      ? '🎁 <b>경품 최종 TOP 3 연락처</b><br />선물 전달을 위한 연락처를 정확히 입력해 주세요.'
      : '🎉 <b>경품 연락처 등록·수정</b><br />랭킹 <b>TOP 3</b>에게는 <b>🎁선물</b>을 드려요.<br />미리 등록해도 수상 확정은 아니에요.<br /><b>(12월 12일 마감)</b>';

    contactSubmitButton.textContent = contactBusy
      ? '저장 중…'
      : contactSaved
        ? '새 연락처로 저장'
        : '연락처 남기기';

    contactSubmitButton.disabled = contactBusy;
    contactEditButton.disabled = contactBusy;
    contactCancelButton.disabled = contactBusy;
    contactForm.elements.contact.disabled = contactBusy;
    contactForm.elements.password.disabled = contactBusy;
  }

  // 게임이 시작되면 등록 폼과 수정 버튼을 함께 숨긴다.
  function hideContact() {
    contactArea.hidden = true;
    contactForm.hidden = true;
    contactSavedBox.hidden = true;

    if (!contactBusy) {
      contactEditing = false;
      clearContactInputs();
    }
  }

  /** 창을 열 때: 내 캐릭터와 개발자 설정 연결 */
  function reset(me, settings) {
    screenVersion++;
    loadVersion++;
    mine = me;
    onSettings = settings || null;
    admin.hidden = !onSettings;
    $('.rps-admin-list').replaceChildren();

    contactEligible = false;
    contactSaved = false;
    contactEditing = false;
    contactBusy = false;
    prizeClosed = false;
    clearContactInputs();
    updateContactView();

    nextNameRefreshAt = 0;
  }

  /** 랭킹과 내 도전 기록 조회. data가 있으면 해당 응답 사용 */
  async function load(data) {
    const currentScreen = screenVersion;
    const currentLoad = ++loadVersion;

    try {
      if (!data) {
        const id = mine?.info.id
          ? `?id=${encodeURIComponent(mine.info.id)}`
          : '';

        const res = await fetch(`${CONFIG.apiUrl}${path}${id}`, {
          cache: 'no-store',
        });
        data = await res.json();

        if (!res.ok) throw new Error(data.error);
      }

      if (
        currentScreen !== screenVersion ||
        currentLoad !== loadVersion
      ) {
        return;
      }

      render(data);
    } catch {
      if (
        currentScreen !== screenVersion ||
        currentLoad !== loadVersion
      ) {
        return;
      }

      $('.rps-empty').hidden = false;
      $('.rps-empty').textContent = '랭킹을 불러오지 못했어요.';
    }
  }

  function render({ ranking = [], mine: history, hasContact, prize }) {
    // 직접 전달된 최신 결과보다 오래된 조회 응답은 적용하지 않는다.
    loadVersion++;

    const medals = ['🥇', '🥈', '🥉'];

    $('.rps-board h3').textContent = `${title} (일반)`;

    $('.rps-ranking').replaceChildren(
      ...ranking.map((r, i) => {
        const li = document.createElement('li');
        li.classList.toggle('top', i < 3);
        li.classList.toggle('me', r.id === mine?.info.id);

        li.innerHTML =
          '<span class="rk"></span><span class="nm"></span><b class="st"></b><small class="tm"></small>';

        li.querySelector('.rk').textContent = medals[i] ?? i + 1;
        setNameNode(li.querySelector('.nm'), r);
        li.querySelector('.st').textContent = score(r);
        li.querySelector('.tm').textContent = fmt(r.end);

        return li;
      })
    );

    $('.rps-empty').hidden = ranking.length > 0;
    $('.rps-empty').textContent =
      '아직 기록이 없어요. 첫 번째 도전자가 되어 보세요!';

    // 경품 순위는 서버 응답만 사용하며 기존 숨김 처리를 유지한다.
    const hasPrizeRanking = Array.isArray(prize?.ranking);
    const prizeRanking = hasPrizeRanking ? prize.ranking.slice(0, 3) : [];
    const prizeTitle = $('.rps-prize-title');
    const prizeList = $('.rps-prize-ranking');
    const prizeEmpty = $('.rps-prize-empty');

    prizeTitle.textContent = hasPrizeRanking
      ? prize.closed
        ? '🎁 경품 최종 TOP 3'
        : '🎁 경품 후보 TOP 3 (미확정)'
      : '🎁 경품 TOP 3';

    prizeList.replaceChildren(
      ...prizeRanking.map((r, i) => {
        const li = document.createElement('li');
        li.classList.add('top');
        li.classList.toggle('me', r.id === mine?.info.id);

        li.innerHTML =
          '<span class="rk"></span><span class="nm"></span><b class="st"></b><small class="tm"></small>';

        li.querySelector('.rk').textContent = medals[i] ?? i + 1;
        setNameNode(li.querySelector('.nm'), r);
        li.querySelector('.st').textContent = score(r);
        li.querySelector('.tm').textContent = `🎁선물 · ${fmt(r.end)}`;

        return li;
      })
    );

    prizeTitle.hidden = true;
    prizeList.hidden = true;
    prizeEmpty.hidden = true;

    contactEligible = Boolean(mine && prize?.canContact);
    contactSaved = Boolean(prize?.hasContact ?? hasContact);
    prizeClosed = Boolean(prize?.closed);

    if (!contactEligible || !contactSaved) {
      contactEditing = false;
    }

    updateContactView();

    if (history) {
      $('.rps-mine-title').hidden = !history.length;
      $('.rps-mine').replaceChildren(
        ...history.map((r) =>
          Object.assign(document.createElement('li'), {
            textContent: `${fmt(r.at)} 도전 → ${score(r)}`,
          })
        )
      );
    }

    void refreshGuestNames();
  }

  contactEditButton.addEventListener('click', () => {
    if (
      contactBusy ||
      !mine ||
      !contactEligible ||
      !contactSaved ||
      isPlaying()
    ) {
      return;
    }

    clearContactInputs();
    contactEditing = true;
    updateContactView();
    contactForm.elements.contact.focus();
  });

  // 저장 요청을 보내기 전의 수정 취소만 처리한다. 저장 중에는 취소 버튼을 비활성화한다.
  contactCancelButton.addEventListener('click', () => {
    if (contactBusy) return;

    contactEditing = false;
    clearContactInputs();
    updateContactView();
  });

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (contactBusy) return;

    contactError.hidden = true;
    contactError.textContent = '';

    const showError = (message) => {
      contactError.hidden = false;
      contactError.textContent = message;
    };

    if (!mine?.info.id || !mine.info.number) {
      showError('먼저 본인 캐릭터로 접속해 주세요.');
      return;
    }

    if (!contactEligible || isPlaying()) {
      showError('현재 연락처를 저장할 수 없어요. 도전을 마치고 게임 창을 다시 열어 주세요.');
      return;
    }

    if (contactSaved && !contactEditing) return;

    // 요청 시작 당시의 캐릭터를 고정한다.
    const currentScreen = screenVersion;
    const guestId = mine.info.id;
    const guestNumber = mine.info.number;
    const wasEditing = contactSaved;

    const pw = wasEditing
      ? contactForm.elements.password.value
      : password.get() || contactForm.elements.password.value;

    const contact = contactForm.elements.contact.value.trim();

    if (!contact || !pw) {
      showError(
        contact
          ? '비밀번호를 입력해 주세요.'
          : '연락처를 입력해 주세요.'
      );
      return;
    }

    if (contact.length > 50) {
      showError('연락처는 50자까지 쓸 수 있어요.');
      return;
    }

    contactBusy = true;
    updateContactView();

    try {
      const result = await api({
        action: 'contact',
        number: guestNumber,
        id: guestId,
        password: pw,
        contact,
      });

      if (result?.ok !== true) {
        throw new Error(
          '저장 결과를 확인하지 못했어요. 게임 창을 다시 열어 확인해 주세요.'
        );
      }

      // 다른 캐릭터로 바뀌었거나 창을 다시 열었다면 이전 화면을 갱신하지 않는다.
      if (
        currentScreen !== screenVersion ||
        mine?.info.id !== guestId
      ) {
        return;
      }

      // 저장 전에 시작한 조회가 옛 등록 여부를 다시 표시하지 않도록 한다.
      loadVersion++;
      password.set(pw);
      contactSaved = true;
      contactEditing = false;
      clearContactInputs();

      // 개발자 목록에 이전 연락처가 남지 않도록 비운다.
      // 새 연락처는 관리자의 '연락처 보기' 인증 요청으로만 다시 조회한다.
      $('.rps-admin-list').replaceChildren();

      UI.showToast(
        wasEditing
          ? '이 게임의 연락처를 새 연락처로 변경했어요.'
          : '연락처를 저장했어요. 경품은 마감 기준 최종 TOP 3에게 지급돼요.',
        4000
      );
    } catch (err) {
      if (
        currentScreen !== screenVersion ||
        mine?.info.id !== guestId
      ) {
        return;
      }

      contactForm.elements.password.value = '';
      showError(
        err.message ||
        '저장 결과를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.'
      );
    } finally {
      if (
        currentScreen === screenVersion &&
        mine?.info.id === guestId
      ) {
        contactBusy = false;
        updateContactView();
      }
    }
  });

  // ---------- 개발자 관리 ----------

  async function adminCall(body) {
    const pw = devPassword();
    if (!pw) return null;

    try {
      const r = await api({ ...body, password: pw });
      rememberDevPassword(pw);
      return r;
    } catch (err) {
      rememberDevPassword(pw, err);
      UI.showToast(err.message, 3000);
      return null;
    }
  }

  $('.rps-admin-view').addEventListener('click', async () => {
    const currentScreen = screenVersion;
    const list = $('.rps-admin-list');
    list.replaceChildren();

    const r = await adminCall({ action: 'admin' });
    if (!r || currentScreen !== screenVersion) return;

    if (!Array.isArray(r.prize?.ranking)) {
      list.textContent = '경품 순위 정보를 불러오지 못했어요.';
      return;
    }

    const ranking = r.prize.ranking.slice(0, 3);

    list.replaceChildren(
      ...ranking.map((x, i) => {
        const li = document.createElement('li');
        const name = document.createElement('span');

        setNameNode(name, x);

        li.append(
          `${i + 1}위 · `,
          name,
          ` · ${score(x)} — `,
          Object.assign(document.createElement('b'), {
            textContent: x.contact ?? '연락처 없음',
          })
        );

        return li;
      })
    );

    if (!ranking.length) {
      list.textContent = '경품 대상 기록이 없어요.';
    }

    void refreshGuestNames(true);

    UI.showToast(
      r.prize.closed
        ? '마감된 경품 최종 TOP 3의 연락처예요.'
        : '현재 경품 후보 TOP 3의 연락처예요. 수상 확정은 아니에요.',
      4000
    );
  });

  // 해당 게임의 자료만 삭제하도록 게임 구분과 명시적인 확인값을 전달한다.
  // 실제 관리자 인증·삭제·이전 토큰 차단은 서버에서 수행한다.
  $('.rps-admin-reset').addEventListener('click', async () => {
    const game =
      path === '/api/rps' ? 'rps' :
      path === '/api/chase' ? 'chase' :
      null;

    if (!game) {
      UI.showToast('초기화할 게임을 확인할 수 없어요.', 3000);
      return;
    }

    if (isPlaying()) {
      UI.showToast('진행 중인 도전을 종료한 뒤 초기화해 주세요.', 3000);
      return;
    }

    if (contactBusy) {
      UI.showToast('연락처 저장이 끝난 뒤 초기화해 주세요.', 3000);
      return;
    }

    const gameName = game === 'rps' ? '가위바위보' : '도둑잡기';

    const confirmed = confirm(
      `[${gameName}] 기록을 모두 초기화할까요?\n\n` +
      '삭제: 이 게임의 일반 랭킹·전체 도전 기록·경품 기록·등록 연락처\n' +
      '유지: 캐릭터·방명록·사진·다른 게임 자료\n\n' +
      '초기화 전에 시작한 이 게임의 도전도 무효 처리됩니다.\n' +
      '삭제한 자료는 이 화면에서 되돌릴 수 없습니다.\n' +
      '필요한 최신 백업을 보관한 뒤 진행해 주세요.'
    );

    if (!confirmed) return;

    const currentScreen = screenVersion;
    const btn = $('.rps-admin-reset');
    btn.disabled = true;

    try {
      const result = await adminCall({
        action: 'reset',
        confirmation: `${game}:ALL`,
      });

      if (!result || currentScreen !== screenVersion) return;

      // 초기화 이전에 시작한 화면 조회 응답도 더 이상 적용하지 않는다.
      screenVersion++;
      loadVersion++;
      $('.rps-admin-list').replaceChildren();

      contactEligible = false;
      contactSaved = false;
      contactEditing = false;
      contactBusy = false;
      clearContactInputs();
      updateContactView();

      UI.showToast(
        `${gameName}의 일반·경품 기록과 등록 연락처를 초기화했어요.`,
        4000
      );

      await load();
    } finally {
      btn.disabled = false;
    }
  });

  $('.rps-admin-npc').addEventListener('click', () => {
    close();
    onSettings?.();
  });

  return {
    reset,
    load,
    render,
    hideContact,
  };
      }
