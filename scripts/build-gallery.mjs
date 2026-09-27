// img/gallery/ 사진으로 웨딩 갤러리용 이미지와 목록(gallery.json)을 만든다. (Actions 배포 때 실행)
// 하위 폴더 = 앨범 (img/gallery/studio/*.jpg → album "studio"). 앨범 NPC(map-data npcs[id].album)를 누르면 그 앨범만 보인다.
// 사진은 앨범 → 파일 이름 순서로 보인다 → 01.jpg, 02.jpg ... 처럼 이름을 붙이면 순서를 정할 수 있다.
//   node scripts/build-gallery.mjs <사이트 폴더>   (예: _site)
//
// 원본(장당 수 MB)은 폰에서 너무 무거워서 사이트에는 올리지 않고, sharp로 줄인 두 가지만 올린다.
//   <사이트>/img/gallery/thumb/<앨범>/<이름>.webp  목록용 썸네일 (긴 변 400px)
//   <사이트>/img/gallery/view/<앨범>/<이름>.webp   크게 보기용 (긴 변 1600px)
// gallery.json: { photos: [{ thumb, src, album }] } (album = 하위 폴더 이름, 바로 아래 사진은 '')
// 변환 결과는 .cache/gallery 에 두고(Actions cache), 같은 파일(이름+크기)이면 다시 변환하지 않는다.
// sharp가 없으면(로컬 등) 원본 경로를 그대로 쓴다.

import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, parse } from 'node:path';

const SRC = 'img/gallery';
const CACHE = '.cache/gallery';
const SIZES = { thumb: { size: 400, quality: 72 }, view: { size: 1600, quality: 82 } };
const site = process.argv[2] || '_site';

const sharp = await import('sharp').then((m) => m.default).catch(() => null);
if (!sharp) console.warn('sharp 없음 → 원본 이미지를 그대로 사용');

const isPhoto = (f) => /\.(jpe?g|png|webp|gif)$/i.test(f);
const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });

// [{ album, file }] — 바로 아래 사진(album '')과 하위 폴더(앨범) 사진
const entries = await readdir(SRC, { withFileTypes: true }).catch(() => []);
const items = [];
for (const e of entries.filter((e) => e.isFile() && isPhoto(e.name)).sort((a, b) => byName(a.name, b.name))) items.push({ album: '', file: e.name });
for (const dir of entries.filter((e) => e.isDirectory() && !Object.keys(SIZES).includes(e.name)).sort((a, b) => byName(a.name, b.name))) {
  const files = (await readdir(join(SRC, dir.name))).filter(isPhoto).sort(byName);
  for (const file of files) items.push({ album: dir.name, file });
}

const url = (...parts) => [SRC, ...parts.filter(Boolean).map(encodeURIComponent)].join('/');
const photos = [];
for (const { album, file } of items) {
  if (!sharp) {
    photos.push({ thumb: url(album, file), src: url(album, file), album });
    continue;
  }
  await rm(join(site, SRC, album, file), { force: true }); // 사이트에 복사된 원본은 지운다
  const { size } = await stat(join(SRC, album, file));
  const base = parse(file).name;
  const entry = { album };
  for (const [kind, { size: px, quality }] of Object.entries(SIZES)) {
    const cached = join(CACHE, kind, album, `${base}-${size}.webp`);
    if (!existsSync(cached)) {
      await mkdir(join(CACHE, kind, album), { recursive: true });
      await sharp(join(SRC, album, file))
        .rotate() // EXIF 회전 반영
        .resize(px, px, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(cached);
    }
    await mkdir(join(site, SRC, kind, album), { recursive: true });
    await copyFile(cached, join(site, SRC, kind, album, `${base}.webp`));
    entry[kind === 'view' ? 'src' : 'thumb'] = url(kind, album, `${base}.webp`);
  }
  photos.push(entry);
}

await mkdir(join(site, 'data'), { recursive: true });
await writeFile(join(site, 'data', 'gallery.json'), JSON.stringify({ photos }, null, 2));
console.log(`갤러리 사진 ${photos.length}장 → ${site}/data/gallery.json`);
