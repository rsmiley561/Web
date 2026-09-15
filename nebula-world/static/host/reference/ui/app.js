'use strict';
/**
 * Chef Smiley S1 preview UI — local, read-only, single-page browser app.
 *
 * Everything numeric on this page runs through the shared evaluator that is bundled at
 * ui/vendor/{quantity-engine.js, corpus-adapter.js, s1-bundle.js} (built from
 * WORK/preview/lib by tools/build-ui-bundle.js). This file never scales, converts,
 * rounds or prices anything itself — it only builds evaluatePlan() requests from user
 * controls and renders the response. See WORK/preview/API-CONTRACT.md.
 *
 * No network calls beyond same-origin fetches of /data/... and this app's own assets.
 * No CDN, no remote font, no analytics, no AI/model call anywhere on this page.
 */

/* ============================== tiny safe-DOM helpers ============================== */
/* We never use innerHTML with recipe/product/source text. Every dynamic string goes
   through textContent (via `text()` below) so nothing can be interpreted as markup. */

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const child of [].concat(children || [])) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function text(str) { return document.createTextNode(str === null || str === undefined ? '' : String(str)); }
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function esc(str) { return str === null || str === undefined ? '' : String(str); } // used only for attribute-safe values we already set via setAttribute/textContent

/* ============================================ state ================================================ */

const state = {
  genPath: null,
  generationId: null,
  publishedAt: null,
  index: null,
  indexById: new Map(),
  manifest: null,
  rulesDoc: null,        // rules.json — { rules: { <id>: {...source, ...} } }
  reviewedRules: null,   // reviewed-rules.json — fed to the evaluator as `rules`
  bindings: null,        // occurrence-bindings.json
  ledger: null,          // admission-ledger.json
  versions: null,
  shardCache: new Map(), // '00' -> parsed shard json
  recipeSourceById: new Map(), // recipe_id -> source recipe object (as loaded from a shard)
  evaluator: null,
  selections: [],        // ordered list of selection-state objects, see makeSelection()
  profileId: 'retail-walmart-33445-recorded',
  presetId: null,
  context: 'home',
  inventory: { scenario: 'UNKNOWN', items: [] }, // items: [{product_id, qty, unit}]
  currentPlan: null,
  snapshots: [],
  debounceTimer: null,
  searchQuery: '',
  loading: false,
};

function makeSelection(recipeId) {
  return {
    recipe_id: recipeId,
    portions: null,
    multiplier: null,
    choices: {},            // ingredient_index -> {ingredient_id, scenario}
    choice_occurrences: {}, // ingredient_index -> {id, raw, confirmed_source_choice:true}
    explicit_text_choice: {}, // ingredient_index -> true
    include_optional: false,
  };
}

/* ============================================ boot ================================================= */

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('Fetch failed (' + res.status + '): ' + url);
  return res.json();
}

async function boot() {
  try {
    await loadCurrentGeneration();
    wireGlobalControls();
    renderSidebarList();
    renderMain();
    document.getElementById('app').removeAttribute('aria-busy');
  } catch (e) {
    showToast('Failed to load generated data: ' + e.message, true);
    console.error(e);
  }
}

async function loadCurrentGeneration() {
  const current = await fetchJson('/data/current.json');
  state.generationId = current.generation_id;
  state.publishedAt = current.published_at_utc;
  state.genPath = '/data/' + current.path;
  await loadGenerationDocs();
}

async function loadGenerationDocs() {
  const [index, manifest, rulesDoc, reviewedRules, bindings, ledger] = await Promise.all([
    fetchJson(state.genPath + '/index.json'),
    fetchJson(state.genPath + '/GENERATION-MANIFEST.json'),
    fetchJson(state.genPath + '/rules.json'),
    fetchJson(state.genPath + '/reviewed-rules.json'),
    fetchJson(state.genPath + '/occurrence-bindings.json'),
    fetchJson(state.genPath + '/admission-ledger.json'),
  ]);
  state.index = index;
  state.indexById = new Map(index.recipes.map((r) => [r.recipe_id, r]));
  state.manifest = manifest;
  state.rulesDoc = rulesDoc;
  state.reviewedRules = reviewedRules;
  state.bindings = bindings;
  state.ledger = ledger;
  state.versions = buildVersions(manifest);
  // A new (or re-read) generation invalidates any recipe objects and evaluator built
  // against the previous data, per AUTO-06/AUTO-13. Saved snapshots are untouched: they
  // hold their own copies of the plan values, not a live reference to this state.
  state.shardCache = new Map();
  state.recipeSourceById = new Map();
  rebuildEvaluator();
  updateGenerationBadge();
  populateProfileSelect();
  populatePresetSelect();
}

function buildVersions(manifest) {
  const deps = manifest.dependencies || {};
  const ev = deps.evaluator || {};
  return {
    generation_id: manifest.generation_id,
    generated_at_utc: manifest.generated_at_utc,
    // Field names match the shared snapshot module bundled at ui/vendor/s1-bundle.js,
    // which is built from lib/snapshot.js itself.
    recipe_runtime_sha256: (deps.recipe_runtime || {}).sha256 || null,
    rule_registry_sha256: (deps.rule_registry || {}).sha256 || null,
    // Two different dependencies: the accepted binding file and the S1 overlay on top.
    accepted_bindings_sha256: (deps.accepted_bindings || {}).sha256 || null,
    occurrence_bindings_sha256: (deps.accepted_bindings || {}).sha256 || null,
    binding_overlay_sha256: (deps.binding_overlay || {}).sha256 || null,
    binding_overlay_version: (deps.binding_overlay || {}).version || null,
    price_observations_sha256: (deps.price_observations || {}).sha256 || null,
    price_admission_ledger_sha256: (deps.price_admission_ledger || {}).sha256 || null,
    quantity_engine_sha256: ev.quantity_engine_sha256 || null,
    corpus_adapter_sha256: ev.corpus_adapter_sha256 || null,
    evaluator_version: ev.quantity_engine || null,
    s1_preview_api: ev.s1_preview_api || null,
  };
}

function rebuildEvaluator() {
  state.evaluator = SmileyS1.plan.createEvaluator({
    engine: SmileyQuantity,
    adapter: SmileyCorpus,
    runtime: { recipes: Array.from(state.recipeSourceById.values()) },
    rules: state.reviewedRules,
    bindings: state.bindings,
    ledger: state.ledger,
    versions: state.versions,
  });
}

