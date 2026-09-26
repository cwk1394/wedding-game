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
  // 이미 투명 배경인 이미지(네 귀퉁이가 투명)는 흰색을 지우지 않는다 — 흰 털(흰 고양이·토끼)이 뚫리지 않게
  const corners = [0, w - 1, (h - 1) * w, h * w - 1];
  const transparentBg = corners.every((p) => d[p * 4 + 3] < 10);
  const isBg = transparentBg
    ? (p) => d[p * 4 + 3] < 10
    : (p) => d[p * 4 + 3] < 10 || (d[p * 4] >= T && d[p * 4 + 1] >= T && d[p * 4 + 2] >= T);

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

/** 정면 이미지 → 배경 제거·크롭 후 높이 height로 축소한 캔버스 */
function buildFrontCanvas(frontImg, height) {
  const front = removeBackground(frontImg);
  const b = contentBounds(front, 0, 0, front.width, front.height);
  return cropScale(front, b, height / b.h);
}

/**
 * 동작 스트립(가로 4프레임) → 배경 제거 후 프레임별 캔버스 배열 (모두 같은 크기, 높이 height).
 * 모든 프레임을 같은 세로 범위로 잘라야 발 위치가 흔들리지 않는다
 * → 프레임별 경계 박스를 구한 뒤 가장 큰 폭/공통 세로 범위로 맞춰 자른다.
 * 좌우로는 CONFIG.sprite.framePadding만큼 여유를 둬서 머리카락·치마가 프레임 끝에 걸리지 않게 한다.
 * 점프 스트립도 같은 방식이라, 다리를 접은 프레임은 발이 살짝 떠 보인다 (몸 위치는 고정).
 */
function buildStripFrames(stripImg, height, frames = 4) {
  const strip = removeBackground(stripImg);
  const parts = splitFrames(strip, frames);
  const w = Math.max(...parts.map((p) => p.w));
  const y0 = Math.min(...parts.map((p) => p.y));
  const h = Math.max(...parts.map((p) => p.y + p.h)) - y0;
  const scale = height / h;
  const pad = Math.round(w * scale * CONFIG.sprite.framePadding);
  return parts.map((p) => {
    // 이 프레임 픽셀만 남긴 캔버스를 공통 폭(+양옆 여유) 캔버스 가운데에 놓는다
    const frame = document.createElement('canvas');
    frame.width = Math.round(w * scale) + pad * 2;
    frame.height = height;
    const ctx = frame.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(p.canvas, 0, y0 - p.y, p.w, h, pad + ((w - p.w) / 2) * scale, 0, p.w * scale, height);
    return frame;
  });
}

/**
 * 가로 스트립을 캐릭터 n명(프레임)으로 나눈다. 반환: [{ canvas, x, y, w, h }]
 * (canvas = 그 프레임 픽셀만 담은 크롭, x/y/w/h = 스트립 좌표 기준 박스)
 * AI 이미지는 프레임 간격이 일정하지 않고, 긴 머리·치마가 옆 프레임과 붙어 있기도 해서
 * 세로줄로 자르면 옆 프레임 조각이 섞이거나 잘린다. 그래서
 *  1) 불투명 열의 무게로 프레임 중심 n개를 찾고 (1차원 k-means)
 *  2) 붙어 있는 픽셀 덩어리(연결 요소) 단위로 가장 가까운 중심에 배정한다.
 *     덩어리 하나가 두 프레임에 걸칠 만큼 크면(서로 붙은 치마 등) 픽셀별로 가까운 중심에 나눈다.
 */
