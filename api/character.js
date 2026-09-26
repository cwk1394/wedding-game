// 캐릭터 이미지 생성 API (Vercel Serverless Function)
// POST /api/character { type, image: <data URL> }
//   front : 하객 사진 + prompt/create-character.txt                → 정면 캐릭터 (1024x1024)
//           image 없이 보내면 사진 없이 prompt/create-character-noref.txt + 무작위 특징으로 새로 그림
//   walk  : 정면 캐릭터 + prompt/create-character-walk.txt           → 왼쪽으로 걷는 4프레임 스트립 (1536x1024)
//   jump  : 정면 캐릭터 + prompt/create-character-jump.txt           → 점프 4프레임 (왼쪽, 제자리 포즈만)
//   ladder: 정면 캐릭터 + prompt/create-character-ladder-climbing.txt → 사다리 타기 4프레임 (뒷모습)
//   rope  : 정면 캐릭터 + prompt/create-character-rope-climbing.txt   → 로프 타기 4프레임 (뒷모습)
//   prone : 정면 캐릭터 + prompt/create-character-prone.txt           → 엎드리기 2프레임 (왼쪽)
//   → { image: <data URL (webp)> }
// 한 번에 다 만들면 오래 걸리므로(각 최대 ~2분) 브라우저가 front를 먼저 만들고 나머지를 따로 호출한다.
// 생성된 이미지는 저장하지 않는다. 저장은 방명록 등록(/api/guestbook) 때 브라우저가 후처리한 PNG로.
//
// 환경변수(Vercel): OPENAI_API_KEY(필수)
//   선택: OPENAI_IMAGE_MODEL(쉼표 구분 시 순서대로 시도), OPENAI_IMAGE_QUALITY(low|medium|high, 기본 medium)

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError, corsHeaders, handlePost, json, preflight } from './_lib/http.js';

