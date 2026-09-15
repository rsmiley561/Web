// Builds the world's data files from the FB+VFB browsing graph.
// Every edge is a printed recommendation from one of the two books. No score
// of any kind is computed or emitted. Positions and colours are navigation.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {familyFor, FAMILIES} from './families.mjs';

const SLICE = '/home/user/fb/Smiley-Flavor-Brain-FB-VFB-Claude-Handoff/04-CURRENT-APP-FLAVOR-SLICE/src/data';
const OUT = '/home/user/world/static/data';
await mkdir(OUT, {recursive: true});

const graph = JSON.parse(await readFile(`${SLICE}/pairing-graph.json`, 'utf8'));
const entries = JSON.parse(await readFile(`${SLICE}/source-entries.json`, 'utf8'));
const catalog = JSON.parse(await readFile(`${SLICE}/recipe-catalog.json`, 'utf8'));
if (catalog.recipeCount !== 1497 || catalog.recipes.length !== 1497) throw new Error('INCOMPLETE_RECIPE_CATALOG');

// --- owner rule: every tomato form folds onto one Tomato parent -------------
const isTomatoForm = s => /(?:^|[^a-z])(?:tomatoes|tomato|pomodoro|pomodori)(?:$|[^a-z])/i.test(s || '');
const raw = new Map(graph.nodes.map(n => [n.id, n]));
const parentOf = id => { const n = raw.get(id); return (n && (isTomatoForm(n.label) || isTomatoForm(n.id))) ? 'tomatoes' : id; };
const tomatoMembers = graph.nodes.filter(n => parentOf(n.id) === 'tomatoes' && n.id !== 'tomatoes');

// Display labels: the book's own head title, minus its cross-references. A list head
// such as "COCONUT, COCONUT CREAM, And COCONUT MILK" keeps its first item; the full
// printed title stays on every evidence row.
const labelOf = raw => {
  let s = (raw || '').replace(/\s*\((?:see also|aka|a\.k\.a\.|see|also)[^)]*\)/gi, '').replace(/\s*\([^)]*\)/g, '').replace(/[—–]\s*in general/i, '').trim();
  if (/,\s.*\b(?:and|or)\b/i.test(s) && !/^[\w\s-]+,\s[\w\s-]+$/.test(s)) s = s.split(',')[0].trim();
  // "PEPPER, BLACK" / "MILK, COCONUT" / "PALM, HEARTS OF" are index order; read them as spoken.
  const inv = s.match(/^([\w\s'-]{2,24}),\s([\w\s'-]{2,24})$/);
  if (inv && !/^(e\.g\.|esp\.|etc|or |and )/i.test(inv[2]) && inv[1].split(' ').length <= 3 && inv[2].split(' ').length <= 3) s = inv[2] + ' ' + inv[1];
  s = s.toLowerCase().replace(/(^|[\s\-/])\S/g, c => c.toUpperCase()).replace(/\bAnd\b/g, 'and').replace(/\bOr\b/g, 'or').replace(/\bOf\b/g, 'of');
  return s;
};
// Printed qualifiers ("e.g., apple juice", "esp. roasted") stay with the term, as a sub-label.
const splitQualifier = raw => { const m = (raw || '').match(/^(.*?)(?:,\s*|\s*:\s*)((?:e\.g\.|esp\.|i\.e\.|such as|especially|preferably).*)$/i); return m ? [m[1], m[2].trim()] : [raw, null]; };
const eligible = n => n.kind !== 'prose-heading' && n.browseEligible !== false && parentOf(n.id) === n.id;
// FB in particular gives cuisines, dish types, seasons and taste concepts their own
// entries. They are printed contexts, not ingredients, so they are listed but not
// given a cloud of their own.
const CONCEPT = /CUISINE|DISHES?$|^(APPETIZERS?|BREAKFAST|BRUNCH|DESSERTS?|SALADS?|SOUPS?|STEWS?|SNACKS?|LUNCH|DINNER|AUTUMN|WINTER|SPRING|SUMMER|CHRISTMAS|THANKSGIVING|EASTER|PASSOVER|BALANCE|BITTERNESS|SWEETNESS|SOURNESS|SALTINESS|ASTRINGENCY|PIQUANCY|UMAMI|AROMA|TASTE|MOUTHFEEL|TEXTURE|TEMPERATURE|WEIGHT|VOLUME|SEASONS?|FLAVOR|THE X FACTOR|FUNCTION|SEASONING|COOKING|TECHNIQUES?|BRAISED|BRINED|FRIED|GRILLED|ROASTED|SAUTÉED|SAUTEED|STEAMED|STIR-FRIED|RAW|BAKED|POACHED|PICKLED|SMOKED|CANDIED|CONFIT|MARINATED|SPICY|GRILLING|SMOKING|DEHYDRATING|PRESSURE-COOKING|SOUS-VIDE|SLOW-COOKED|PUREE|MENU|VITAMIX|WHOLE FOODS|ORGANIC|GLUTEN-FREE|FRESHNESS|SMOKINESS|PREPARED|OIL SUBSTITUTES|IN GENERAL|FROZEN|TRAIL MIX|VEGGIE BURGERS|SMOOTHIES|JUICES|STOCK|STUFFING|SPICES|MEATS|LEGUMES|NUTS$|SEEDS$|FRUIT, DRIED|FRUIT, FRESH|FLOWERS|SEA VEGETABLES|OILS?, VEGETABLE|SWEET DISHES|SAVORY DISHES|HOLIDAYS?|PARTY|PICNIC|BARBECUE|BBQ|CASSEROLES?|SANDWICHES?|PIZZAS?|PASTAS?|BURGERS?|TACOS?|SAUCES?|CONDIMENTS?|BEVERAGES?|DRINKS?|COCKTAILS?)\b/i;
const isConcept = n => (n.sourceHeads || []).some(h => CONCEPT.test(h.rawTitle || '')) || /cuisine|dishes?$/i.test(n.label || '');

