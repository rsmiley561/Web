// Culinary Universe — app shell. Chain building over printed pairings from
// The Flavor Bible and The Vegetarian Flavor Bible. No score is computed.
import {createWorld} from './world.js';

const $ = s => document.querySelector(s);
const BOOK = ['Flavor Bible', 'Vegetarian Flavor Bible'], SHORT = ['FB', 'VFB'];
const profile = () => innerWidth < 701 ? 'phone' : innerWidth <= 1180 || ('ontouchstart' in globalThis && innerWidth < 1400) ? 'ipad' : 'desktop';
const LABEL_CAP = {phone: 7, ipad: 12, desktop: 18};

// ---- data -------------------------------------------------------------------------
const nodesData = await fetch('data/nodes.json').then(r => r.json());
const N = nodesData.nodes, byId = new Map(N.map((n, i) => [n.id, i]));
const FAMILIES = nodesData.families;
let E = null, EV = null, META = null, adj = null;          // loaded right after the world opens
const edgesReady = fetch('data/edges.json').then(r => r.json()).then(d => {
  E = d.edges; EV = d.evidence; META = d.entryMeta; adj = new Map();
  E.forEach(([a, b, ev], ei) => { (adj.get(a) || adj.set(a, []).get(a)).push([b, ei]); (adj.get(b) || adj.set(b, []).get(b)).push([a, ei]); });
});
let recipesPromise = null;
const recipes = () => recipesPromise ||= fetch('data/recipes.json').then(r => r.json());

// ---- graph queries (book filter applies to printed evidence) --------------------------
function evidenceFor(ei, book) { return E[ei][2].map(i => EV[i]).filter(v => book === 'both' || SHORT[v[0]] === book); }
function partners(id, book) {
  const i = byId.get(id); if (i == null || !adj) return [];
  const out = [];
  for (const [j, ei] of adj.get(i) || []) { const ev = evidenceFor(ei, book); if (ev.length) out.push({node: N[j], ev, ei}); }
  return out.sort((x, y) => x.node.label.localeCompare(y.node.label));
}
function linked(a, b, book) { const i = byId.get(a), j = byId.get(b); if (i == null || j == null || !adj) return null; for (const [k, ei] of adj.get(i) || []) if (k === j) { const ev = evidenceFor(ei, book); return ev.length ? {ei, ev} : null; } return null; }

// ---- state --------------------------------------------------------------------------
const S = {chain: [], focus: null, history: [], book: 'both', view: 'rest', sheet: null, justAdded: null, recipe: null, error: ''};
const node = id => N[byId.get(id)];
const chainNodes = () => S.chain.map(node).filter(Boolean);
const label = id => node(id)?.label || id;

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  S.chain = (h.get('chain') || '').split(',').filter(id => byId.has(id)); S.focus = byId.has(h.get('focus')) ? h.get('focus') : null;
  S.book = ['both', 'FB', 'VFB'].includes(h.get('book')) ? h.get('book') : 'both'; S.view = S.focus ? 'visit' : S.chain.length ? 'overview' : 'rest';
}
function writeHash() { const parts = []; if (S.chain.length) parts.push('chain=' + S.chain.map(encodeURIComponent).join(',')); if (S.focus) parts.push('focus=' + encodeURIComponent(S.focus)); if (S.book !== 'both') parts.push('book=' + S.book); history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname); }

// ---- world -------------------------------------------------------------------------
const stage = $('#stage'); let world = null;
try { world = createWorld(stage, {families: FAMILIES, onSelect: id => visit(id), onState: s => { if (s.error) { $('#graphics-note').textContent = s.error; $('#graphics-note').hidden = false; } else renderStatus(s); }}); } catch (e) { console.error(e); $('#graphics-note').hidden = false; }
const places = N.filter(n => n.place);
world?.setPlaces(places);

