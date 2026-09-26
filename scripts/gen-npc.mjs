// NPC 스프라이트 생성 (OpenAI 이미지 API). 로컬에서 한 번씩 돌리는 도구 — 키는 환경변수로만 받는다.
//   OPENAI_API_KEY=... node scripts/gen-npc.mjs                 전부 생성
//   OPENAI_API_KEY=... node scripts/gen-npc.mjs pudding cat-mimi:sleep   일부만 다시 생성
// 1) NPC마다 기준 이미지(front)를 글로 생성 → 2) 그 이미지를 참고로 동작 스트립(idle/walk/sleep) 생성
// 결과: img/npc/<id>/<motion>.webp (sharp로 가로 768px로 줄여 저장, 원본은 .cache/npc-raw/)
// 옵션: OPENAI_IMAGE_MODEL(쉼표 구분, 기본 gpt-image-2,gpt-image-1.5,gpt-image-1), OPENAI_IMAGE_QUALITY(기본 medium)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) {
  console.error('OPENAI_API_KEY 환경변수가 필요합니다.');
  process.exit(1);
}
const MODELS = (process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2,gpt-image-1.5,gpt-image-1').split(',').map((s) => s.trim());
const QUALITY = process.env.OPENAI_IMAGE_QUALITY || 'medium';
const sharp = (await import('sharp')).default;

const STYLE = `Authentic classic MapleStory-style 2D pixel art sprite: chibi proportions, chunky visible pixels, clean 1px dark outline,
flat color shading, limited palette, no anti-aliasing, no smooth gradients, no painterly rendering.
Pure white background (#FFFFFF). No text, no logo, no watermark, no UI, no ground, no shadow, no environment.`;

const spacing = (n) => `FRAME LAYOUT (VERY IMPORTANT — the game slices frames automatically):
- Exactly ${n} frames in ONE horizontal row, ${n} equal-width cells, identical scale in every frame.
- One character centered in each cell, all at the same baseline (feet/bottom on the same line).
- Keep a clear EMPTY white gap between neighboring characters of at least 15% of a cell width,
  and at least 10% margin on the left and right of each character inside its own cell.
- No part of a character (ears, tail, paws, props, effects) may touch or cross into a neighboring cell.
- Do not draw borders, separators, or grid lines.`;

const facingLeft = 'The character faces LEFT (left-facing side / three-quarter view) in every frame.';

// 공통 동작 프롬프트
const strip = (n, action, extra = '') => `Using the character from the reference image, create a ${n}-frame horizontal sprite sheet animation.
Keep the exact same character design, colors, proportions and pixel-art style as the reference.
${facingLeft}
Action: ${action}
${extra}
${spacing(n)}
${STYLE}`;

const catBase = (look) => `A cute small cat NPC in MapleStory style, ${look}, walking on four legs, side view facing LEFT, full body, chibi and round, big shiny eyes, friendly expression.`;

const NPCS = {
  pudding: {
    front: `A cute white rabbit NPC named Pudding in MapleStory style: snow-white fluffy fur, bright red eyes, pink inner ears, big happy smile,
standing upright on two legs, carrying a small woven basket full of pink flower petals. Full body, three-quarter view facing LEFT, chibi proportions.`,
    motions: {
      idle: strip(4, 'Standing in place, smiling happily and tossing pink flower petals into the air from the basket with one paw (a looping sprinkle motion). A few small petals may float just above the paw, staying inside the cell.'),
      walk: strip(4, 'Walking/hopping cheerfully to the LEFT while smiling and sprinkling pink flower petals from the basket. A few small petals near the paw, inside the cell.'),
    },
  },
  zebra: {
    front: `A cute zebra NPC in MapleStory style: black and white stripes, short spiky mane, cheerful face, standing upright on two legs like a person,
holding a bubble wand in one hand and a small toy trumpet shaped like an elephant (party trumpet) hanging at the side. Full body, three-quarter view facing LEFT, chibi proportions.`,
    motions: {
      idle: strip(4, 'Standing in place and blowing soap bubbles through a bubble wand toward the left. Show a few round translucent soap bubbles near the wand, inside the cell.'),
      walk: strip(4, 'Walking to the LEFT while happily blowing a small elephant-shaped toy trumpet (party horn), cheeks puffed. Walking legs clearly alternate.'),
    },
  },
  'cat-mimi': { look: 'pure white fur with blue eyes and a small pink nose' },
  'cat-ongi': { look: 'orange cheese tabby fur with darker orange stripes and green eyes' },
  'cat-boksil': { look: 'very fluffy long-haired light grey fur with a big fluffy tail and yellow eyes' },
  'cat-byeol': { look: 'glossy black fur with golden eyes and a tiny yellow star-shaped mark on the forehead' },
  esso: {
    front: `A cute border collie dog NPC named Esso in MapleStory style: light brown (tan) and white coat, fluffy ears, bright happy open-mouth smile,
standing on four legs, side view facing LEFT, full body, chibi and round.`,
    motions: {
      idle: strip(4, 'Standing in place with an innocent happy grin, mouth open and tongue out panting ("hehe"), head turning slightly to look around, tail wagging.'),
      walk: strip(4, 'Running happily to the LEFT with a big innocent smile, tongue out, ears bouncing, a playful energetic run cycle.'),
    },
  },
  taxi: {
    front: `A cute yellow taxi car in MapleStory style, side view facing LEFT, rounded chibi cartoon car with a small "TAXI" roof sign (just the shape, no readable text needed),
a small pink ribbon on the side for a wedding, full vehicle visible. ${STYLE}`,
    motions: {},
  },
};
for (const [id, cat] of Object.entries(NPCS)) {
  if (!cat.look) continue;
  cat.front = catBase(cat.look);
  cat.motions = {
    walk: strip(4, 'Slowly prowling/strolling to the LEFT in a relaxed, lazy way (a calm cat walk cycle), tail swaying.'),
    idle: strip(4, 'Sitting and grooming itself: licking a front paw and washing its face/body, a looping grooming motion.'),
    sleep: strip(2, 'Curled up lying down and sleeping peacefully with eyes closed; frame 2 is the same pose with a tiny breathing motion.', 'The sleeping cat is low and wide (about half the height of the standing cat).'),
  };
}

// ---------- OpenAI ----------

async function callOpenAI(path, makeBody) {
  let lastErr;
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://api.openai.com/v1/images/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, ...(path === 'generations' ? { 'Content-Type': 'application/json' } : {}) },
        body: makeBody(model),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.data?.[0]?.b64_json) return Buffer.from(data.data[0].b64_json, 'base64');
      const err = data.error || {};
      lastErr = `${model}: ${res.status} ${err.code || ''} ${err.message || ''}`;
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 8000 * (attempt + 1)));
        continue;
      }
      if (/model/i.test(err.param || '') || /model/i.test(err.message || '') || err.code === 'model_not_found') break; // 다음 모델
      throw new Error(lastErr);
    }
  }
  throw new Error(lastErr);
}

