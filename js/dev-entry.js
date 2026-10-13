// 게임 진입 처리.
// 일반 접속은 바로 실행하고, 개발자 모드는 서버 인증 후 실행한다.
// 이 파일은 index.html에서 다른 게임 스크립트 대신 먼저 실행해야 한다.
// 화면 진입 제어와 별개로 각 관리 API의 서버 인증은 계속 유지한다.

(async () => {
  const wantsDev = new URLSearchParams(location.search).has('dev');

  // 기존 index.html의 실행 순서를 그대로 유지한다.
  const scripts = [
    'https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js',
    'js/map-data.js',
    'js/config.js',
    'js/data.js',
    'js/npcs.js',
    'js/textures.js',
    'js/character.js',
    'js/api.js',
    'js/ui.js',
    'js/board.js',
    'js/rps.js',
    'js/chase.js',
    'js/view.js',
    'js/control.js',
    'js/scene.js',
    'js/dev.js',
    'js/main.js',
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => {
        script.remove();
        reject(new Error('게임 실행 파일을 불러오지 못했어요.'));
      };
      document.body.append(script);
    });
  }

  async function startGame() {
    // 앞 파일이 실행된 뒤 다음 파일을 불러온다.
    for (const src of scripts) {
      await loadScript(src);
    }
  }

  function goToNormal() {
    const url = new URL(location.href);
    url.searchParams.delete('dev');
    url.searchParams.delete('debug');
    location.replace(url.href);
  }

  function showLoadError() {
    const panel = document.createElement('div');
    panel.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;' +
      'display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:20px;padding:24px;' +
      'box-sizing:border-box;background:#fff5f1;color:#50332c;' +
      'font:normal 16px/1.6 sans-serif;text-align:center;';

    const message = document.createElement('p');
    message.textContent =
      '게임 실행 파일을 불러오지 못했어요. 새로고침해 주세요.';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '새로고침';
    button.style.cssText =
      'padding:14px 24px;border:0;border-radius:12px;' +
      'background:#ee6b58;color:white;font:inherit;cursor:pointer;';
    button.addEventListener('click', () => location.reload());

    panel.append(message, button);
    document.body.append(panel);
    button.focus();
  }

  function askDevPassword() {
    return new Promise((resolve) => {
      // 예전에 저장 기능이 기억한 비밀번호로 자동 입장하지 않는다.
      // 캐릭터 접속 정보와 게임 기록은 건드리지 않는다.
      try {
        sessionStorage.removeItem('devPassword');
      } catch {}

      const previous = [...document.body.children].map((element) => ({
        element,
        inert: element.inert,
      }));

      for (const { element } of previous) {
        element.inert = true;
      }

      const overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;' +
        'display:flex;align-items:center;justify-content:center;' +
        'overflow:auto;padding:24px;box-sizing:border-box;' +
        'background:#fff5f1;color:#50332c;' +
        'font:normal 16px/1.6 sans-serif;';

      const form = document.createElement('form');
      form.noValidate = true;
      form.setAttribute('role', 'dialog');
      form.setAttribute('aria-modal', 'true');
      form.setAttribute('aria-labelledby', 'dev-entry-title');
      form.style.cssText =
        'width:100%;max-width:420px;margin:auto;padding:24px;' +
        'box-sizing:border-box;background:white;' +
        'border:1px solid #f4d4cc;border-radius:20px;' +
        'box-shadow:0 8px 30px #50332c15;';

      form.innerHTML = `
        <h1 id="dev-entry-title"
            style="margin:0 0 16px;font-size:24px;font-style:normal;">
          개발자 모드 비밀번호 확인
        </h1>
        <p style="margin:0 0 20px;">
          관리자 비밀번호를 확인한 뒤 편집 도구를 실행합니다.
        </p>
        <label for="dev-entry-password">관리자 비밀번호</label>
        <input id="dev-entry-password"
               name="password"
               type="password"
               autocomplete="off"
               autocapitalize="off"
               spellcheck="false"
               style="display:block;width:100%;box-sizing:border-box;
                      margin:8px 0 12px;padding:14px;
                      border:1px solid #edb8ac;border-radius:12px;
                      background:white;color:#50332c;font:inherit;" />
        <p class="dev-entry-error"
           role="alert"
           style="margin:0 0 16px;color:#b63f30;"
           hidden></p>
        <div style="display:flex;gap:12px;">
          <button type="button"
                  class="dev-entry-cancel"
                  style="flex:1;padding:14px 10px;border-radius:12px;
                         border:1px solid #edb8ac;background:white;
                         color:#50332c;font:inherit;cursor:pointer;">
            일반 화면으로
          </button>
          <button type="submit"
                  class="dev-entry-submit"
                  style="flex:1;padding:14px 10px;border-radius:12px;
                         border:0;background:#ee6b58;color:white;
                         font:inherit;cursor:pointer;">
            확인 후 입장
          </button>
        </div>
      `;

      overlay.append(form);
      document.body.append(overlay);

      const input = form.elements.password;
      const error = form.querySelector('.dev-entry-error');
      const submit = form.querySelector('.dev-entry-submit');
      const cancel = form.querySelector('.dev-entry-cancel');

      let busy = false;
      let active = true;
      let controller = null;

      function showError(message) {
        error.textContent = message;
        error.hidden = !message;
      }

      function cancelEntry() {
        if (!active) return;
        active = false;
        controller?.abort();
        input.value = '';
        goToNormal();
        resolve(false);
      }

      cancel.addEventListener('click', cancelEntry);

      form.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelEntry();
        }
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!active || busy) return;

        const password = input.value;

        if (!password) {
          showError('관리자 비밀번호를 입력해 주세요.');
          input.focus();
          return;
        }

        busy = true;
        submit.disabled = true;
        submit.textContent = '확인 중…';
        input.disabled = true;
        input.value = '';
        showError('');

        const requestController = new AbortController();
        controller = requestController;
        const timeout = setTimeout(
          () => requestController.abort(),
          15000
        );

        try {
          // 인증 전용 API만 호출한다. 지도 저장 요청은 보내지 않는다.
          const response = await fetch('/api/dev-auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            credentials: 'same-origin',
            signal: requestController.signal,
            body: JSON.stringify({ password }),
          });

          const data = await response.json();

          // 취소한 뒤 늦게 도착한 응답으로 입장하지 않는다.
          if (!active) return;

          if (!response.ok) {
            throw new Error(
              typeof data?.error === 'string'
                ? data.error
                : '비밀번호를 확인하지 못했어요.'
            );
          }

          if (data?.ok !== true || data?.verified !== true) {
            throw new Error('인증 응답을 확인하지 못했어요.');
          }

          active = false;

          // 비밀번호를 저장하지 않고 화면 입력 제한만 해제한다.
          for (const { element, inert } of previous) {
            element.inert = inert;
          }

          overlay.remove();
          resolve(true);
        } catch (err) {
          if (!active) return;

          showError(
            err.name === 'AbortError'
              ? '응답 시간이 길어 확인을 중단했어요. 다시 시도해 주세요.'
              : err instanceof SyntaxError
                ? '서버 응답을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'
                : err.message || '인증 서버에 연결하지 못했어요.'
          );
        } finally {
          clearTimeout(timeout);
          controller = null;

          if (active) {
            busy = false;
            input.disabled = false;
            submit.disabled = false;
            submit.textContent = '확인 후 입장';
            input.focus();
          }
        }
      });

      input.focus();
    });
  }

  if (wantsDev) {
    const allowed = await askDevPassword();
    if (!allowed) return;
  }

  try {
    await startGame();
  } catch {
    showLoadError();
  }
})();
