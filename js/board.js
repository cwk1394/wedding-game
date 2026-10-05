// 이벤트 게임 창(가위바위보 js/rps.js, 도둑 잡기 js/chase.js) 아래쪽 공통 칸 — 서버는 api/_lib/board.js
// - 랭킹 TOP 10(1~3위 ☕ 쿠폰) + 내 도전 기록
// - 랭킹에 들었는데 연락처가 없으면 연락처 남기기 (서버가 암호화 저장, 개발자 모드에서만 보임)
// - 개발자 모드: 연락처 보기 · 랭킹 초기화 · NPC 설정
// 창 안의 <div class="event-board">를 채운다. 모양은 가위바위보 창 클래스(.rps-*)를 같이 씀

function eventBoard(el, { path, title, score, password, isPlaying, close }) {
  // score(기록) → '3연승' 같은 글자, password: { get, set } 이 창에서 확인된 내 캐릭터 비밀번호, isPlaying() 도전 중이면 연락처 칸 숨김, close() 창 닫기
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

  const fmt = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}.${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  /** 창을 열 때: 내 캐릭터, 개발자 모드면 settings(NPC 설정 창 열기) */
  function reset(me, settings) {
    mine = me;
    onSettings = settings || null;
    admin.hidden = !onSettings;
    $('.rps-admin-list').replaceChildren();
    contactForm.hidden = true;
  }

  /** 랭킹 + 내 도전 기록 (data가 없으면 서버에서) */
  async function load(data) {
    try {
      if (!data) {
        const id = mine?.info.id ? `?id=${encodeURIComponent(mine.info.id)}` : '';
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
    $('.rps-ranking').replaceChildren(
      ...ranking.map((r, i) => {
        const li = document.createElement('li');
        li.classList.toggle('top', i < 3);
        li.classList.toggle('me', r.id === mine?.info.id);
        li.innerHTML = '<span class="rk"></span><span class="nm"></span><b class="st"></b><small class="tm"></small>';
        li.querySelector('.rk').textContent = medals[i] ?? i + 1;
        li.querySelector('.nm').textContent = r.name;
        li.querySelector('.st').textContent = score(r);
        li.querySelector('.tm').textContent = i < 3 ? `☕ 쿠폰 · ${fmt(r.end)}` : fmt(r.end);
        return li;
      })
    );
    $('.rps-empty').hidden = ranking.length > 0;
    $('.rps-empty').textContent = '아직 기록이 없어요. 첫 번째 도전자가 되어 보세요!';
        // 서버가 경품 연락처 등록을 허용한 캐릭터만 표시 (도전 중엔 숨김)
    const canContact = Boolean(mine && prize?.canContact);
    contactForm.hidden = !canContact || Boolean(prize?.hasContact ?? hasContact) || isPlaying();
    contactForm.querySelector('.rps-contact-pw').hidden = Boolean(password.get());
    if (history) {
      $('.rps-mine-title').hidden = !history.length;
      $('.rps-mine').replaceChildren(
        ...history.map((r) => Object.assign(document.createElement('li'), { textContent: `${fmt(r.at)} 도전 → ${score(r)}` }))
      );
    }
  }

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = contactForm.querySelector('.rps-contact-error');
    const pw = password.get() || contactForm.elements.password.value;
    const contact = contactForm.elements.contact.value.trim();
    err.hidden = true;
    if (!contact || !pw) return Object.assign(err, { hidden: false, textContent: contact ? '비밀번호를 입력해 주세요.' : '연락처를 입력해 주세요.' });
    const btn = contactForm.querySelector('button');
    btn.disabled = true;
    try {
      await api({ action: 'contact', number: mine.info.number, id: mine.info.id, password: pw, contact });
      password.set(pw);
      contactForm.hidden = true;
      contactForm.elements.contact.value = '';
            UI.showToast('연락처를 저장했어요. 경품은 마감 기준 최종 TOP 3에게 지급돼요.', 4000);
    } catch (e2) {
      Object.assign(err, { hidden: false, textContent: e2.message });
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- 개발자 모드: 연락처 보기·랭킹 초기화 ----------

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
    const r = await adminCall({ action: 'admin' });
    if (!r) return;
    const list = $('.rps-admin-list');
    list.replaceChildren(
      ...r.ranking.map((x) => {
        const li = document.createElement('li');
        li.append(`${x.name} · ${score(x)} — `, Object.assign(document.createElement('b'), { textContent: x.contact ?? '연락처 없음' }));
        return li;
      })
    );
    if (!r.ranking.length) list.textContent = '랭킹이 비어 있어요.';
  });

  $('.rps-admin-reset').addEventListener('click', async () => {
    if (!confirm('랭킹·도전 기록·연락처를 모두 지울까요? 되돌릴 수 없어요.')) return;
    if (!(await adminCall({ action: 'reset' }))) return;
    $('.rps-admin-list').replaceChildren();
    UI.showToast('랭킹을 초기화했어요', 2500);
    load();
  });

  $('.rps-admin-npc').addEventListener('click', () => {
    close();
    onSettings?.();
  });

  return { reset, load, render, hideContact: () => (contactForm.hidden = true) };
}
