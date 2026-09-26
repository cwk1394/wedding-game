// 서버 API 호출 + 업로드 전 이미지 처리

function loadFileImage(file) {
  const url = URL.createObjectURL(file);
  return loadImage(url).finally(() => URL.revokeObjectURL(url));
}

/** File 또는 URL(data URL 포함) → HTMLImageElement */
function toImage(source) {
  return source instanceof Blob ? loadFileImage(source) : loadImage(source);
}

/**
 * 캐릭터 원본 이미지(정면, 걷기) → 업로드용 PNG data URL { front, walk }.
 * 배경 제거·크롭·축소를 거친다. 정면이 없으면 null.
 */
async function prepareSpriteImages(frontSource, walkSource) {
  if (!frontSource) {
    if (walkSource) throw new Error('걷기 이미지를 쓰려면 정면 이미지도 함께 올려 주세요.');
    return null;
  }
  const [frontImg, walkImg] = await Promise.all([
    toImage(frontSource),
    walkSource ? toImage(walkSource) : null,
  ]);
  const { front, walkFrames } = buildSpriteCanvases(frontImg, walkImg, CONFIG.sprite.uploadHeight);
  return {
    front: front.toDataURL('image/png'),
    walk: walkFrames.length ? joinFrames(walkFrames).toDataURL('image/png') : null,
  };
}

/** 하객 사진을 긴 변 maxSize 이하 JPEG data URL로 줄인다 (서버 요청 크기 제한 대응) */
async function resizePhoto(file, maxSize = CONFIG.ai.photoMaxSize) {
  const img = await loadFileImage(file);
  const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; // 투명 PNG 사진 대비
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

async function postJson(path, body) {
  if (!CONFIG.apiUrl) throw new Error('방명록 서버가 아직 설정되지 않았어요.');
  let res;
  try {
    res = await fetch(`${CONFIG.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청에 실패했어요. (HTTP ${res.status})`);
  return data;
}

/** AI 캐릭터 생성. type: 'front'(사진 → 정면) | 'walk'(정면 → 걷기 4프레임). 결과는 data URL. */
async function generateCharacter(type, image) {
  const { image: result } = await postJson('/api/character', { type, image });
  return result;
}

/** 방명록 등록. 성공 시 서버가 만든 guest 객체(id = UUID) 반환. */
async function submitGuestbook({ name, shortMsg, longMsg, images }) {
  const { guest } = await postJson('/api/guestbook', { name, shortMsg, longMsg, images });
  return guest;
}
