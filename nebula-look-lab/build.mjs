// Packages the v4 front end plus recorded API responses into a static folder.
// No renderer, shader, motion or CSS file is modified; index.html gains exactly
// one <script> tag so the API shim installs before the app module evaluates.
import {cp, mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';

const CAND = '/home/user/dl/extracted/Smiley-Deep-Nebula-Claude-Code-Handoff-v1/WORKING-COPY/Smiley-Deep-Nebula-Culinary-Cosmos-Candidate-v4';
const SRC = path.join(CAND, 'SOURCE-DIFF');
const HOST = path.join(CAND, 'DEPENDENCIES', 'host');
const REC = '/home/user/lab/recorded';
const OUT = '/home/user/lab/static';

await rm(OUT, {recursive: true, force: true});
await mkdir(OUT, {recursive: true});

// --- front-end modules, styles and assets (verbatim) -------------------------
const FRONT = ['style.css', 'deep-cosmos.css', 'living-atoms.css', 'slice-app.js', 'host-client.js',
  'slice-contract.js', 'deep-field.js', 'condensations.js', 'dynamics.js', 'field.js',
  'ingredient-atoms.js', 'nebula-field.js', 'nebula-material.js'];
for (const f of FRONT) await cp(path.join(SRC, f), path.join(OUT, f));
await cp(path.join(SRC, 'assets'), path.join(OUT, 'assets'), {recursive: true});

// vendored Three.js — only the build the importmap actually resolves
await mkdir(path.join(OUT, 'vendor/three/build'), {recursive: true});
for (const f of ['three.module.js', 'three.core.js']) {
  await cp(path.join(SRC, 'vendor/three/build', f), path.join(OUT, 'vendor/three/build', f));
}
await cp(path.join(SRC, 'vendor/three/LICENSE'), path.join(OUT, 'vendor/three/LICENSE'));

// --- work surface ------------------------------------------------------------
// index.html uses relative ../reference/ui/..., data.js uses absolute /reference/data.
await cp(path.join(HOST, 'app'), path.join(OUT, 'host/app'), {recursive: true});
await cp(path.join(HOST, 'reference/ui'), path.join(OUT, 'host/reference/ui'), {recursive: true});
await cp(path.join(HOST, 'reference/data'), path.join(OUT, 'reference/data'), {recursive: true});
await cp(path.join(HOST, 'source-methods.json'), path.join(OUT, 'source-methods.json'));

// --- recorded API ------------------------------------------------------------
await cp(path.join(REC, 'responses'), path.join(OUT, 'api/responses'), {recursive: true});
await cp(path.join(REC, 'index.json'), path.join(OUT, 'api/index.json'));

// An honest "not in this capture" envelope, built from a REAL recorded response so
// the pins/producer blocks are the live server's own, never fabricated.
const idx = JSON.parse(await readFile(path.join(REC, 'index.json'), 'utf8'));
const unmappedKey = Object.keys(idx).find(k => k.includes('b=chocolate'));
const real = JSON.parse(await readFile(path.join(REC, 'responses', idx[unmappedKey].file), 'utf8'));
await writeFile(path.join(OUT, 'api/not-recorded.json'), JSON.stringify({
  schema: real.schema, operation: null, accepted: false,
  code: 'NOT_RECORDED_IN_STATIC_CAPTURE',
  detail: 'This look lab answers only from responses recorded from the real v4 server. This query was not recorded, so no value is asserted.',
  request_id: null, generation: 0,
  pins: real.pins, producer: real.producer, payload: null,
  transport: {schema: real.transport.schema, client_request_id: null, requested_client_generation: 0, allocated_producer_generation: 0, cancelled: false},
}, null, 1));

// --- index.html: the app's own file plus one shim script tag ------------------
let html = await readFile(path.join(SRC, 'index.html'), 'utf8');
const marker = '<script type="module" src="slice-app.js">';
if (!html.includes(marker)) throw new Error('index.html shape changed; refusing to patch blindly');
html = html.replace(marker, '<script src="api-shim.js"></script>' + marker);
await writeFile(path.join(OUT, 'index.html'), html);

await cp('/home/user/lab/api-shim.js', path.join(OUT, 'api-shim.js'));
await cp('/home/user/lab/README-LOOK-LAB.md', path.join(OUT, 'README-LOOK-LAB.md'));
console.log('built', OUT);
