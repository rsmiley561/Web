/* =============================================================================
 * ui.js — V02 shell: neutral home, user-controlled library search, quick look,
 * full-page recipe, plan, contextual preferences, printing.
 *
 * Presentation only. Every quantity, package and money figure comes from the
 * unchanged accepted evaluator; formatting goes through SmileyPresenter, which
 * is shared with the print document. No second conversion, scaling, yield or
 * cost implementation lives here.
 *
 * Source text is inserted with textContent only — never as HTML.
 * ========================================================================== */
(function () {
  'use strict';

  var P = window.SmileyPresenter;

  /* ------------------------------------------------------------ tiny helpers */

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = String(v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, String(v));
      }
    }
    appendAll(node, children);
    return node;
  }

  function appendAll(node, children) {
    if (children === null || children === undefined) return node;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function $(id) { return document.getElementById(id); }
  function humanize(v) { return String(v === null || v === undefined ? '' : v).replace(/_/g, ' ').toLowerCase(); }
  function isMobile() { return window.matchMedia('(max-width: 860px)').matches; }

  function formatDate(iso) {
    if (!iso) return 'unknown date';
    try { return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; } catch (e) { return String(iso); }
  }

  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.style.borderColor = isError ? '#8a2f26' : '';
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 4200);
  }

  /* ------------------------------------------------------------------- state */

  var S = {
    route: 'home',
    history: [],
    // library query state — the single shared query, committed only by the user
    query: '',
    facets: { cuisine: '', course: '', book: '', include: [], exclude: [], sort: 'title' },
    page: 0,
    pageSize: 24,
    libScroll: 0,

    suggestions: [],
    suggestIndex: -1,

    drawerId: null,          // quick look, independent of plan membership
    recipeId: null,          // full page, independent of plan membership
    recipeTab: 'cooking',
    lastRecipeId: null,      // only for an explicit "Return to last recipe"

    planIds: [],
    selById: new Map(),
    profileId: 'retail-walmart-33445-recorded',
    presetId: null,
    context: 'home',
    inventory: { scenario: 'UNKNOWN', items: [] },

    results: new Map(),      // recipe_id -> single-recipe evaluation
    planResult: null,
    snapshots: [],
    prefDismissed: false,
    printModel: null,
    lastFocus: null,
    lastNeighborhood: null
  };

  function selectionFor(recipeId) {
    if (!S.selById.has(recipeId)) {
      S.selById.set(recipeId, {
        recipe_id: recipeId, portions: null, multiplier: null,
        choices: {}, choice_occurrences: {}, explicit_text_choice: {}, include_optional: false
      });
    }
    return S.selById.get(recipeId);
  }

  function requestFor(recipeIds) {
    return {
      selections: recipeIds.map(function (id) {
        var s = selectionFor(id);
        return {
          recipe_id: s.recipe_id,
          portions: s.portions === null ? undefined : s.portions,
          multiplier: s.multiplier === null ? undefined : s.multiplier,
          choices: s.choices,
          choice_occurrences: s.choice_occurrences,
          explicit_text_choice: s.explicit_text_choice,
          include_optional: s.include_optional
        };
      }),
      profile_id: S.profileId,
      preset_id: S.presetId,
      context: S.context,
      inventory: S.inventory
    };
  }

  var recalcToken = 0;
  function recalc() {
    var token = ++recalcToken;
    var needed = S.planIds.slice();
    [S.recipeId, S.drawerId].forEach(function (id) { if (id && needed.indexOf(id) < 0) needed.push(id); });
    return Promise.all(needed.map(function (id) { return SmileyData.ensureRecipeLoaded(id); }))
      .then(function () {
        if (token !== recalcToken) return;
        S.results = new Map();
        needed.forEach(function (id) { S.results.set(id, SmileyData.evaluatePlan(requestFor([id]))); });
        S.planResult = S.planIds.length ? SmileyData.evaluatePlan(requestFor(S.planIds)) : null;
      })
      .catch(function (e) {
        if (token !== recalcToken) return;
        console.error(e);
        toast('Evaluation failed: ' + e.message, true);
      });
  }

  var debounceTimer = null;
  function scheduleRecalc() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(function () { recalc().then(render); }, 200);
  }

  function resultFor(recipeId) { return S.results.get(recipeId) || null; }
  function recipeResultOf(result, recipeId) {
    if (!result || !result.recipes) return null;
    return result.recipes.filter(function (r) { return r.recipe_id === recipeId; })[0] || null;
  }
  function selectedRows(rr) {
    var rows = [];
    (rr && rr.members || []).forEach(function (m) {
      if (m.member.role !== 'selected_recipe') return;
      rows = rows.concat(m.rows || []);
    });
    return rows;
  }

  /* ---------------------------------------------------------------- routing */

  var ROUTES = ['home', 'library', 'recipe', 'plan', 'map'];

  function routeFocus() {
    var target = document.querySelector('#view-' + S.route + ' h1') || $('view-' + S.route);
    target.setAttribute('tabindex', '-1'); target.focus({preventScroll: true});
  }
  function snapshotRoute() {
    return {
      route: S.route, query: S.query, facets: JSON.parse(JSON.stringify(S.facets)),
      page: S.page, libScroll: S.libScroll, recipeId: S.recipeId, recipeTab: S.recipeTab,
      drawerId: S.drawerId
    };
  }

  function goto(route, opts) {
    if (S.route === 'library') S.libScroll = $('view-library').scrollTop;
    S.history.push(snapshotRoute());
    if (S.history.length > 40) S.history.shift();
    apply(route, opts);
    routeFocus();
  }

  function apply(route, opts) {
    opts = opts || {};
    S.route = route;
    document.body.dataset.route = route;
    if (opts.recipeId !== undefined) S.recipeId = opts.recipeId;
    if (opts.recipeTab !== undefined) S.recipeTab = opts.recipeTab;
    ROUTES.forEach(function (r) { $('view-' + r).hidden = r !== route; });
    Array.prototype.forEach.call(document.querySelectorAll('.navbtn[data-route]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-route') === route));
    });
    render();
    if (route === 'library') $('view-library').scrollTop = opts.restoreScroll ? S.libScroll : 0;
    else if ($('view-' + route).scrollTop !== undefined && !opts.keepScroll) $('view-' + route).scrollTop = 0;
  }

  /** Back restores the previous view together with its query, filters, page and scroll. */
  function back() {
    var prev = S.history.pop();
    if (!prev) { apply('home'); return; }
    S.query = prev.query;
    S.facets = prev.facets;
    S.page = prev.page;
    S.libScroll = prev.libScroll;
    S.recipeId = prev.recipeId;
    S.recipeTab = prev.recipeTab;
    S.drawerId = prev.drawerId;
    $('search-input').value = S.query;
    syncFacetControls();
    apply(prev.route, { restoreScroll: true });
    routeFocus();
  }

  /* Keyboard focus returns to whatever opened a drawer, sheet or preview, so
     closing one never dumps focus at the top of the document. */
  function rememberFocus() {
    var a = document.activeElement;
    if (a && a !== document.body) S.lastFocus = a;
  }

  function restoreFocus() {
    var a = S.lastFocus;
    S.lastFocus = null;
    if (a && document.contains(a) && typeof a.focus === 'function') a.focus();
  }

  /* ------------------------------------------------------------- plan tray */

  function inPlan(id) { return S.planIds.indexOf(id) >= 0; }

  function addToPlan(id) {
    if (inPlan(id)) return;
    S.planIds.push(id);
    selectionFor(id);
    recalc().then(function () {
      render();
      toast('Added to plan (this session): ' + ((SmileyData.state.indexById.get(id) || {}).title || id));
    });
  }

  function removeFromPlan(id) {
    S.planIds = S.planIds.filter(function (x) { return x !== id; });
    recalc().then(function(){render(); toast('Removed from plan (this session).');});
  }

  function renderTray() {
    var tray = $('plan-tray');
    tray.hidden = S.planIds.length === 0;
    var chips = $('tray-chips');
    clear(chips);
    S.planIds.forEach(function (id) {
      var row = SmileyData.state.indexById.get(id) || {};
      var chip = el('span', { class: 'chip' }, [row.title || id]);
      chip.appendChild(el('button', {
        type: 'button', text: '×', 'aria-label': 'Remove ' + (row.title || id) + ' from plan',
        onclick: function () { removeFromPlan(id); }
      }));
      chips.appendChild(chip);
    });
    [$('nav-plan-count'), $('bottom-plan-count')].forEach(function (n) {
      if (!n) return;
      n.textContent = String(S.planIds.length);
      n.hidden = S.planIds.length === 0;
    });
    $('home-plan').hidden = S.planIds.length === 0;
    $('home-resume').hidden = !S.lastRecipeId;
  }

  /* ------------------------------------------------------------------ cards */

  function sourceCue(row) {
    return row.book || [row.cuisine, row.course].filter(Boolean).join(' · ') || '';
  }

  function yieldLine(row) { return SmileyYield.line(row.recipe_id); }

  function recipeCard(recipeId) {
    var row = SmileyData.state.indexById.get(recipeId);
    if (!row) return el('div', { class: 'panel', text: 'Unknown recipe: ' + recipeId });
    var art = SmileyArt.cardArt(recipeId, row);
    var card = el('article', { class: 'rcard' });
    card.setAttribute('data-recipe-id', recipeId);
    card.setAttribute('data-art-treatment', art.treatment);

    var artWrap = el('div', { class: 'rcard-art' });
    artWrap.appendChild(art.svg);
    card.appendChild(artWrap);

    var body = el('div', { class: 'rcard-body' }, [
      el('h3', { class: 'rcard-title', text: row.title }),
      el('p', { class: 'rcard-cue', text: sourceCue(row) }),
      el('p', { class: 'rcard-yield', text: yieldLine(row) })
    ]);
    body.appendChild(el('div', { class: 'rcard-actions' }, [
      el('button', { type: 'button', class: 'primary small', text: 'Quick look', onclick: function () { openDrawer(recipeId); } }),
      el('button', { type: 'button', class: 'secondary small', text: 'Open recipe', onclick: function () { openRecipe(recipeId); } }),
      el('button', {
        type: 'button', class: 'secondary small' + (inPlan(recipeId) ? ' in-plan' : ''),
        text: inPlan(recipeId) ? 'In plan ✓' : 'Add to plan',
        onclick: function () { inPlan(recipeId) ? removeFromPlan(recipeId) : addToPlan(recipeId); }
      })
    ]));
    card.appendChild(body);
    return card;
  }

  /* ------------------------------------------------------- shared recipe UI */

  function ingredientLineNode(row, opts) {
    var line = P.cookingLine(row);
    var node = el('li', { class: 'ing' + (line.optionalNotSelected ? ' ing-optional' : '') });
    node.setAttribute('data-ingredient-index', String(line.index));
    if (line.amount) node.setAttribute('data-cooking-amount', line.amount.text);

    var main = el('div', { class: 'ing-main' });
    if (line.amount) {
      main.appendChild(el('span', { class: 'ing-amt', text: line.amount.text }));
      main.appendChild(document.createTextNode(' '));
      main.appendChild(el('span', { class: 'ing-name', text: line.name }));
      if (line.prep) main.appendChild(el('span', { class: 'ing-prep', text: ', ' + line.prep }));
    } else {
      // No scalable number in the source: its own wording carries the amount.
      main.appendChild(el('span', { class: 'ing-name', text: line.sourceText }));
      main.appendChild(el('span', { class: 'ing-qual', text: ' — ' + line.displayQualification }));
    }
    if (line.optionalNotSelected) main.appendChild(el('span', { class: 'ing-qual', text: ' (optional — not included)' }));
    node.appendChild(main);

    if (opts && opts.showSource && line.amount && line.sourceText) {
      var evidence = el('details', {class: 'ing-source'});
      evidence.appendChild(el('summary', {text: 'Source line'}));
      evidence.appendChild(el('p', {text: line.sourceText}));
      node.appendChild(evidence);
    }
    if (line.chosenAlternative) {
      node.appendChild(el('div', { class: 'ing-qual small', text: 'Your choice: ' + line.chosenAlternative.replace(/-/g, ' ') }));
    }
    return node;
  }

  function ingredientSections(rows, opts) {
    var wrap = el('div', { class: 'ing-sections' });
    P.groupSections(rows).forEach(function (sec) {
      var block = el('section', { class: 'ing-group' });
      if (sec.heading) {
        block.id = 'group-' + encodeURIComponent(sec.heading);
        block.appendChild(el('h3', { class: 'ing-h3', text: sec.heading }));
      }
      var ul = el('ul', { class: 'ing-list' });
      sec.rows.forEach(function (r) { ul.appendChild(ingredientLineNode(r, opts)); });
      block.appendChild(ul);
      wrap.appendChild(block);
    });
    return wrap;
  }

  function purchasingHeldNote(rows) {
    var held = rows.filter(function (r) { return !r.canonical_purchase; }).length;
    if (!held) return null;
    return el('p', {
      class: 'section-note',
      text: P.PURCHASING_NOTE + ' — ' + held + ' of ' + rows.length +
        ' rows. That is a purchasing gap; the cooking amounts above are unaffected. See Purchasing & cost.'
    });
  }

  function timingBlock(source, method) {
    var t = P.timingStatement(source);
    var wrap = el('div', { class: 'timing' });
    wrap.appendChild(el('p', { class: 'section-note', text: t.text }));
    var ex = P.durationExcerpts(method, 3);
    if (ex.length) {
      wrap.appendChild(el('p', { class: 'section-note', text: 'Durations the method itself states:' }));
      var ul = el('ul', { class: 'quote-list' });
      ex.forEach(function (e) { ul.appendChild(el('li', { text: 'Step ' + e.stepNumber + ': “' + e.excerpt + '”' })); });
      wrap.appendChild(ul);
      wrap.appendChild(el('p', { class: 'section-note tiny', text: 'Quoted from the source method. Not added up, not scaled, not split into prep and cook.' }));
    }
    return wrap;
  }

  function componentsBlock(source) {
    var comps = P.componentLinks(source, SmileyData.hasRecipe);
    if (!comps.length) return null;
    var wrap = el('section', { class: 'panel' });
    wrap.appendChild(el('h3', { text: 'Referenced components (' + comps.length + ')' }));
    comps.forEach(function (c) {
      var row = el('div', { class: 'ing' });
      row.appendChild(el('div', { class: 'ing-main' }, el('span', { class: 'ing-name', text: c.raw })));
      if (c.available) {
        row.appendChild(el('button', {
          type: 'button', class: 'secondary small', text: 'Open ' + ((SmileyData.state.indexById.get(c.id) || {}).title || c.id),
          onclick: function () { openRecipe(c.id); }
        }));
      } else {
        row.appendChild(el('div', { class: 'ing-qual', text: 'Unavailable — the source names it, but no matching recipe id exists in this library. No link is guessed from the title.' }));
      }
      wrap.appendChild(row);
    });
    wrap.appendChild(el('p', { class: 'section-note tiny', text: 'Components are separate records. They are never folded into this recipe’s amounts, so nothing is counted twice.' }));
    return wrap;
  }

  /* ------------------------------------------------------------- quick look */

  /* Opening or closing the quick look repaints the drawer and the tray only.
     Rebuilding the whole view would destroy the card button you came from, and
     with it the element focus should return to. */
  function drawerRepaint() { renderDrawer(); renderTray(); }

  function openDrawer(recipeId) {
    rememberFocus();
    S.drawerId = recipeId;
    SmileyData.ensureRecipeLoaded(recipeId).then(recalc).then(drawerRepaint)
      .catch(function (e) { toast('Could not load recipe: ' + e.message, true); });
    drawerRepaint();
    $('drawer-close').focus({preventScroll:true});
  }

  function closeDrawer() { S.drawerId = null; drawerRepaint(); restoreFocus(); }

  function renderDrawer() {
    var host = $('drawer');
    var body = $('drawer-body');
    clear(body);
    if (!S.drawerId) { host.hidden = true; return; }
    host.hidden = false;

    var id = S.drawerId;
    var row = SmileyData.state.indexById.get(id) || {};
    var source = SmileyData.sourceRecipe(id);
    var methodDoc = SmileyData.method(id);
    var method = methodDoc ? methodDoc.method : [];
    var result = resultFor(id);
    var rr = recipeResultOf(result, id);
    var rows = selectedRows(rr);

    var art = SmileyArt.cardArt(id, row);
    var head = el('div', { class: 'rcard' });
    var artWrap = el('div', { class: 'rcard-art' });
    artWrap.appendChild(art.svg);
    head.appendChild(artWrap);
    head.appendChild(el('div', { class: 'rcard-body' }, [
      el('h2', { class: 'rcard-title', text: row.title || id }),
      el('p', { class: 'rcard-cue', text: sourceCue(row) }),
      el('p', { class: 'rcard-yield', text: yieldLine(row) })
    ]));
    body.appendChild(head);

    body.appendChild(el('div', { class: 'drawer-actions' }, [
      el('button', { type: 'button', class: 'primary', text: 'Open recipe', onclick: function () { openRecipe(id); } }),
      el('button', {
        type: 'button', class: 'secondary' + (inPlan(id) ? ' in-plan' : ''),
        text: inPlan(id) ? 'In plan ✓' : 'Add to plan',
        onclick: function () { inPlan(id) ? removeFromPlan(id) : addToPlan(id); }
      }),
      el('button', { type: 'button', class: 'secondary', text: 'Print', onclick: function () { openPrint({ recipeIds: [id] }); } }),
      el('button', { type: 'button', class: 'secondary', text: 'Explore connections', onclick: function () { exploreConnections({ type: 'recipe', id: id }); } })
    ]));

    if (!source) { body.appendChild(el('p', { class: 'section-note', text: 'Loading the source record…' })); return; }

    var ov = P.overview(source, method);
    var overviewPanel = el('section', { class: 'panel' });
    overviewPanel.appendChild(el('h3', { text: 'Overview' }));
    var facts = [];
    if (ov.yieldText) facts.push('Yield as written: ' + ov.yieldText);
    facts.push(ov.ingredientCount + ' ingredient rows');
    facts.push(ov.stepCount + ' method steps');
    if (ov.sections.length) facts.push('Sections: ' + ov.sections.join(', '));
    if (ov.componentCount) facts.push(ov.componentCount + ' referenced component(s)');
    overviewPanel.appendChild(el('p', { text: facts.join(' · ') }));
    overviewPanel.appendChild(el('p', { class: 'section-note tiny', text: ov.note }));
    body.appendChild(overviewPanel);

    var ingPanel = el('section', { class: 'panel' });
    ingPanel.appendChild(el('h3', { text: 'Ingredients' }));
    if (rows.length) {
      var preview = rows.slice(0, 6);
      ingPanel.appendChild(ingredientSections(preview));
      if (rows.length > preview.length) {
        ingPanel.appendChild(el('p', { class: 'section-note', text: 'Showing ' + preview.length + ' of ' + rows.length + ' rows. Open the recipe for the full list.' }));
      }
      var held = purchasingHeldNote(rows);
      if (held) ingPanel.appendChild(held);
    } else {
      ingPanel.appendChild(el('p', { class: 'section-note', text: 'Evaluating the ingredient rows…' }));
    }
    body.appendChild(ingPanel);

    var methodPanel = el('details', { class: 'disclose' });
    methodPanel.appendChild(el('summary', { text: 'Method — ' + method.length + ' steps' }));
    var mBody = el('div', { class: 'disclose-body' });
    if (method.length) {
      var ol = el('ol', { class: 'method-list' });
      method.slice(0, 2).forEach(function (s) { ol.appendChild(el('li', null, el('span', { class: 'method-text', text: s.step }))); });
      mBody.appendChild(ol);
      if (method.length > 2) mBody.appendChild(el('p', { class: 'section-note', text: '…and ' + (method.length - 2) + ' more steps on the recipe page.' }));
    } else {
      mBody.appendChild(el('p', { class: 'section-note', text: 'No source method is supplied for this recipe id.' }));
    }
    methodPanel.appendChild(mBody);
    body.appendChild(methodPanel);

    body.appendChild(timingBlock(source, method));

    var cov = el('details', { class: 'disclose' });
    cov.appendChild(el('summary', { text: 'Source coverage and evidence' }));
    cov.appendChild(el('div', { class: 'disclose-body' }, [
      el('p', {
        class: 'section-note',
        text: row.quantity_supported_rows + ' of ' + row.direct_rows + ' listed rows have a supported purchasing quantity; ' +
          row.priced_purchase_lines + ' of ' + row.purchase_lines + ' purchase lines carry an admitted recorded price. ' +
          'Coverage counts for this preview — not a rating of the recipe.'
      }),
      el('p', { class: 'section-note', text: (row.book || '') + (row.page ? ', p. ' + row.page : '') + (row.author ? ' · ' + row.author : '') })
    ]));
    body.appendChild(cov);
  }

  /* ------------------------------------------------------ full recipe page */

  function openRecipe(recipeId) {
    S.drawerId = null;
    S.lastRecipeId = recipeId;
    goto('recipe', { recipeId: recipeId, recipeTab: 'cooking' });
    SmileyData.ensureRecipeLoaded(recipeId).then(recalc).then(function(){
      if(S.route !== 'recipe' || S.recipeId !== recipeId) return;
      render(); routeFocus();
      if(document.body.dataset.motion === 'on') $('recipe-wrap').querySelector('.recipe-head').animate([{transform:'translateY(5px)',opacity:.8},{transform:'none',opacity:1}],{duration:180,easing:'ease-out'});
    })
      .catch(function (e) { toast('Could not load recipe: ' + e.message, true); });
  }

  function renderRecipePage() {
    var host = $('recipe-wrap');
    clear(host);
    var id = S.recipeId;
    if (!id) { host.appendChild(el('p', { class: 'section-note', text: 'No recipe open.' })); return; }

    var row = SmileyData.state.indexById.get(id) || {};
    var source = SmileyData.sourceRecipe(id);
    var methodDoc = SmileyData.method(id);
    var method = methodDoc ? methodDoc.method : [];
    var result = resultFor(id);
    var rr = recipeResultOf(result, id);
    var rows = selectedRows(rr);
    var sel = selectionFor(id);

    var head = el('header', { class: 'recipe-head' });
    head.appendChild(el('button', { type: 'button', class: 'ghost', text: '‹ Back', onclick: back }));
    head.appendChild(el('h1', { class: 'recipe-title', text: row.title || id }));
    var cite = el('details',{class:'recipe-citation'});cite.appendChild(el('summary',{text:[row.book,row.page?'p. '+row.page:null].filter(Boolean).join(' · ')}));cite.appendChild(el('p',{class:'recipe-cite',text:[row.book,row.author,row.page?'p. '+row.page:null].filter(Boolean).join(' · ')}));head.appendChild(cite);
    head.appendChild(el('p', { class: 'recipe-yield', text: yieldLine(row) }));

    head.appendChild(el('p', {class:'recipe-basis', text:SmileyYield.basis(rr && rr.source_servings)}));
    var actions = el('div', { class: 'recipe-actions' });
    actions.appendChild(el('button', {
      type: 'button', class: 'primary' + (inPlan(id) ? ' in-plan' : ''),
      text: inPlan(id) ? 'In plan ✓' : 'Add to plan',
      onclick: function () { inPlan(id) ? removeFromPlan(id) : addToPlan(id); }
    }));
    actions.appendChild(el('button', { type: 'button', class: 'secondary', text: 'Print recipe', onclick: function () { openPrint({ recipeIds: [id] }); } }));
    actions.appendChild(el('button', { type: 'button', class: 'secondary', text: 'Explore connections', onclick: function () { exploreConnections({ type: 'recipe', id: id }); } }));
    head.appendChild(actions);

    // Scale controls stay on the recipe page: they are cooking controls.
    var controls = el('div', { class: 'controls-row' });
    var portions = el('input', {
      type: 'number', min: '0', step: 'any',
      placeholder: rr && rr.source_servings ? 'source: ' + rr.source_servings : 'source states no serving count',
      disabled: rr && rr.source_servings ? null : 'disabled'
    });
    if (sel.portions !== null) portions.value = sel.portions;
    portions.addEventListener('input', function (e) {
      var v = e.target.value === '' ? null : Number(e.target.value);
      sel.portions = v; if (v !== null) sel.multiplier = null;
      scheduleRecalc();
    });
    controls.appendChild(el('label', null, ['Portions', portions]));

    var mult = el('input', { type: 'number', min: '0', step: 'any', placeholder: '1' });
    if (sel.multiplier !== null) mult.value = sel.multiplier;
    mult.addEventListener('input', function (e) {
      var v = e.target.value === '' ? null : Number(e.target.value);
      sel.multiplier = v; if (v !== null) sel.portions = null;
      scheduleRecalc();
    });
    controls.appendChild(el('label', null, ['Scale ×', mult]));
    head.appendChild(controls);
    if (rr && !rr.source_servings) {
      head.appendChild(el('p', { class: 'section-note tiny', text: 'The source states no serving count, so a portions basis is not supported here. The scale multiplier stays available and stays explicit.' }));
    }
    host.appendChild(head);

    var tabs = el('div', { class: 'tabs', role: 'tablist' });
    [['cooking', 'Cooking'], ['purchasing', 'Purchasing & cost'], ['evidence', 'Evidence']].forEach(function (t) {
      tabs.appendChild(el('button', {
        type: 'button', class: 'tab' + (S.recipeTab === t[0] ? ' on' : ''), role: 'tab',
        'aria-selected': String(S.recipeTab === t[0]), text: t[1],
        onclick: function () { S.recipeTab = t[0]; renderRecipePage(); }
      }));
    });
    host.appendChild(tabs);

    if (!source || !rr) { host.appendChild(el('p', { class: 'section-note', text: 'Loading…' })); return; }

    if (S.recipeTab === 'cooking') {
      var ing = el('section', { class: 'panel' });
      ing.appendChild(el('h2', { text: 'Ingredients' }));
      ing.appendChild(el('p', { class: 'section-note', text: 'Cooking amounts at the current scale. Purchased and package amounts live in Purchasing & cost.' }));

      /* Sections come from the source's own ingredient-group headings. Choosing
         one scrolls to that inline section — it never opens or invents a
         separate recipe. */
      var sectionKeys = [];
      rows.forEach(function (r) { if (r.source.group && sectionKeys.indexOf(r.source.group) < 0) sectionKeys.push(r.source.group); });
      if (sectionKeys.length > 1) {
        var nav = el('div', { class: 'chips', id: 'section-nav' });
        sectionKeys.forEach(function (g) {
          nav.appendChild(el('button', {
            type: 'button', class: 'ghost small', text: g, 'data-section': g,
            onclick: function () {
              var target = document.getElementById('group-' + encodeURIComponent(g));
              if (target) { target.scrollIntoView({ block: 'start' }); target.classList.add('flash'); setTimeout(function () { target.classList.remove('flash'); }, 1200); }
            }
          }));
        });
        ing.appendChild(el('p', { class: 'section-note tiny', text: 'Jump to source section:' }));
        ing.appendChild(nav);
      }

      ing.appendChild(ingredientSections(rows));
      var rawLines = el('details', {class:'disclose source-lines'});
      rawLines.appendChild(el('summary',{text:'Original ingredient lines (' + rows.length + ')'}));
      var rawBody = el('div',{class:'disclose-body'});
      P.groupSections(rows).forEach(function(group){
        if(group.heading) rawBody.appendChild(el('h3',{text:group.heading}));
        var list = el('ul',{class:'source-line-list'});
        group.rows.forEach(function(r){list.appendChild(el('li',{text:r.source.raw || ''}));});
        rawBody.appendChild(list);
      });
      rawLines.appendChild(rawBody); ing.appendChild(rawLines);
      var held = purchasingHeldNote(rows);
      if (held) ing.appendChild(held);
      host.appendChild(ing);

      var comps = componentsBlock(source);
      if (comps) host.appendChild(comps);

      var m = el('section', { class: 'panel' });
      m.appendChild(el('h2', { text: 'Method' }));
      var notice = (sel.multiplier !== null || sel.portions !== null)
        ? 'Ingredients are scaled. The method below stays the original instructions; quantities and times written inside a step are not rewritten.'
        : 'Method as written in the source.';
      m.appendChild(el('p', { class: 'section-note', text: notice }));
      if (method.length) {
        var ol = el('ol', { class: 'method-list' });
        method.forEach(function (s) { ol.appendChild(el('li', null, el('span', { class: 'method-text', text: s.step }))); });
        m.appendChild(ol);
      } else {
        m.appendChild(el('p', { class: 'section-note', text: 'No source method is supplied for this recipe id.' }));
      }
      host.appendChild(m);

      var t = el('section', { class: 'panel' });
      t.appendChild(el('h2', { text: 'Timing' }));
      t.appendChild(timingBlock(source, method));
      host.appendChild(t);
    }

    if (S.recipeTab === 'purchasing') {
      host.appendChild(preferencePanel(result, [id]));
      var cost = el('section', { class: 'panel' });
      cost.appendChild(el('h2', { text: 'Purchasing and recorded cost' }));
      appendAll(cost, [costBlocks(result)]);
      host.appendChild(cost);
      host.appendChild(purchaseLinesTable(result));
      host.appendChild(purchasingRowsPanel(rows, sel));
    }

    if (S.recipeTab === 'evidence') {
      var ev = el('section', { class: 'panel' });
      ev.appendChild(el('h2', { text: 'Evidence and source metadata' }));
      ev.appendChild(el('p', {
        class: 'section-note',
        text: row.quantity_supported_rows + ' of ' + row.direct_rows + ' listed rows have a supported purchasing quantity; ' +
          row.priced_purchase_lines + ' of ' + row.purchase_lines + ' purchase lines carry an admitted recorded price.'
      }));
      var timing = P.timingStatement(source);
      ev.appendChild(el('p', {
        class: 'section-note',
        text: 'Source metadata field time_total_min: ' + (timing.metadataPresent ? String(timing.metadataValue) : 'absent') +
          '. ' + timing.metadataNote
      }));
      ev.appendChild(el('p', { class: 'section-note', text: 'Recipe id: ' + id + ' · generation ' + SmileyData.state.generationId }));
      host.appendChild(ev);

      var gaps = el('details', { class: 'disclose' });
      gaps.appendChild(el('summary', { text: 'Row-level diagnostics' }));
      var gb = el('div', { class: 'disclose-body' });
      rows.forEach(function (r) {
        if (!r.gap) return;
        gb.appendChild(el('p', { class: 'section-note', text: (r.source.raw || '') + ' — ' + humanize(r.gap.family) + ': ' + humanize(r.gap.reason) }));
      });
      gaps.appendChild(gb);
      host.appendChild(gaps);
    }
  }

  /* --------------------------------------------------- purchasing surfaces */

  function purchasingRowsPanel(rows, sel) {
    var panel = el('section', { class: 'panel' });
    panel.appendChild(el('h3', { text: 'Rows that still need a purchasing conversion' }));
    var held = rows.filter(function (r) { return !r.canonical_purchase; });
    if (!held.length) {
      panel.appendChild(el('p', { class: 'section-note', text: 'Every row on this recipe has a purchasing quantity.' }));
      return panel;
    }
    panel.appendChild(el('p', { class: 'section-note', text: held.length + ' of ' + rows.length + ' rows. The cooking amounts are unaffected.' }));
    held.forEach(function (r) {
      var line = P.cookingLine(r);
      var box = el('div', { class: 'ing' });
      box.appendChild(el('div', { class: 'ing-main' }, [
        el('span', { class: 'ing-name', text: line.amount ? (line.amount.text + ' ' + line.name) : line.sourceText })
      ]));
      box.appendChild(el('div', { class: 'ing-qual small', text: r.gap ? humanize(r.gap.family) + ' — ' + humanize(r.gap.reason) : 'no admitted purchasing relation' }));
      if (r.gap && r.gap.requires) box.appendChild(el('div', { class: 'ing-qual small', text: 'Requires: ' + r.gap.requires }));

      if (r.gap && r.gap.family === 'ingredient_choice' && r.source.alternatives && r.source.alternatives.length) {
        var idx = r.occurrence.ingredient_index;
        var select = el('select');
        select.appendChild(el('option', { value: r.source.ingredient_id, text: r.source.ingredient_id.replace(/-/g, ' ') + ' (as written)' }));
        r.source.alternatives.forEach(function (a) { select.appendChild(el('option', { value: a.id, text: a.id.replace(/-/g, ' ') + ' (stated alternative)' })); });
        select.value = (sel.choices[idx] || {}).ingredient_id || r.source.ingredient_id;
        select.addEventListener('change', function (e) {
          var chosen = e.target.value;
          sel.choices[idx] = { ingredient_id: chosen, scenario: 'user_selected_alternative_' + chosen };
          sel.choice_occurrences[idx] = { id: chosen, raw: r.source.raw, confirmed_source_choice: true };
          sel.explicit_text_choice[idx] = true;
          scheduleRecalc();
        });
        box.appendChild(el('label', { class: 'section-note' }, ['Choose the stated option: ', select]));
      }
      panel.appendChild(box);
    });
    return panel;
  }

  function costBlocks(result) {
    if (!result || result.status !== 'COMPUTED') return el('p', { class: 'section-note', text: 'Not evaluated yet.' });
    var totals = result.totals;
    var frag = document.createDocumentFragment();
    var grid = el('div', { class: 'cost-grid' });

    function tile(label, block, meaning) {
      var t = el('div', { class: 'cost-tile' });
      t.appendChild(el('div', { class: 'label', text: label }));
      var money = block.known_line_subtotal_money;
      var complete = block.complete_total !== null && block.complete_total !== undefined;
      t.appendChild(el('div', { class: money ? 'value' : 'value unknown', text: money ? '$' + money.display_usd + (complete ? '' : ' · known subtotal only') : 'unknown — no admitted line yet' }));
      if (!complete && block.complete_total_withheld_because) {
        t.appendChild(el('div', { class: 'meaning', text: 'No complete total yet: some required parts of this scenario are still unaccounted.' }));
      }
      t.appendChild(el('div', { class: 'meaning', text: meaning }));
      return t;
    }

    grid.appendChild(tile('Known ingredient-use subtotal', totals.theoretical_ingredient_use_cost, totals.theoretical_ingredient_use_cost.meaning));
    grid.appendChild(tile('Package merchandise commitment', totals.package_merchandise_commitment, totals.package_merchandise_commitment.meaning));
    var allIn = el('div', { class: 'cost-tile' }, [
      el('div', { class: 'label', text: 'All-in checkout total' }),
      el('div', { class: 'value unknown', text: 'unknown (never $0.00)' }),
      el('div', { class: 'meaning', text: totals.all_in_checkout_reason })
    ]);
    grid.appendChild(allIn);
    frag.appendChild(grid);

    frag.appendChild(el('p', {
      class: 'section-note',
      text: totals.theoretical_ingredient_use_cost.known_lines + ' line(s) priced, ' +
        totals.theoretical_ingredient_use_cost.unknown_lines + ' unpriced. A recorded price is an observation, not current availability; opening this view does not refresh it.'
    }));

    var c = totals.completeness;
    if (c && c.unaccounted && c.unaccounted.length) {
      // Consequential missing requirements stay visible; only the diagnostics collapse.
      frag.appendChild(el('p', {
        class: 'section-note',
        text: c.required_included_requirements + ' required parts in this scenario · ' + c.accounted_quantity +
          ' with a supported quantity · ' + c.accounted_price + ' also priced' +
          (c.excluded_by_scenario ? ' · ' + c.excluded_by_scenario + ' excluded by the scenario' : '')
      }));
      var det = el('details', { class: 'disclose' });
      det.appendChild(el('summary', { text: 'Diagnostics for the unaccounted parts' }));
      var byReason = {};
      c.unaccounted.forEach(function (u) {
        var key = u.kind + ' — ' + (u.reason || 'unresolved');
        byReason[key] = (byReason[key] || 0) + 1;
      });
      var ul = el('ul', { class: 'section-note' });
      Object.keys(byReason).sort(function (a, b) { return byReason[b] - byReason[a]; })
        .forEach(function (k) { ul.appendChild(el('li', { text: byReason[k] + ' × ' + humanize(k) })); });
      det.appendChild(el('div', { class: 'disclose-body' }, ul));
      frag.appendChild(det);
    }

    var states = result.independent_states;
    var row = el('div', { class: 'states-row' });
    [['Quantity', states.quantity], ['Price', states.price], ['Fulfillment', states.fulfillment],
     ['Production guidance', states.production_guidance], ['Safety', states.safety]].forEach(function (p) {
      row.appendChild(el('div', { class: 'state-pill' }, [el('b', { text: p[0] }), humanize(p[1])]));
    });
    frag.appendChild(row);
    frag.appendChild(el('p', { class: 'section-note', text: states.note }));
    return frag;
  }

  function purchaseLinesTable(result) {
    var panel = el('section', { class: 'panel' });
    if (!result || result.status !== 'COMPUTED') return panel;
    panel.appendChild(el('h3', { text: 'Purchasing needs (' + result.purchase_lines.length + ')' }));
    panel.appendChild(el('p', { class: 'section-note', text: 'Compatible demand is summed once across the selection, then packages are rounded once per line.' }));
    if (!result.purchase_lines.length) {
      panel.appendChild(el('p', { class: 'section-note', text: 'No purchase lines: every row is unresolved for purchasing.' }));
      return panel;
    }
    var wrap = el('div', { class: 'table-wrap' });
    var table = el('table');
    var head = el('tr');
    ['Product', 'Aggregated demand', 'Offer (recorded)', 'Packages', 'Ingredient-use', 'Package commitment'].forEach(function (h) { head.appendChild(el('th', { text: h })); });
    table.appendChild(el('thead', null, head));
    var tb = el('tbody');
    result.purchase_lines.forEach(function (line) {
      var tr = el('tr');
      tr.appendChild(el('td', null, [el('div', { class: 'mono', text: line.product_id }), el('div', { class: 'muted small', text: 'basis ' + line.basis })]));
      tr.appendChild(el('td', { text: line.aggregated_demand ? (line.aggregated_demand.is_range ? line.aggregated_demand.min + '–' + line.aggregated_demand.max : line.aggregated_demand.display) + ' ' + line.aggregated_demand.unit : humanize(line.offer_status.reason || 'not aggregatable') }));
      var offer = el('td');
      if (line.offer) {
        offer.appendChild(el('div', { text: line.offer.product_evidence.walmart_product_name }));
        offer.appendChild(el('div', { class: 'muted small', text: 'observed ' + formatDate(line.offer.observed_at) + ' · ' + line.offer.price_label + ' · not refreshed by opening this app' }));
      } else {
        offer.appendChild(el('span', { class: 'badge gap', text: humanize((line.offer_status || {}).status || 'no offer') }));
      }
      tr.appendChild(offer);
      tr.appendChild(el('td', null, line.package_plan && line.package_plan.status !== 'GAP'
        ? document.createTextNode(line.package_plan.low_demand_scenario.packages + ' × → ' + line.package_plan.low_demand_scenario.purchased_amount + ' ' + line.package_plan.unit)
        : el('span', { class: 'badge unknown', text: line.package_plan ? humanize(line.package_plan.reason || 'gap') : 'not evaluated' })));
      tr.appendChild(el('td', null, line.costs.theoretical_ingredient_use_cost_money
        ? document.createTextNode('$' + line.costs.theoretical_ingredient_use_cost_money.display_usd)
        : el('span', { class: 'badge unknown', text: humanize(line.price_status) })));
      tr.appendChild(el('td', null, line.costs.package_merchandise_commitment_money
        ? document.createTextNode('$' + line.costs.package_merchandise_commitment_money.display_usd)
        : el('span', { class: 'badge unknown', text: humanize(line.price_status) })));
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    wrap.appendChild(table);
    panel.appendChild(wrap);
    return panel;
  }

  /* ------------------------------------------------------------ preferences */

  function eachRow(result, fn) {
    ((result && result.recipes) || []).forEach(function (rr) {
      (rr.members || []).forEach(function (m) { (m.rows || []).forEach(fn); });
    });
  }

  function rowKey(r) { return r.occurrence.recipe_id + '#' + r.occurrence.ingredient_index; }

  /**
   * What this preset would actually do to THIS selection, measured by running
   * the unchanged evaluator with it and comparing. No scope logic is
   * re-implemented here, and nothing is applied by measuring.
   */
  function presetImpact(presetId, result, ids) {
    var blocked = {};
    eachRow(result, function (r) {
      if (r.gap && r.gap.family === 'owner_convention') blocked[rowKey(r)] = r;
    });
    var keys = Object.keys(blocked);
    if (!keys.length) return { count: 0, rows: [] };

    var trial;
    try {
      var req = requestFor(ids);
      req.preset_id = presetId;
      trial = SmileyData.evaluatePlan(req);
    } catch (e) { return { count: 0, rows: [] }; }

    var resolved = [];
    eachRow(trial, function (r) {
      var k = rowKey(r);
      if (blocked[k] && r.canonical_purchase) resolved.push(blocked[k]);
    });
    return { count: resolved.length, rows: resolved };
  }

  function preferencePanel(result, ids) {
    var presets = (SmileyS1.overlays && SmileyS1.overlays.PRESETS) || {};
    var wrap = el('section', { class: 'panel pref' });
    wrap.appendChild(el('h3', { text: 'Cooking preferences' }));

    if (S.presetId && presets[S.presetId]) {
      var p = presets[S.presetId];
      var stillBlocked = 0;
      eachRow(result, function (r) { if (r.gap && r.gap.family === 'owner_convention') stillBlocked++; });
      wrap.appendChild(el('p', { text: 'In use: ' + p.label }));
      wrap.appendChild(el('p', { class: 'section-note', text: 'Scope: ' + p.scope }));
      wrap.appendChild(el('p', { class: 'section-note', text: 'Uncertainty: ' + p.uncertainty }));
      wrap.appendChild(el('p', { class: 'section-note', text: 'You chose this; it is not a default, it is recorded in the request and any snapshot you save, and it changes no owner default. ' + (stillBlocked ? stillBlocked + ' row(s) in this selection still need something else.' : '') }));
      wrap.appendChild(el('button', {
        type: 'button', class: 'secondary small', text: 'Undo this assumption',
        onclick: function () { S.presetId = null; S.prefDismissed = false; scheduleRecalc(); toast('Assumption removed. Unknown conventions stay unknown.'); }
      }));
      return wrap;
    }

    // Which preset — if any — would actually change something here?
    var candidate = null, impact = { count: 0, rows: [] };
    Object.keys(presets).forEach(function (k) {
      if (candidate) return;
      var m = presetImpact(presets[k].id, result, ids || S.planIds);
      if (m.count > 0) { candidate = presets[k]; impact = m; }
    });

    if (!candidate) {
      wrap.appendChild(el('p', {
        class: 'section-note',
        text: 'Nothing in this selection is waiting on an assumption that a reviewed preference could settle. None is applied, and none is assumed on your behalf.'
      }));
      return wrap;
    }

    if (S.prefDismissed) {
      wrap.appendChild(el('p', { class: 'section-note', text: 'One optional assumption is available for this selection. Nothing has been applied.' }));
      wrap.appendChild(el('button', { type: 'button', class: 'secondary small', text: 'Show it', onclick: function () { S.prefDismissed = false; render(); } }));
      return wrap;
    }

    wrap.appendChild(el('p', {
      text: impact.count + ' ingredient row' + (impact.count === 1 ? '' : 's') + ' in this selection can’t be turned into a purchasing amount because the source did not say which form it meant.'
    }));
    wrap.appendChild(el('p', { class: 'section-note', text: 'Reviewed reading available: ' + candidate.label }));
    wrap.appendChild(el('p', { class: 'section-note', text: 'Scope: ' + candidate.scope }));
    wrap.appendChild(el('p', { class: 'section-note', text: 'Uncertainty: ' + candidate.uncertainty }));
    wrap.appendChild(el('p', { class: 'section-note', text: 'Impact if you use it: ' + impact.count + ' row(s) in this selection would get a purchasing quantity. Nothing else changes, and the cooking amounts are already shown either way.' }));
    wrap.appendChild(el('ul', { class: 'quote-list' }, impact.rows.slice(0, 4).map(function (r) { return el('li', { text: r.source.raw }); })));
    wrap.appendChild(el('div', { class: 'recipe-actions' }, [
      el('button', {
        type: 'button', class: 'primary small', text: 'Use this assumption for this plan',
        onclick: function () {
          S.presetId = candidate.id;
          scheduleRecalc();
          toast('Applied to this session only. You chose it — it is not a default, and you can undo it.');
        }
      }),
      el('button', { type: 'button', class: 'secondary small', text: 'Not now', onclick: function () { S.prefDismissed = true; render(); } })
    ]));
    wrap.appendChild(el('p', { class: 'section-note tiny', text: 'Saying nothing is not approval: with no preference selected, these rows stay unresolved and no owner default changes.' }));
    return wrap;
  }

  /* ------------------------------------------------------------------ plan */

  function renderPlan() {
    var host = $('plan-body');
    clear(host);

    if (!S.planIds.length) {
      host.appendChild(el('div', { class: 'panel' }, [
        el('h1', { text: 'Nothing in the plan yet' }),
        el('p', { class: 'section-note', text: 'Add a recipe from its card, quick look or recipe page. The plan holds your selection for this session only — nothing is saved to an account or another device.' }),
        el('button', { type: 'button', class: 'primary', text: 'Browse the library', onclick: function () { goto('library'); } })
      ]));
      return;
    }

    var result = S.planResult;
    var head = el('section', { class: 'panel' });
    head.appendChild(el('h1', { text: S.planIds.length === 1 ? 'Plan — 1 recipe' : 'Plan — ' + S.planIds.length + ' recipes' }));
    head.appendChild(el('p', { class: 'section-note', text: 'This session only. Demand is aggregated across the plan before any package rounding.' }));

    var chips = el('div', { class: 'tray-chips' });
    S.planIds.forEach(function (id) {
      var row = SmileyData.state.indexById.get(id) || {};
      var chip = el('span', { class: 'chip' }, [row.title || id]);
      chip.appendChild(el('button', { type: 'button', text: '×', 'aria-label': 'Remove from plan', onclick: function () { removeFromPlan(id); } }));
      chips.appendChild(chip);
    });
    head.appendChild(chips);
    head.appendChild(el('div', { class: 'recipe-actions' }, [
      el('button', { type: 'button', class: 'secondary', text: 'Print these recipes', onclick: function () { openPrint({ recipeIds: S.planIds.slice() }); } })
    ]));
    host.appendChild(head);

    var ctl = el('section', { class: 'panel' });
    ctl.appendChild(el('h3', { text: 'Shopping context' }));
    var row2 = el('div', { class: 'controls-row' });
    var prof = el('select');
    Object.keys(SmileyS1.mapping.PROFILES).forEach(function (pid) {
      prof.appendChild(el('option', { value: SmileyS1.mapping.PROFILES[pid].id, text: SmileyS1.mapping.PROFILES[pid].label }));
    });
    prof.value = S.profileId;
    prof.addEventListener('change', function (e) { S.profileId = e.target.value; scheduleRecalc(); });
    row2.appendChild(el('label', null, ['Purchasing profile', prof]));

    var ctx = el('select');
    [['home', 'Home'], ['truck', 'Food truck'], ['restaurant', 'Restaurant'], ['consulting', 'Consulting']].forEach(function (c) {
      ctx.appendChild(el('option', { value: c[0], text: c[1] }));
    });
    ctx.value = S.context;
    ctx.addEventListener('change', function (e) { S.context = e.target.value; scheduleRecalc(); });
    row2.appendChild(el('label', null, ['Context', ctx]));

    var inv = el('select');
    [['UNKNOWN', 'Inventory unknown (default)'], ['DECLARED_EMPTY', 'Declared empty'], ['ENTERED_STOCK', 'Entered stock']].forEach(function (o) {
      inv.appendChild(el('option', { value: o[0], text: o[1] }));
    });
    inv.value = S.inventory.scenario;
    inv.addEventListener('change', function (e) { S.inventory = { scenario: e.target.value, items: S.inventory.items }; scheduleRecalc(); });
    row2.appendChild(el('label', null, ['Inventory', inv]));
    ctl.appendChild(row2);
    ctl.appendChild(el('p', { class: 'section-note tiny', text: 'Unknown inventory stays unknown — it never becomes an empty pantry.' }));
    host.appendChild(ctl);

    host.appendChild(preferencePanel(result, S.planIds));

    if (!result) { host.appendChild(el('p', { class: 'section-note', text: 'Evaluating…' })); return; }
    if (result.status === 'ERROR') {
      host.appendChild(el('div', { class: 'panel' }, el('p', { text: 'Could not evaluate this plan: ' + (result.reason || 'unknown error') })));
      return;
    }

    var totals = el('section', { class: 'panel' });
    totals.appendChild(el('h2', { text: 'What this plan costs, and what it cannot say' }));
    appendAll(totals, [costBlocks(result)]);
    host.appendChild(totals);
    host.appendChild(purchaseLinesTable(result));

    (result.recipes || []).forEach(function (rr) {
      var panel = el('section', { class: 'panel' });
      panel.appendChild(el('h3', { text: rr.title || rr.recipe_id }));
      panel.appendChild(el('div', { class: 'recipe-actions' }, [
        el('button', { type: 'button', class: 'secondary small', text: 'Open recipe', onclick: function () { openRecipe(rr.recipe_id); } }),
        el('button', { type: 'button', class: 'secondary small', text: 'Print', onclick: function () { openPrint({ recipeIds: [rr.recipe_id] }); } })
      ]));
      var sel = selectionFor(rr.recipe_id);
      var line = el('div', { class: 'controls-row' });
      var p2 = el('input', { type: 'number', min: '0', step: 'any', placeholder: rr.source_servings ? 'source: ' + rr.source_servings : 'no serving count', disabled: rr.source_servings ? null : 'disabled' });
      if (sel.portions !== null) p2.value = sel.portions;
      p2.addEventListener('input', function (e) { var v = e.target.value === '' ? null : Number(e.target.value); sel.portions = v; if (v !== null) sel.multiplier = null; scheduleRecalc(); });
      line.appendChild(el('label', null, ['Portions', p2]));
      var m2 = el('input', { type: 'number', min: '0', step: 'any', placeholder: '1' });
      if (sel.multiplier !== null) m2.value = sel.multiplier;
      m2.addEventListener('input', function (e) { var v = e.target.value === '' ? null : Number(e.target.value); sel.multiplier = v; if (v !== null) sel.portions = null; scheduleRecalc(); });
      line.appendChild(el('label', null, ['Scale ×', m2]));
      panel.appendChild(line);
      host.appendChild(panel);
    });

    host.appendChild(snapshotPanel(result));
  }

  function snapshotPanel(result) {
    var panel = el('section', { class: 'panel' });
    panel.appendChild(el('h3', { text: 'Save a snapshot (this session)' }));
    panel.appendChild(el('p', { class: 'section-note', text: 'A detached copy of what the evaluator returned, pinned to the dependency digests it was computed from. Held in this browser tab only — no durable, cross-device or account storage is built.' }));
    panel.appendChild(el('button', { type: 'button', class: 'primary', text: 'Save snapshot', onclick: function () { saveSnapshot(result); } }));
    S.snapshots.slice().reverse().forEach(function (snap) {
      panel.appendChild(el('div', { class: 'ing' }, [
        el('div', { class: 'ing-main' }, el('span', { class: 'ing-name', text: snap.label || snap.snapshot_id })),
        el('div', { class: 'muted small mono', text: snap.snapshot_id }),
        el('div', { class: 'muted small', text: 'pinned generation ' + snap.pinned_revisions.generation_id + ' · saved ' + formatDate(snap.created_at_utc) }),
        el('div', { class: 'muted small', text: 'source-methods dependency: ' + (snap.ui_dependencies.source_methods_sha256 || 'digest unavailable in this browser context') })
      ]));
    });
    return panel;
  }

  function saveSnapshot(result) {
    if (!result || result.status !== 'COMPUTED') { toast('Nothing computed to save yet.', true); return; }
    var snap = SmileyS1.snapshot.createSnapshot({
      plan: result,
      versions: SmileyData.state.versions,
      generation_id: SmileyData.state.generationId,
      inventory: S.inventory,
      label: S.planIds.map(function (id) { return (SmileyData.state.indexById.get(id) || {}).title || id; }).join(' + ')
    });
    snap.ui_dependencies = {
      source_methods_sha256: SmileyData.state.sourceMethodsSha256,
      source_runtime_sha256: (SmileyData.state.methodsMeta || {}).source_runtime_sha256 || null,
      note: 'Display-only method projection. Not an engine dependency and not a re-certification of the method text.'
    };
    S.snapshots.push(snap);
    renderPlan();
    toast('Snapshot saved this session: ' + snap.snapshot_id);
  }

  /* ----------------------------------------------------------------- print */

  function openPrint(opts) {
    showPrintPreview(opts.recipeIds, true, false);
  }

  /**
   * Every recipe in the pack must be loaded before the capture, or the
   * evaluator would return a recipe with no rows and the sheet would print
   * empty. Loading is part of opening the preview, not the caller's problem.
   */
  function showPrintPreview(ids, scaled, includeCosts) {
    if (!document.getElementById('print-preview')) rememberFocus();
    var missing = ids.filter(function (id) { return !SmileyData.sourceRecipe(id); });
    if (missing.length) {
      Promise.all(ids.map(function (id) { return SmileyData.ensureRecipeLoaded(id); }))
        .then(function () { showPrintPreview(ids, scaled, includeCosts); })
        .catch(function (e) { toast('Could not prepare the print document: ' + e.message, true); });
      return;
    }
    var model = SmileyPrint.captureModel({
      recipeIds: ids,
      scaled: scaled,
      includeCosts: includeCosts,
      selectionFor: selectionFor,
      profileId: S.profileId,
      presetId: S.presetId,
      context: S.context,
      inventory: S.inventory
    });
    S.printModel = model;

    // Reopening must first return #print-root to the document, since the old
    // overlay owns it while a preview is open.
    closePrintPreview();

    var overlay = el('div', { id: 'print-preview', role: 'dialog', 'aria-label': 'Print preview' });
    var bar = el('div', { id: 'print-preview-bar' });
    bar.appendChild(el('strong', { text: 'Print preview' }));

    var scaleToggle = el('div', { class: 'seg' });
    [['original', 'Original batch', false], ['scaled', 'Current scale', true]].forEach(function (o) {
      scaleToggle.appendChild(el('button', {
        type: 'button', class: 'ghost' + (scaled === o[2] ? ' on' : ''), text: o[1],
        onclick: function () { showPrintPreview(ids, o[2], includeCosts); }
      }));
    });
    bar.appendChild(scaleToggle);

    var costBox = el('input', { type: 'checkbox' });
    costBox.checked = includeCosts;
    costBox.addEventListener('change', function (e) { showPrintPreview(ids, scaled, e.target.checked); });
    bar.appendChild(el('label', { class: 'switch' }, [costBox, el('span', { text: 'Include recorded cost notes' })]));

    bar.appendChild(el('span', { class: 'pv-note', text: 'This preview is a detached copy taken now. Changing the plan afterwards does not change it. Printing changes nothing.' }));
    bar.appendChild(el('button', { type: 'button', class: 'primary', text: 'Print / Save as PDF', onclick: function () { window.print(); } }));
    bar.appendChild(el('button', { type: 'button', class: 'secondary', text: 'Close', onclick: closePrintPreview }));
    overlay.appendChild(bar);

    var paper = el('div', { class: 'paper' });
    var root = $('print-root');
    root.hidden = false;
    SmileyPrint.buildDocument(model, root);
    paper.appendChild(root);
    overlay.appendChild(paper);
    document.body.appendChild(overlay);
    document.body.classList.add('print-open');
  }

  function closePrintPreview() {
    var overlay = $('print-preview');
    if (!overlay) return;
    var root = $('print-root');
    if (root) { root.hidden = true; document.body.appendChild(root); }
    overlay.parentNode.removeChild(overlay);
    document.body.classList.remove('print-open');
    restoreFocus();
  }

  /* ---------------------------------------------------------------- search */

  function renderSuggestions() {
    var box = $('search-results');
    clear(box);
    var input = $('search-input');
    var q = input.value.trim();
    if (q.length < 2) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); S.suggestions = []; S.suggestIndex = -1; return; }

    var recipes = SmileyData.searchRecipes(q, 8);
    var ingredients = SmileyData.searchIngredients(q, 4);
    S.suggestions = recipes.map(function (r) { return { kind: 'recipe', id: r.recipe_id, label: r.title, sub: [r.book, r.course].filter(Boolean).join(' · ') }; })
      .concat(ingredients.map(function (i) { return { kind: 'ingredient', id: i.ingredient_id, label: i.ingredient_id.replace(/-/g, ' '), sub: 'listed in ' + i.count + ' recipes' }; }));
    S.suggestIndex = -1;

    var total = SmileyData.filterLibrary({ query: q }).length;
    box.appendChild(el('div', { class: 'sr-group', text: 'Press Enter for all ' + total + ' matching recipes' }));
    S.suggestions.forEach(function (s, i) {
      box.appendChild(el('button', {
        type: 'button', class: 'sr-item', role: 'option', id: 'sugg-' + i, 'aria-selected': 'false',
        onclick: function () { chooseSuggestion(i); }
      }, [
        el('div', { class: 't', text: s.label }),
        el('div', { class: 's', text: (s.kind === 'ingredient' ? 'Ingredient · ' : '') + s.sub })
      ]));
    });
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function highlightSuggestion(delta) {
    if (!S.suggestions.length) return;
    var next = S.suggestIndex + delta;
    if (next < 0) next = S.suggestions.length - 1;
    if (next >= S.suggestions.length) next = 0;
    S.suggestIndex = next;
    Array.prototype.forEach.call(document.querySelectorAll('#search-results .sr-item'), function (b, i) {
      var on = i === next;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
      if (on) { b.scrollIntoView({ block: 'nearest' }); $('search-input').setAttribute('aria-activedescendant', b.id); }
    });
  }

  /** An explicit choice — pointer click, or Enter on a highlighted suggestion. */
  function chooseSuggestion(i) {
    var s = S.suggestions[i];
    if (!s) return;
    closeSuggestions();
    if (s.kind === 'recipe') { openDrawer(s.id); return; }
    S.facets.include = [s.id];
    S.page = 0;
    syncFacetControls();
    goto('library');
  }

  /** Submitting an unselected query shows results. It never opens a recipe or the map. */
  function submitQuery() {
    S.query = $('search-input').value.trim();
    S.page = 0;
    closeSuggestions();
    goto('library');
  }

  var suggestionTimer = null;
  function closeSuggestions() {
    clearTimeout(suggestionTimer);
    $('search-results').hidden = true;
    $('search-input').setAttribute('aria-expanded', 'false');
    $('search-input').removeAttribute('aria-activedescendant');
    S.suggestIndex = -1;
  }

  /* ---------------------------------------------------------------- library */

  function syncFacetControls() {
    $('f-cuisine').value = S.facets.cuisine;
    $('f-course').value = S.facets.course;
    $('f-book').value = S.facets.book;
    $('f-sort').value = S.facets.sort;
  }

  function renderLibrary() {
    var all = SmileyData.filterLibrary({
      query: S.query,
      cuisine: S.facets.cuisine, course: S.facets.course, book: S.facets.book,
      include: S.facets.include, exclude: S.facets.exclude, sort: S.facets.sort
    });
    var totalLibrary = SmileyData.state.index.recipes.length;
    var pages = Math.max(1, Math.ceil(all.length / S.pageSize));
    if (S.page >= pages) S.page = 0;
    var start = S.page * S.pageSize;
    var slice = all.slice(start, start + S.pageSize);

    $('lib-title').textContent = S.query ? 'Results for “' + S.query + '”' : 'Library';
    $('lib-count').textContent = all.length === totalLibrary
      ? all.length + ' recipes — the whole library, page by page.'
      : all.length + ' of ' + totalLibrary + ' recipes match. Filters compose over the whole library, not over the map.';

    var chips = $('f-chips');
    clear(chips);
    function chipFor(kind, id) {
      var chip = el('span', { class: 'chip' }, [(kind === 'include' ? 'with ' : 'without ') + id.replace(/-/g, ' ')]);
      chip.appendChild(el('button', {
        type: 'button', text: '×', 'aria-label': 'Remove filter',
        onclick: function () {
          S.facets[kind] = S.facets[kind].filter(function (x) { return x !== id; });
          S.page = 0; renderLibrary();
        }
      }));
      return chip;
    }
    S.facets.include.forEach(function (i) { chips.appendChild(chipFor('include', i)); });
    S.facets.exclude.forEach(function (i) { chips.appendChild(chipFor('exclude', i)); });
    if (S.query) {
      var qchip = el('span', { class: 'chip' }, ['query: ' + S.query]);
      qchip.appendChild(el('button', {
        type: 'button', text: '×', 'aria-label': 'Clear the query',
        onclick: function () { S.query = ''; $('search-input').value = ''; S.page = 0; renderLibrary(); }
      }));
      chips.appendChild(qchip);
    }

    var grid = $('lib-grid');
    clear(grid);
    if (!slice.length) {
      grid.appendChild(el('div', { class: 'panel' }, [
        el('h3', { text: 'No recipes match these filters' }),
        el('p', { class: 'section-note', text: 'Nothing has been removed from the library — only this filter combination is empty. Ingredient filters match listed source entries and make no dietary or allergy claim.' }),
        el('button', { type: 'button', class: 'primary', text: 'Clear filters', onclick: clearFilters })
      ]));
    }
    slice.forEach(function (row) { grid.appendChild(recipeCard(row.recipe_id)); });

    $('page-label').textContent = 'Page ' + (S.page + 1) + ' of ' + pages +
      ' · showing ' + (slice.length ? (start + 1) + '–' + (start + slice.length) : '0') + ' of ' + all.length;
    $('page-prev').disabled = S.page === 0;
    $('page-next').disabled = S.page >= pages - 1;
  }

  function clearFilters() {
    S.query = '';
    $('search-input').value = '';
    S.facets = { cuisine: '', course: '', book: '', include: [], exclude: [], sort: S.facets.sort };
    S.page = 0;
    syncFacetControls();
    renderLibrary();
  }

  /* ------------------------------------------------------------------- map */

  function exploreConnections(target) {
    goto('map');
    SmileyMap.focus(target);
    render();
  }

  function renderMapEmpty() {
    var box = $('map-empty');
    clear(box);
    if (SmileyMap.current()) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el('h2', { text: 'Pick a starting point' }));
    box.appendChild(el('p', { class: 'section-note', text: 'The map draws only what the sources record: which recipes list an ingredient, and (optionally) which recipes share a book. Nothing is selected until you choose it.' }));
    var counts = SmileyData.state.ingredientCounts;
    var top = Array.from(counts.keys()).sort(function (a, b) { return counts.get(b) - counts.get(a); }).slice(0, 8);
    box.appendChild(el('p', { class: 'section-note tiny', text: 'Most frequently listed ingredients in this library:' }));
    var list = el('div', { class: 'chips' });
    top.forEach(function (i) {
      list.appendChild(el('button', {
        type: 'button', class: 'ghost small', text: i.replace(/-/g, ' ') + ' (' + counts.get(i) + ')',
        onclick: function () { SmileyMap.focus({ type: 'ingredient', id: i }); render(); }
      }));
    });
    box.appendChild(list);
  }

  function renderNeighborhood(info) {
    S.lastNeighborhood = info;
    var label = $('focus-label');
    clear(label);
    if (info.focus) {
      label.hidden = false;
      label.appendChild(el('div', { class: 'fl-kind', text: info.focus.type === 'recipe' ? 'Recipe' : 'Ingredient' }));
      var name = info.focus.type === 'recipe'
        ? (SmileyData.state.indexById.get(info.focus.id) || {}).title || info.focus.id
        : String(info.focus.id).replace(/-/g, ' ');
      label.appendChild(el('div', { class: 'fl-name', text: name }));
      label.appendChild(el('div', {
        class: 'muted small',
        text: info.nodes.length + ' of a ' + info.cap + '-item limit drawn' +
          (info.memberTotal ? ' · ' + info.memberTotal + ' recipes list it in total' : '') +
          (info.hidePantry && info.hiddenPantryCount ? ' · ' + info.hiddenPantryCount + ' common pantry link(s) hidden' : '')
      }));
      if (info.focus.type === 'recipe') {
        label.appendChild(el('button', { type: 'button', class: 'primary small', text: 'Quick look', onclick: function () { openDrawer(info.focus.id); } }));
      }
    } else {
      label.hidden = true;
    }
    renderMapEmpty();

    var body = $('nlist-body');
    clear(body);
    $('nlist-count').textContent = '(' + info.nodes.length + ' items, ' + info.edges.length + ' links)';
    body.appendChild(el('p', {
      class: 'section-note',
      text: 'Links are source-backed only: listed ingredient entries, plus same-book provenance when you switch it on. Position carries no meaning. The draw limit never limits search.'
    }));
    info.nodes.forEach(function (n) {
      var btn = el('button', { type: 'button', class: 'nl-item', onclick: function () { onSelectNode({ type: n.kind, id: n.id }); } }, [
        el('div', { class: 'k', text: n.kind === 'recipe' ? 'Recipe' : 'Ingredient' }),
        el('div', { class: 'n', text: n.label })
      ]);
      if (n.kind === 'ingredient') btn.appendChild(el('div', { class: 'e', text: 'listed in ' + (SmileyData.state.ingredientCounts.get(n.id) || 0) + ' recipes' }));
      body.appendChild(btn);
    });
    if (info.edges.length) {
      body.appendChild(el('h4', { text: 'Links' }));
      info.edges.slice(0, 60).forEach(function (e) {
        var text = e.kind === 'same_book'
          ? 'same source book — ' + e.book
          : ((SmileyData.state.indexById.get(e.recipe_id) || {}).title || e.recipe_id) + ' lists ' + String(e.ingredient_id).replace(/-/g, ' ');
        body.appendChild(el('button', { type: 'button', class: 'nl-item', onclick: function () { onEdgeInspect(e); } },
          [el('div', { class: 'k', text: 'Link' }), el('div', { class: 'e', text: text })]));
      });
    }
  }

  function onSelectNode(target) {
    SmileyMap.focus(target);
    if (target.type === 'recipe') openDrawer(target.id);
    else showIngredient(target.id);
    render();
  }

  function showIngredient(ingredientId) {
    S.drawerId = null;
    var host = $('drawer'), body = $('drawer-body');
    host.hidden = false;
    clear(body);
    var count = SmileyData.state.ingredientCounts.get(ingredientId) || 0;
    var panel = el('section', { class: 'panel' });
    panel.appendChild(el('h2', { text: String(ingredientId).replace(/-/g, ' ') }));
    panel.appendChild(el('p', { class: 'mono', text: ingredientId }));
    panel.appendChild(el('p', {
      class: 'section-note',
      text: 'Listed as an ingredient entry in ' + count + ' of ' + SmileyData.state.index.recipes.length +
        ' recipes. Direct list membership from the source ingredient lines — not a flavour affinity, not a compatibility score, and not proof that it is required in any of them.'
    }));
    panel.appendChild(el('button', {
      type: 'button', class: 'primary small', text: 'Show these ' + count + ' recipes in the library',
      onclick: function () { S.facets.include = [ingredientId]; S.query = ''; $('search-input').value = ''; S.page = 0; host.hidden = true; goto('library'); }
    }));
    body.appendChild(panel);
  }

  function onEdgeInspect(edge) {
    var host = $('drawer'), body = $('drawer-body');
    host.hidden = false;
    clear(body);
    var panel = el('section', { class: 'panel' });
    if (edge.kind === 'same_book') {
      panel.appendChild(el('h2', { text: 'Link: same source book' }));
      panel.appendChild(el('p', { class: 'section-note', text: 'Both recipes are published in ' + edge.book + '. Shared provenance metadata only — not a flavour, technique or substitution relationship.' }));
      body.appendChild(panel);
      return;
    }
    panel.appendChild(el('h2', { text: 'Link: listed ingredient entry' }));
    var recipeRow = SmileyData.state.indexById.get(edge.recipe_id) || {};
    panel.appendChild(el('p', { class: 'section-note', text: (recipeRow.title || edge.recipe_id) + ' lists ' + String(edge.ingredient_id).replace(/-/g, ' ') + ' in its source ingredient list.' }));
    var src = SmileyData.sourceRecipe(edge.recipe_id);
    if (!src) {
      panel.appendChild(el('p', { class: 'section-note', text: 'Loading the source line…' }));
      SmileyData.ensureRecipeLoaded(edge.recipe_id).then(function () { onEdgeInspect(edge); });
      body.appendChild(panel);
      return;
    }
    (src.ingredients || []).filter(function (i) { return i.id === edge.ingredient_id || i.original_id === edge.ingredient_id; })
      .forEach(function (ing) {
        var box = el('div', { class: 'ing' });
        box.appendChild(el('div', { class: 'ing-main' }, el('span', { class: 'ing-name', text: ing.raw || '(no raw source text)' })));
        var meta = el('div', { class: 'ing-meta' });
        if (ing.group) meta.appendChild(el('span', { class: 'badge unknown', text: 'section: ' + ing.group }));
        if (ing.choice_group) meta.appendChild(el('span', { class: 'badge gap', text: 'a stated choice, not a required inclusion' }));
        if (ing.alternatives && ing.alternatives.length) meta.appendChild(el('span', { class: 'badge gap', text: ing.alternatives.length + ' stated alternative(s): ' + ing.alternatives.map(function (a) { return a.id; }).join(', ') }));
        if (ing.percentage_of) meta.appendChild(el('span', { class: 'badge unknown', text: 'stated as a percentage of ' + ing.percentage_of }));
        if (ing.original_id && ing.original_id !== ing.id) meta.appendChild(el('span', { class: 'badge unknown', text: 'normalised from ' + ing.original_id }));
        box.appendChild(meta);
        panel.appendChild(box);
      });
    panel.appendChild(el('button', { type: 'button', class: 'secondary small', text: 'Open recipe', onclick: function () { openRecipe(edge.recipe_id); } }));
    body.appendChild(panel);
  }

  /* ---------------------------------------------------------------- render */

  function render() {
    renderTray();
    renderDrawer();
    if (S.route === 'library') renderLibrary();
    if (S.route === 'recipe') renderRecipePage();
    if (S.route === 'plan') renderPlan();
    if (S.route === 'map') {
      if (!SmileyMap.current()) $('focus-label').hidden = true;
      renderMapEmpty();
    }
  }

  /* ------------------------------------------------------------------ wire */

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll('.navbtn[data-route]'), function (b) {
      b.addEventListener('click', function () { goto(b.getAttribute('data-route')); });
    });
    $('brand').addEventListener('click', function () { goto('home'); });
    $('mobile-search').addEventListener('click', function () { goto('home'); $('search-input').focus(); });

    $('home-search').addEventListener('click', function () { $('search-input').focus(); });
    $('home-browse').addEventListener('click', function () { goto('library'); });
    $('home-browse-2').addEventListener('click', function () { goto('library'); });
    $('home-plan').addEventListener('click', function () { goto('plan'); });
    $('home-map').addEventListener('click', function () { goto('map'); });
    $('home-resume').addEventListener('click', function () { if (S.lastRecipeId) openRecipe(S.lastRecipeId); });

    var input = $('search-input');
    input.addEventListener('input', function () {
      clearTimeout(suggestionTimer);
      S.suggestIndex = -1; S.suggestions = [];
      suggestionTimer = setTimeout(renderSuggestions, 120);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); highlightSuggestion(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); highlightSuggestion(-1); return; }
      if (e.key === 'Escape') { e.preventDefault(); closeSuggestions(); return; }   // closes suggestions only
      if (e.key === 'Enter') {
        e.preventDefault();
        if (S.suggestIndex >= 0) chooseSuggestion(S.suggestIndex);   // an explicit highlight is a choice
        else submitQuery();                                          // otherwise: show the results
      }
    });
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.search-wrap')) closeSuggestions();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if ($('print-preview')) { closePrintPreview(); return; }
      if (!$('drawer').hidden && document.activeElement !== input) closeDrawer();
    });

    $('drawer-close').addEventListener('click', closeDrawer);
    $('tray-open').addEventListener('click', function () { goto('plan'); });
    $('tray-print').addEventListener('click', function () { openPrint({ recipeIds: S.planIds.slice() }); });

    ['cuisine', 'course', 'book', 'sort'].forEach(function (f) {
      $('f-' + f).addEventListener('change', function (e) { S.facets[f] = e.target.value; S.page = 0; renderLibrary(); });
    });
    $('f-clear').addEventListener('click', clearFilters);
    function addIngredientFilter(kind, value) {
      var v = String(value || '').trim().toLowerCase().replace(/\s+/g, '-');
      if (!v) return;
      if (!SmileyData.state.ingredientCounts.has(v)) { toast('No ingredient id “' + v + '” is listed in this library.', true); return; }
      if (S.facets[kind].indexOf(v) < 0) S.facets[kind].push(v);
      S.page = 0;
      renderLibrary();
    }
    $('f-include').addEventListener('keydown', function (e) { if (e.key === 'Enter') { addIngredientFilter('include', e.target.value); e.target.value = ''; } });
    $('f-exclude').addEventListener('keydown', function (e) { if (e.key === 'Enter') { addIngredientFilter('exclude', e.target.value); e.target.value = ''; } });
    $('page-prev').addEventListener('click', function () { S.page--; renderLibrary(); $('view-library').scrollTop = 0; });
    $('page-next').addEventListener('click', function () { S.page++; renderLibrary(); $('view-library').scrollTop = 0; });

    $('btn-back-map').addEventListener('click', back);
    $('btn-reset').addEventListener('click', function () { SmileyMap.resetView(); });
    $('btn-zoom-in').addEventListener('click', function () { SmileyMap.zoom(1.25); });
    $('btn-zoom-out').addEventListener('click', function () { SmileyMap.zoom(0.8); });
    $('btn-list').addEventListener('click', function () {
      var host = $('drawer'), body = $('drawer-body');
      host.hidden = false;
      clear(body);
      var panel = el('section', { class: 'panel' });
      panel.appendChild(el('h2', { text: 'On the map' }));
      panel.appendChild(el('p', {
        class: 'section-note',
        text: 'Every item and link drawn on the map, as buttons — so nothing needs panning, dragging or hovering.'
      }));
      body.appendChild(panel);
      if (S.lastNeighborhood) renderNeighborhoodInto(panel, S.lastNeighborhood);
      else panel.appendChild(el('p', { class: 'section-note', text: 'Nothing is on the map yet. Pick a starting point first.' }));
    });
    $('toggle-pantry').addEventListener('change', function (e) {
      SmileyMap.setPantryHidden(e.target.checked);
      toast(e.target.checked ? 'Common pantry links hidden from the drawing. Search and the library are unchanged.' : 'Common pantry links shown again.');
    });
    $('toggle-book').addEventListener('change', function (e) {
      SmileyMap.setBookLinks(e.target.checked);
      if (e.target.checked) toast('Same-book links shown. Shared provenance only — not a flavour relationship.');
    });

    window.addEventListener('beforeprint', function () {
      if (!$('print-preview')) return;   // nothing to print unless a preview is open
    });
  }

  function renderNeighborhoodInto(host, info) {
    info.nodes.forEach(function (n) {
      host.appendChild(el('button', { type: 'button', class: 'nl-item', onclick: function () { onSelectNode({ type: n.kind, id: n.id }); } }, [
        el('div', { class: 'k', text: n.kind === 'recipe' ? 'Recipe' : 'Ingredient' }),
        el('div', { class: 'n', text: n.label })
      ]));
    });
    info.edges.slice(0, 40).forEach(function (e) {
      var text = e.kind === 'same_book'
        ? 'same source book — ' + e.book
        : ((SmileyData.state.indexById.get(e.recipe_id) || {}).title || e.recipe_id) + ' lists ' + String(e.ingredient_id).replace(/-/g, ' ');
      host.appendChild(el('button', { type: 'button', class: 'nl-item', onclick: function () { onEdgeInspect(e); } },
        [el('div', { class: 'k', text: 'Link' }), el('div', { class: 'e', text: text })]));
    });
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    SmileyData.load().then(function (D) {
      $('generation-badge').textContent = 'generation ' + D.generationId;
      $('generation-badge').className = 'badge ok';
      $('home-counts').textContent = D.index.recipes.length.toLocaleString() + ' recipes · ' + D.books.length +
        ' source books · ' + D.cuisines.length + ' cuisines · ' + D.ingredientCounts.size.toLocaleString() + ' listed ingredients.';

      D.cuisines.forEach(function (c) { $('f-cuisine').appendChild(el('option', { value: c, text: c })); });
      D.courses.forEach(function (c) { $('f-course').appendChild(el('option', { value: c, text: c })); });
      D.books.forEach(function (b) { $('f-book').appendChild(el('option', { value: b, text: b })); });
      var dl = $('ingredient-list');
      Array.from(D.ingredientCounts.keys()).sort().slice(0, 1200).forEach(function (i) { dl.appendChild(el('option', { value: i })); });

      SmileyMap.init({
        svg: $('sky'),
        onSelectNode: onSelectNode,
        onEdgeInspect: onEdgeInspect,
        onNeighborhood: renderNeighborhood
      });

      // Index-only Home cards: no recipe evaluation or implicit selection.
      SmileyArt.bespokeIds.forEach(function(id){if(D.indexById.has(id)) $('home-cards').appendChild(recipeCard(id));});
      // Optional material field starts after core routes and controls are ready.
      var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      var motionOff = false;
      function syncMotion(){document.body.dataset.motion = motionOff || mq.matches ? 'off' : 'on'; $('motion-toggle').textContent = mq.matches ? 'Motion: OS reduced' : (motionOff ? 'Motion: off' : 'Motion: on'); $('motion-toggle').setAttribute('aria-pressed',String(motionOff || mq.matches));}
      $('motion-toggle').addEventListener('click',function(){motionOff=!motionOff;syncMotion();});
      mq.addEventListener('change',syncMotion);syncMotion();
      document.addEventListener('visibilitychange',function(){document.body.classList.toggle('backgrounded',document.hidden);});
      wire();

      /* Neutral home: a plain load focuses, inspects, evaluates and selects
         nothing. A deep link is an explicit request typed or followed by the
         user, so ?recipe= or ?q= opens that view — never a stored or guessed
         "last recipe", and never on a bare load. */
      var params = new URLSearchParams(location.search);
      var deepRecipe = params.get('recipe');
      var deepQuery = params.get('q');
      if (deepRecipe && D.indexById.has(deepRecipe)) {
        openRecipe(deepRecipe);
      } else if (deepQuery !== null) {
        S.query = deepQuery;
        $('search-input').value = deepQuery;
        apply('library');
      } else {
        apply('home');
      }
      $('app').removeAttribute('aria-busy');
      setTimeout(function(){try{SmileyField.init({onPreview:openDrawer,onExplore:exploreConnections});}catch(e){console.warn('Optional material field unavailable',e);}},0);
    }).catch(function (e) {
      console.error(e);
      toast('Failed to load the prepared reference data: ' + e.message, true);
      $('app').removeAttribute('aria-busy');
    });
  }

  window.SmileyUI = {
    state: S,
    goto: goto,
    openDrawer: openDrawer,
    openRecipe: openRecipe,
    openPrint: openPrint,
    showPrintPreview: showPrintPreview,
    closePrintPreview: closePrintPreview,
    addToPlan: addToPlan,
    removeFromPlan: removeFromPlan,
    selectionFor: selectionFor,
    requestFor: requestFor,
    submitQuery: submitQuery,
    chooseSuggestion: chooseSuggestion,
    highlightSuggestion: highlightSuggestion,
    renderSuggestions: renderSuggestions,
    recalc: recalc,
    render: render,
    back: back
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
