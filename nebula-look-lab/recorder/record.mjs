// Records byte-exact /api/ responses from the live v4 server into static JSON files.
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import path from 'node:path';

const BASE = 'http://127.0.0.1:8836';
const OUT = path.resolve(process.argv[2] || '/home/user/lab/recorded');

// Params the client varies per-request; they must not take part in the cache key.
const VOLATILE = new Set(['generation', 'request_id', 'delay', 'intent']);

export function keyFor(pathname, searchParams) {
  const parts = [];
  for (const [k, v] of [...searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!VOLATILE.has(k)) parts.push(k + '=' + v);
  }
  return pathname + (parts.length ? '?' + parts.join('&') : '');
}

const index = new Map();   // key -> {file, bytes, status}
let n = 0;

async function record(pathname, params = {}) {
  const url = new URL(pathname, BASE);
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  const key = keyFor(pathname, url.searchParams);
  if (index.has(key)) return JSON.parse(index.get(key).text);

  const res = await fetch(url, {cache: 'no-store'});
  const text = await res.text();          // byte-exact body, untouched
  const name = createHash('sha256').update(key).digest('hex').slice(0, 24) + '.json';
  await writeFile(path.join(OUT, 'responses', name), text);
  index.set(key, {file: name, status: res.status, bytes: Buffer.byteLength(text), text});
  n++;
  if (n % 25 === 0) process.stderr.write(`  ...${n} responses\n`);
  return JSON.parse(text);
}

const gen = (operation, args) => record('/api/flavor-generalized', {operation, generation: 1, request_id: 'rec:' + (n + 1), delay: 0, ...args});
const SCOPE = 'source:VFB';

async function collectPartners(id) {
  const all = [];
  let cursor = null, total = null, pages = 0;
  for (;;) {
    const r = await gen('LIST_GENERIC_PARTNERS', {canonical_id: id, source_scope: SCOPE, cursor});
    const p = r.payload;
    pages++;
    all.push(...(p.records || []));
    if (Number.isFinite(p.total_count)) total = p.total_count;
    if (!p.has_more) break;
    cursor = p.cursor;
  }
  if (total !== null && all.length !== total) throw new Error(`partner count mismatch for ${id}: ${all.length} vs ${total}`);
  console.log(`partners ${id}: ${all.length} across ${pages} page(s)`);
  return all;
}

await mkdir(path.join(OUT, 'responses'), {recursive: true});
const summary = {};

// --- binding -----------------------------------------------------------------
await record('/api/binding');

// --- canonical searches -------------------------------------------------------
const TERMS = ['garlic', 'basil', 'onion', 'lemon', 'pork', 'tomato', 'butter', 'thyme'];
summary.searches = {};
for (const q of TERMS) {
  const r = await gen('SEARCH_CANONICAL_INGREDIENTS', {query: q});
  summary.searches[q] = r.payload.total_count;
  console.log(`search "${q}": ${r.payload.total_count} records`);
}

// --- rest view (the app's own discovery seed call) ----------------------------
const rest = await gen('SEARCH_CANONICAL_INGREDIENTS', {query: 'a'});
summary.rest_view_total = rest.payload.total_count;
summary.rest_view_vfb = (rest.payload.records || []).filter(r => r.flavor_source_scopes?.includes(SCOPE)).length;
console.log(`rest view (query "a"): ${summary.rest_view_total} records, ${summary.rest_view_vfb} VFB-admitted seeds`);

// --- partner neighborhoods ----------------------------------------------------
const garlicPartners = await collectPartners('garlic');
const basilPartners = await collectPartners('basil');
summary.partners = {garlic: garlicPartners.length, basil: basilPartners.length};

// --- relationships + evidence -------------------------------------------------
// basil+garlic in both orders, plus garlic paired with every one of its partners.
const pairs = [['basil', 'garlic'], ['garlic', 'basil']];
for (const p of garlicPartners) pairs.push(['garlic', p.canonical_ingredient_id]);
// ...and the reverse order the app uses when garlic is reached as basil's partner.
for (const p of basilPartners) if (p.canonical_ingredient_id === 'garlic') pairs.push(['basil', 'garlic']);

let scored = 0, absent = 0, evid = 0;
const seenPair = new Set();
for (const [a, b] of pairs) {
  const sig = a + '|' + b;
  if (seenPair.has(sig)) continue;
  seenPair.add(sig);
  const rel = await gen('GET_GENERIC_RELATIONSHIP', {a, b, source_scope: SCOPE});
  const rec = rel.payload;
  if (rec.state === 'NOT_ESTABLISHED') absent++; else scored++;
  if (rec.evidence_id) { await gen('GET_GENERIC_EVIDENCE', {relation_id: rec.relation_id}); evid++; }
}
summary.relationships = {pairs: seenPair.size, scored, not_established: absent, evidence: evid};
console.log(`relationships: ${seenPair.size} pairs (${scored} scored, ${absent} NOT_ESTABLISHED), ${evid} evidence records`);

// --- recipes using both basil + garlic ----------------------------------------
const ids = ['basil', 'garlic'];
const first = await record('/api/recipes', {include: ids.join(','), page: 0, pageSize: 24, annotations: 'off'});
const items = [...first.items];
for (let page = 1; page < first.pagination.total_pages; page++) {
  const next = await record('/api/recipes', {include: ids.join(','), page, pageSize: 24, annotations: 'off'});
  items.push(...next.items);
}
// The app also re-requests page 0 with the same args on re-entry; already cached by key.
summary.recipes = {total: first.total, pages: first.pagination.total_pages, collected: items.length,
                   page_sizes: [first.items.length, items.length - first.items.length]};
console.log(`recipes basil+garlic: total ${first.total}, ${first.pagination.total_pages} pages, sizes ${summary.recipes.page_sizes.join(' + ')}`);

// --- recipe details -----------------------------------------------------------
let bienville = null;
for (const it of items) {
  const r = await record('/api/recipe/' + encodeURIComponent(it.recipe_id));
  if (/bienville/i.test(r.title || '')) bienville = {recipe_id: r.recipe_id, title: r.title, work_url: r.work_url};
}
summary.recipe_details = items.length;
summary.bienville = bienville;
console.log(`recipe details: ${items.length}`);
console.log('Bienville:', JSON.stringify(bienville));

// --- catalog (host-client exposes it; record the terms in play) ----------------
for (const q of [...TERMS, 'a']) await record('/api/catalog', {q});

// --- write the index ----------------------------------------------------------
const manifest = {};
for (const [key, v] of index) manifest[key] = {file: v.file, status: v.status, bytes: v.bytes};
await writeFile(path.join(OUT, 'index.json'), JSON.stringify(manifest, null, 1));
await writeFile(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(`\nrecorded ${index.size} responses`);
