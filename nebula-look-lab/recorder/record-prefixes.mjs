// Second pass: the search box debounces per keystroke and fires for any query
// of length >= 2, so every prefix of the requested terms must also be recorded.
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const BASE = 'http://127.0.0.1:8836';
const OUT = '/home/user/lab/recorded';
const VOLATILE = new Set(['generation', 'request_id', 'delay', 'intent']);
const keyFor = (p, sp) => p + (() => {
  const parts = [...sp.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([k]) => !VOLATILE.has(k)).map(([k, v]) => k + '=' + v);
  return parts.length ? '?' + parts.join('&') : '';
})();

const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'));
let n = 0, added = 0;

async function record(pathname, params) {
  const url = new URL(pathname, BASE);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const key = keyFor(pathname, url.searchParams);
  if (index[key]) return null;
  const res = await fetch(url, {cache: 'no-store'});
  const text = await res.text();
  const name = createHash('sha256').update(key).digest('hex').slice(0, 24) + '.json';
  await writeFile(path.join(OUT, 'responses', name), text);
  index[key] = {file: name, status: res.status, bytes: Buffer.byteLength(text)};
  added++;
  return JSON.parse(text);
}

const TERMS = ['garlic', 'basil', 'onion', 'lemon', 'pork', 'tomato', 'butter', 'thyme'];
const prefixes = new Set();
for (const t of TERMS) for (let i = 2; i <= t.length; i++) prefixes.add(t.slice(0, i));

for (const q of [...prefixes].sort()) {
  const r = await record('/api/flavor-generalized',
    {operation: 'SEARCH_CANONICAL_INGREDIENTS', generation: 1, request_id: 'pfx:' + (++n), delay: 0, query: q});
  if (r) console.log(`  "${q}" -> ${r.payload?.total_count ?? r.code}`);
  await record('/api/catalog', {q});
}

// Honest-state templates, captured live so the shim never fabricates envelope shape.
const tmplNotEstablished = await record('/api/flavor-generalized',
  {operation: 'GET_GENERIC_RELATIONSHIP', generation: 1, request_id: 'tmpl:ne', delay: 0,
   a: 'garlic', b: 'cinnamon', source_scope: 'source:VFB'});
const tmplUnmapped = await record('/api/flavor-generalized',
  {operation: 'GET_GENERIC_RELATIONSHIP', generation: 1, request_id: 'tmpl:un', delay: 0,
   a: 'garlic', b: 'chocolate', source_scope: 'source:VFB'});
console.log('NOT_ESTABLISHED template:', tmplNotEstablished?.payload?.state, 'numeric=', tmplNotEstablished?.payload?.numeric);
console.log('UNMAPPED template:', tmplUnmapped?.code);

await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
console.log(`\nadded ${added} responses; index now ${Object.keys(index).length}`);