// Rest view beacons: the ingredients with the most printed recommendations. That is a
// count of what the books print, shown as a way in — not a ranking of anything.
const beacons = []; for (const n of [...places].sort((a, b) => (Number(b.kind === 'canonical-ingredient') - Number(a.kind === 'canonical-ingredient')) || b.deg - a.deg)) { if (beacons.length >= LABEL_CAP[profile()]) break; if (!beacons.some(b => Math.hypot(b.p[0] - n.p[0], b.p[1] - n.p[1], b.p[2] - n.p[2]) < 90)) beacons.push(n); }

function focusPartners() { return S.focus ? partners(S.focus, S.book) : []; }
function coverage(id) { const others = S.chain.filter(c => c !== id); return {n: others.filter(c => linked(id, c, S.book)).length, of: others.length}; }

function syncWorld() {
  if (!world) return;
  const chain = new Set(S.chain), fp = focusPartners(), pset = new Set(fp.map(p => p.node.id));
  world.setStates(id => id === S.focus ? 3 : chain.has(id) ? 2 : pset.has(id) ? 1 : 0, id => { if (!chain.size || !pset.has(id)) return 0; const c = coverage(id); return c.of ? c.n / c.of : 0; });
  // filaments: every chain edge, plus the focus to the partners that are labelled
  const fil = [], seen = new Set(), now = world.now();
  const push = (a, b, st) => { const k = a < b ? a + '|' + b : b + '|' + a; if (seen.has(k)) return; seen.add(k); const A = node(a), B = node(b); if (!A?.p || !B?.p) return; fil.push({a: A.p, b: B.p, state: st, start: S.justAdded && (a === S.justAdded || b === S.justAdded) ? now : -100, seed: (k.length * 7919 % 1000) / 1000}); };
  for (let i = 0; i < S.chain.length; i++) for (let j = i + 1; j < S.chain.length; j++) if (linked(S.chain[i], S.chain[j], S.book)) push(S.chain[i], S.chain[j], S.justAdded ? 2 : 1);
  const labels = [];
  if (S.view === 'rest') beacons.forEach(b => labels.push({id: b.id, label: b.label, p: b.p, role: 'beacon', family: b.family, aria: `${b.label}, ${b.deg} printed pairings`}));
  else {
    for (const c of chainNodes()) if (c.p) labels.push({id: c.id, label: c.label, p: c.p, role: c.id === S.focus ? 'focus' : 'chain', family: c.family});
    const f = S.focus && node(S.focus); if (f?.p && !chain.has(f.id)) labels.push({id: f.id, label: f.label, p: f.p, role: 'focus', family: f.family});
    if (S.view === 'visit' && S.focus) {
      const cap = LABEL_CAP[profile()] - labels.length;
      nearby().slice(0, Math.max(3, cap)).forEach(p => { labels.push({id: p.node.id, label: p.node.label, p: p.node.p, role: 'partner', family: p.node.family, aria: `${p.node.label}, printed pairing with ${label(S.focus)}`}); if (!chain.has(p.node.id)) push(S.focus, p.node.id, chain.has(S.focus) ? 1 : 0); });
      for (const c of S.chain) if (c !== S.focus && linked(S.focus, c, S.book)) push(S.focus, c, chain.has(S.focus) ? 1 : 0);
    }
  }
  world.setFilaments(fil); world.setLabels(labels);
}
// Partners worth a label right now: linked to more of the chain first, then the
// nearest in space, so the neighbourhood you see is the one around you.
function nearby() {
  const f = node(S.focus); if (!f?.p) return [];
  return focusPartners().filter(p => p.node.p && !S.chain.includes(p.node.id)).map(p => ({...p, cov: coverage(p.node.id).n, dist: Math.hypot(p.node.p[0] - f.p[0], p.node.p[1] - f.p[1], p.node.p[2] - f.p[2])}))
    .sort((a, b) => b.cov - a.cov || a.dist - b.dist);
}