// --- nodes -------------------------------------------------------------------
const nodes = [];
const index = new Map();
for (const n of graph.nodes) {
  if (!eligible(n)) continue;
  const heads = n.id === 'tomatoes'
    ? [...(n.sourceHeads || []), ...tomatoMembers.flatMap(m => m.sourceHeads || [])]
    : (n.sourceHeads || []);
  const books = [...new Set(heads.filter(h => h.browseEligible).map(h => h.source === 'Flavor Bible' ? 'FB' : 'VFB'))].sort();
  const [core, q] = splitQualifier(n.label);
  const label = n.id === 'tomatoes' ? 'Tomato' : labelOf(core);
  index.set(n.id, nodes.length);
  nodes.push({
    id: n.id, label, q: q || undefined, family: familyFor(label),
    kind: n.kind, canonical: n.canonicalIds || [],
    concept: isConcept(n) || undefined,
    books, place: heads.length > 0 && !isConcept(n),   // own book entry, and an ingredient rather than a context
    heads: heads.map(h => ({s: h.source === 'Flavor Bible' ? 0 : 1, p: h.page, t: h.rawTitle, e: h.entryId})),
    members: n.id === 'tomatoes' ? tomatoMembers.map(m => labelOf(m.label)) : undefined,
    deg: 0,
  });
}