async function ensureRecipeLoaded(recipeId) {
  if (state.recipeSourceById.has(recipeId)) return;
  const row = state.indexById.get(recipeId);
  if (!row) throw new Error('Unknown recipe id: ' + recipeId);
  const shardKey = String(row.shard).padStart(2, '0');
  let shard = state.shardCache.get(shardKey);
  if (!shard) {
    shard = await fetchJson(state.genPath + '/shards/' + shardKey + '.json');
    state.shardCache.set(shardKey, shard);
  }
  const rec = shard.recipes[recipeId];
  if (!rec) throw new Error('Recipe not present in shard ' + shardKey + ': ' + recipeId);
  state.recipeSourceById.set(recipeId, rec.source);
  rebuildEvaluator(); // cheap: rebuilds the ledger/rule index and recipe map only
}

/* ============================================ header ================================================ */

function updateGenerationBadge() {
  const badge = document.getElementById('generation-badge');
  clear(badge);
  badge.appendChild(text('generation ' + state.generationId + ' · published ' + formatDate(state.publishedAt)));
  badge.className = 'badge ok';
}

function populateProfileSelect() {
  const sel = document.getElementById('profile-select');
  clear(sel);
  for (const profile of Object.values(SmileyS1.mapping.PROFILES)) {
    sel.appendChild(el('option', { value: profile.id }, profile.label));
  }
  sel.value = state.profileId;
  updateProfileNote();
}

function updateProfileNote() {
  const profile = SmileyS1.mapping.PROFILES[state.profileId];
  document.getElementById('profile-note').textContent = profile ? profile.note : '';
}

/* A material convention is an OWNER decision, never a default. Nothing is selected until
   someone selects it, and the scope and uncertainty are stated on screen when they do. */
function populatePresetSelect() {
  const sel = document.getElementById('preset-select');
  const presets = (SmileyS1.overlays && SmileyS1.overlays.PRESETS) || {};
  for (const preset of Object.values(presets)) {
    sel.appendChild(el('option', { value: preset.id }, preset.label));
  }
  sel.value = state.presetId || '';
  updatePresetNote();
}

function updatePresetNote() {
  const note = document.getElementById('preset-note');
  const presets = (SmileyS1.overlays && SmileyS1.overlays.PRESETS) || {};
  const preset = state.presetId ? presets[state.presetId] : null;
  clear(note);
  if (!preset) {
    note.textContent = 'No material convention is selected, so unknown conventions stay unknown. Owner defaults are unchanged.';
    return;
  }
  note.appendChild(el('div', {}, 'Selected by you, not a default. Owner default values are unchanged.'));
  note.appendChild(el('div', {}, 'Scope: ' + preset.scope));
  note.appendChild(el('div', {}, 'Uncertainty: ' + preset.uncertainty));
}

function wireGlobalControls() {
  document.getElementById('refresh-data-btn').addEventListener('click', onRefreshCurrentData);
  document.getElementById('save-snapshot-btn').addEventListener('click', onSaveSnapshot);
  document.getElementById('search-input').addEventListener('input', (e) => {
    state.searchQuery = e.target.value.trim().toLowerCase();
    renderSidebarList();
  });
  document.getElementById('profile-select').addEventListener('change', (e) => {
    state.profileId = e.target.value;
    updateProfileNote();
    recalcNow();
  });
  document.getElementById('context-select').addEventListener('change', (e) => {
    state.context = e.target.value;
    recalcNow();
  });
  document.getElementById('preset-select').addEventListener('change', (e) => {
    state.presetId = e.target.value || null;
    updatePresetNote();
    recalcNow();
  });
  document.getElementById('inventory-select').addEventListener('change', (e) => {
    state.inventory = { scenario: e.target.value, items: state.inventory.items };
    renderMain(); // scenario switch changes which inventory-entry controls are shown
    recalcNow();
  });
}

async function onRefreshCurrentData() {
  const btn = document.getElementById('refresh-data-btn');
  btn.disabled = true;
  try {
    const before = state.generationId;
    await loadCurrentGeneration();
    renderSidebarList();
    await recalcNow();
    showToast(
      state.generationId === before
        ? 'Refreshed current data — generation unchanged (' + state.generationId + ').'
        : 'Refreshed current data — now on generation ' + state.generationId + '.'
    );
  } catch (e) {
    showToast('Refresh failed: ' + e.message, true);
  } finally {
    btn.disabled = false;
  }
}

function showToast(msg, isError) {
  const t = document.getElementById('toast');
  clear(t);
  t.appendChild(text(msg));
  t.style.background = isError ? '#8a2f26' : '';
  t.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { t.hidden = true; }, 4500);
}

function formatDate(iso) {
  if (!iso) return 'unknown date';
  try { return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; } catch { return iso; }
}

/* ============================================ sidebar ================================================ */

function renderSidebarList() {
  const list = document.getElementById('recipe-list');
  const countEl = document.getElementById('search-count');
  clear(list);
  const q = state.searchQuery;
  const rows = q ? state.index.recipes.filter((r) => r.search_text.includes(q)) : state.index.recipes;
  const shown = q ? rows : rows.slice(0, 250); // full library browsable by scroll+search; cap the unfiltered view for render performance
  countEl.textContent = q
    ? shown.length + ' of ' + state.index.recipes.length + ' recipes match'
    : 'Showing first ' + shown.length + ' of ' + state.index.recipes.length + ' recipes — search to narrow';
  const selectedIds = new Set(state.selections.map((s) => s.recipe_id));
  const frag = document.createDocumentFragment();
  for (const row of shown) {
    const li = el('li', {});
    const openBtn = el(
      'button',
      {
        type: 'button',
        class: 'recipe-open-btn' + (selectedIds.has(row.recipe_id) ? ' active' : ''),
        onclick: () => openRecipeExclusive(row.recipe_id),
        title: 'Open ' + row.title,
      },
      [
        el('span', { class: 'r-title' }, row.title),
        el('span', { class: 'r-meta' }, row.book + (row.page ? ', p. ' + row.page : '') + ' · ' + row.scenario.replace(/_/g, ' ').toLowerCase()),
      ]
    );
    const addBtn = el(
      'button',
      { type: 'button', class: 'r-add-btn', title: 'Add to current plan (small-menu mode)', onclick: () => addRecipeToPlan(row.recipe_id) },
      '+'
    );
    const wrap = el('div', { class: 'recipe-row' }, [openBtn, addBtn]);
    li.appendChild(wrap);
    frag.appendChild(li);
  }
  list.appendChild(frag);
}

function openRecipeExclusive(recipeId) {
  state.selections = [makeSelection(recipeId)];
  renderSidebarList();
  recalcNow();
}

function addRecipeToPlan(recipeId) {
  if (state.selections.some((s) => s.recipe_id === recipeId)) {
    showToast('Already in the current plan.');
    return;
  }
  state.selections.push(makeSelection(recipeId));
  renderSidebarList();
  recalcNow();
}

