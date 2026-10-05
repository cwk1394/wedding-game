// 이벤트 NPC "가위바위보 머신": 내 캐릭터(비밀번호 확인)로 연승 도전 → 지거나 그만하면 기록 (판정·기록은 api/rps.js)
// 진행 중인 도전 토큰은 localStorage(rpsToken)에도 둬서, 창을 닫거나 새로고침해도 다음에 열 때 그 연승으로 기록한다.
// 아래쪽 랭킹·연락처·개발자 관리 칸은 공통 (js/board.js).

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
  const EMOJI = { rock: '✊', scissors: '✌️', paper: '🖐️' };

  let token = null;
  let password = ''; // 이 창에서 한 번 맞게 입력하면 "다시 도전"에 그대로
  let busy = false;
  let mine = null;

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
  const board = eventBoard(el, {
    path: '/api/rps',
    title: '🏆 연승 랭킹',
    score: (r) => `${r.streak}연승`,
    password: { get: () => password, set: (pw) => (password = pw) },
    isPlaying: () => Boolean(token),
    close: () => modal.close(),
  });
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
    if (on) board.hideContact();
  }

  /** settings: 개발자 모드일 때 "NPC 설정" 버튼이 여는 함수 */
  async function open(settings) {
    mine = UI.getMine?.();
    board.reset(mine, settings);
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
    board.load();
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
    if (!r) return board.load();
    if (lost) {
      flashText('LOSE', 'lose');
      cpuHand.classList.add('winner');
      stage.classList.add('shake');
      setTimeout(() => stage.classList.remove('shake'), 500);
    }
        setTimeout(() => UI.showToast(`${r.streak}연승으로 기록했어요!`, 3000), lost ? 900 : 0);
        board.render({ ranking: r.ranking, hasContact: r.hasContact, prize: r.prize });
    board.load(); // 내 도전 기록까지
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
