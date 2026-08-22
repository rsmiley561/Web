/**
 * Screenshot a direction for review, and surface any console/page errors.
 *   node tools/shoot.mjs a            full-page desktop + mobile
 *   node tools/shoot.mjs a hero       just the first viewport
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const dir = process.argv[2] || 'a';
const mode = process.argv[3] || 'full';
const OUT = path.join(ROOT, '.shots');

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.mp4': 'video/mp4', '.json': 'application/json', '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('nope');
  }
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const buf = await readFile(file);
  const range = req.headers.range;
  if (range) {
    // <video> issues Range requests; without support Chromium aborts the load.
    const [s0, s1] = range.replace('bytes=', '').split('-');
    const start = Number(s0) || 0;
    const end = s1 ? Number(s1) : buf.length - 1;
    res.writeHead(206, {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${buf.length}`,
      'Content-Length': end - start + 1,
    });
    return res.end(buf.subarray(start, end + 1));
  }
  res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': buf.length });
  res.end(buf);
});

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(OUT, { recursive: true });

// The preinstalled browser build differs from the npm package's expected
// revision, so point at it explicitly rather than downloading another one.
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const problems = [];

async function shoot(name, viewport, full) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`[console] ${name}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${name}: ${e.message}`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`[${r.status()}] ${name}: ${r.url().replace(base, '')}`);
  });
  page.on('requestfailed', (r) => {
    // Media loads are routinely aborted when the page/context closes — not a defect.
    const err = r.failure()?.errorText || '';
    if (err === 'net::ERR_ABORTED' && /\.(mp4|webm)$/.test(r.url())) return;
    problems.push(`[failed] ${name}: ${r.url().replace(base, '')} — ${err}`);
  });

  await page.goto(`${base}/${dir}/`, { waitUntil: 'networkidle' });
  // Drive the whole page so lazy images and reveal animations resolve.
  if (full) {
    const stats = await page.evaluate(async () => {
      const step = window.innerHeight * 0.75;
      const h = () => document.documentElement.scrollHeight;
      for (let y = 0; y < h(); y += step) {
        window.scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 120));
      }
      window.scrollTo(0, 0);
      await new Promise((r) => setTimeout(r, 500));
      return {
        height: h(),
        reveals: document.querySelectorAll('.reveal').length,
        revealed: document.querySelectorAll('.reveal.is-in').length,
        lazyPending: [...document.querySelectorAll('img[loading="lazy"]')].filter((i) => !i.complete).length,
      };
    });
    // Force any straggler into its final state so the capture shows the
    // finished page rather than mid-animation.
    await page.evaluate(() => window.Core && window.Core.revealAll());
    await page.waitForTimeout(700);
    console.log(`    scrolled ${stats.height}px · revealed ${stats.revealed}/${stats.reveals} · ${stats.lazyPending} images still loading`);
    if (stats.lazyPending) await page.waitForTimeout(1500);
    await page.waitForTimeout(900);
  } else {
    // Let the staggered hero reveals (up to ~640ms delay) finish.
    await page.waitForTimeout(2200);
  }
  await page.screenshot({ path: path.join(OUT, `${dir}-${name}.png`), fullPage: full });
  console.log(`  ${dir}-${name}.png`);
  await ctx.close();
}

if (mode === 'hero') {
  await shoot('hero', { width: 1440, height: 900 }, false);
} else {
  await shoot('desktop', { width: 1440, height: 900 }, true);
  await shoot('mobile', { width: 390, height: 844 }, true);
}

await browser.close();
server.close();

if (problems.length) {
  console.log('\nPROBLEMS:');
  [...new Set(problems)].forEach((p) => console.log('  ' + p));
  process.exitCode = 1;
} else {
  console.log('\nNo console errors, no failed requests.');
}
