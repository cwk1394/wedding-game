// 이벤트 게임 창의 공통 영역 — 서버는 api/_lib/board.js
// 일반 랭킹·내 도전 기록·경품 연락처·개발자 관리 영역을 표시한다.
// 랭킹의 표시 이름은 캐릭터 ID로 최신 방명록 이름과 연결한다.
// 표시 이름만 바꾸며, 서버의 기록·점수·순위·연락처는 수정하지 않는다.

function eventBoard(el, { path, title, score, password, isPlaying, close }) {
  // score: 기록을 표시 문구로 변환
  // password: 이 창에서 확인된 캐릭터 비밀번호의 get·set
  // isPlaying: 도전 중인지 확인
  // close: 게임 창 닫기
  const root = el.querySelector('.event-board');

  root.innerHTML = `
    <form class="rps-contact" hidden novalidate>
      <p class="rps-rule">🎉 <b>경품 연락처 등록</b><br />랭킹 <b>TOP 3</b>에게는 <b>🎁선물</b>을 드려요.<br />미리 등록해도 수상 확정은 아니에요.<br /><b>(12월 12일 마감)</b></p>
      <label class="field">
        <span>연락처 <small>(신랑·신부만 볼 수 있어요)</small></span>
        <input name="contact" type="text" autocomplete="tel" maxlength="50" placeholder="010-0000-0000" />
      </label>
      <label class="field rps-contact-pw">
        <span>내 캐릭터 비밀번호</span>
        <input name="password" type="password" autocomplete="current-password" maxlength="30" />
      </label>
      <p class="form-error rps-contact-error" hidden></p>
      <button type="submit" class="btn btn-primary">연락처 남기기</button>
    </form>
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

  const contactForm = $('.rps-contact');
  const admin = $('.rps-admin');
  const api = (body) => postJson(path, body);

  let mine = null;
  let onSettings = null;

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

  // 나중에 이름 조회가 끝나면 이름 부분만 갱신할 수 있도록 표시한다.
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
  // 요청 중에는 중복 요청하지 않고, 반복 렌더링에서는 30초 간격으로 제한한다.
  // 조회가 실패해도 기존 랭킹과 마지막으로 확인한 이름을 유지한다.
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

        // 성공한 전체 목록으로 교체한다.
        // 목록에서 사라진 캐릭터는 기록에 남은 이름으로 표시된다.
        guestNames = names;
        nextNameRefreshAt = Date.now() + 30000;
        refreshVisibleNames();
      } catch {
        // 이름 조회 실패 때문에 게임 기록 표시를 중단하지 않는다.
        // 다음 랭킹 갱신 때 재시도하되 연속 요청은 제한한다.
        nextNameRefreshAt = Date.now() + 10000;
      } finally {
        if (timer !== null) clearTimeout(timer);
        nameRequest = null;
      }
    })();

    return nameRequest;
  }

  /** 창을 열 때: 내 캐릭터와 개발자 설정 연결 */
  function reset(me, settings) {
    mine = me;
    onSettings = settings || null;
    admin.hidden = !onSettings;
    $('.rps-admin-list').replaceChildren();
    contactForm.hidden = true;

    // 창을 다시 열면 다음 렌더링에서 최신 이름을 새로 조회한다.
    nextNameRefreshAt = 0;
  }

  /** 랭킹과 내 도전 기록 조회. data가 있으면 해당 응답 사용 */
  async function load(data) {
    try {
      if (!data) {
        const id = mine?.info.id
          ? `?id=${encodeURIComponent(mine.info.id)}`
          : '';

        const res = await fetch(`${CONFIG.apiUrl}${path}${id}`);
        data = await res.json();

        if (!res.ok) throw new Error(data.error);
      }

      render(data);
    } catch {
      $('.rps-empty').hidden = false;
      $('.rps-empty').textContent = '랭킹을 불러오지 못했어요.';
    }
  }

  function render({ ranking = [], mine: history, hasContact, prize }) {
    const medals = ['🥇', '🥈', '🥉'];

    // 일반 랭킹: 서버가 정한 순서와 최고 기록을 그대로 표시한다.
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

    // 경품 순위도 서버 응답만 사용한다. 기존 숨김 처리는 유지한다.
    const hasPrizeRanking = Array.isArray(prize?.ranking);
    const prizeRanking = hasPrizeRanking ? prize.ranking.slice(0, 3) : [];
    const prizeTitle = $('.rps-prize-title');
    const prizeList = $('.rps-prize-ranking');
    const prizeEmpty = $('.rps-prize-empty');

    prizeTitle.hidden = false;
    prizeTitle.textContent = hasPrizeRanking
      ? prize.closed
        ? '🎁 경품 최종 TOP 3'
        : '🎁 경품 후보 TOP 3 (미확정)'
      : '🎁 경품 TOP 3';

    prizeList.hidden = !hasPrizeRanking;
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

    // 연락처 등록 자격은 기존처럼 서버 판단만 사용한다.
    const canContact = Boolean(mine && prize?.canContact);

    contactForm.hidden =
      !canContact ||
      Boolean(prize?.hasContact ?? hasContact) ||
      isPlaying();

    contactForm.querySelector('.rps-contact-pw').hidden =
      Boolean(password.get());

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

    // 기록은 먼저 표시하고 최신 이름 조회가 끝나면 이름만 갱신한다.
    void refreshGuestNames();
  }

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const err = contactForm.querySelector('.rps-contact-error');
    const pw = password.get() || contactForm.elements.password.value;
    const contact = contactForm.elements.contact.value.trim();

    err.hidden = true;

    if (!contact || !pw) {
      return Object.assign(err, {
        hidden: false,
        textContent: contact
          ? '비밀번호를 입력해 주세요.'
          : '연락처를 입력해 주세요.',
      });
    }

    const btn = contactForm.querySelector('button');
    btn.disabled = true;

    try {
      await api({
        action: 'contact',
        number: mine.info.number,
        id: mine.info.id,
        password: pw,
        contact,
      });

      password.set(pw);
      contactForm.hidden = true;
      contactForm.elements.contact.value = '';

      UI.showToast(
        '연락처를 저장했어요. 경품은 마감 기준 최종 TOP 3에게 지급돼요.',
        4000
      );
    } catch (e2) {
      Object.assign(err, {
        hidden: false,
        textContent: e2.message,
      });
    } finally {
      btn.disabled = false;
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
    const list = $('.rps-admin-list');
    list.replaceChildren();

    const r = await adminCall({ action: 'admin' });
    if (!r) return;

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

    // 관리자 연락처 목록도 캐릭터 ID로 최신 이름을 연결한다.
    // 서버가 반환한 연락처와 순위는 그대로 유지한다.
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

    const btn = $('.rps-admin-reset');
    btn.disabled = true;

    try {
      const result = await adminCall({
        action: 'reset',
        confirmation: `${game}:ALL`,
      });

      if (!result) return;

      $('.rps-admin-list').replaceChildren();
      contactForm.hidden = true;

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
    hideContact: () => (contactForm.hidden = true),
  };
}
