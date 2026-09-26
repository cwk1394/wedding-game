// 방명록 등록: 브라우저에서 이미지를 배경 제거·크롭·축소한 뒤 Worker로 전송

function loadFileImage(file) {
  const url = URL.createObjectURL(file);
  return loadImage(url).finally(() => URL.revokeObjectURL(url));
}

/** 선택한 이미지 파일 → 업로드용 PNG data URL { front, walk }. 정면이 없으면 null. */
async function prepareSpriteImages(frontFile, walkFile) {
  if (!frontFile) {
    if (walkFile) throw new Error('걷기 이미지를 쓰려면 정면 이미지도 함께 올려 주세요.');
    return null;
  }
  const [frontImg, walkImg] = await Promise.all([
    loadFileImage(frontFile),
    walkFile ? loadFileImage(walkFile) : null,
  ]);
  const { front, walkFrames } = buildSpriteCanvases(frontImg, walkImg, CONFIG.sprite.uploadHeight);
  return {
    front: front.toDataURL('image/png'),
    walk: walkFrames.length ? joinFrames(walkFrames).toDataURL('image/png') : null,
  };
}

/** Worker에 방명록 등록 요청. 성공 시 서버가 만든 guest 객체(id = UUID) 반환. */
async function submitGuestbook({ name, shortMsg, longMsg, images }) {
  if (!CONFIG.apiUrl) throw new Error('방명록 서버가 아직 설정되지 않았어요.');
  const res = await fetch(`${CONFIG.apiUrl}/api/guestbook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, shortMsg, longMsg, images }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `등록에 실패했어요. (HTTP ${res.status})`);
  return data.guest;
}
