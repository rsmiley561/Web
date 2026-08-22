/**
 * Builds a single self-contained HTML file for one direction — every image,
 * video and script embedded — so it can be published as an Artifact or emailed
 * as one file with no server.
 *
 *   node tools/inline.mjs a
 *   node tools/inline.mjs b
 *
 * Output: dist/<dir>.html (page content only — no <html>/<head>/<body>
 * wrapper, which the Artifact runtime supplies).
 *
 * This is a PREVIEW build, not the deployable site. It deliberately trades
 * quality for bytes: gallery tiles use the small crop, videos use short
 * low-bitrate encodes, and webfonts load from Google rather than being
 * embedded. Deploy the real folders.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const dir = process.argv[2];
if (!['a', 'b'].includes(dir)) {
  console.error('usage: node tools/inline.mjs <a|b>');
  process.exit(1);
}

const TINY = '/tmp/claude-0/-home-user-Web/d530be8a-d911-5b8a-b5d9-85d6d62a8c5c/scratchpad/tiny';
const MIME = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4', '.svg': 'image/svg+xml' };

let embedded = 0;
async function dataUri(file) {
  const buf = await readFile(file);
  embedded += buf.length;
  return `data:${MIME[path.extname(file)] || 'application/octet-stream'};base64,${buf.toString('base64')}`;
}

/* ------------------------------- sources -------------------------------- */
let html = await readFile(path.join(ROOT, dir, 'index.html'), 'utf8');
const css = await readFile(path.join(ROOT, dir, 'style.css'), 'utf8');
const gallery = JSON.parse(await readFile(path.join(ROOT, 'data/gallery.json'), 'utf8'));

const jsFiles = ['assets/site-data.js', 'assets/app-core.js', 'assets/gallery-data.js', `${dir}/app.js`];
let js = '';
for (const f of jsFiles) js += `\n/* ---- ${f} ---- */\n` + (await readFile(path.join(ROOT, f), 'utf8'));

// Preview-only: srcset would embed each tile twice (small AND large). Drop it
// and let the single small crop carry the grid.
js = js
  .replace(/\n\s*srcset="[^"]*"/g, '')
  .replace(/\n\s*sizes="[^"]*"/g, '');

/* ------------------------------ asset map -------------------------------- */
// Keys are exactly the paths the runtime asks Core.asset() for.
const assets = {};

for (const g of gallery) {
  // Tiles render from the small crop in the preview build.
  const small = path.join(ROOT, 'assets/img', `${g.id}-ps.webp`);
  assets[`../assets/img/${g.id}-p.webp`] = await dataUri(small);
  assets[`../assets/img/${g.id}-ps.webp`] = assets[`../assets/img/${g.id}-p.webp`];
}
// Service cards use the square crop.
for (const id of ['tuna-tower', 'chef-live', 'flatbread']) {
  assets[`../assets/img/${id}-sq.webp`] = await dataUri(path.join(ROOT, 'assets/img', `${id}-sq.webp`));
}
// Motion reel: short low-bitrate clips + their posters.
for (const slug of ['tartare', 'brisket', 'carrots', 'tower']) {
  const tiny = path.join(TINY, `${slug}.mp4`);
  if (existsSync(tiny)) {
    assets[`../assets/video/${slug}-720.mp4`] = await dataUri(tiny);
    assets[`../assets/video/${slug}-hero.mp4`] = assets[`../assets/video/${slug}-720.mp4`];
  }
  assets[`../assets/video/${slug}-poster.jpg`] = await dataUri(path.join(ROOT, 'assets/video', `${slug}-poster.jpg`));
}

/* ------------------- rewrite the static markup paths --------------------- */
// Anything hard-coded in the HTML (hero poster, split image, portrait).
const statics = [...html.matchAll(/\.\.\/assets\/(?:img|video)\/[A-Za-z0-9._-]+/g)]
  .map((m) => m[0])
  .filter((v, i, a) => a.indexOf(v) === i);

for (const ref of statics) {
  let file = path.join(ROOT, ref.replace('../', ''));
  // Prefer the small crop / tiny clip for anything large.
  const alt = file.replace(/-p\.webp$/, '-ps.webp').replace(/-w\.webp$/, '-ws.webp');
  if (alt !== file && existsSync(alt)) file = alt;
  const tinyAlt = path.join(TINY, path.basename(file).replace(/-hero\.mp4$/, '.mp4'));
  if (file.endsWith('-hero.mp4') && existsSync(tinyAlt)) file = tinyAlt;
  if (!existsSync(file)) { console.warn('  skip (missing):', ref); continue; }
  html = html.replaceAll(ref, await dataUri(file));
}

/* ------------------------------- assemble -------------------------------- */
// The two previews sit side by side in a gallery, so each carries its
// direction name rather than the shared production title.
const title = dir === 'a' ? 'Chef Smiley — Ember' : 'Chef Smiley — Meridian';
const body = html.slice(html.indexOf('<body>') + 6, html.lastIndexOf('</body>'))
  // Drop the external <script src> tags; the bundle replaces them.
  .replace(/\n?\s*<script src="[^"]*"><\/script>/g, '');

// Webfonts come from Google here rather than being embedded — it is the one
// external host artifacts allow, and it saves ~1 MB of base64.
const fontLink =
  dir === 'a'
    ? 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&family=Inter:wght@300..600&display=swap'
    : 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300..600;1,300..500&family=Inter:wght@300..600&display=swap';

const out = `<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${fontLink}">
<style>
${css}
</style>
<script>document.documentElement.classList.add('js')</script>
${body}
<script>window.__ASSETS = ${JSON.stringify(assets)};</script>
<script>
${js}
</script>
`;

await mkdir(path.join(ROOT, 'dist'), { recursive: true });
const dest = path.join(ROOT, 'dist', `${dir}.html`);
await writeFile(dest, out);
const size = (await stat(dest)).size;
console.log(
  `dist/${dir}.html — ${(size / 1e6).toFixed(2)} MB ` +
    `(${(embedded / 1e6).toFixed(2)} MB of media embedded)`
);
if (size > 16e6) {
  console.error('OVER the 16 MB artifact limit');
  process.exitCode = 1;
}