function removeFromPlan(recipeId) {
  state.selections = state.selections.filter((s) => s.recipe_id !== recipeId);
  renderSidebarList();
  if (state.selections.length) recalcNow();
  else { state.currentPlan = null; renderMain(); }
}

/* ============================================ recalculation ================================================ */

/* Explicit, commented debounce: only free-typed numeric fields (portions/multiplier and
   on-hand quantities) are debounced, so recalculation runs once after the user pauses
   typing rather than on every keystroke. Discrete controls (selects, checkboxes, buttons)
   recalculate immediately. This is the ONLY debouncing in the app. */
const RECALC_DEBOUNCE_MS = 350;
function scheduleRecalc() {
  clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(recalcNow, RECALC_DEBOUNCE_MS);
}

/* Selection/control changes are async (they may need to fetch a not-yet-loaded shard
   first). If the user changes another control before that finishes, a stale call must
   not clobber the newer one's result — this token makes recalcNow() a no-op once a
   later call has started, so the screen always reflects the LAST requested state. */
let recalcToken = 0;
async function recalcNow() {
  const myToken = ++recalcToken;
  if (!state.selections.length) {
    state.currentPlan = null;
    renderMain();
    return;
  }
  state.loading = true;
  try {
    for (const sel of state.selections) await ensureRecipeLoaded(sel.recipe_id);
    if (myToken !== recalcToken) return; // superseded by a newer control change
    const request = {
      selections: state.selections.map((s) => ({
        recipe_id: s.recipe_id,
        portions: s.portions === null ? undefined : s.portions,
        multiplier: s.multiplier === null ? undefined : s.multiplier,
        choices: s.choices,
        choice_occurrences: s.choice_occurrences,
        explicit_text_choice: s.explicit_text_choice,
        include_optional: s.include_optional,
      })),
      profile_id: state.profileId,
      preset_id: state.presetId,
      context: state.context,
      inventory: state.inventory,
    };
    const plan = state.evaluator.evaluatePlan(request);
    if (myToken !== recalcToken) return; // superseded while evaluatePlan ran
    state.currentPlan = plan;
  } catch (e) {
    if (myToken !== recalcToken) return;
    showToast('Recalculation failed: ' + e.message, true);
    console.error(e);
    state.currentPlan = { status: 'ERROR', reason: e.message };
  } finally {
    if (myToken === recalcToken) {
      state.loading = false;
      renderMain();
    }
  }
}

/* ============================================ main render ================================================ */

function renderMain() {
  const planSection = document.getElementById('plan-section');
  const emptyState = document.getElementById('empty-state');
  if (!state.selections.length || !state.currentPlan) {
    planSection.hidden = true;
    emptyState.hidden = false;
    document.getElementById('save-snapshot-btn').disabled = true;
    return;
  }
  planSection.hidden = false;
  emptyState.hidden = true;
  const plan = state.currentPlan;

  renderSelectionChips();

  if (plan.status === 'ERROR') {
    const box = document.getElementById('plan-summary');
    clear(box);
    box.appendChild(el('div', { class: 'panel' }, el('p', {}, 'Could not evaluate this plan: ' + (plan.reason || 'unknown error'))));
    document.getElementById('purchase-lines-section').replaceChildren();
    document.getElementById('recipes-detail-section').replaceChildren();
    document.getElementById('inventory-entry-section').replaceChildren();
    document.getElementById('export-section').replaceChildren();
    document.getElementById('save-snapshot-btn').disabled = true;
    return;
  }

  renderPlanSummary(plan);
  renderPurchaseLines(plan);
  renderRecipesDetail(plan);
  renderInventoryEntry(plan);
  renderExportSection(plan);
  document.getElementById('save-snapshot-btn').disabled = false;
}

function renderSelectionChips() {
  const wrap = document.getElementById('selection-chips');
  clear(wrap);
  if (state.selections.length <= 1) return; // only show chip bar in small-menu (multi-recipe) mode
  for (const sel of state.selections) {
    const row = state.indexById.get(sel.recipe_id);
    wrap.appendChild(
      el('div', { class: 'chip' }, [
        text(row ? row.title : sel.recipe_id),
        el('button', { type: 'button', title: 'Remove from plan', onclick: () => removeFromPlan(sel.recipe_id) }, '×'),
      ])
    );
  }
}

/* ---------------- plan-level summary: totals, coverage, independent states ---------------- */

function renderPlanSummary(plan) {
  const box = document.getElementById('plan-summary');
  clear(box);

  const heading = state.selections.length > 1
    ? 'Menu plan — ' + state.selections.length + ' recipes (demand aggregated before package rounding)'
    : (state.indexById.get(state.selections[0].recipe_id) || {}).title || state.selections[0].recipe_id;

  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h2', {}, heading));

  const totals = plan.totals;
  const grid = el('div', { class: 'cost-grid' });
  grid.appendChild(costTile('Theoretical ingredient-use cost', totals.theoretical_ingredient_use_cost.known_line_subtotal_money, totals.theoretical_ingredient_use_cost.meaning, totals.theoretical_ingredient_use_cost));
  grid.appendChild(costTile('Package merchandise commitment', totals.package_merchandise_commitment.known_line_subtotal_money, totals.package_merchandise_commitment.meaning, totals.package_merchandise_commitment));
  grid.appendChild(unknownTile('All-in checkout total', totals.all_in_checkout_reason));
  panel.appendChild(grid);

  panel.appendChild(completenessPanel(totals));

  panel.appendChild(el('h4', { style: 'margin-top:10px' }, 'Unknown charges (never assumed zero)'));
  const uc = totals.unknown_charges;
  panel.appendChild(el('p', { class: 'section-note' }, Object.keys(uc).filter((k) => k !== 'note').map((k) => k.replace(/_/g, ' ')).join(', ') + ' — ' + uc.note));

  panel.appendChild(el('h4', {}, 'Independent states'));
  const states = plan.independent_states;
  const statesRow = el('div', { class: 'states-row' }, [
    statePill('Quantity', states.quantity),
    statePill('Price', states.price),
    statePill('Fulfillment', states.fulfillment),
    statePill('Production guidance', states.production_guidance),
    statePill('Safety', states.safety),
  ]);
  panel.appendChild(statesRow);
  panel.appendChild(el('p', { class: 'section-note' }, states.note));

  panel.appendChild(el('h4', {}, 'Coverage'));
  const cov = plan.coverage;
  panel.appendChild(
    el(
      'p',
      { class: 'section-note' },
      cov.quantity_supported_rows + ' of ' + cov.direct_rows_in_plan + ' direct rows have a supported purchasing quantity; ' +
        cov.priced_purchase_lines + ' of ' + cov.purchase_lines + ' purchase lines carry an admitted recorded price. ' +
        cov.unresolved_rows + ' rows remain unresolved and stay visible with their gap reason below.'
    )
  );

  const componentNote = renderComponentGapsNote(plan);
  if (componentNote) panel.appendChild(componentNote);

  box.appendChild(panel);
}

