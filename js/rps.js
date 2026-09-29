// 이벤트 NPC "가위바위보 머신": 내 캐릭터(비밀번호 확인)로 연승 도전 → 지거나 그만하면 기록 (판정·기록은 api/rps.js)
// 진행 중인 도전 토큰은 localStorage(rpsToken)에도 둬서, 창을 닫거나 새로고침해도 다음에 열 때 그 연승으로 기록한다.
// 랭킹에 든 캐릭터는 쿠폰 연락용 연락처를 남김(서버가 암호화 저장). 개발자 모드면 연락처 보기·랭킹 초기화 칸.

const Rps = (() => {
  const el = document.getElementById('rps-modal');
  const modal = UI.setupModal(el);
  const $ = (sel) => el.querySelector(sel);
  const startForm = $('.rps-start');
  const play = $('.rps-play');
  const stage = $('.rps-stage');
  const resultEl = $('.rps-result');
  const fx = $('.rps-fx');
  const myHand = $('.rps-my-hand');
  const cpuHand = $('.rps-cpu-hand');
  const streakEl = $('.rps-streak');
  const errorEl = $('.rps-error');
  const contactForm = $('.rps-contact');
  const admin = $('.rps-admin');
  const EMOJI = { rock: '✊', scissors: '✌️', paper: '🖐️' };

  let token = null;
  let password = ''; // 이 창에서 한 번 맞게 입력하면 "다시 도전"에 그대로
  let busy = false;
  let mine = null;
  let onSettings = null; // 개발자 모드: NPC 설정 창 열기

  const store = {
    get: () => {
      try {
        return localStorage.getItem('rpsToken');
      } catch {
        return null;
      }
    },
    set: (t) => {
      try {
        t ? localStorage.setItem('rpsToken', t) : localStorage.removeItem('rpsToken');
      } catch {}
    },
  };

  const api = (body) => postJson('/api/rps', body);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function showError(msg) {
    errorEl.textContent = msg || '';
    errorEl.hidden = !msg;
  }

  function setStreak(n) {
    streakEl.hidden = !token && !n;
    streakEl.querySelector('b').textContent = n;
    streakEl.classList.remove('pop');
    void streakEl.offsetWidth;
    streakEl.classList.add('pop');
  }

  function setPlaying(on) {
    startForm.hidden = on;
    play.hidden = !on;
    if (on) contactForm.hidden = true;
  }

  /** settings: 개발자 모드일 때 "NPC 설정" 버튼이 여는 함수 */
  async function open(settings) {
    onSettings = settings || null;
    admin.hidden = !onSettings;
    $('.rps-admin-list').replaceChildren();
    contactForm.hidden = true;
    mine = UI.getMine?.();
    $('.rps-avatar').src = mine?.avatarUrl ?? 'img/npc/rps-machine/front.webp';
    $('.rps-avatar').style.visibility = mine ? '' : 'hidden';
    $('.rps-me-name').textContent = mine?.info.name ?? '';
    $('.rps-need').hidden = Boolean(mine);
    $('.rps-pw').hidden = !mine;
    $('.rps-go').hidden = !mine;
    $('.rps-go').textContent = '도전하기';
    startForm.elements.password.value = password;
    myHand.textContent = cpuHand.textContent = '';
    resultEl.className = 'rps-result';
    resultEl.textContent = '';
    showError('');
    token = null;
    setStreak(0);
    setPlaying(false);
    modal.open();
    // 지난번에 끝내지 못한 도전이 있으면 그 연승으로 기록
    const pending = store.get();
    if (pending) {
      store.set(null);
      try {
        const r = await api({ action: 'stop', token: pending });
        UI.showToast(`지난 도전(${r.streak}연승)을 기록했어요`, 2500);
      } catch {}
    }
    loadBoard();
  }

  /** 랭킹 + 내 도전 기록 */
  async function loadBoard(data) {
    try {
      if (!data) {
        const id = mine?.info.id ? `?id=${encodeURIComponent(mine.info.id)}` : '';
        const res = await fetch(`${CONFIG.apiUrl}/api/rps${id}`);
        data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }
      renderBoard(data);
    } catch {
      $('.rps-empty').hidden = false;
      $('.rps-empty').textContent = '랭킹을 불러오지 못했어요.';
    }
  }

  const fmt = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}.${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };

  function renderBoard({ ranking = [], mine: history, hasContact }) {
    const medals = ['🥇', '🥈', '🥉'];
    $('.rps-ranking').replaceChildren(
      ...ranking.map((r, i) => {
        const li = document.createElement('li');
        li.classList.toggle('top', i < 3);
        li.classList.toggle('me', r.id === mine?.info.id);
        li.innerHTML = '<span class="rk"></span><span class="nm"></span><b class="st"></b><small class="tm"></small>';
        li.querySelector('.rk').textContent = medals[i] ?? i + 1;
        li.querySelector('.nm').textContent = r.name;
        li.querySelector('.st').textContent = `${r.streak}연승`;
        li.querySelector('.tm').textContent = i < 3 ? `☕ 쿠폰 · ${fmt(r.end)}` : fmt(r.end);
        return li;
      })
    );
    $('.rps-empty').hidden = ranking.length > 0;
    $('.rps-empty').textContent = '아직 기록이 없어요. 첫 번째 도전자가 되어 보세요!';
    // 랭킹에 들었는데 연락처가 없으면 남기기 (도전 중엔 숨김)
    const ranked = mine && ranking.some((r) => r.id === mine.info.id);
    if (hasContact !== undefined) contactForm.hidden = !ranked || hasContact || Boolean(token);
    contactForm.querySelector('.rps-contact-pw').hidden = Boolean(password);
    if (history) {
      $('.rps-mine-title').hidden = !history.length;
      $('.rps-mine').replaceChildren(
        ...history.map((r) => Object.assign(document.createElement('li'), { textContent: `${fmt(r.at)} 도전 → ${r.streak}연승` }))
      );
    }
  }

  // 도전 시작: 비밀번호 확인 → 토큰
  startForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !mine) return;
    const pw = startForm.elements.password.value;
    if (!pw) return showError('비밀번호를 입력해 주세요.');
    if (!mine.info.number) return showError('방금 만든 캐릭터는 1~2분 뒤에 도전할 수 있어요.');
    busy = true;
    showError('');
    $('.rps-go').textContent = '확인 중...';
    try {
      const r = await api({ action: 'start', number: mine.info.number, id: mine.info.id, password: pw });
      password = pw;
      token = r.token;
      store.set(token);
      myHand.textContent = cpuHand.textContent = '';
      resultEl.className = 'rps-result';
      setStreak(0);
      setPlaying(true);
      flashText('START!', 'start');
    } catch (err) {
      showError(err.message);
    } finally {
      busy = false;
      $('.rps-go').textContent = '도전하기';
    }
  });

  // 가위·바위·보: 머신 화면이 빠르게 돌다가 멈추며 결과
  play.querySelectorAll('[data-hand]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (busy || !token) return;
      busy = true;
      const choice = btn.dataset.hand;
      play.classList.add('busy');
      btn.classList.add('picked');
      resultEl.className = 'rps-result';
      myHand.textContent = EMOJI[choice];
      myHand.className = 'rps-hand rps-my-hand shake';
      cpuHand.className = 'rps-hand rps-cpu-hand spin';
      stage.classList.add('rolling');
      const hands = Object.values(EMOJI);
      let k = 0;
      const roll = setInterval(() => (cpuHand.textContent = hands[k++ % 3]), 70);
      try {
        const [r] = await Promise.all([api({ action: 'play', token, choice }), wait(1100)]);
        clearInterval(roll);
        cpuHand.textContent = EMOJI[r.cpu];
        myHand.className = cpuHand.className = 'rps-hand';
        stage.classList.remove('rolling');
        if (r.result === 'lose') return end(r, true);
        token = r.token;
        store.set(token);
        if (r.result === 'win') {
          setStreak(r.streak);
          flashText(r.streak >= 3 ? `${r.streak}연승!!` : 'WIN!', 'win');
          confetti(r.streak);
          myHand.classList.add('winner');
        } else {
          flashText('DRAW', 'draw');
          myHand.classList.add('bump-r');
          cpuHand.classList.add('bump-l');
        }
      } catch (err) {
        clearInterval(roll);
        stage.classList.remove('rolling');
        cpuHand.textContent = '';
        UI.showToast(err.message, 3000);
        if (/끝난|지났|잘못/.test(err.message)) end(null);
      } finally {
        busy = false;
        play.classList.remove('busy');
        btn.classList.remove('picked');
      }
    })
  );

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = contactForm.querySelector('.rps-contact-error');
    const pw = password || contactForm.elements.password.value;
    const contact = contactForm.elements.contact.value.trim();
    err.hidden = true;
    if (!contact || !pw) return Object.assign(err, { hidden: false, textContent: contact ? '비밀번호를 입력해 주세요.' : '연락처를 입력해 주세요.' });
    const btn = contactForm.querySelector('button');
    btn.disabled = true;
    try {
      await api({ action: 'contact', number: mine.info.number, id: mine.info.id, password: pw, contact });
      password = pw;
      contactForm.hidden = true;
      contactForm.elements.contact.value = '';
      UI.showToast('연락처를 남겼어요. 쿠폰을 보내 드릴게요! ☕', 3000);
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
        li.append(`${x.name} · ${x.streak}연승 — `, Object.assign(document.createElement('b'), { textContent: x.contact ?? '연락처 없음' }));
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
    loadBoard();
  });

  $('.rps-admin-npc').addEventListener('click', () => {
    modal.close();
    onSettings?.();
  });

  $('.rps-stop').addEventListener('click', async () => {
    if (busy || !token) return;
    busy = true;
    try {
      end(await api({ action: 'stop', token }), false);
    } catch (err) {
      UI.showToast(err.message, 3000);
    } finally {
      busy = false;
    }
  });

  /** 도전 끝 (졌거나 그만함): 결과 문구 + 랭킹 새로고침, "다시 도전" */
  function end(r, lost) {
    token = null;
    store.set(null);
    setPlaying(false);
    $('.rps-go').textContent = '다시 도전';
    if (!r) return loadBoard();
    if (lost) {
      flashText('LOSE', 'lose');
      cpuHand.classList.add('winner');
      stage.classList.add('shake');
      setTimeout(() => stage.classList.remove('shake'), 500);
    }
    const rank = r.rank && r.rank <= 3 ? ` · ${r.rank}위! ☕ 쿠폰 순위` : r.rank ? ` · ${r.rank}위` : '';
    setTimeout(() => UI.showToast(`${r.streak}연승으로 기록했어요${rank}`, 3000), lost ? 900 : 0);
    renderBoard({ ranking: r.ranking, hasContact: r.hasContact });
    loadBoard(); // 내 도전 기록까지
  }

  // ---------- 효과 ----------

  function flashText(text, kind) {
    resultEl.textContent = text;
    resultEl.className = 'rps-result';
    void resultEl.offsetWidth;
    resultEl.className = `rps-result show ${kind}`;
  }

  /** 이기면 가운데서 색종이·하트·별이 터짐 (연승이 길수록 많이) */
  function confetti(streak) {
    const colors = ['#ff8f7e', '#ffd76a', '#8fe3cf', '#b8a4ff', '#ff6fa8', '#7cc6ff'];
    const shapes = ['', '', '', '💖', '✨', '⭐'];
    const n = Math.min(36 + streak * 8, 90);
    const rect = fx.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i');
      const shape = shapes[i % shapes.length];
      if (shape) s.textContent = shape;
      else s.style.background = colors[i % colors.length];
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * Math.max(rect.width, 200) * 0.55;
      s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
      s.style.setProperty('--dy', `${Math.sin(angle) * dist - 40}px`);
      s.style.setProperty('--r', `${Math.random() * 720 - 360}deg`);
      s.style.animationDelay = `${Math.random() * 0.12}s`;
      fx.append(s);
      setTimeout(() => s.remove(), 1500);
    }
    stage.classList.remove('flash');
    void stage.offsetWidth;
    stage.classList.add('flash');
  }

  // 도전 중에 창을 닫으면 그 연승으로 기록
  el.addEventListener('click', (e) => {
    if (!e.target.closest('[data-close]') || !token) return;
    const t = token;
    token = null;
    api({ action: 'stop', token: t })
      .then((r) => (store.set(null), UI.showToast(`${r.streak}연승으로 기록했어요`, 2500)))
      .catch(() => {}); // 실패하면 다음에 열 때 localStorage 토큰으로 다시
  });

  return { open };
})();