function splitFrames(canvas, n) {
  const { width, height } = canvas;
  const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  const opaque = (x, y) => data[(y * width + x) * 4 + 3] > 20;

  // 1) 프레임 중심: 열마다 불투명 픽셀 수를 무게로 k-means
  const colWeight = new Float64Array(width);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (opaque(x, y)) colWeight[x]++;
  let centers = [...Array(n)].map((_, i) => ((i + 0.5) * width) / n);
  const nearest = (x) => {
    let k = 0;
    for (let j = 1; j < n; j++) if (Math.abs(x - centers[j]) < Math.abs(x - centers[k])) k = j;
    return k;
  };
  for (let iter = 0; iter < 20; iter++) {
    const sum = new Float64Array(n);
    const cnt = new Float64Array(n);
    for (let x = 0; x < width; x++) {
      if (!colWeight[x]) continue;
      const k = nearest(x);
      sum[k] += x * colWeight[x];
      cnt[k] += colWeight[x];
    }
    centers = centers.map((c, k) => (cnt[k] ? sum[k] / cnt[k] : c));
  }
  const cellW = width / n;

  // 2) 연결 요소 라벨링 (4px 블록 단위로 줄여서 빠르게, 8방향 연결)
  const B = 4;
  const bw = Math.ceil(width / B);
  const bh = Math.ceil(height / B);
  const block = new Uint8Array(bw * bh);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (opaque(x, y)) block[((y / B) | 0) * bw + ((x / B) | 0)] = 1;
  }
  const label = new Int32Array(bw * bh).fill(-1);
  const owner = []; // 덩어리 번호 → 프레임 번호 (-1이면 픽셀별로 나눔)
  for (let start = 0; start < block.length; start++) {
    if (!block[start] || label[start] >= 0) continue;
    const id = owner.length;
    const stack = [start];
    label[start] = id;
    let minX = Infinity;
    let maxX = -1;
    let sumX = 0;
    let count = 0;
    while (stack.length) {
      const p = stack.pop();
      const bx = p % bw;
      const by = (p / bw) | 0;
      minX = Math.min(minX, bx);
      maxX = Math.max(maxX, bx);
      sumX += bx;
      count++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = bx + dx;
          const ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const q = ny * bw + nx;
          if (block[q] && label[q] < 0) {
            label[q] = id;
            stack.push(q);
          }
        }
      }
    }
    const spansTwo = (maxX - minX + 1) * B > cellW * 1.1;
    owner.push(spansTwo ? -1 : nearest((sumX / count + 0.5) * B));
  }

  // 3) 프레임별로 자기 픽셀만 복사
  const out = [...Array(n)].map(() => ({ img: new ImageData(width, height), x0: width, y0: height, x1: -1, y1: -1 }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] === 0) continue;
      const id = label[((y / B) | 0) * bw + ((x / B) | 0)];
      const f = out[id >= 0 && owner[id] >= 0 ? owner[id] : nearest(x)];
      f.img.data.set(data.subarray(i, i + 4), i);
      if (data[i + 3] > 20) {
        if (x < f.x0) f.x0 = x;
        if (x > f.x1) f.x1 = x;
        if (y < f.y0) f.y0 = y;
        if (y > f.y1) f.y1 = y;
      }
    }
  }
  return out.map((f, k) => {
    if (f.x1 < 0) {
      // 빈 프레임은 균등 칸으로 대신
      f.x0 = Math.round(k * cellW);
      f.x1 = Math.round((k + 1) * cellW) - 1;
      f.y0 = 0;
      f.y1 = height - 1;
    }
    const w = f.x1 - f.x0 + 1;
    const h = f.y1 - f.y0 + 1;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').putImageData(f.img, -f.x0, -f.y0, f.x0, f.y0, w, h);
    return { canvas: c, x: f.x0, y: f.y0, w, h };
  });
}

/** 같은 크기의 프레임들을 가로 한 줄 스트립으로 합친다 (업로드용) */
function joinFrames(frames) {
  const canvas = document.createElement('canvas');
  canvas.width = frames[0].width * frames.length;
  canvas.height = frames[0].height;
  const ctx = canvas.getContext('2d');
  frames.forEach((f, i) => ctx.drawImage(f, i * f.width, 0));
  return canvas;
}

/**
 * spriteUrl + 동작 스트립(walkUrl, jumpUrl, ladderUrl, ropeUrl) 이미지로 텍스처와 애니메이션을 만든다.
 *   `${key}_0` = 정면, `${key}_<motion>` = 동작 애니메이션 (프레임 텍스처 `${key}_<motion>0..3`)
 * 반환: { key, facesLeft, motions: { walk, jump, ladder, rope } } — motions는 해당 애니메이션이 있는지.
 * 동작 이미지 하나가 실패해도 나머지는 쓴다.
 */
async function loadSpriteTextures(scene, info) {
  const key = `sprite_${info.id}`;
  const motions = {};
  // NPC는 idle/sleep 같은 자기만의 동작, 자기 키(height), 동작별 프레임 수·높이 비율을 가질 수 있다
  const motionList = [...CONFIG.sprite.motions, ...(info.extraMotions ?? [])];
  const framesOf = (m) => info.motionFrames?.[m] ?? CONFIG.sprite.motionFrames[m] ?? 4;
  const ratioOf = (m) => info.motionHeight?.[m] ?? CONFIG.sprite.motionHeight[m] ?? 1;

  if (!scene.textures.exists(`${key}_0`)) {
    const [frontImg, ...stripImgs] = await Promise.all([
      loadImage(info.spriteUrl),
      ...motionList.map((m) =>
        info[`${m}Url`]
          ? loadImage(info[`${m}Url`]).catch((err) => console.warn(`${info.name} ${m} 이미지 로드 실패:`, err))
          : null
      ),
    ]);
    const height = (info.height ?? CONFIG.sprite.height) * CONFIG.sprite.textureScale;
    scene.textures.addCanvas(`${key}_0`, buildFrontCanvas(frontImg, height));

    motionList.forEach((m, i) => {
      if (!stripImgs[i]) return;
      const h = Math.round(height * ratioOf(m));
      const frameKeys = buildStripFrames(stripImgs[i], h, framesOf(m)).map((canvas, f) => {
        scene.textures.addCanvas(`${key}_${m}${f}`, canvas);
        return `${key}_${m}${f}`;
      });
      scene.anims.create({
        key: `${key}_${m}`,
        frames: frameKeys.map((k) => ({ key: k })),
        frameRate: { walk: 8, prone: 2, sleep: 2 }[m] ?? 6,
        repeat: m === 'jump' ? 0 : -1,
      });
    });
  }

  for (const m of motionList) motions[m] = scene.anims.exists(`${key}_${m}`);
  // 걷기 이미지가 없으면 정면 이미지 한 장으로 걷는다 (방향 뒤집기 기준은 오른쪽)
  if (!motions.walk && !scene.anims.exists(`${key}_walk`)) {
    scene.anims.create({ key: `${key}_walk`, frames: [{ key: `${key}_0` }], repeat: -1 });
  }
  return { key, facesLeft: motions.walk, motions };
}