/* Sub-recipe components referenced by a recipe (e.g. "1/2 batch of the pastry cream on
   p. 40") are listed but never silently folded into the plan's cost — resolving them is
   out of scope for this preview. Showing them here keeps that an honest, visible gap
   instead of a hidden omission. */
function renderComponentGapsNote(plan) {
  if (!plan.component_gaps || !plan.component_gaps.length) return null;
  const wrap = el('div', { class: 'section-note' });
  wrap.appendChild(
    text(plan.component_gaps.length + ' sub-recipe component reference(s) are named by these recipes but not resolved into this plan (component resolution is out of scope for this preview):')
  );
  const list = el('ul', { class: 'small' });
  for (const g of plan.component_gaps) {
    const componentId = g.component && (g.component.id || g.component.recipe_id);
    list.appendChild(el('li', {}, (componentId || 'component #' + g.component_index) + ' — referenced by ' + g.parent_id + ' (' + g.reason + ')'));
  }
  wrap.appendChild(list);
  return wrap;
}

/**
 * S1-R01: a subtotal is "partial" when a REQUIREMENT is unaccounted, not merely when a
 * purchase line lacks a price. A recipe with unresolved source rows is partial even if
 * every line that survived qualification happens to be priced.
 */
/** Readable amount for a quantity that the evaluator returns as an exact rational. */
function amountText(value) {
  if (value === null || value === undefined) return 'unknown';
  const s = String(value);
  if (s.indexOf('/') < 0) return s;
  return SmileyQuantity.Rat.from(s).decimal(4);
}

function costTile(label, moneyObj, meaning, block) {
  const tile = el('div', { class: 'cost-tile' });
  tile.appendChild(el('div', { class: 'label' }, label));
  const isComplete = block && block.complete_total !== null && block.complete_total !== undefined;
  if (moneyObj) {
    tile.appendChild(el('div', { class: 'value' }, '$' + moneyObj.display_usd + (isComplete ? '' : ' (partial)')));
  } else {
    tile.appendChild(el('div', { class: 'value unknown' }, 'unknown — no admitted line yet'));
  }
  if (block && block.low_endpoint_total && block.high_endpoint_total && block.low_endpoint_total !== block.high_endpoint_total) {
    tile.appendChild(el('div', { class: 'meaning' }, 'Source range — endpoint scenarios only. ' + (block.range_note || '')));
  }
  if (!isComplete && block && block.complete_total_withheld_because) {
    tile.appendChild(
      el('div', { class: 'meaning' }, block.complete_total_withheld_because === 'SOURCE_RANGE_REQUIRES_ENDPOINT_SCENARIOS'
        ? 'No single complete total: the source states a range, so only labelled endpoints are published.'
        : 'No complete total yet: some required parts of this scenario are still unaccounted (listed below).')
    );
  }
  tile.appendChild(el('div', { class: 'meaning' }, meaning));
  return tile;
}

/** What is still unaccounted, by reason — kept short and grouped, not a wall of JSON. */
function completenessPanel(totals) {
  const c = totals.completeness;
  const wrap = el('section', { class: 'panel' });
  wrap.appendChild(el('h4', {}, 'What the totals still need'));
  if (!c) return wrap;
  const summary =
    c.required_included_requirements + ' required parts in this scenario · ' + c.accounted_quantity + ' with a supported quantity · ' +
    c.accounted_price + ' also priced' + (c.excluded_by_scenario ? ' · ' + c.excluded_by_scenario + ' excluded by the scenario' : '');
  wrap.appendChild(el('p', { class: 'section-note' }, summary));
  if (!c.unaccounted.length) {
    wrap.appendChild(el('p', { class: 'section-note' }, 'Nothing is unaccounted, so a complete total is published above.'));
    return wrap;
  }
  const byReason = {};
  for (const u of c.unaccounted) {
    const key = u.kind + ' — ' + (u.reason || 'unresolved');
    byReason[key] = (byReason[key] || 0) + 1;
  }
  const list = el('ul', { class: 'gap-list' });
  for (const [reason, count] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    list.appendChild(el('li', {}, count + ' × ' + reason.toLowerCase().replace(/_/g, ' ')));
  }
  wrap.appendChild(list);
  if (c.explicit_exclusions && c.explicit_exclusions.length) {
    wrap.appendChild(el('p', { class: 'section-note' }, c.explicit_exclusions.length + ' row(s) are excluded by this scenario rather than unresolved; including them changes the scenario and its totals.'));
  }
  wrap.appendChild(el('p', { class: 'section-note' }, c.meaning));
  return wrap;
}
function unknownTile(label, reason) {
  const tile = el('div', { class: 'cost-tile' });
  tile.appendChild(el('div', { class: 'label' }, label));
  tile.appendChild(el('div', { class: 'value unknown' }, 'unknown (never $0.00)'));
  tile.appendChild(el('div', { class: 'meaning' }, reason));
  return tile;
}
function statePill(label, value) {
  return el('div', { class: 'state-pill' }, [el('b', {}, label), text(String(value).replace(/_/g, ' ').toLowerCase())]);
}

/* ---------------- purchase lines (the aggregated purchasing table) ---------------- */