const generate = (prompt, size) =>
  callOpenAI('generations', (model) => JSON.stringify({ model, prompt, size, quality: QUALITY, output_format: 'webp', output_compression: 92 }));

const edit = (prompt, size, ref) =>
  callOpenAI('edits', (model) => {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('image', new Blob([ref], { type: 'image/webp' }), 'ref.webp');
    form.append('size', size);
    form.append('quality', QUALITY);
    form.append('output_format', 'webp');
    form.append('output_compression', '92');
    return form;
  });

async function save(id, motion, buf) {
  await mkdir(`.cache/npc-raw/${id}`, { recursive: true });
  await mkdir(`img/npc/${id}`, { recursive: true });
  await writeFile(`.cache/npc-raw/${id}/${motion}.webp`, buf);
  // 게임에서는 표시 높이 70px 안팎 × 2배면 충분 → 가로 768px로 줄여 용량 절약
  await sharp(buf).resize({ width: 768, withoutEnlargement: true }).webp({ quality: 90 }).toFile(`img/npc/${id}/${motion}.webp`);
}

// ---------- 실행 ----------

const only = process.argv.slice(2); // "id" 또는 "id:motion"
const want = (id, motion) => !only.length || only.includes(id) || only.includes(`${id}:${motion}`);

async function pool(tasks, n) {
  const queue = [...tasks];
  const run = async () => {
    while (queue.length) await queue.shift()();
  };
  await Promise.all(Array.from({ length: n }, run));
}

const t0 = Date.now();
const log = (msg) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${msg}`);

// 1) 기준 이미지
await pool(
  Object.entries(NPCS)
    .filter(([id]) => want(id, 'front'))
    .map(([id, npc]) => async () => {
      const size = id === 'taxi' ? '1536x1024' : '1024x1024';
      try {
        await save(id, 'front', await generate(`${npc.front}\n${id === 'taxi' ? '' : STYLE}`, size));
        log(`${id}/front ok`);
      } catch (e) {
        log(`${id}/front FAIL ${e.message}`);
      }
    }),
  4
);

// 2) 동작 스트립 (기준 이미지를 참고)
const jobs = [];
for (const [id, npc] of Object.entries(NPCS)) {
  for (const [motion, prompt] of Object.entries(npc.motions)) {
    if (!want(id, motion)) continue;
    jobs.push(async () => {
      const refPath = `.cache/npc-raw/${id}/front.webp`;
      if (!existsSync(refPath)) return log(`${id}/${motion} SKIP (기준 이미지 없음)`);
      try {
        await save(id, motion, await edit(prompt, '1536x1024', await readFile(refPath)));
        log(`${id}/${motion} ok`);
      } catch (e) {
        log(`${id}/${motion} FAIL ${e.message}`);
      }
    });
  }
}
await pool(jobs, 4);
log('done');
