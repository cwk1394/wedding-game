// NPC 스프라이트 생성 (OpenAI 이미지 API). 로컬에서 한 번씩 돌리는 도구 — 키는 환경변수로만 받는다.
//   OPENAI_API_KEY=... node scripts/gen-npc.mjs                 전부 생성
//   OPENAI_API_KEY=... node scripts/gen-npc.mjs rabbit-pudding cat-mimi:sleep   일부만 다시 생성
// 1) NPC마다 기준 이미지(front)를 글로 생성 — img/npc/<id>/origin.jpg(실제 사진)가 있으면 그 사진을 바탕으로 생성
// 2) 그 기준 이미지를 참고로 동작 스트립(idle/walk/sleep/scratch) 생성
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
Transparent background (no background at all). No text, no logo, no watermark, no UI, no ground, no shadow, no environment.`;

const spacing = (n) => `FRAME LAYOUT (VERY IMPORTANT — the game slices frames automatically):
- Exactly ${n} frames in ONE horizontal row, ${n} equal-width cells, identical scale in every frame.
- One character centered in each cell, all at the same baseline (feet/bottom on the same line).
- Keep a clear EMPTY white gap between neighboring characters of at least 15% of a cell width,
  and at least 10% margin on the left and right of each character inside its own cell.
- No part of a character (ears, tail, paws, props, effects) may touch or cross into a neighboring cell.
- Do not draw borders, separators, or grid lines. The gaps are fully transparent.`;

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
  'rabbit-pudding': {
    origin: true,
    front: `Turn the real rabbit in this photo into a cute MapleStory-style NPC named Pudding. Keep its real look: pure snow-white fluffy fur,
bright red eyes, long upright ears with pink insides, round body. Give it a big happy smile and let it stand upright on two legs,
carrying a small woven basket full of pink flower petals. Full body, three-quarter view facing LEFT, chibi proportions. Ignore the photo background.`,
    motions: {
      idle: strip(4, 'Standing in place, smiling happily and tossing pink flower petals into the air from the basket with one paw (a looping sprinkle motion). A few small petals may float just above the paw, staying inside the cell.'),
      walk: strip(4, 'Walking/hopping cheerfully to the LEFT while smiling and sprinkling pink flower petals from the basket. A few small petals near the paw, inside the cell.'),
    },
  },
  'zebra': {
    front: `A goofy, mischievous zebra NPC in MapleStory style — a playful class-clown personality: black and white stripes, wild spiky mane,
cheeky toothy grin, wearing funky oversized novelty sunglasses (bright pink heart-shaped frames with star sparkles), standing upright on two legs like a person
in a silly confident pose, holding a bubble wand in one hand and a colorful curled paper party blower in the other.
Full body, three-quarter view facing LEFT, chibi proportions.`,
    motions: {
      idle: strip(4, 'Standing in place doing a silly little dance/wiggle while blowing soap bubbles through a bubble wand toward the left, grinning behind the funky sunglasses. Show a few round translucent soap bubbles near the wand, inside the cell.'),
      walk: strip(4, 'Strutting/bouncing goofily to the LEFT while blowing a colorful paper party blower: the curled party blower unrolls and extends straight out in some frames and curls back in others, cheeks puffed, funky sunglasses on. Walking legs clearly alternate.'),
    },
  },
  'cat-mimi': {
    origin: true,
    look: 'the real cat in the reference photo (ignore the mirror reflection behind it): a sleek black-and-white tuxedo cat, mostly glossy black short fur with a white chin spot, white chest and belly and white paw tips, a long black tail, and yellow-green eyes',
  },
  'cat-ongi': {
    origin: true,
    look: 'the real cat in the reference photo: a brown tabby cat with short dark brown and black mackerel stripes, a striped ringed tail with a dark tip, a light muzzle, a pinkish-brown nose and yellow-green eyes',
  },
  'cat-boksil': {
    origin: true,
    look: 'the real cat in the reference photo: a slim grey tabby-and-white cat with a grey striped head, back and tail, a white muzzle, chest, belly and white paws, a pink nose, big green eyes and tall pointy ears',
  },
  'cat-byeol': {
    origin: true,
    look: 'the real cat in the reference photo: a pure white, very fluffy long-haired Persian-style cat with a flat round face, blue-grey eyes and a small pink nose',
  },
  'dog-esso': {
    origin: true,
    front: `Turn the real dog in this photo into a cute MapleStory-style NPC named Esso. Keep its real look: a fluffy light cream / pale golden-brown
