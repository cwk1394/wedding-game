// 임시 캐릭터 텍스처를 코드로 그려서 생성한다. (4단계에서 AI 스프라이트로 교체 예정)
// 프레임 0 = 서있기, 프레임 1 = 걷기(다리 벌림). 오른쪽을 바라보는 모습으로 그린다.

const CHAR_W = 40;
const CHAR_H = 60;
const SKIN = 0xffe0bd;
const OUTLINE = 0x3b2410;

function drawHead(g, hair) {
  g.fillStyle(hair);
  g.fillCircle(20, 18, 15);
  g.fillStyle(SKIN);
  g.fillEllipse(21, 23, 22, 20);
  g.fillStyle(hair);
  g.fillRect(8, 8, 24, 7); // 앞머리
  g.fillStyle(0x222222);
  g.fillRect(19, 21, 3, 5); // 눈
  g.fillRect(27, 21, 3, 5);
  g.fillStyle(0xff9f9f, 0.7);
  g.fillCircle(16, 28, 2); // 볼터치
  g.fillCircle(31, 28, 2);
}

function drawLegs(g, color, frame) {
  g.fillStyle(color);
  if (frame === 0) {
    g.fillRect(14, 46, 5, 9);
    g.fillRect(21, 46, 5, 9);
  } else {
    g.fillRect(11, 46, 5, 8);
    g.fillRect(24, 46, 5, 8);
  }
  g.fillStyle(0x5a3a22); // 신발
  if (frame === 0) {
    g.fillRect(13, 55, 7, 4);
    g.fillRect(21, 55, 7, 4);
  } else {
    g.fillRect(9, 54, 7, 4);
    g.fillRect(24, 54, 7, 4);
  }
}

function drawGuest(g, look, frame) {
  drawLegs(g, look.bottom, frame);
  g.fillStyle(look.top);
  g.fillRoundedRect(12, 34, 16, 14, 3);
  g.fillStyle(SKIN);
  g.fillRect(frame === 0 ? 9 : 8, 37, 4, 8); // 팔
  g.fillRect(frame === 0 ? 27 : 28, 37, 4, 8);
  drawHead(g, look.hair);
}

function drawGroom(g, look, frame) {
  drawLegs(g, 0x1a1a1a, frame);
  g.fillStyle(0x1a1a1a); // 턱시도
  g.fillRoundedRect(11, 34, 18, 14, 3);
  g.fillStyle(0xffffff); // 셔츠
  g.fillTriangle(16, 34, 24, 34, 20, 44);
  g.fillStyle(0xc0392b); // 보타이
  g.fillTriangle(17, 34, 20, 36, 17, 38);
  g.fillTriangle(23, 34, 20, 36, 23, 38);
  drawHead(g, look.hair);
}

function drawBride(g, look, frame) {
  const sway = frame === 0 ? 0 : 1;
  g.fillStyle(SKIN);
  g.fillRect(16, 52, 3, 5);
  g.fillRect(21, 52, 3, 5);
  g.fillStyle(0xffffff); // 드레스
  g.fillTriangle(20, 32, 6 - sway, 57, 34 + sway, 57);
  g.fillRoundedRect(13, 33, 14, 10, 3);
  g.lineStyle(1, 0xd8d8e8);
  g.strokeTriangle(20, 32, 6 - sway, 57, 34 + sway, 57);
  g.fillStyle(0xff7eb6); // 부케
  g.fillCircle(24, 42, 3);
  g.fillCircle(27, 40, 3);
  drawHead(g, look.hair);
  g.fillStyle(0xffffff, 0.75); // 베일
  g.fillTriangle(8, 10, 3, 46, 14, 20);
  g.fillStyle(0xffd700); // 티아라
  g.fillRect(12, 5, 16, 3);
}

const HAIR_COLORS = [0x222222, 0x4a2c17, 0x7a3b12, 0xd9a441, 0x8e5a3c, 0x3b3b5c];
const TOP_COLORS = [0x3d7dd8, 0xe85d8a, 0x4caf50, 0xf2a93b, 0x9b59b6, 0xe74c3c, 0x1abc9c, 0xf5f5f5];
const BOTTOM_COLORS = [0x2b3a55, 0x4a4a4a, 0x6d4c41, 0x1a1a1a, 0x5d6d7e];

/** id 문자열로부터 항상 같은 랜덤 외형을 만든다 (새로고침해도 색이 안 바뀌게) */
function lookFromId(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const pick = (arr, shift) => arr[(h >>> shift) % arr.length];
  return { hair: pick(HAIR_COLORS, 0), top: pick(TOP_COLORS, 8), bottom: pick(BOTTOM_COLORS, 16) };
}

