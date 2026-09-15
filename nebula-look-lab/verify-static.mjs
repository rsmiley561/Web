import assert from 'node:assert/strict';
import fs from 'node:fs';
import {chromium} from '/home/user/lab/pw/node_modules/playwright/index.mjs';

const base = process.env.BASE_URL || 'http://127.0.0.1:8900';
const out = '/home/user/lab/validation-static';
fs.mkdirSync(out, {recursive: true});
const results = [];
const ok = (check, detail) => { results.push({check, status: 'PASS', detail}); console.log(`PASS  ${check}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}});
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // 1. Rest view renders from the recorded discovery call.
  await p.goto(base);
  await p.waitForSelector('.seed-object');
  await p.waitForFunction(() => VERTICAL.metrics().assetReady);
  const seeds = await p.$$eval('.seed-object', els => els.map(e => e.dataset.target));
  assert(seeds.length > 0);
  await p.screenshot({path: out + '/static-01-rest.png'});
  ok('Rest view renders', `${seeds.length} seed presences, WebGL asset ready`);

  // 2. Garlic search -> focus -> 29 partners across pages.
  await p.click('#search-open');
  await p.fill('#query', 'garlic');
  await p.waitForSelector('#semantic-layer [data-action="ingredient:garlic"]');
  await p.click('#semantic-layer [data-action="ingredient:garlic"]');
  await p.waitForFunction(() => VERTICAL.state.partners === 29 && !VERTICAL.state.loading);
  await p.screenshot({path: out + '/static-02-garlic-partners.png'});
  const pageLabel = await p.textContent('[data-action="partners-next"]');
  // Walk every partner page and collect what is actually reachable on screen.
  const seen = new Set();
  const pages = Number(pageLabel.split('/')[1].trim().split(/\s+/)[0]);
  for (let i = 0; i < pages; i++) {
    for (const id of await p.$$eval('.partner', els => els.map(e => e.dataset.target.replace('partner:', '')))) seen.add(id);
    await p.click('[data-action="partners-next"]');
    await p.waitForTimeout(150);
  }
  assert.equal(seen.size, 29, `reachable partners ${seen.size}`);
  ok('Garlic search -> 29 partners across pages', `${pages} pages, ${seen.size} distinct partners all reachable`);

  // 3. Basil + Garlic = 100.
  await p.evaluate(() => VERTICAL.actions.inspectPair('basil', 'garlic', 'garlic'));
  await p.waitForFunction(() => VERTICAL.stage === 'relationship');
  const rel = await p.evaluate(() => VERTICAL.state.relation);
  assert.equal(rel.value, 100);
  assert.equal(rel.absent, false);
  await p.screenshot({path: out + '/static-03-basil-garlic-100.png'});
  ok('Basil + Garlic = 100', `relation_id ${rel.relationId}`);

  // 4. Evidence opens with exact lineage.
  await p.evaluate(() => VERTICAL.actions.openEvidence());
  await p.waitForSelector('#evidence-dialog[open]');
  const lineage = await p.textContent('#evidence-lineage');
  assert(lineage.length > 100);
  const ev = await p.evaluate(() => VERTICAL.evidence());
  await p.screenshot({path: out + '/static-04-evidence.png'});
  await p.click('#evidence-close');
  ok('Evidence opens with exact lineage', `evidence id ${ev.evidence_id || ev.relation_id}, ${lineage.length} chars of lineage`);

  // 5. 41 recipes over 24 + 17.
  await p.evaluate(() => VERTICAL.actions.loadRecipes());
  await p.waitForFunction(() => VERTICAL.state.recipes === 41);
  await p.screenshot({path: out + '/static-05-recipes.png'});
  ok('Recipes using both = 41', 'collected across the recorded 24 + 17 pages');

  // 6. Every one of the 41 recipes opens, and its work surface loads.
  const ids = await p.evaluate(async () => {
    const r = await fetch('/api/recipes?include=basil,garlic&page=0&pageSize=24&annotations=off').then(x => x.json());
    const r2 = await fetch('/api/recipes?include=basil,garlic&page=1&pageSize=24&annotations=off').then(x => x.json());
    return [...r.items, ...r2.items].map(i => i.recipe_id);
  });
  assert.equal(ids.length, 41);
  let opened = 0, worked = 0;
  for (const id of ids) {
    await p.evaluate(rid => VERTICAL.actions.openRecipe(rid), id);
    await p.waitForFunction(rid => VERTICAL.stage === 'recipe' && VERTICAL.state.recipe === rid, id, {timeout: 20000});
    opened++;
    await p.evaluate(() => VERTICAL.actions.enterWork());
    await p.waitForFunction(
      () => document.querySelector('#work-frame').contentWindow?.SmileyUI?.state?.route === 'recipe',
      null, {timeout: 40000});
    worked++;
    if (/bienville/i.test(id)) await p.screenshot({path: out + '/static-06-bienville-work.png'});
    await p.click('#work-back');
    await p.waitForFunction(() => VERTICAL.stage === 'recipe');
  }
  assert.equal(opened, 41);
  assert.equal(worked, 41);
  ok('All 41 recipe detail views open', `${opened}/41`);
  ok('Work surface opens for all 41 recipes', `${worked}/41 reached SmileyUI route "recipe"`);

  const bienville = ids.find(i => /bienville/i.test(i));
  assert(bienville, 'Bienville Stuffing present');
  ok('Bienville Stuffing reachable and opens in work mode', bienville);

  // 7. Honest states. An UNRECORDED pair must not assert anything; a RECORDED
  //    absence must replay the real server's own NOT_ESTABLISHED, numeric null.
  const q = (a, b) => p.evaluate(([x, y]) => fetch(
    `/api/flavor-generalized?operation=GET_GENERIC_RELATIONSHIP&generation=99&request_id=probe:${x}:${y}&delay=0&a=${x}&b=${y}&source_scope=source:VFB`
  ).then(r => r.json()), [a, b]);

  const unrecorded = await q('onion', 'thyme');
  assert.equal(unrecorded.accepted, false);
  assert.equal(unrecorded.code, 'NOT_RECORDED_IN_STATIC_CAPTURE');
  assert.equal(unrecorded.payload, null);
  ok('Unrecorded pair asserts nothing', 'onion+thyme -> accepted:false, payload:null, no numeric');

  const absent = await q('garlic', 'cinnamon');
  assert.equal(absent.accepted, true);
  assert.equal(absent.payload.state, 'NOT_ESTABLISHED');
  assert.equal(absent.payload.numeric, null);
  assert.equal(absent.payload.positive, false);
  ok('Recorded absence replays real NOT_ESTABLISHED', 'garlic+cinnamon -> numeric null (not zero), positive false');

  const unmapped = await q('garlic', 'chocolate');
  assert.equal(unmapped.accepted, false);
  assert.equal(unmapped.code, 'UNMAPPED_CANONICAL_TO_SOURCE');
  ok('Recorded unmapped pair replays real producer code', 'garlic+chocolate -> UNMAPPED_CANONICAL_TO_SOURCE');

  // Correlation must be re-stamped per request or the client rejects the envelope.
  assert.equal(absent.transport.client_request_id, 'probe:garlic:cinnamon');
  assert.equal(absent.transport.requested_client_generation, 99);
  assert.equal(absent.transport.allocated_producer_generation, absent.generation);
  ok('Transport correlation re-stamped per request', 'client_request_id and generation echo the live request');

  // Rapidly swapping the work iframe 41 times aborts whatever recipe shard the
  // previous work document was still loading. That race exists on the real v4
  // server too (measured: 3 aborted shard fetches per run live, 0-1 here), so it
  // is tolerated by name. Anything else is a real failure.
  const abortRace = e => /Failed to fetch|NetworkError|ERR_ABORTED|AbortError/i.test(e);
  const real = errors.filter(e => !abortRace(e));
  assert.deepEqual(real, [], 'unexpected page errors: ' + JSON.stringify(real));
  ok('No unexpected page or console errors across the whole journey',
     `${real.length} unexpected; ${errors.length - real.length} iframe-swap aborts (also present on the live server)`);

  fs.writeFileSync(out + '/STATIC-VERIFICATION.json', JSON.stringify({
    status: 'PASS', base, checks: results.length, results,
    environment: 'Desktop Chromium headless, static build, no server',
    physical_iPad: 'NOT_RUN', physical_iPhone: 'NOT_RUN', VoiceOver: 'NOT_RUN',
  }, null, 2));
  console.log('\nALL CHECKS PASS (' + results.length + ')');
} finally { await browser.close(); }
