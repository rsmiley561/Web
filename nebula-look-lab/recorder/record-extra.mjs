// Third pass: the reverse ingredient order a garlic-first journey produces.
import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
const BASE = 'http://127.0.0.1:8836', OUT = '/home/user/lab/recorded';
const VOLATILE = new Set(['generation', 'request_id', 'delay', 'intent']);
const keyFor = (p, sp) => p + (() => {
  const parts = [...sp.entries()].sort((a, b) => a[0].localeCompare(b[0])).filter(([k]) => !VOLATILE.has(k)).map(([k, v]) => k + '=' + v);
  return parts.length ? '?' + parts.join('&') : '';
})();
const index = JSON.parse(await readFile(path.join(OUT, 'index.json'), 'utf8'));
let added = 0;
async function record(pathname, params) {
  const url = new URL(pathname, BASE);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
  const key = keyFor(pathname, url.searchParams);
  if (index[key]) return JSON.parse(await readFile(path.join(OUT, 'responses', index[key].file), 'utf8'));
  const res = await fetch(url, {cache: 'no-store'});
  const text = await res.text();
  const name = createHash('sha256').update(key).digest('hex').slice(0, 24) + '.json';
  await writeFile(path.join(OUT, 'responses', name), text);
  index[key] = {file: name, status: res.status, bytes: Buffer.byteLength(text)};
  added++;
  return JSON.parse(text);
}
// garlic-first ordering of the same pair
const first = await record('/api/recipes', {include: 'garlic,basil', page: 0, pageSize: 24, annotations: 'off'});
console.log('garlic,basil recipes: total', first.total, 'pages', first.pagination.total_pages);
for (let p = 1; p < first.pagination.total_pages; p++) await record('/api/recipes', {include: 'garlic,basil', page: p, pageSize: 24, annotations: 'off'});
await writeFile(path.join(OUT, 'index.json'), JSON.stringify(index, null, 1));
console.log(`added ${added}; index now ${Object.keys(index).length}`);
