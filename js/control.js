// 캐릭터 직접 조종 (일반 방문자 + 개발자 모드 공용).
// - 방명록 팝업의 "조종하기" 버튼, 방명록 등록 직후, 개발자 모드 조종 도구에서 take()로 시작
// - PC: 방향키 + Space(점프), 터치 기기: 화면 스틱(왼쪽 아래) + 점프 버튼(오른쪽 아래)
// - 조종 중엔 카메라가 캐릭터를 따라간다 (지도를 드래그하는 동안은 멈춤)
// 실제 움직임(중력·사다리·엎드리기 등)은 GuestCharacter.tickControlled 가 input 을 읽어 처리한다.

class Controller {
  constructor(scene) {
    this.scene = scene;
    this.controlled = null;
    this.keys = { left: false, right: false, up: false, down: false };
    this.stick = { left: false, right: false, up: false, down: false };
    this.jumpQueued = false;
    this.onChange = null; // 조종 대상이 바뀌면 호출 (개발자 모드 툴바 갱신용)
    this.buildPad();
    this.bindKeys();
  }

  /** 조종 입력 (키보드 + 화면 스틱). 캐릭터의 tickControlled가 매 프레임 읽는다 */
  get input() {
    const k = this.keys;
    const s = this.stick;
    return {
      left: k.left || s.left,
      right: k.right || s.right,
      up: k.up || s.up,
      down: k.down || s.down,
      consumeJump: () => {
        const j = this.jumpQueued;
        this.jumpQueued = false;
        return j;
      },
    };
  }

  /** 이 캐릭터를 조종 시작. zoom이면 캐릭터 쪽으로 확대 */
  take(character, { zoom = false } = {}) {
    if (this.controlled === character) return;
    this.release();
    character.setControlled(true);
    this.controlled = character;
    this.pad.hidden = !matchMedia('(pointer: coarse)').matches;
    if (zoom) {
      const view = this.scene.view;
      view.touched = true;
      view.zoom = Math.max(view.zoom, CONFIG.view.controlZoom * DPR);
      view.center = { x: character.x, y: character.y - 40 };
      view.apply();
    }
    this.onChange?.();
  }

  release() {
    if (!this.controlled) return;
    this.controlled.setControlled(false);
    this.controlled = null;
    this.pad.hidden = true;
    Object.keys(this.keys).forEach((k) => (this.keys[k] = false));
    this.onChange?.();
  }

  /** 매 프레임: 조종 중인 캐릭터를 카메라가 따라간다 */
  update() {
    const c = this.controlled;
    const view = this.scene.view;
    if (!c || view.drag || view.pinch) return;
    view.center.x += (c.x - view.center.x) * 0.12;
    view.center.y += (c.y - 40 - view.center.y) * 0.12;
    view.apply();
  }

  bindKeys() {
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    // 조종 중이고, 팝업·입력칸에 포커스가 없을 때만
    const active = (e) =>
      this.controlled &&
      !document.querySelector('.modal:not([hidden])') &&
      !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? '');
    window.addEventListener('keydown', (e) => {
      if (!active(e)) return;
      if (map[e.key]) {
        this.keys[map[e.key]] = true;
        e.preventDefault();
      } else if (e.code === 'Space') {
        if (!e.repeat) this.jumpQueued = true;
        e.preventDefault();
        document.activeElement?.blur?.(); // 버튼에 포커스가 있으면 스페이스가 버튼을 누르지 않게
      }
    });
    window.addEventListener('keyup', (e) => {
      if (map[e.key]) this.keys[map[e.key]] = false;
    });
    window.addEventListener('blur', () => Object.keys(this.keys).forEach((k) => (this.keys[k] = false)));
  }

  /** 터치 기기용 화면 스틱(왼쪽 아래) + 점프 버튼(오른쪽 아래). 조종 중에만 보임 */
  buildPad() {
    const pad = document.createElement('div');
    pad.className = 'ctl-pad';
    pad.hidden = true;
    pad.innerHTML = `
      <div class="ctl-stick"><div class="ctl-knob"></div></div>
      <button type="button" class="ctl-jump">점프</button>`;
    document.body.append(pad);
    this.pad = pad;

    // Phaser가 window에서 받는 터치/마우스로 새지 않게 (지도 드래그·핀치로 오인 방지)
    for (const type of ['touchstart', 'touchmove', 'touchend', 'mousedown', 'mouseup', 'mousemove']) {
      pad.addEventListener(type, (e) => e.stopPropagation());
    }

    const stick = pad.querySelector('.ctl-stick');
    const knob = pad.querySelector('.ctl-knob');
    let active = null;
    const setStick = (dx, dy) => {
      const len = Math.hypot(dx, dy);
      const max = stick.clientWidth / 2;
      const k = len > max ? max / len : 1;
      knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
      const nx = dx / max;
      const ny = dy / max;
      Object.assign(this.stick, { left: nx < -0.35, right: nx > 0.35, up: ny < -0.5, down: ny > 0.5 });
    };
    const fromEvent = (e) => {
      const r = stick.getBoundingClientRect();
      setStick(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    };
    stick.addEventListener('pointerdown', (e) => {
      active = e.pointerId;
      try {
        stick.setPointerCapture(e.pointerId);
      } catch {}
      fromEvent(e);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId === active) fromEvent(e);
    });
    const end = (e) => {
      if (e.pointerId !== active) return;
      active = null;
      setStick(0, 0);
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);
    pad.querySelector('.ctl-jump').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.jumpQueued = true;
    });
  }
}