// --- edges: fold onto parents, keep every printed occurrence ---------------
const evidence = [];   // flat: [src(0 FB/1 VFB), page, head, targetRaw, fromIdx, toIdx, star, entryId]
const edgeMap = new Map();
for (const e of graph.edges) {
  const a = parentOf(e.a), b = parentOf(e.b);
  if (a === b || !index.has(a) || !index.has(b)) continue;
  const key = a < b ? a + '|' + b : b + '|' + a;
  let rec = edgeMap.get(key);
  if (!rec) { rec = {a: index.get(a < b ? a : b), b: index.get(a < b ? b : a), ev: []}; edgeMap.set(key, rec); }
  for (const v of e.evidence) {
    rec.ev.push(evidence.length);
    const from = index.get(parentOf(v.fromNode)), to = index.get(parentOf(v.toNode));
    evidence.push([v.source === 'Flavor Bible' ? 0 : 1, v.page, v.head, v.targetRaw, from, to, v.authorTopTierAsterisk ? 1 : 0, v.entryId,
                   (parentOf(v.fromNode) !== v.fromNode || parentOf(v.toNode) !== v.toNode) ? 1 : 0]);
  }
}
const edges = [...edgeMap.values()].map(r => { nodes[r.a].deg++; nodes[r.b].deg++; return [r.a, r.b, r.ev]; });

// --- stats that decide the world's shape ------------------------------------
const places = nodes.filter(n => n.place);
const stat = id => {
  const i = index.get(id); const partners = edges.filter(e => e[0] === i || e[1] === i).map(e => nodes[e[0] === i ? e[1] : e[0]]);
  return `${id}: ${partners.length} partners, ${partners.filter(p => p.place).length} are places`;
};
console.log(`nodes ${nodes.length} (places ${places.length}), edges ${edges.length}, evidence ${evidence.length}`);
console.log(stat('garlic')); console.log(stat('basil')); console.log(stat('tomatoes')); console.log(stat('book:carrots'));
const fam = {}; for (const n of places) fam[n.family] = (fam[n.family] || 0) + 1; console.log('family distribution (places):', fam);
console.log('concept heads (listed, no cloud):', nodes.filter(n => n.concept).length);
console.log('unclassified place sample:', places.filter(n => n.family === 'mist').slice(0, 60).map(n => n.label).join(' · '));