// ---- actions ----------------------------------------------------------------------------
async function visit(id) {
  if (!byId.has(id) || world?.metrics().moving) return;
  const n = node(id); S.justAdded = null; closeSheet();
  if (!n.place) { S.focus = id; S.view = 'visit'; render(); openSheet('pairings'); return; }   // contexts: listed, not flown to
  S.focus = id; S.view = 'visit'; render(); await world?.go(id); render();
}
function add() {
  if (!S.focus || S.chain.includes(S.focus)) return;
  S.history.push([...S.chain]); S.chain = [...S.chain, S.focus]; S.justAdded = S.focus; S.view = 'overview'; render();
  world?.frame(chainNodes().filter(n => n.p).map(n => n.p)).then(() => { setTimeout(() => { S.justAdded = null; syncWorld(); }, 2500); });
}
function remove(id) { S.history.push([...S.chain]); S.chain = S.chain.filter(c => c !== id); S.justAdded = null; if (S.focus === id) S.focus = S.chain.at(-1) || null; S.view = S.chain.length ? 'overview' : 'rest'; closeSheet(); render(); world?.frame(chainNodes().filter(n => n.p).map(n => n.p)); }
function undo() { if (!S.history.length) return; S.chain = S.history.pop(); S.justAdded = null; S.view = S.chain.length ? 'overview' : 'rest'; render(); world?.frame(chainNodes().filter(n => n.p).map(n => n.p)); }
function overview() { S.justAdded = null; closeSheet(); S.view = S.chain.length ? 'overview' : 'rest'; render(); world?.frame(chainNodes().filter(n => n.p).map(n => n.p)); }
function rest() { S.justAdded = null; closeSheet(); S.view = 'rest'; S.focus = null; render(); world?.frame([]); }

// ---- sheets --------------------------------------------------------------------------
function openSheet(name) { S.sheet = name; $('#sheet').hidden = false; $('#sheet').dataset.kind = name; renderSheet(); requestAnimationFrame(() => $('#sheet [autofocus], #sheet input, #sheet button')?.focus()); }
function closeSheet() { if (!S.sheet) return; S.sheet = null; $('#sheet').hidden = true; }

