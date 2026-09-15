import {readFile, writeFile} from 'node:fs/promises';
const idx = JSON.parse(await readFile('/home/user/lab/recorded/index.json', 'utf8'));
const byOp = {};
for (const k of Object.keys(idx)) {
  let label;
  if (k.startsWith('/api/recipe/')) label = '/api/recipe/:id';
  else if (k.startsWith('/api/recipes')) label = '/api/recipes';
  else if (k.startsWith('/api/catalog')) label = '/api/catalog';
  else if (k.startsWith('/api/binding')) label = '/api/binding';
  else if (k.startsWith('/api/flavor-generalized')) label = new URLSearchParams(k.split('?')[1]).get('operation');
  else label = k;
  (byOp[label] ||= []).push(k);
}
const counts = Object.fromEntries(Object.entries(byOp).map(([k, v]) => [k, v.length]));
const bytes = Object.values(idx).reduce((a, b) => a + b.bytes, 0);
await writeFile('/home/user/lab/static/api/COVERAGE.json', JSON.stringify({
  recorded_from: 'Deep Nebula x Culinary Cosmos candidate v4, sha256 4b07cb9b6dbbf4aa9d5be393eda236b65e8342a15729f0b15f0b07778b9332b6',
  server: 'node launch.cjs on 127.0.0.1:8836',
  responses: Object.keys(idx).length,
  total_bytes: bytes,
  by_operation: counts,
  unrecorded_behaviour: 'accepted:false, code NOT_RECORDED_IN_STATIC_CAPTURE, payload null. Never zero, never a fabricated relationship, never an unobserved NOT_ESTABLISHED.',
  mutated_on_replay: ['transport.client_request_id', 'transport.requested_client_generation', 'transport.allocated_producer_generation'],
  unmutated: 'payload, pins, producer, generation, request_id and every recipe body are the recorded bytes.',
}, null, 2));
console.log(JSON.stringify(counts, null, 1), '\ntotal bytes', bytes);