border collie with a white chest and muzzle, soft floppy ears, bright happy open-mouth smile with tongue out. Standing on four legs, side view facing LEFT,
full body, chibi and round. Ignore the photo background and people.`,
    motions: {
      idle: strip(4, 'Standing in place with an innocent happy grin, mouth open and tongue out panting ("hehe"), head turning slightly to look around, tail wagging.'),
      walk: strip(4, 'Running happily to the LEFT with a big innocent smile, tongue out, ears bouncing, a playful energetic run cycle.'),
      scratch: strip(4, 'Sitting on the ground and scratching behind its ear/head with one hind leg, like a real dog: the hind leg moves up and down in a quick scratching loop, head tilted, eyes squinted happily.'),
    },
  },
  'dog-mongsil': {
    origin: true,
    front: `Turn the real dog in this photo into a cute MapleStory-style NPC named Mongsil. Keep its real look: a small white Pekingese with long soft white fur,
a short flat face with a dark muzzle and black nose, big round dark shiny eyes, fluffy ears. Standing on four legs, three-quarter side view facing LEFT,
full body, chibi and round. Ignore the photo background.`,
    motions: {
      idle: strip(4, 'Standing in place and looking UP with big round shiny eyes, head tilted upward exactly like the reference photo, a gentle curious look; tiny head tilt and blink between frames.'),
      walk: strip(4, 'Walking SLOWLY and calmly to the LEFT with short little steps, fluffy fur swaying — a relaxed, leisurely small-dog walk cycle.'),
      sit: strip(4, 'Sitting on the ground holding a pink squeaky dumbbell-shaped chew toy in its mouth, happily chewing it: the toy squishes a little between frames, tail wagging.'),
    },
  },
  'wedding-car': {
    // 오른쪽 아래 광장(파스텔 분홍·크림색 돌바닥, 위에서 살짝 내려다보는 시점)에 서 있는 웨딩 택시
    front: `A cute MapleStory-style wedding taxi NPC, parked on a pastel pink-and-cream stone plaza in a dreamy flower wedding garden.
Camera angle: a clear THREE-QUARTER FRONT view with real 3D depth (NOT a flat side view): the car is turned about 35-45 degrees toward the viewer,
facing front-LEFT, so we see the whole FRONT (headlights, grille, bumper, windshield) AND the LEFT side at the same time, plus the top of the roof and hood
from a slightly elevated camera. Clear perspective: the front is closer and larger, the rear recedes. Isometric-like chunky toy-car volume.
Rounded chibi cartoon car with soft pastel colors that blend with the pink/cream garden: creamy butter-yellow body, white trim, a small "TAXI" roof sign (shape only, no readable text),
a pink satin ribbon bow on the side door, a tiny garland of pink roses and white flowers on the roof, "just married" style pastel ribbons trailing from the back bumper.
Soft warm lighting from the upper left, subtle cute shading, full vehicle visible, no ground, no shadow. ${STYLE}`,
    motions: {},
  },
  'rps-machine': {
    // 이벤트 NPC: 옛날 오락실 "가위바위보 동전 게임기"를 웨딩 파스텔로. 가만히 서 있음
    front: `A cute MapleStory-style event NPC object: a retro Korean arcade "rock-paper-scissors" coin game machine, redesigned for a wedding party.
A standing arcade cabinet, chibi and chunky, three-quarter front view facing LEFT, full object visible.
Pastel pink and cream cabinet with gold trim, a glowing marquee on top ringed with little round light bulbs and a small heart,
a round display window in the middle showing a big cartoon hand sign, three big shiny round push buttons in a row (pink, mint, butter yellow)
each with a simple hand icon (fist, V-sign, open palm), a small coin slot and a prize tray at the bottom with a tiny coffee cup icon,
a pink satin ribbon bow and a few roses on the side. Sparkles around the lights. No readable text or letters anywhere.`,
    motions: {},
  },
};
for (const [id, cat] of Object.entries(NPCS)) {
  if (!cat.look) continue;
  cat.front = (cat.origin ? 'Turn the real cat in this photo into a MapleStory-style NPC. Ignore the photo background and pose. ' : '') + catBase(cat.look);
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
  callOpenAI('generations', (model) => JSON.stringify({ model, prompt, size, quality: QUALITY, output_format: 'webp', output_compression: 92, background: 'transparent' }));

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
    form.append('background', 'transparent'); // 흰 털 캐릭터가 배경 제거 때 뚫리지 않게 투명 배경으로
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
      const size = id === 'wedding-car' ? '1536x1024' : '1024x1024';
      try {
        const prompt = `${npc.front}\n${id === 'wedding-car' ? '' : STYLE}`;
        const origin = `img/npc/${id}/origin.jpg`;
        const buf =
          npc.origin && existsSync(origin)
            ? // 실제 사진 기반: EXIF 회전 반영 + 1024px로 줄여 참고 이미지로
              await edit(prompt, size, await sharp(origin).rotate().resize(1024, 1024, { fit: 'inside' }).webp().toBuffer())
            : await generate(prompt, size);
        await save(id, 'front', buf);
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