function evidenceRows(ev) {
  return ev.map(v => {
    const m = META?.[v[7]] || {}, from = N[v[4]], to = N[v[5]];
    return `<li><b>${BOOK[v[0]]}</b> · p. ${v[1]} <span class="print">${esc(v[2])} → ${esc(v[3])}</span>${v[6] ? ' <em title="The author marks this pairing typographically in the book">★ author highlight</em>' : ''}${v[8] ? ' <small>grouped under Tomato · original form shown</small>' : ''}${m.season ? `<small>Season: ${esc(String(m.season))}</small>` : ''}${m.techniques?.length ? `<small>Entry techniques: ${esc(m.techniques.join(', '))}</small>` : ''}</li>`;
  }).join('');
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const dot = f => `<i class="fam" style="--fam:${(FAMILIES[f] || FAMILIES.mist).hex}"></i>`;

function renderSheet() {
  const sh = $('#sheet'); if (!S.sheet) return;
  const f = S.focus && node(S.focus);
  if (S.sheet === 'pairings') {
    const q = (sh.querySelector('input')?.value || S.q || '').trim().toLowerCase(); S.q = q;
    let list, heading;
    if (q.length >= 2) { list = N.filter(n => n.label.toLowerCase().includes(q) || (n.members || []).some(m => m.toLowerCase().includes(q))).filter(n => S.book === 'both' || n.books.includes(S.book)).sort((a, b) => Number(b.label.toLowerCase() === q) - Number(a.label.toLowerCase() === q) || b.deg - a.deg).slice(0, 120).map(n => ({node: n})); heading = `${list.length} matches`; }
    else if (f) { list = partners(S.focus, S.book).map(p => ({...p, cov: coverage(p.node.id)})).sort((a, b) => (b.cov.n - a.cov.n) || Number(b.node.place) - Number(a.node.place) || a.node.label.localeCompare(b.node.label)); heading = `${list.length} printed pairings for ${f.label}`; }
    else { list = beacons.map(n => ({node: n})); heading = 'Most-connected in the books'; }
    const placesList = list.filter(x => x.node.place), contexts = list.filter(x => !x.node.place);
    sh.innerHTML = `<header><h2>${f && q.length < 2 ? `Where next from ${esc(f.label)}?` : 'Find an ingredient'}</h2><button class="close" data-act="close" aria-label="Close">×</button></header>
      <div class="tools"><input type="search" placeholder="Basil, tomato, eggplant…" value="${esc(S.q || '')}" autocomplete="off" aria-label="Find an ingredient">
      <select aria-label="Source"><option value="both"${S.book === 'both' ? ' selected' : ''}>Both books</option><option value="FB"${S.book === 'FB' ? ' selected' : ''}>The Flavor Bible</option><option value="VFB"${S.book === 'VFB' ? ' selected' : ''}>The Vegetarian Flavor Bible</option></select></div>
      <p class="note">${heading}${S.chain.length && f && q.length < 2 ? ' · brighter ones are printed alongside more of your chain' : ''}</p>
      <ul class="options">${placesList.map(x => `<li><button data-act="visit" data-id="${x.node.id}" style="--fam:${(FAMILIES[x.node.family] || FAMILIES.mist).hex};--cov:${x.cov?.of ? (x.cov.n / x.cov.of).toFixed(2) : 0}">${dot(x.node.family)}<span>${esc(x.node.label)}${x.node.q ? ` <small class="q">${esc(x.node.q)}</small>` : ''}</span><small>${S.chain.includes(x.node.id) ? 'In your chain' : x.cov?.of ? `Printed with ${x.cov.n} of ${x.cov.of} in your chain` : x.node.books.join(' · ')}${x.node.members ? ' · all tomato forms' : ''}</small></button></li>`).join('')}</ul>
      ${contexts.length ? `<details><summary>Also printed: ${contexts.length} contexts and terms without an entry of their own</summary><ul class="terms">${contexts.map(x => `<li>${esc(x.node.label)}${x.node.q ? ` <span class="q">${esc(x.node.q)}</span>` : ''}${x.ev ? ` <small>${[...new Set(x.ev.map(v => SHORT[v[0]]))].join(' · ')}</small>` : ''}</li>`).join('')}</ul></details>` : ''}
      <p class="note">Every line is a printed recommendation. A missing line means the books do not print it — not that it is a bad pairing. No score is calculated anywhere.</p>`;
    sh.querySelector('input').oninput = () => renderSheet(); sh.querySelector('select').onchange = e => { S.book = e.target.value; render(); renderSheet(); };
  } else if (S.sheet === 'connections' && f) {
    const others = S.chain.filter(c => c !== f.id), rows = others.map(c => ({c, l: linked(f.id, c, S.book)}));
    sh.innerHTML = `<header><h2>${esc(f.label)}</h2><button class="close" data-act="close" aria-label="Close">×</button></header>
      <p class="note">${f.books.map(b => BOOK[SHORT.indexOf(b)]).join(' and ') || 'Printed as a pairing target'} · ${f.heads.map(h => `p. ${h.p}`).join(', ')}${f.members ? ` · ${f.members.length} tomato forms share this parent` : ''}</p>
      ${rows.length ? rows.map(({c, l}) => `<section><h3>${dot(node(c).family)}${esc(label(c))}</h3>${l ? `<ul class="evidence">${evidenceRows(l.ev)}</ul>` : '<p class="quiet">No printed connection between these two in this source view. You can still keep both in your chain.</p>'}</section>`).join('') : `<p class="quiet">${S.chain.includes(f.id) ? 'Add another ingredient to see what the books print between them.' : `Add ${esc(f.label)} to your chain to start connecting.`}</p>`}
      ${f.members ? `<details><summary>Forms under Tomato · ${f.members.length}</summary><ul class="terms">${f.members.map(m => `<li>${esc(m)}</li>`).join('')}</ul></details>` : ''}
      <p class="note">The wording above is the book's own, with its direction. Cloud colour identifies an ingredient; it does not measure anything.</p>
      ${S.chain.includes(f.id) ? `<button class="glass danger" data-act="remove" data-id="${f.id}">Remove ${esc(f.label)} from chain</button>` : ''}`;
  } else if (S.sheet === 'recipes') {
    sh.innerHTML = `<header><h2>Recipes with your chain</h2><button class="close" data-act="close" aria-label="Close">×</button></header><p class="note">Looking through 1,497 recipes…</p>`;
    recipes().then(R => { if (S.sheet !== 'recipes') return; const {items, unresolved} = matchChain(R);
      sh.innerHTML = `<header><h2>Recipes with ${S.chain.length ? chainNodes().map(n => esc(n.label)).join(' + ') : 'your chain'}</h2><button class="close" data-act="close" aria-label="Close">×</button></header>
        ${unresolved.length ? `<p class="note">${unresolved.map(esc).join(', ')} ${unresolved.length > 1 ? 'are' : 'is'} a book term without a recipe ingredient match yet, so it is set aside for this search. Your chain is unchanged.</p>` : ''}
        <p class="note">${items.length} of 1,497 recipes contain every remaining ingredient${items.length ? '' : '. Your chain stays intact — keep exploring, or take one ingredient out.'}</p>
        <ul class="options recipes">${items.map(r => `<li><button data-act="open" data-id="${r.id}"><span>${esc(r.title)}</span><small>${esc(r.author)} · ${esc(r.book)} · p. ${r.page}${r.forms.length ? ` · uses ${esc(r.forms.join(', '))}` : ''}</small></button></li>`).join('')}</ul>`; });
  }
}
function matchChain(R) {
  const isTomato = s => /(?:^|[^a-z])(?:tomatoes|tomato|pomodoro|pomodori)(?:$|[^a-z])/i.test(s);
  const ids = [], unresolved = [];
  for (const c of chainNodes()) if (c.canonical.length === 1) ids.push(c.canonical[0]); else unresolved.push(c.label);
  if (!ids.length) return {items: [], unresolved};
  const all = new Set(R.recipes.flatMap(r => r.ing));
  const groups = ids.map(id => ({id, variants: id === 'tomatoes' ? [...all].filter(isTomato) : R.nameGroups[id] || [id]}));
  const items = R.recipes.filter(r => groups.every(g => g.variants.some(v => r.ing.includes(v)))).map(r => ({...r, forms: groups.flatMap(g => g.variants.filter(v => v !== g.id && r.ing.includes(v)))})).sort((a, b) => a.title.localeCompare(b.title));
  return {items, unresolved};
}
function openRecipe(id) {
  S.recipe = id; $('#work-frame').src = `host/app/index.html?recipe=${encodeURIComponent(id)}`; $('#work').hidden = false; document.body.classList.add('reading'); world?.setReading(true); closeSheet();
  recipes().then(R => { const r = R.recipes.find(x => x.id === id); $('#work-title').textContent = r ? r.title : id; });
  $('#work-back').focus();
}
function closeRecipe() { S.recipe = null; $('#work').hidden = true; $('#work-frame').src = 'about:blank'; document.body.classList.remove('reading'); world?.setReading(false); render(); }

// ---- render -----------------------------------------------------------------------------
function renderStatus(s) { $('#status').textContent = s.moving ? 'Traveling through the clouds' : S.view === 'rest' ? 'A universe of printed pairings' : S.view === 'overview' ? `${S.chain.length} ingredient${S.chain.length === 1 ? '' : 's'} in your chain` : `Exploring ${label(S.focus)}`; $('#motion').textContent = s.paused ? 'Resume' : 'Pause'; $('#motion').setAttribute('aria-pressed', String(!!s.paused)); }
function render() {
  writeHash(); document.body.dataset.view = S.view;
  const f = S.focus && node(S.focus), inChain = f && S.chain.includes(f.id), fp = f ? focusPartners() : [];
  renderStatus(world?.metrics() || {});
  $('#where').innerHTML = S.view === 'rest' ? `<b>${places.length.toLocaleString()} ingredients</b> from The Flavor Bible and The Vegetarian Flavor Bible · <b>${(E ? E.length : 36895).toLocaleString()}</b> printed pairings · 1,497 recipes underneath` : f && S.view === 'visit' ? `${dot(f.family)}<b>${esc(f.label)}</b> · ${fp.filter(p => p.node.place).length} places you can travel to · ${fp.filter(p => !p.node.place).length} printed contexts${!f.place ? ' · a printed context, listed rather than flown to' : ''}` : `Your chain stays connected. Return to any ingredient to branch from it.`;
  const primary = $('#primary');
  if (S.view === 'rest') { primary.textContent = 'Choose where to begin'; primary.dataset.act = 'pairings'; }
  else if (S.view === 'overview') { primary.textContent = f ? `Continue from ${label(f.id)}` : 'Choose an ingredient'; primary.dataset.act = f ? 'continue' : 'pairings'; }
  else if (!inChain) { primary.textContent = `Add ${f.label} to chain`; primary.dataset.act = 'add'; }
  else { const nx = nearby()[0]; primary.textContent = nx ? `Travel to ${nx.node.label}` : 'Choose the next ingredient'; primary.dataset.act = nx ? 'visit' : 'pairings'; primary.dataset.id = nx?.node.id || ''; }
  $('#chain').innerHTML = S.chain.length ? S.chain.map(c => `<button data-act="visit" data-id="${c}" style="--fam:${(FAMILIES[node(c).family] || FAMILIES.mist).hex}" aria-current="${S.focus === c && S.view === 'visit' ? 'location' : 'false'}">${dot(node(c).family)}${esc(label(c))}</button>`).join('') : `<span class="quiet">Your chain is empty. Start anywhere.</span>`;
  $('#undo').disabled = !S.history.length; $('#overview').disabled = !S.chain.length; $('#recipes-btn').disabled = !S.chain.length;
  $('#recipes-btn').textContent = S.chain.length ? `Recipes with ${S.chain.length} ↗` : 'Recipes';
  $('#connections-btn').disabled = !f;
  syncWorld(); if (S.sheet) renderSheet();
}

// ---- wiring ------------------------------------------------------------------------------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const act = b.dataset.act, id = b.dataset.id;
  if (act === 'visit') visit(id); else if (act === 'add') add(); else if (act === 'remove') remove(id); else if (act === 'undo') undo(); else if (act === 'overview') overview(); else if (act === 'rest') rest();
  else if (act === 'continue') visit(S.focus); else if (act === 'pairings' || act === 'connections' || act === 'recipes') openSheet(act); else if (act === 'close') closeSheet(); else if (act === 'open') openRecipe(id); else if (act === 'work-back') closeRecipe(); else if (act === 'motion') { world?.pause(); }
});
addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#work').hidden) closeRecipe(); else if (S.sheet) closeSheet(); } if (e.key === '/' && !S.sheet && $('#work').hidden) { e.preventDefault(); openSheet('pairings'); } });
addEventListener('hashchange', () => { readHash(); render(); });

// ---- start ----------------------------------------------------------------------------------
readHash(); render();
edgesReady.then(async () => { render(); if (S.focus && node(S.focus)?.place) await world?.go(S.focus); else if (S.chain.length) world?.frame(chainNodes().filter(n => n.p).map(n => n.p)); render(); });

window.UNIVERSE = {ready: edgesReady.then(() => true), get state() { return {view: S.view, focus: S.focus, chain: [...S.chain], book: S.book, sheet: S.sheet, recipe: S.recipe, places: places.length, edges: E?.length || 0}; },
  actions: {visit, add, remove, undo, overview, rest, openSheet, closeSheet, openRecipe, closeRecipe}, partners: id => partners(id, S.book), linked: (a, b) => linked(a, b, S.book), metrics: () => world?.metrics(), matchChain: async () => matchChain(await recipes())};
