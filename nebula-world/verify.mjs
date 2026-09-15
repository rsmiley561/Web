import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '/home/user/lab/pw/node_modules/playwright/index.mjs';
const base = process.env.BASE_URL || 'http://127.0.0.1:8910', out = process.env.OUTDIR || '/home/user/world/validation';
fs.mkdirSync(out, {recursive: true});
const proxy = process.env.CCR_SPKI ? {server: process.env.HTTPS_PROXY} : undefined, args = process.env.CCR_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.CCR_SPKI}`] : [];
const browser = await chromium.launch({proxy, args: [...args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
const results = []; const ok = (c, d) => { results.push({check: c, status: 'PASS', detail: d}); console.log(`PASS  ${c}${d ? ' — ' + d : ''}`); };
try {
  const ctx = await browser.newContext({viewport: {width: 1180, height: 820}, hasTouch: true, deviceScaleFactor: 1});
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => { if (/swiftshader|software WebGL|GroupMarkerNotSet/i.test(m.text())) return; if (m.type() === 'error' || m.type() === 'warning' && /shader|three/i.test(m.text())) errors.push(m.type() + ': ' + m.text().slice(0, 300)); });
  await p.goto(base); await p.waitForFunction(() => window.UNIVERSE, null, {timeout: 30000}); await p.evaluate(() => UNIVERSE.ready);
  await p.waitForTimeout(4000);
  const s0 = await p.evaluate(() => UNIVERSE.state), m0 = await p.evaluate(() => UNIVERSE.metrics());
  assert.equal(s0.view, 'rest'); assert(s0.places > 900 && s0.edges > 36000, JSON.stringify(s0));
  await p.screenshot({path: out + '/01-rest.png'});
  const beacons = await p.$$eval('.label[data-role=beacon]', els => els.map(e => e.textContent));
  assert(beacons.length >= 7, 'beacons ' + beacons.length);
  ok('Rest view renders the whole universe', `${s0.places} places, ${s0.edges.toLocaleString()} printed pairings, ${m0.fps} fps at dpr ${m0.dpr}, beacons: ${beacons.slice(0, 6).join(', ')}`);
  assert.deepEqual(errors, [], 'errors on load: ' + JSON.stringify(errors));

  // Basil: travel in
  await p.evaluate(() => UNIVERSE.actions.visit('basil')); await p.waitForTimeout(500); await p.screenshot({path: out + '/02-travel-to-basil.png', timeout: 120000});
  await p.waitForFunction(() => !UNIVERSE.metrics().moving, null, {timeout: 8000}); await p.waitForTimeout(600);
  const s1 = await p.evaluate(() => UNIVERSE.state); assert.equal(s1.focus, 'basil'); assert.equal(s1.view, 'visit');
  const basilPartners = await p.evaluate(() => UNIVERSE.partners('basil').length);
  const labels1 = await p.$$eval('.label', els => els.map(e => e.dataset.role + ':' + e.textContent));
  assert(labels1.some(l => l.startsWith('focus:Basil'))); assert(labels1.filter(l => l.startsWith('partner:')).length >= 3, labels1.join(','));
  await p.screenshot({path: out + '/03-basil-neighborhood.png'});
  ok('Travel to Basil, neighbourhood resolves', `${basilPartners} printed partners, ${labels1.filter(l => l.startsWith('partner:')).length} labelled around you`);

  // Add basil, then travel to garlic and add it: chain of two with a printed connection
  await p.click('#primary'); await p.waitForFunction(() => UNIVERSE.state.chain.length === 1); await p.waitForFunction(() => !UNIVERSE.metrics().moving, null, {timeout: 8000});
  await p.evaluate(() => UNIVERSE.actions.visit('garlic')); await p.waitForFunction(() => !UNIVERSE.metrics().moving, null, {timeout: 8000}); await p.waitForTimeout(500);
  await p.screenshot({path: out + '/04-garlic-with-basil-behind.png'});
  await p.click('#primary'); await p.waitForFunction(() => UNIVERSE.state.chain.length === 2); await p.waitForTimeout(700); await p.screenshot({path: out + '/05-chain-basil-garlic-pulse.png', timeout: 120000});
  await p.waitForFunction(() => !UNIVERSE.metrics().moving, null, {timeout: 8000});
  const bg = await p.evaluate(() => UNIVERSE.linked('basil', 'garlic'));
  assert(bg && bg.ev.length >= 1, 'basil-garlic evidence'); const books = [...new Set(bg.ev.map(v => v[0]))];
  ok('Basil + Garlic chained with printed connection', `${bg.ev.length} printed occurrence(s) across ${books.length} book(s); first: "${bg.ev[0][2]} → ${bg.ev[0][3]}" p.${bg.ev[0][1]}`);

  // Third ingredient: Tomato (owner family), chain preserved
  await p.evaluate(() => UNIVERSE.actions.visit('tomatoes')); await p.waitForFunction(() => !UNIVERSE.metrics().moving, null, {timeout: 8000});
  await p.click('#primary'); await p.waitForFunction(() => UNIVERSE.state.chain.length === 3); await p.waitForFunction(() => !UNIVERSE.metrics().moving, null, {timeout: 8000}); await p.waitForTimeout(800);
  const s3 = await p.evaluate(() => UNIVERSE.state); assert.deepEqual(s3.chain, ['basil', 'garlic', 'tomatoes']); assert.equal(s3.view, 'overview');
  await p.screenshot({path: out + '/06-chain-of-three-overview.png'});
  const chainLabels = await p.$$eval('.label[data-role=chain],.label[data-role=focus]', els => els.map(e => e.textContent).sort());
  assert.deepEqual(chainLabels, ['Basil', 'Garlic', 'Tomato']);
  ok('Chain of three persists in overview', chainLabels.join(' · '));

  // Connections sheet: book wording, no score anywhere
  await p.evaluate(() => UNIVERSE.actions.visit('tomatoes')); await p.waitForFunction(() => !UNIVERSE.metrics().moving, null, {timeout: 8000});
  await p.click('#connections-btn'); await p.waitForSelector('#sheet:not([hidden])'); await p.waitForTimeout(300);
  const sheet = await p.textContent('#sheet');
  assert(/Flavor Bible/.test(sheet)); assert(/p\. \d+/.test(sheet));
  assert(!/affinity|score|\b(25|50|75|100)\b\s*\/|rating/i.test(sheet), 'no score language: ' + sheet.slice(0, 200));
  const tg = await p.evaluate(() => UNIVERSE.linked('tomatoes', 'garlic')), tb = await p.evaluate(() => UNIVERSE.linked('tomatoes', 'basil'));
  await p.screenshot({path: out + '/07-connections-sheet.png'});
  ok('Connections show the books\' own wording, no scores', `tomato–garlic ${tg ? tg.ev.length + ' printed' : 'not printed'}; tomato–basil ${tb ? tb.ev.length + ' printed' : 'not printed (shown honestly as absent)'}`);
  await p.evaluate(() => UNIVERSE.actions.closeSheet());

  // Recipes underneath the chain — QA cross-check says basil+tomatoes+garlic = 20
  await p.click('#recipes-btn'); await p.waitForFunction(() => /of 1,497 recipes/.test(document.querySelector('#sheet')?.textContent || ''), null, {timeout: 20000});
  const rc = await p.evaluate(async () => (await UNIVERSE.matchChain()).items.length);
  assert.equal(rc, 20, 'expected the accepted QA count of 20');
  await p.screenshot({path: out + '/08-recipes-for-chain.png'});
  ok('Recipes containing all three', `${rc} of 1,497 — matches the integration QA receipt (universeMatches.basilTomatoesGarlic = 20)`);

  // Open one in Smiley OS
  const firstId = await p.$eval('#sheet .recipes button', b => b.dataset.id);
  await p.click('#sheet .recipes button'); await p.waitForFunction(() => document.querySelector('#work-frame').contentWindow?.SmileyUI?.state?.route === 'recipe', null, {timeout: 40000}); await p.waitForTimeout(2500);
  const work = await p.evaluate(() => { const d = document.querySelector('#work-frame').contentDocument; return {chars: (d.body.innerText || '').replace(/\s+/g, ' ').length, rows: d.querySelectorAll('li,tr').length, title: document.querySelector('#work-title').textContent}; });
  assert(work.chars > 500 && work.rows > 5);
  await p.screenshot({path: out + '/09-smiley-os.png'});
  ok('Recipe opens in Smiley OS inside the same world', `${work.title} — ${work.chars} chars, ${work.rows} rows (id ${firstId})`);
  await p.click('#work-back'); await p.waitForFunction(() => UNIVERSE.state.recipe === null);
  const s4 = await p.evaluate(() => UNIVERSE.state); assert.deepEqual(s4.chain, ['basil', 'garlic', 'tomatoes']);
  ok('Back returns to the same chain', s4.chain.join(' · '));

  // Undo / remove / hash state
  await p.evaluate(() => UNIVERSE.actions.undo()); await p.waitForFunction(() => UNIVERSE.state.chain.length === 2);
  const hash = await p.evaluate(() => location.hash); assert(/chain=basil,garlic/.test(hash));
  ok('Undo and shareable state', hash);

  // Phone
  await ctx.close();
  const ph = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 1}); const pp = await ph.newPage(); const perr = [];
  pp.on('pageerror', e => perr.push(e.message));
  await pp.goto(base + '#chain=basil,garlic&focus=garlic'); await pp.waitForFunction(() => window.UNIVERSE, null, {timeout: 30000}); await pp.evaluate(() => UNIVERSE.ready);
  await pp.waitForFunction(() => !UNIVERSE.metrics().moving, null, {timeout: 12000}); await pp.waitForTimeout(1500);
  const pm = await pp.evaluate(() => UNIVERSE.metrics()); await pp.screenshot({path: out + '/10-phone.png'});
  assert.deepEqual(perr, []); ok('Phone layout, state restored from URL', `${pm.fps} fps at dpr ${pm.dpr}`); await ph.close();

  const real = errors.filter(e => !/Failed to fetch|ERR_ABORTED|AbortError/i.test(e));
  assert.deepEqual(real, [], 'unexpected: ' + JSON.stringify(real));
  ok('No page or console errors', `${errors.length - real.length} iframe-swap aborts tolerated`);
  fs.writeFileSync(out + '/VERIFICATION.json', JSON.stringify({status: 'PASS', base, results, physical_iPad: 'NOT_RUN', physical_iPhone: 'NOT_RUN'}, null, 2));
  console.log('\nALL CHECKS PASS (' + results.length + ')');
} finally { await browser.close(); }