/** 캐릭터 한 명의 텍스처(프레임 2장)와 걷기 애니메이션을 생성하고 텍스처 키를 반환한다. */
function createCharacterTexture(scene, info) {
  const key = `char_${info.id}`;
  if (scene.textures.exists(`${key}_0`)) return key;

  const look = info.look || lookFromId(info.id);
  const draw = look.type === 'groom' ? drawGroom : look.type === 'bride' ? drawBride : drawGuest;

  for (const frame of [0, 1]) {
    const g = scene.make.graphics({ add: false });
    draw(g, look, frame);
    g.generateTexture(`${key}_${frame}`, CHAR_W, CHAR_H);
    g.destroy();
  }

  scene.anims.create({
    key: `${key}_walk`,
    frames: [{ key: `${key}_1` }, { key: `${key}_0` }],
    frameRate: 6,
    repeat: -1,
  });

  return key;
}

// ---------- 이미지 스프라이트 (spriteUrl = 정면, walkUrl = 걷기 프레임 가로 스트립) ----------
// AI가 만든 이미지는 흰 배경 + 고해상도라서, 테두리에서 이어진 흰색만 투명 처리(흰 옷은 보존)하고
// 캐릭터 영역만 잘라 CONFIG.sprite.height 높이로 축소해 캔버스 텍스처로 등록한다.

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`이미지 로드 실패: ${url}`));
    img.src = url;
  });
}

/** 이미지 테두리에서 flood fill로 흰 배경을 투명하게 만든 캔버스를 반환 */
function removeBackground(img) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, w, h);
  const d = imageData.data;
  const T = CONFIG.sprite.bgThreshold;
  const isBg = (p) => d[p * 4 + 3] < 10 || (d[p * 4] >= T && d[p * 4 + 1] >= T && d[p * 4 + 2] >= T);

  const visited = new Uint8Array(w * h);
  const stack = [];
  const seed = (p) => {
    if (!visited[p]) {
      visited[p] = 1;
      stack.push(p);
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const p = stack.pop();
    if (!isBg(p)) continue;
    d[p * 4 + 3] = 0;
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < w * (h - 1)) seed(p + w);
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** 캔버스의 (x, y, w, h) 영역에서 불투명 픽셀의 경계 박스 (영역 기준 좌표) */
function contentBounds(canvas, x, y, w, h) {
  const d = canvas.getContext('2d').getImageData(x, y, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      if (d[(yy * w + xx) * 4 + 3] > 20) {
        if (xx < x0) x0 = xx;
        if (xx > x1) x1 = xx;
        if (yy < y0) y0 = yy;
        if (yy > y1) y1 = yy;
      }
    }
  }
  if (x1 < 0) return { x: 0, y: 0, w, h };
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function cropScale(src, rect, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(rect.w * scale));
  canvas.height = Math.max(1, Math.round(rect.h * scale));
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, rect.x, rect.y, rect.w, rect.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * spriteUrl/walkUrl 이미지로 텍스처(`${key}_0`, `${key}_w0..`)와 걷기 애니메이션을 만든다.
 * 반환: { key, facesLeft } — 걷기 이미지는 왼쪽을 바라본다고 가정.
 */
async function loadSpriteTextures(scene, info) {
  const key = `sprite_${info.id}`;
  const height = CONFIG.sprite.height;
  const walkFrameKeys = [];

  if (!scene.textures.exists(`${key}_0`)) {
    const [front, walk] = await Promise.all([
      loadImage(info.spriteUrl).then(removeBackground),
      info.walkUrl ? loadImage(info.walkUrl).then(removeBackground) : null,
    ]);

    const fb = contentBounds(front, 0, 0, front.width, front.height);
    scene.textures.addCanvas(`${key}_0`, cropScale(front, fb, height / fb.h));

    if (walk) {
      // 모든 프레임을 같은 영역으로 잘라야 발 위치가 흔들리지 않는다 → 프레임별 경계 박스의 합집합 사용
      const n = CONFIG.sprite.walkFrames;
      const cw = Math.floor(walk.width / n);
      const boxes = [...Array(n)].map((_, i) => contentBounds(walk, i * cw, 0, cw, walk.height));
      const x0 = Math.min(...boxes.map((b) => b.x));
      const y0 = Math.min(...boxes.map((b) => b.y));
      const x1 = Math.max(...boxes.map((b) => b.x + b.w));
      const y1 = Math.max(...boxes.map((b) => b.y + b.h));
      const scale = height / (y1 - y0);
      for (let i = 0; i < n; i++) {
        const rect = { x: i * cw + x0, y: y0, w: x1 - x0, h: y1 - y0 };
        scene.textures.addCanvas(`${key}_w${i}`, cropScale(walk, rect, scale));
        walkFrameKeys.push(`${key}_w${i}`);
      }
    }

    if (!scene.anims.exists(`${key}_walk`)) {
      scene.anims.create({
        key: `${key}_walk`,
        frames: (walkFrameKeys.length ? walkFrameKeys : [`${key}_0`]).map((k) => ({ key: k })),
        frameRate: 8,
        repeat: -1,
      });
    }
  }

  return { key, facesLeft: Boolean(info.walkUrl) };
}