function renderPurchaseLines(plan) {
  const box = document.getElementById('purchase-lines-section');
  clear(box);
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h3', {}, 'Purchasing needs (' + plan.purchase_lines.length + ' purchase line' + (plan.purchase_lines.length === 1 ? '' : 's') + ')'));
  panel.appendChild(
    el('p', { class: 'section-note' }, 'Compatible demand from every selected recipe is summed once, then packages are rounded once per line — never a sum of separately rounded per-recipe lists.')
  );
  if (!plan.purchase_lines.length) {
    panel.appendChild(el('p', { class: 'muted' }, 'No purchase lines yet: every row on this plan is unresolved for quantity.'));
    box.appendChild(panel);
    return;
  }
  const wrap = el('div', { class: 'table-wrap' });
  const table = el('table');
  table.appendChild(
    el('thead', {}, el('tr', {}, [
      el('th', {}, 'Product'),
      el('th', {}, 'Aggregated demand'),
      el('th', {}, 'Offer'),
      el('th', {}, 'Packages / purchased'),
      el('th', {}, 'Ingredient-use cost'),
      el('th', {}, 'Package commitment'),
      el('th', {}, 'Surplus (usability)'),
      el('th', {}, 'On-hand used'),
      el('th', {}, 'Fulfillment'),
    ]))
  );
  const tbody = el('tbody');
  for (const line of plan.purchase_lines) {
    tbody.appendChild(purchaseLineRow(line));
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
  panel.appendChild(wrap);
  box.appendChild(panel);
}

function purchaseLineRow(line) {
  const productCell = el('td', {}, [
    el('div', { class: 'mono' }, line.product_id),
    el('div', { class: 'muted small' }, 'basis ' + line.basis + (line.merged_strict_groups > 1 ? ' · ' + line.merged_strict_groups + ' compatible specs merged' : '')),
  ]);

  const demandCell = el('td', {}, line.aggregated_demand
    ? text(quantityDisplay(line.aggregated_demand))
    : el('span', { class: 'badge unknown' }, line.offer_status.reason || 'not aggregatable'));

  const offerCell = el('td', {}, renderOfferCell(line));

  const packagesCell = el('td', {}, renderPackagesCell(line));

  const useCostCell = el('td', {}, renderMoneyOrUnknown(line.costs.theoretical_ingredient_use_cost_money, line.costs.theoretical_ingredient_use_cost_reason || line.price_status));
  const commitCell = el('td', {}, renderMoneyOrUnknown(line.costs.package_merchandise_commitment_money, line.price_status));

  const surplusCell = el('td', {}, line.costs.arithmetic_surplus !== null
    ? [text(amountText(line.costs.arithmetic_surplus) + ' ' + (line.package_plan ? line.package_plan.unit : '')), el('br'), el('span', { class: 'badge unknown' }, 'usability: ' + line.costs.surplus_usability)]
    : el('span', { class: 'muted' }, 'not evaluated'));

  const onHandCell = el('td', {}, line.costs.known_on_hand_usage !== null && line.costs.known_on_hand_usage !== undefined
    ? text(line.costs.known_on_hand_usage + ' ' + (line.package_plan ? line.package_plan.unit : ''))
    : el('span', { class: 'badge unknown' }, line.inventory_state || 'UNKNOWN'));

  const fulfillCell = el('td', {}, el('span', { class: 'badge unknown' }, 'UNKNOWN'));

  return el('tr', {}, [productCell, demandCell, offerCell, packagesCell, useCostCell, commitCell, surplusCell, onHandCell, fulfillCell]);
}

function renderOfferCell(line) {
  if (!line.offer) {
    const status = line.offer_status || {};
    const label = OFFER_STATUS_LABELS[status.status] || status.status || 'no offer';
    const parts = [el('span', { class: 'badge gap' }, label)];
    if (status.reason) parts.push(el('div', { class: 'muted small' }, String(status.reason)));
    return parts;
  }
  const o = line.offer;
  return [
    el('div', {}, o.product_evidence.walmart_product_name),
    el('div', { class: 'muted small' }, 'item ' + o.product_evidence.walmart_item_id + ' · observed ' + formatDate(o.observed_at) + ' · ' + o.price_label + ' (not refreshed by opening this app)'),
  ];
}

const OFFER_STATUS_LABELS = {
  DEMAND_NOT_AGGREGATABLE: 'demand not aggregatable',
  NO_PRICE_SOURCE_FOR_PROFILE: 'no price source for this profile',
  NO_RECORDED_OBSERVATION_FOR_IDENTITY: 'no recorded observation',
  OFFER_HELD_BY_ADMISSION: 'held — not admitted',
  OFFER_NOT_APPLICABLE_TO_THIS_OCCURRENCE: 'not applicable to this occurrence',
  MULTIPLE_ADMISSIBLE_OFFERS_REQUIRE_SELECTION: 'multiple offers — needs owner selection',
  OFFER_RESOLVED: 'resolved',
};

function renderPackagesCell(line) {
  if (!line.package_plan || line.package_plan.status === 'GAP') {
    return el('span', { class: 'badge unknown' }, line.package_plan ? (line.package_plan.reason || 'GAP') : 'not evaluated');
  }
  const low = line.package_plan.low_demand_scenario;
  return [
    text(low.packages + ' package(s) → ' + low.purchased_amount + ' ' + line.package_plan.unit),
    line.package_plan.is_range ? el('div', { class: 'muted small' }, 'range scenario — see recipe detail') : null,
  ];
}

function renderMoneyOrUnknown(moneyObj, reason) {
  if (moneyObj) return text('$' + moneyObj.display_usd);
  return el('span', { class: 'badge unknown', title: reason || '' }, 'unknown' + (reason ? ' (' + String(reason).replace(/_/g, ' ').toLowerCase() + ')' : ''));
}

function quantityDisplay(q) {
  if (!q) return 'unknown';
  return (q.is_range ? q.min + '–' + q.max : q.display || q.min) + ' ' + q.unit;
}

/* ---------------- per-recipe ingredient detail, controls, gaps, evidence ---------------- */

function renderRecipesDetail(plan) {
  const box = document.getElementById('recipes-detail-section');
  clear(box);
  for (const recipeResult of plan.recipes) {
    const sel = state.selections.find((s) => s.recipe_id === recipeResult.recipe_id);
    box.appendChild(renderRecipeCard(recipeResult, sel, plan));
  }
}

function renderRecipeCard(recipeResult, sel, plan) {
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h3', {}, recipeResult.title || recipeResult.recipe_id));
  panel.appendChild(el('p', { class: 'muted small' }, (recipeResult.book || '') + (recipeResult.page ? ', p. ' + recipeResult.page : '')));

  if (recipeResult.status === 'RECIPE_NOT_FOUND') {
    panel.appendChild(el('p', {}, 'Recipe not found.'));
    return panel;
  }

  panel.appendChild(renderRecipeControls(recipeResult, sel));

  panel.appendChild(
    el('p', { class: 'section-note' }, 'Source yield as written: ' +
      (recipeResult.source_yield ? recipeResult.source_yield.raw || (recipeResult.source_yield.qty + ' ' + recipeResult.source_yield.unit) : (recipeResult.source_servings ? recipeResult.source_servings + ' servings' : 'not stated')) +
      '. ' + recipeResult.yield_note)
  );

  for (const member of recipeResult.members) {
    if (recipeResult.members.length > 1) {
      panel.appendChild(el('h4', {}, member.member.role === 'selected_recipe' ? 'This recipe' : 'Component: ' + member.member.title + ' (× ' + member.member.multiplier + ')'));
    }
    const rowsWrap = el('div', {});
    for (const row of member.rows) {
      rowsWrap.appendChild(renderIngredientRow(row, sel, member.member.recipe_id, plan));
    }
    panel.appendChild(rowsWrap);
  }

  return panel;
}

function renderRecipeControls(recipeResult, sel) {
  const wrap = el('div', { class: 'recipe-controls' });

  const portionsLabel = el('label', {}, [text('Portions'), ]);
  const portionsInput = el('input', {
    type: 'number', min: '0', step: 'any',
    placeholder: recipeResult.source_servings ? 'source: ' + recipeResult.source_servings : 'source states no serving count',
    disabled: !recipeResult.source_servings,
  });
  if (sel.portions !== null) portionsInput.value = sel.portions;
  portionsInput.addEventListener('input', (e) => {
    const v = e.target.value === '' ? null : Number(e.target.value);
    sel.portions = v;
    if (v !== null) sel.multiplier = null; // portions and multiplier are mutually exclusive
    scheduleRecalc();
  });
  portionsLabel.appendChild(portionsInput);

  const multiplierLabel = el('label', {}, [text('Scale multiplier ×')]);
  const multiplierInput = el('input', { type: 'number', min: '0', step: 'any', placeholder: '1' });
  if (sel.multiplier !== null) multiplierInput.value = sel.multiplier;
  multiplierInput.addEventListener('input', (e) => {
    const v = e.target.value === '' ? null : Number(e.target.value);
    sel.multiplier = v;
    if (v !== null) sel.portions = null;
    scheduleRecalc();
  });
  multiplierLabel.appendChild(multiplierInput);

  const optionalLabel = el('label', { class: 'checkbox-label' });
  const optionalCheckbox = el('input', { type: 'checkbox' });
  optionalCheckbox.checked = sel.include_optional;
  optionalCheckbox.addEventListener('change', (e) => { sel.include_optional = e.target.checked; recalcNow(); });
  optionalLabel.appendChild(optionalCheckbox);
  optionalLabel.appendChild(text('Include optional ingredients'));

  const multiplierBasis = el('div', { class: 'muted small' }, 'Basis used: ' + String(recipeResult.multiplier.basis).replace(/_/g, ' ').toLowerCase());

  wrap.appendChild(portionsLabel);
  wrap.appendChild(multiplierLabel);
  wrap.appendChild(optionalLabel);
  wrap.appendChild(multiplierBasis);
  return wrap;
}

function renderIngredientRow(row, sel, memberRecipeId, plan) {
  const rowEl = el('div', { class: 'ingredient-row' });
  const top = el('div', { class: 'ing-top' });
  top.appendChild(el('div', { class: 'ing-source' }, (row.source.raw || '(no source text on this row)') + (row.source.prep ? ' (' + row.source.prep + ')' : '')));

  const rightBadges = el('div', {});
  if (row.canonical_purchase) {
    rightBadges.appendChild(el('span', { class: 'badge ok' }, 'quantity: ' + quantityDisplay(row.canonical_purchase)));
  } else {
    rightBadges.appendChild(el('span', { class: 'badge gap' }, 'quantity: unresolved'));
  }
  top.appendChild(rightBadges);
  rowEl.appendChild(top);

  // Row-level price, if this occurrence contributes to a resolved purchase line.
  if (plan && plan.purchase_lines) {
    const line = plan.purchase_lines.find((l) =>
      l.contributing_occurrences.some((o) => o.recipe_id === memberRecipeId && o.ingredient_index === row.occurrence.ingredient_index)
    );
    if (line) {
      const priceNote = el('div', { class: 'muted small' }, 'Purchase line: ' + line.product_id + ' — ' +
        (line.costs.package_merchandise_commitment_money ? '$' + line.costs.package_merchandise_commitment_money.display_usd + ' package commitment' : 'no admitted price (' + (line.price_status || 'unpriced') + ')'));
      rowEl.appendChild(priceNote);
    }
  }

  if (row.gap) {
    rowEl.appendChild(renderGapBox(row, sel));
  }

  rowEl.appendChild(renderRowEvidence(row));
  return rowEl;
}

function renderGapBox(row, sel) {
  const box = el('div', { class: 'gap-box' });
  const family = row.gap.family || 'unclassified_gap';
  const reason = row.gap.reason || 'UNSPECIFIED';
  box.appendChild(el('span', { class: 'muted small' }, [el('b', {}, family.replace(/_/g, ' ')), text(reason.replace(/_/g, ' ').toLowerCase())]));
  if (row.gap.requires) box.appendChild(el('div', { class: 'small' }, 'Requires: ' + row.gap.requires));
  if (row.gap.detail) box.appendChild(el('div', { class: 'small' }, 'Detail: ' + safeDetail(row.gap.detail)));

  if (family === 'ingredient_choice') {
    box.appendChild(renderChoiceControl(row, sel));
  } else {
    box.appendChild(el('div', { class: 'small' }, 'Remedy family: ' + String(row.gap.remedy || 'NOT_CLASSIFIED').replace(/_/g, ' ').toLowerCase() + ' — not invented by this preview.'));
  }
  return box;
}

function safeDetail(detail) {
  try { return typeof detail === 'string' ? detail : JSON.stringify(detail); } catch { return String(detail); }
}

function renderChoiceControl(row, sel) {
  const idx = row.occurrence.ingredient_index;
  const alts = row.source.alternatives || [];
  if (alts.length) {
    const select = el('select', {});
    select.appendChild(el('option', { value: row.source.ingredient_id }, row.source.ingredient_id + ' (as written)'));
    for (const alt of alts) select.appendChild(el('option', { value: alt.id }, alt.id + ' (stated alternative)'));
    const current = (sel.choices[idx] || {}).ingredient_id || row.source.ingredient_id;
    select.value = current;
    select.addEventListener('change', (e) => {
      const chosenId = e.target.value;
      sel.choices[idx] = { ingredient_id: chosenId, scenario: 'user_selected_alternative_' + chosenId };
      // Also pre-supply the state-quantity confirmation the adapter asks for when the
      // chosen alternative changes the ingredient identity (harmless when not needed).
      const altMeta = alts.find((a) => a.id === chosenId);
      if (altMeta) sel.choice_occurrences[idx] = { id: chosenId, raw: altMeta.source_raw || row.source.raw, confirmed_source_choice: true };
      else delete sel.choice_occurrences[idx];
      recalcNow();
    });
    return el('div', { class: 'ing-controls' }, [el('span', { class: 'small' }, 'Choose:'), select]);
  }
  if (row.gap.reason === 'TEXT_ALTERNATIVE_REQUIRES_SOURCE_SCENARIO') {
    const btn = el('button', { type: 'button', class: 'btn small secondary' }, 'Use recipe text as written');
    btn.addEventListener('click', () => { sel.explicit_text_choice[idx] = true; recalcNow(); });
    return el('div', { class: 'ing-controls' }, btn);
  }
  return el('div', { class: 'small muted' }, 'This choice scenario (' + String(row.gap.reason || 'unspecified').toLowerCase() + ') has no selectable input supported by the shared evaluator in this preview; it stays an honest gap rather than a guess.');
}

/* ---------------- rule / offer evidence, behind progressive disclosure ---------------- */

function renderRowEvidence(row) {
  const details = el('details', { class: 'evidence' });
  details.appendChild(el('summary', {}, 'Source & rule evidence'));
  const body = el('div', { class: 'evidence-body' });

  body.appendChild(el('div', { class: 'small' }, 'Basis interpretation: ' + (row.interpretation.basis_interpretation.interpreted_basis || 'unknown') +
    ' — ' + row.interpretation.basis_interpretation.note));

  if (row.evidence_class) body.appendChild(el('div', { class: 'small' }, 'Evidence class: ' + row.evidence_class));

  const ruleIds = row.applicable_rule.rule_ids || [];
  if (ruleIds.length) {
    for (const rid of ruleIds) body.appendChild(renderRuleCard(rid));
  } else {
    body.appendChild(el('div', { class: 'small muted' }, 'No shared reviewed rule applied to this row.'));
  }
  if (row.applicable_rule.binding_id) body.appendChild(el('div', { class: 'small mono' }, 'binding: ' + row.applicable_rule.binding_id));

  details.appendChild(body);
  return details;
}

function renderRuleCard(ruleId) {
  const rule = (state.rulesDoc.rules || {})[ruleId];
  const card = el('div', { class: 'rule-card' });
  if (!rule) {
    card.appendChild(el('div', { class: 'small mono' }, ruleId + ' (not found in rules.json)'));
    return card;
  }
  card.appendChild(el('div', { class: 'small mono' }, rule.id + ' · ' + rule.kind + ' · ' + rule.status));
  if (rule.source) {
    card.appendChild(
      el('div', { class: 'small' }, (rule.source.title || 'unnamed source') + (rule.source.edition ? ' (' + rule.source.edition + ')' : '') +
        ', p. ' + (rule.source.printed_page || rule.source.physical_page || 'unknown') + (rule.source.table_or_entry ? ' — ' + rule.source.table_or_entry : ''))
    );
    if (rule.source.excerpt) card.appendChild(el('div', { class: 'small excerpt' }, '"' + rule.source.excerpt + '"'));
  }
  if (rule.uncertainty && rule.uncertainty.notes && rule.uncertainty.notes.length) {
    card.appendChild(el('div', { class: 'small muted' }, rule.uncertainty.notes.join(' ')));
  }
  return card;
}

/* ---------------- inventory entry (ENTERED_STOCK) ---------------- */

function renderInventoryEntry(plan) {
  const box = document.getElementById('inventory-entry-section');
  clear(box);
  if (state.inventory.scenario !== 'ENTERED_STOCK') return;
  const panel = el('div', { class: 'panel' });
  panel.appendChild(el('h3', {}, 'Entered stock'));
  panel.appendChild(el('p', { class: 'section-note' }, 'Enter what you actually have on hand for a product on this plan. Only entered products count as known stock; every other product stays UNKNOWN, never assumed zero or assumed sufficient.'));
  const productIds = Array.from(new Set(plan.purchase_lines.map((l) => l.product_id)));
  if (!productIds.length) {
    panel.appendChild(el('p', { class: 'muted small' }, 'No purchase lines yet to enter stock against.'));
    box.appendChild(panel);
    return;
  }
  for (const pid of productIds) {
    const line = plan.purchase_lines.find((l) => l.product_id === pid);
    const existing = state.inventory.items.find((i) => i.product_id === pid);
    const unit = (line.package_plan && line.package_plan.unit) || (line.aggregated_demand && line.aggregated_demand.unit) || '';
    const row = el('div', { class: 'stock-row' });
    row.appendChild(el('span', { class: 'mono' }, pid));
    const qtyInput = el('input', { type: 'number', min: '0', step: 'any', placeholder: '0' });
    if (existing) qtyInput.value = existing.qty;
    qtyInput.addEventListener('input', (e) => {
      const v = e.target.value === '' ? null : Number(e.target.value);
      state.inventory.items = state.inventory.items.filter((i) => i.product_id !== pid);
      if (v !== null && !Number.isNaN(v)) state.inventory.items.push({ product_id: pid, qty: v, unit: unit || 'each' });
      scheduleRecalc();
    });
    row.appendChild(qtyInput);
    row.appendChild(el('span', { class: 'muted small' }, unit || ''));
    panel.appendChild(row);
  }
  box.appendChild(panel);
}

/* ============================================ export ================================================ */

function buildExportObject(plan) {
  return {
    schema: 's1-preview-export-1',
    exported_at_utc: new Date().toISOString(),
    generation_id: state.generationId,
    generation_published_at_utc: state.publishedAt,
    pinned_dependency_revisions: state.versions,
    request: {
      selections: state.selections.map((s) => ({ recipe_id: s.recipe_id, portions: s.portions, multiplier: s.multiplier, include_optional: s.include_optional, choices: s.choices })),
      profile_id: state.profileId,
      preset_id: state.presetId,
      context: state.context,
      inventory: state.inventory,
    },
    plan: plan,
    note: 'Portable export from the Chef Smiley S1 local preview. All monetary figures came from evaluatePlan() in WORK/preview/lib/plan.js via the shared evaluator; nothing here was computed by this export step.',
  };
}

function renderExportSection(plan) {
  const box = document.getElementById('export-section');
  clear(box);
  const jsonBtn = el('button', { type: 'button', class: 'btn secondary' }, 'Download JSON');
  jsonBtn.addEventListener('click', () => {
    const obj = buildExportObject(plan);
    downloadBlob(JSON.stringify(obj, null, 2), 'application/json', fileNameFor('json'));
  });
  const readableBtn = el('button', { type: 'button', class: 'btn secondary' }, 'Download readable');
  readableBtn.addEventListener('click', () => {
    downloadBlob(buildReadableExport(plan), 'text/markdown', fileNameFor('md'));
  });
  box.appendChild(jsonBtn);
  box.appendChild(readableBtn);
}

function fileNameFor(ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return 'smiley-s1-plan-' + state.generationId + '-' + stamp + '.' + ext;
}

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function buildReadableExport(plan) {
  const lines = [];
  lines.push('# Chef Smiley S1 — plan export');
  lines.push('');
  lines.push('Generation: ' + state.generationId + ' (published ' + formatDate(state.publishedAt) + ')');
  lines.push('Profile: ' + plan.profile.label + ' — ' + plan.profile.note);
  lines.push('Context: ' + plan.context.label);
  lines.push('Inventory scenario: ' + plan.inventory_scenario);
  lines.push('Exported: ' + new Date().toISOString());
  lines.push('');
  lines.push('Pinned dependency revisions: ' + JSON.stringify(state.versions));
  lines.push('');
  lines.push('## Recipes');
  for (const r of plan.recipes) {
    lines.push('- ' + (r.title || r.recipe_id) + ' (' + r.book + ', p. ' + r.page + ') — multiplier basis: ' + r.multiplier.basis);
  }
  lines.push('');
  lines.push('## Purchasing needs');
  for (const line of plan.purchase_lines) {
    lines.push('### ' + line.product_id + ' (' + line.basis + ')');
    lines.push('- Aggregated demand: ' + (line.aggregated_demand ? quantityDisplay(line.aggregated_demand) : 'not aggregatable — ' + (line.offer_status.reason || '')));
    if (line.offer) {
      lines.push('- Offer: ' + line.offer.product_evidence.walmart_product_name + ' (item ' + line.offer.product_evidence.walmart_item_id + '), observed ' + formatDate(line.offer.observed_at) + ', ' + line.offer.price_label + ' — not refreshed by this app.');
    } else {
      lines.push('- Offer: ' + (OFFER_STATUS_LABELS[line.offer_status.status] || line.offer_status.status) + (line.offer_status.reason ? ' — ' + line.offer_status.reason : ''));
    }
    lines.push('- Theoretical ingredient-use cost: ' + (line.costs.theoretical_ingredient_use_cost_money ? '$' + line.costs.theoretical_ingredient_use_cost_money.display_usd : 'unknown') + ' (cost of the amount actually used, at the recorded package unit rate — not a checkout charge)');
    lines.push('- Package merchandise commitment: ' + (line.costs.package_merchandise_commitment_money ? '$' + line.costs.package_merchandise_commitment_money.display_usd : 'unknown') + ' (what the admitted packages themselves would cost as merchandise)');
    lines.push('- Arithmetic surplus: ' + (line.costs.arithmetic_surplus !== null ? amountText(line.costs.arithmetic_surplus) : 'not evaluated') + ' — usability: ' + line.costs.surplus_usability + ' (unknown is never assumed usable or unusable)');
    lines.push('- Known on-hand usage: ' + (line.costs.known_on_hand_usage !== null && line.costs.known_on_hand_usage !== undefined ? line.costs.known_on_hand_usage : 'UNKNOWN'));
    lines.push('- Fulfillment: UNKNOWN for every recorded offer.');
    lines.push('');
  }
  lines.push('## Totals');
  const totals = plan.totals;
  lines.push('- Theoretical ingredient-use cost subtotal: ' + (totals.theoretical_ingredient_use_cost.known_line_subtotal_money ? '$' + totals.theoretical_ingredient_use_cost.known_line_subtotal_money.display_usd : 'unknown') + ' — ' + totals.theoretical_ingredient_use_cost.meaning);
  lines.push('- Package merchandise commitment subtotal: ' + (totals.package_merchandise_commitment.known_line_subtotal_money ? '$' + totals.package_merchandise_commitment.known_line_subtotal_money.display_usd : 'unknown') + ' — ' + totals.package_merchandise_commitment.meaning);
  lines.push('- All-in checkout total: unknown — ' + totals.all_in_checkout_reason);
  lines.push('');
  lines.push('## Significant gaps');
  let gapCount = 0;
  for (const r of plan.recipes) {
    for (const m of r.members) {
      for (const row of m.rows) {
        if (row.gap) {
          gapCount++;
          lines.push('- [' + r.title + '] ' + row.source.raw + ' — ' + row.gap.family + ' / ' + row.gap.reason);
        }
      }
    }
  }
  if (!gapCount) lines.push('- None on this plan.');
  lines.push('');
  lines.push('_Production guidance and safety are not modelled anywhere in this preview. Arithmetic scaling of source quantities does not certify cooked yield, cooking time, or safety readiness._');
  return lines.join('\n');
}

/* ============================================ snapshots ================================================ */

function onSaveSnapshot() {
  if (!state.currentPlan || state.currentPlan.status !== 'COMPUTED') return;
  const snap = SmileyS1.snapshot.createSnapshot({
    plan: state.currentPlan,
    versions: state.versions,
    generation_id: state.generationId,
    label: state.selections.map((s) => (state.indexById.get(s.recipe_id) || {}).title || s.recipe_id).join(' + '),
  });
  state.snapshots.push(snap);
  renderSnapshots();
  showToast('Snapshot saved: ' + snap.snapshot_id);
}

function renderSnapshots() {
  const list = document.getElementById('snapshots-list');
  clear(list);
  if (!state.snapshots.length) {
    list.appendChild(text('No snapshots saved yet this session.'));
    return;
  }
  for (const snap of state.snapshots.slice().reverse()) {
    const card = el('div', { class: 'snapshot-card' });
    card.appendChild(el('div', {}, [el('b', {}, snap.label || snap.snapshot_id)]));
    card.appendChild(el('div', { class: 'muted' }, snap.snapshot_id));
    card.appendChild(el('div', { class: 'muted' }, 'pinned generation: ' + snap.pinned_revisions.generation_id));
    card.appendChild(el('div', { class: 'muted' }, 'saved: ' + formatDate(snap.created_at_utc)));
    const totals = snap.result.totals;
    card.appendChild(
      el(
        'div',
        {},
        'use cost: ' + (totals.theoretical_ingredient_use_cost.known_line_subtotal_money ? '$' + totals.theoretical_ingredient_use_cost.known_line_subtotal_money.display_usd : 'unknown') +
          ' · commitment: ' + (totals.package_merchandise_commitment.known_line_subtotal_money ? '$' + totals.package_merchandise_commitment.known_line_subtotal_money.display_usd : 'unknown')
      )
    );
    card.appendChild(el('div', { class: 'muted small' }, 'This value is pinned and does not change on "Refresh current data".'));
    const dlBtn = el('button', { type: 'button', class: 'btn small secondary' }, 'Download JSON');
    dlBtn.addEventListener('click', () => downloadBlob(JSON.stringify(snap, null, 2), 'application/json', 'smiley-s1-snapshot-' + snap.snapshot_id + '.json'));
    card.appendChild(dlBtn);
    list.appendChild(card);
  }
}

/* wrap onSaveSnapshot's render call so the list refreshes even though renderSnapshots is
   defined after onSaveSnapshot in source order (fine under function hoisting, kept for clarity) */

boot();
