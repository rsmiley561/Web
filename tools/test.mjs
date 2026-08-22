/**
 * Interaction checks for both directions: the multi-step form, the gallery
 * filters, and the lightbox. Catches the class of bug a screenshot cannot.
 *
 *   node tools/test.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404); return res.end('404');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  res.end(await readFile(f));
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
});

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

for (const dir of ['a', 'b']) {
  console.log(`\n/${dir}/`);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/${dir}/`, { waitUntil: 'networkidle' });

  // --- content rendered from the shared data layer ---
  check('plans rendered', (await page.locator('.plan').count()) === 3);
  check('steps rendered', (await page.locator('.step-card').count()) === 4);
  check('gallery rendered', (await page.locator('.tile').count()) === 32);
  check('services rendered', (await page.locator('.svc').count()) === 3);
  check('faqs rendered', (await page.locator('.faq details').count()) === 8);
  check('cv rendered', (await page.locator('.cv li').count()) === 4);

  // --- form starts on step 1 with only the right controls visible ---
  await page.locator('#start').scrollIntoViewIfNeeded();
  check('step 1 visible', await page.locator('.step[data-step="1"]').isVisible());
  check('step 2 hidden', !(await page.locator('.step[data-step="2"]').isVisible()));
  check('Back hidden on step 1', !(await page.locator('#back').isVisible()));
  check('Send hidden on step 1', !(await page.locator('#send').isVisible()));
  check('Continue visible', await page.locator('#next').isVisible());

  // --- validation blocks an empty required step ---
  await page.locator('#next').click();
  check('blocks empty required radio', await page.locator('#formErr').isVisible());

  // --- advancing through all four steps ---
  await page.locator('input[name="service"][value="Weekly meal prep"]').check();
  await page.locator('#next').click();
  check('advanced to step 2', await page.locator('.step[data-step="2"]').isVisible());
  await page.locator('#next').click();
  await page.locator('#next').click();
  check('reached step 4', await page.locator('.step[data-step="4"]').isVisible());
  check('Send visible on step 4', await page.locator('#send').isVisible());
  check('Continue hidden on step 4', !(await page.locator('#next').isVisible()));
  check('Back visible on step 4', await page.locator('#back').isVisible());
  check('progress bar full', (await page.locator('#formBar').evaluate((el) => el.style.width)) === '100%');

  // --- invalid email is caught ---
  await page.locator('#name').fill('Test Person');
  await page.locator('#email').fill('not-an-email');
  await page.locator('#send').click();
  check('rejects bad email', await page.locator('#formErr').isVisible());

  // --- gallery filter ---
  await page.locator('.chip[data-cat="prep"]').click();
  const visibleTiles = await page.locator('.tile:not(.is-hidden)').count();
  const prepTiles = await page.locator('.tile[data-cat="prep"]').count();
  check('filter narrows the grid', visibleTiles === prepTiles && prepTiles > 0,
    `showing ${visibleTiles}, expected ${prepTiles}`);
  await page.locator('.chip[data-cat="all"]').click();
  check('filter resets', (await page.locator('.tile:not(.is-hidden)').count()) === 32);

  // --- lightbox ---
  check('lightbox starts closed', !(await page.locator('#lb').isVisible()));
  await page.locator('.tile').first().click();
  check('lightbox opens', await page.locator('#lb').isVisible());
  const first = await page.locator('#lbTitle').textContent();
  await page.locator('#lbNext').click();
  check('lightbox advances', (await page.locator('#lbTitle').textContent()) !== first);
  await page.keyboard.press('Escape');
  check('Escape closes lightbox', !(await page.locator('#lb').isVisible()));

  // --- plan CTA preselects the matching service ---
  await page.locator('.svc__link').nth(2).click();
  check('consulting CTA preselects service',
    await page.locator('input[name="service"][value="Restaurant consulting"]').isChecked());

  check('no page errors', errors.length === 0, errors.join(' | '));
  await page.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} FAILING` : '\nAll checks passed.');
process.exitCode = failures ? 1 : 0;