const MODELS = (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2,gpt-image-1.5,gpt-image-1')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';
const MAX_INPUT_BYTES = 3 * 1024 * 1024; // Vercel 요청 본문 상한(4.5MB) 안쪽

const TYPES = {
  front: { prompt: 'create-character.txt', size: '1024x1024' },
  walk: { prompt: 'create-character-walk.txt', size: '1536x1024' },
  jump: { prompt: 'create-character-jump.txt', size: '1536x1024' },
  ladder: { prompt: 'create-character-ladder-climbing.txt', size: '1536x1024' },
  rope: { prompt: 'create-character-rope-climbing.txt', size: '1536x1024' },
  prone: { prompt: 'create-character-prone.txt', size: '1536x1024' },
};

let workingModel = null; // 한 번 성공한 모델은 기억해 두고 계속 사용

export const OPTIONS = preflight;

export function GET(request) {
  return json({ ok: true, configured: Boolean(process.env.OPENAI_API_KEY) }, 200, corsHeaders(request));
}

export function POST(request) {
  return handlePost(request, async (body) => {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다.');
    const spec = TYPES[body.type];
    if (!spec) throw new HttpError(400, `type은 ${Object.keys(TYPES).join(', ')} 중 하나여야 합니다.`);
    if (body.type === 'front' && !body.image) {
      // 사진 없이: 무작위 특징을 넣은 프롬프트로 새 캐릭터
      const template = await readFile(join(process.cwd(), 'prompt', 'create-character-noref.txt'), 'utf8');
      const prompt = template.replace('{{TRAITS}}', randomTraits());
      const image = await generate({ prompt, size: spec.size, input: null });
      return { status: 200, body: { image } };
    }
    const input = decodeImage(body.image);
    const prompt = await readFile(join(process.cwd(), 'prompt', spec.prompt), 'utf8');
    const image = await generate({ prompt, size: spec.size, input });
    return { status: 200, body: { image } };
  });
}

/** data URL(png/jpeg/webp) → { blob, filename } */
function decodeImage(dataUrl) {
  const m = typeof dataUrl === 'string' && dataUrl.match(/^data:image\/(png|jpeg|webp);base64,(.+)$/);
  if (!m) throw new HttpError(400, '이미지 형식이 잘못되었습니다. (png, jpeg, webp)');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_INPUT_BYTES) throw new HttpError(413, '이미지가 너무 큽니다.');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  return { blob: new Blob([bytes], { type: `image/${m[1]}` }), filename: `input.${ext}` };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** 사진 없이 만들 때 캐릭터가 매번 다르게 나오도록 무작위 특징 */
function randomTraits() {
  const gender = pick(['남자', '여자']);
  const hair =
    gender === '남자'
      ? pick(['덥수룩한 짧은 머리', '앞머리 내린 투블럭', '살짝 뻗친 삐죽 머리', '가르마 댄디컷', '곱슬 펌 머리', '뒤로 넘긴 포마드'])
      : pick(['긴 웨이브 머리', '양갈래 묶음 머리', '단발 보브컷', '높게 묶은 포니테일', '땋은 머리', '반묶음 긴 생머리', '둥근 똥머리']);
  const color = pick(['검정', '짙은 갈색', '밝은 갈색', '밀크티 베이지', '분홍', '하늘색', '금발', '와인색', '민트색']);
  const outfit =
    gender === '남자'
      ? pick(['네이비 정장과 넥타이', '베이지 셔츠와 멜빵바지', '카키 재킷과 청바지', '회색 조끼 정장과 나비넥타이', '하얀 셔츠와 슬랙스', '파스텔 니트와 면바지'])
      : pick(['파스텔 핑크 원피스', '하늘색 플레어 원피스', '노란 블라우스와 치마', '라벤더 투피스', '꽃무늬 원피스', '민트 셔츠와 치마', '크림색 니트 원피스']);
  const accessory = pick(['없음', '동그란 안경', '꽃 머리핀', '리본 머리띠', '작은 꽃다발', '작은 선물 상자', '베레모', '진주 목걸이', '하트 풍선']);
  return [
    `* 성별 느낌: ${gender}`,
    `* 헤어스타일: ${hair}`,
    `* 머리색: ${color}`,
    `* 의상: ${outfit}`,
    `* 액세서리: ${accessory}`,
  ].join('\n');
}

/** input이 있으면 이미지 편집(사진 참고), 없으면 글만으로 이미지 생성 */
async function generate({ prompt, size, input }) {
  const models = workingModel ? [workingModel] : MODELS;
  let lastError;
  for (const model of models) {
    const params = { model, prompt, size, quality: QUALITY, output_format: 'webp', output_compression: 90 };
    let body;
    let headers = { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` };
    if (input) {
      // 이미지 편집(사진 참고): multipart
      body = new FormData();
      for (const [k, v] of Object.entries(params)) body.append(k, String(v));
      body.append('image', input.blob, input.filename);
    } else {
      // 글만으로 생성: JSON만 받는다
      body = JSON.stringify(params);
      headers = { ...headers, 'Content-Type': 'application/json' };
    }

    const res = await fetch(`https://api.openai.com/v1/images/${input ? 'edits' : 'generations'}`, {
      method: 'POST',
      headers,
      body,
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.data?.[0]?.b64_json) {
      workingModel = model;
      return `data:image/webp;base64,${data.data[0].b64_json}`;
    }

    const err = data.error || {};
    lastError = `${model}: ${res.status} ${err.code || ''} ${err.message || ''}`.trim();
    console.error('OpenAI 이미지 생성 실패', lastError);

    if (isModelUnavailable(res.status, err)) continue; // 다음 모델로
    if (err.code === 'moderation_blocked' || /safety|moderation/i.test(err.message || '')) {
      throw new HttpError(422, '이 사진으로는 캐릭터를 만들 수 없어요. 다른 사진으로 시도해 주세요.');
    }
    if (err.code === 'insufficient_quota' || err.type === 'insufficient_quota') {
      throw new HttpError(503, '캐릭터 생성 서비스를 지금 쓸 수 없어요. (AI 사용 한도 초과: insufficient_quota)');
    }
    if (res.status === 429) {
      throw new HttpError(429, `지금 요청이 많아요. 잠시 후 다시 시도해 주세요. (${err.code || 'rate_limit'})`);
    }
    break;
  }
  throw new Error(`이미지 생성 실패 — ${lastError}`);
}

function isModelUnavailable(status, err) {
  if (err.code === 'model_not_found') return true;
  const msg = err.message || '';
  return (status === 400 || status === 403 || status === 404) && err.param === 'model'
    ? true
    : /model.*(does not exist|not found|invalid|not supported|do not have access)/i.test(msg);
}