// --- 3D layout over places only -----------------------------------------------
// Attraction along printed edges (normalised by degree so hubs do not collapse the
// world), repulsion between all places, a weak pull toward a family direction so
// colour regions read at a distance, and a centre gravity. Layout only.
const P = places.length, pi = new Map(places.map((n, k) => [n.id, k]));
const famDir = {}; const famKeys = Object.keys(FAMILIES).filter(k => k !== 'mist');
famKeys.forEach((k, i) => { const phi = Math.acos(1 - 2 * (i + .5) / famKeys.length), th = Math.PI * (1 + Math.sqrt(5)) * i; famDir[k] = [Math.cos(th) * Math.sin(phi), Math.sin(th) * Math.sin(phi), Math.cos(phi)]; });
famDir.mist = [0, 0, 0];
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pos = new Float64Array(P * 3), vel = new Float64Array(P * 3);
places.forEach((n, k) => { const d = famDir[n.family]; for (let c = 0; c < 3; c++) pos[k * 3 + c] = d[c] * 0.6 + (rnd() - .5) * 0.8; });
const pe = []; for (const [a, b] of edges) { const ka = pi.get(nodes[a].id), kb = pi.get(nodes[b].id); if (ka != null && kb != null) pe.push([ka, kb, 1 / Math.sqrt(Math.max(1, nodes[a].deg) * Math.max(1, nodes[b].deg))]); }
const ITER = 320;
for (let it = 0; it < ITER; it++) {
  const t = 1 - it / ITER, step = 0.02 + 0.08 * t;
  vel.fill(0);
  for (let i = 0; i < P; i++) for (let j = i + 1; j < P; j++) {
    const dx = pos[i*3]-pos[j*3], dy = pos[i*3+1]-pos[j*3+1], dz = pos[i*3+2]-pos[j*3+2];
    const d2 = dx*dx+dy*dy+dz*dz + 0.002, f = 0.00045 / d2;
    vel[i*3]+=dx*f; vel[i*3+1]+=dy*f; vel[i*3+2]+=dz*f; vel[j*3]-=dx*f; vel[j*3+1]-=dy*f; vel[j*3+2]-=dz*f;
  }
  for (const [a, b, w] of pe) {
    const dx = pos[b*3]-pos[a*3], dy = pos[b*3+1]-pos[a*3+1], dz = pos[b*3+2]-pos[a*3+2], f = w * 2.2;
    vel[a*3]+=dx*f; vel[a*3+1]+=dy*f; vel[a*3+2]+=dz*f; vel[b*3]-=dx*f; vel[b*3+1]-=dy*f; vel[b*3+2]-=dz*f;
  }
  for (let i = 0; i < P; i++) {
    const d = famDir[places[i].family];
    for (let c = 0; c < 3; c++) { vel[i*3+c] += (d[c] * 0.9 - pos[i*3+c]) * 0.05 * (places[i].family === 'mist' ? 0.3 : 1); vel[i*3+c] -= pos[i*3+c] * 0.02; }
    const vl = Math.hypot(vel[i*3], vel[i*3+1], vel[i*3+2]) || 1, cap = Math.min(1, 0.06 / vl) * step;
    for (let c = 0; c < 3; c++) pos[i*3+c] += vel[i*3+c] * cap * 12;
  }
}
// normalise to a world radius
let maxR = 0; for (let i = 0; i < P; i++) maxR = Math.max(maxR, Math.hypot(pos[i*3], pos[i*3+1], pos[i*3+2]));
const R = 900 / maxR;
places.forEach((n, k) => { n.p = [pos[k*3]*R, pos[k*3+1]*R, pos[k*3+2]*R].map(v => Math.round(v * 10) / 10); });
// nearest-neighbour spacing report
let minD = Infinity, sumD = 0; for (let i = 0; i < P; i++) { let best = Infinity; for (let j = 0; j < P; j++) if (i !== j) { const d = Math.hypot(pos[i*3]-pos[j*3], pos[i*3+1]-pos[j*3+1], pos[i*3+2]-pos[j*3+2]) * R; if (d < best) best = d; } minD = Math.min(minD, best); sumD += best; }
console.log(`layout: radius 900, nearest-neighbour min ${minD.toFixed(1)} mean ${(sumD/P).toFixed(1)}`);

// --- entries (season / techniques) for the evidence panel -------------------
const entryMeta = {};
for (const e of entries.entries) if (e.season || (e.techniques && e.techniques.length)) entryMeta[e.id] = {season: e.season, techniques: e.techniques};

// --- write -----------------------------------------------------------------
await writeFile(`${OUT}/nodes.json`, JSON.stringify({
  schema: 'smiley.culinary-world.nodes.v1',
  sources: ['Flavor Bible', 'Vegetarian Flavor Bible'],
  families: FAMILIES,
  note: 'Every filament is a printed recommendation. Colour and position are navigation, not evidence. No score exists.',
  nodes,
}));
await writeFile(`${OUT}/edges.json`, JSON.stringify({schema: 'smiley.culinary-world.edges.v1', edges, evidence, entryMeta}));
await writeFile(`${OUT}/recipes.json`, JSON.stringify({
  schema: 'smiley.culinary-world.recipes.v1', generation: catalog.generationId, count: catalog.recipes.length,
  nameGroups: {'black-eyed-peas': ['black-eyed-peas', 'black-eyed-pea'], peaches: ['peaches', 'peach'], 'pomegranate-seeds': ['pomegranate-seeds', 'pomegranate-seed'], 'sweet-potatoes': ['sweet-potatoes', 'sweet-potato']},
  recipes: catalog.recipes.map(r => ({id: r.recipe_id, title: r.title, book: r.book, author: r.author, page: r.page, ing: r.ingredient_ids})),
}));
const sizes = {}; for (const f of ['nodes', 'edges', 'recipes']) sizes[f] = ((await readFile(`${OUT}/${f}.json`)).length / 1048576).toFixed(2) + ' MB';
console.log('written', sizes);
