/* =============================================================================
 * data.js — loading and evaluator wiring for Constellation V01.
 *
 * Every number this prototype shows comes from the unchanged accepted S1 v1.1
 * evaluator (SmileyS1.plan.createEvaluator over SmileyQuantity + SmileyCorpus).
 * Nothing here converts, rounds, scales or totals anything itself.
 *
 * Method text comes from source-methods.json, kept in a separate map from the
 * evaluator's source recipe objects so the two can never be confused.
 * ========================================================================== */
(function (global) {
  'use strict';

  var REF = '/reference/data';

  var state = {
    genPath: null,
    generationId: null,
    publishedAt: null,
    index: null,
    indexById: new Map(),
    manifest: null,
    reviewedRules: null,
    bindings: null,
    ledger: null,
    versions: null,
    shardCache: new Map(),
    recipeSourceById: new Map(),
    evaluator: null,
    methodsById: new Map(),
    methodsMeta: null,
    sourceMethodsSha256: null,
    ingredientToRecipes: new Map(),   // ingredient_id -> [recipe_id]
    ingredientCounts: new Map(),      // ingredient_id -> membership count
    pantryIds: new Set(),
    pantryThreshold: 200,
    books: [],
    courses: [],
    cuisines: [],
    anchors: []
  };

  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Fetch failed (' + res.status + '): ' + url);
      return res.json();
    });
  }

  /* Mirrors the accepted S1 UI's buildVersions: it maps generation manifest
     dependencies onto the field names the shared snapshot module expects. It is
     bookkeeping, not arithmetic. */
  function buildVersions(manifest) {
    var deps = manifest.dependencies || {};
    var ev = deps.evaluator || {};
    return {
      generation_id: manifest.generation_id,
      generated_at_utc: manifest.generated_at_utc,
      recipe_runtime_sha256: (deps.recipe_runtime || {}).sha256 || null,
      rule_registry_sha256: (deps.rule_registry || {}).sha256 || null,
      accepted_bindings_sha256: (deps.accepted_bindings || {}).sha256 || null,
      occurrence_bindings_sha256: (deps.accepted_bindings || {}).sha256 || null,
      binding_overlay_sha256: (deps.binding_overlay || {}).sha256 || null,
      binding_overlay_version: (deps.binding_overlay || {}).version || null,
      price_observations_sha256: (deps.price_observations || {}).sha256 || null,
      price_admission_ledger_sha256: (deps.price_admission_ledger || {}).sha256 || null,
      quantity_engine_sha256: ev.quantity_engine_sha256 || null,
      corpus_adapter_sha256: ev.corpus_adapter_sha256 || null,
      evaluator_version: ev.quantity_engine || null,
      s1_preview_api: ev.s1_preview_api || null
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
      versions: state.versions
    });
  }

  function sha256Hex(buffer) {
    if (!global.crypto || !global.crypto.subtle) return Promise.resolve(null);
    return global.crypto.subtle.digest('SHA-256', buffer).then(function (digest) {
      var bytes = new Uint8Array(digest);
      var out = '';
      for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
      return out;
    }).catch(function () { return null; });
  }

  function loadSourceMethods() {
    return fetch('/source-methods.json', { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Fetch failed (' + res.status + '): /source-methods.json');
      return res.arrayBuffer();
    }).then(function (buf) {
      var doc = JSON.parse(new TextDecoder().decode(buf));
      state.methodsMeta = {
        schema: doc.schema,
        kind: doc.kind,
        source_member: doc.source_member,
        source_runtime_sha256: doc.source_runtime_sha256,
        display_policy: doc.display_policy,
        recipe_count: doc.recipe_count,
        method_step_count: doc.method_step_count,
        not_new_extraction: doc.not_new_extraction,
        not_new_semantic_or_safety_approval: doc.not_new_semantic_or_safety_approval
      };
      state.methodsById = new Map(doc.recipes.map(function (r) { return [r.recipe_id, r]; }));
      return sha256Hex(buf);
    }).then(function (hex) {
      state.sourceMethodsSha256 = hex;
    });
  }

  /* Membership index: recipe -> listed ingredient entries, inverted.
     This is direct ingredient-list membership. It is NOT flavor affinity,
     compatibility, or proof that an ingredient is mandatory. */
  function buildMembership() {
    state.ingredientToRecipes = new Map();
    state.ingredientCounts = new Map();
    state.index.recipes.forEach(function (row) {
      (row.ingredient_ids || []).forEach(function (ing) {
        if (!state.ingredientToRecipes.has(ing)) state.ingredientToRecipes.set(ing, []);
        state.ingredientToRecipes.get(ing).push(row.recipe_id);
        state.ingredientCounts.set(ing, (state.ingredientCounts.get(ing) || 0) + 1);
      });
    });
    state.pantryIds = new Set();
    state.ingredientCounts.forEach(function (count, ing) {
      if (count >= state.pantryThreshold) state.pantryIds.add(ing);
    });
    var books = new Set(), courses = new Set(), cuisines = new Set(), anchors = new Set();
    state.index.recipes.forEach(function (r) {
      if (r.book) books.add(r.book);
      if (r.course) courses.add(r.course);
      if (r.cuisine) cuisines.add(r.cuisine);
      if (r.anchor) anchors.add(r.anchor);
    });
    state.books = Array.from(books).sort();
    state.courses = Array.from(courses).sort();
    state.cuisines = Array.from(cuisines).sort();
    state.anchors = Array.from(anchors).sort();
  }

  /**
   * The library query. Facets compose over the WHOLE 1,497-record index, never
   * over whatever the relationship map happens to be drawing.
   *
   * Ingredient include/exclude match listed source ingredient entries by id.
   * That is list membership only: it is not an allergy, cross-contact, vegan or
   * any other dietary certification, and the UI says so wherever it is offered.
   */
  function filterLibrary(opts) {
    var o = opts || {};
    var q = String(o.query || '').trim().toLowerCase();
    var include = o.include || [];
    var exclude = o.exclude || [];
    var rows = state.index.recipes.filter(function (r) {
      if (q && (r.search_text || '').indexOf(q) < 0 && r.recipe_id.indexOf(q) < 0) return false;
      if (o.book && r.book !== o.book) return false;
      if (o.course && r.course !== o.course) return false;
      if (o.cuisine && r.cuisine !== o.cuisine) return false;
      if (include.length && !include.every(function (i) { return (r.ingredient_ids || []).indexOf(i) >= 0; })) return false;
      if (exclude.length && exclude.some(function (i) { return (r.ingredient_ids || []).indexOf(i) >= 0; })) return false;
      return true;
    });
    var sort = o.sort || 'title';
    rows.sort(function (a, b) {
      if (sort === 'title-desc') return b.title.localeCompare(a.title);
      if (sort === 'book') return (a.book || '').localeCompare(b.book || '') || a.title.localeCompare(b.title);
      return a.title.localeCompare(b.title);
    });
    return rows;
  }

  function hasRecipe(recipeId) { return state.indexById.has(recipeId); }

  function load() {
    return fetchJson(REF + '/current.json').then(function (current) {
      state.generationId = current.generation_id;
      state.publishedAt = current.published_at_utc;
      state.genPath = REF + '/' + current.path;
      return Promise.all([
        fetchJson(state.genPath + '/index.json'),
        fetchJson(state.genPath + '/GENERATION-MANIFEST.json'),
        fetchJson(state.genPath + '/reviewed-rules.json'),
        fetchJson(state.genPath + '/occurrence-bindings.json'),
        fetchJson(state.genPath + '/admission-ledger.json'),
        loadSourceMethods()
      ]);
    }).then(function (docs) {
      state.index = docs[0];
      state.indexById = new Map(state.index.recipes.map(function (r) { return [r.recipe_id, r]; }));
      state.manifest = docs[1];
      state.reviewedRules = docs[2];
      state.bindings = docs[3];
      state.ledger = docs[4];
      state.versions = buildVersions(state.manifest);
      buildMembership();
      rebuildEvaluator();
      return state;
    });
  }

  function ensureRecipeLoaded(recipeId) {
    if (state.recipeSourceById.has(recipeId)) return Promise.resolve();
    var row = state.indexById.get(recipeId);
    if (!row) return Promise.reject(new Error('Unknown recipe id: ' + recipeId));
    var shardKey = String(row.shard).padStart(2, '0');
    var cached = state.shardCache.get(shardKey);
    var shardPromise = cached ? Promise.resolve(cached) : fetchJson(state.genPath + '/shards/' + shardKey + '.json').then(function (shard) {
      state.shardCache.set(shardKey, shard);
      return shard;
    });
    return shardPromise.then(function (shard) {
      var rec = shard.recipes[recipeId];
      if (!rec) throw new Error('Recipe not present in shard ' + shardKey + ': ' + recipeId);
      state.recipeSourceById.set(recipeId, rec.source);
      rebuildEvaluator();
    });
  }

  function sourceRecipe(recipeId) { return state.recipeSourceById.get(recipeId) || null; }
  function method(recipeId) { return state.methodsById.get(recipeId) || null; }

  /* Search across ALL 1,497 index records — never a subset, and never limited
     by whatever the constellation happens to be drawing. */
  function searchRecipes(query, limit) {
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var out = [];
    var rows = state.index.recipes;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var hay = r.search_text || '';
      if (hay.indexOf(q) >= 0 || r.recipe_id.indexOf(q) >= 0) {
        out.push(r);
        if (limit && out.length >= limit) break;
      }
    }
    return out;
  }

  function searchIngredients(query, limit) {
    var q = String(query || '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!q) return [];
    var out = [];
    var it = state.ingredientCounts.keys();
    var next = it.next();
    while (!next.done) {
      if (next.value.indexOf(q) >= 0) {
        out.push({ ingredient_id: next.value, count: state.ingredientCounts.get(next.value) });
        if (limit && out.length >= limit) break;
      }
      next = it.next();
    }
    out.sort(function (a, b) { return b.count - a.count; });
    return out;
  }

  function recipesWithIngredient(ingredientId) {
    return state.ingredientToRecipes.get(ingredientId) || [];
  }

  /* All shown money/quantity values come from this one call. */
  function evaluatePlan(request) {
    return state.evaluator.evaluatePlan(request);
  }

  global.SmileyData = {
    state: state,
    load: load,
    ensureRecipeLoaded: ensureRecipeLoaded,
    sourceRecipe: sourceRecipe,
    method: method,
    searchRecipes: searchRecipes,
    searchIngredients: searchIngredients,
    recipesWithIngredient: recipesWithIngredient,
    filterLibrary: filterLibrary,
    hasRecipe: hasRecipe,
    evaluatePlan: evaluatePlan
  };
})(window);
