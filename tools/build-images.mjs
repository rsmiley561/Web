/**
 * Generates web-optimised derivatives from assets/source.
 *
 * Nearly every source frame is an 864x1536 phone photo shot in a working
 * kitchen, so several have stainless counters, outlets, sheet trays and staff
 * around the edges. sharp's `attention` strategy was not reliable on these —
 * it kept an electrical outlet in the ribeye and a cook's legs in the service
 * line — so images with clutter carry an explicit `focus` window in
 * data/gallery.json ([left, top, width, height] as fractions of the source),
 * which is extracted before the resize. Everything else falls back to
 * `attention`.
 *
 *   node tools/build-images.mjs
 */
import sharp from 'sharp';
import { readFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SRC = path.join(ROOT, 'assets/source');
const OUT = path.join(ROOT, 'assets/img');

const BASE = [
  { s: 'p',  w: 1000, h: 1500, q: 74 }, // portrait card / full-bleed panel
  { s: 'ps', w: 500,  h: 750,  q: 66 }, // portrait, small screens
  { s: 'sq', w: 800,  h: 800,  q: 74 }, // square tile
];
// Only images flagged `wide` get banner crops — a 16:9 cut out of a 9:16
// source throws away most of the frame, so it is opt-in.
const WIDE = [
  { s: 'w',  w: 1920, h: 1080, q: 76 },
  { s: 'ws', w: 960,  h: 540,  q: 68 },
];

async function render(item, v) {
  let img = sharp(path.join(SRC, item.src)).rotate();
  if (item.focus) {
    const { width, height } = await img.metadata();
    const [l, t, w, h] = item.focus;
    img = img.extract({
      left: Math.round(l * width),
      top: Math.round(t * height),
      width: Math.round(w * width),
      height: Math.round(h * height),
    });
  }
  return img
    .resize(v.w, v.h, {
      fit: 'cover',
      position: item.focus ? 'centre' : sharp.strategy.attention,
    })
    .webp({ quality: v.q, effort: 5 })
    .toFile(path.join(OUT, `${item.id}-${v.s}.webp`));
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const manifest = JSON.parse(await readFile(path.join(ROOT, 'data/gallery.json'), 'utf8'));
  const present = new Set(await readdir(SRC));
  const missing = manifest.filter((m) => !present.has(m.src));
  if (missing.length) {
    console.error('Missing sources:', missing.map((m) => m.src).join(', '));
    process.exitCode = 1;
    return;
  }

  let files = 0;
  let bytes = 0;
  for (const item of manifest) {
    for (const v of item.wide ? [...BASE, ...WIDE] : BASE) {
      await render(item, v);
      bytes += (await stat(path.join(OUT, `${item.id}-${v.s}.webp`))).size;
      files++;
    }
    process.stdout.write('.');
  }
  console.log(`\n${manifest.length} images -> ${files} files, ${(bytes / 1e6).toFixed(1)} MB`);
}

main();
