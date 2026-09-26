// img/gallery/ 폴더의 사진 목록을 gallery.json으로 저장한다 (웨딩 갤러리 메뉴에서 사용).
// 사진은 파일 이름 순서로 보인다 → 01.jpg, 02.jpg ... 처럼 이름을 붙이면 순서를 정할 수 있다.
//   node scripts/build-gallery.mjs <출력 경로>

import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const DIR = 'img/gallery';
const outPath = process.argv[2] || 'data/gallery.json';

const files = await readdir(DIR).catch(() => []);
const photos = files
  .filter((f) => /\.(jpe?g|png|webp|gif)$/i.test(f))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((f) => `${DIR}/${encodeURIComponent(f)}`);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ photos }, null, 2));
console.log(`갤러리 사진 ${photos.length}장 → ${outPath}`);
