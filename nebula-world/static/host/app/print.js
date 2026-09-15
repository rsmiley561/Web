/* =============================================================================
 * print.js — uniform recipe printing.
 *
 * One reusable paper template for: the original batch, the currently scaled
 * selection, and a pack of selected plan recipes. It shares SmileyPresenter with
 * the quick look and the full recipe page, so a printed amount is the same value
 * the screen showed.
 *
 * Contract points this file keeps:
 *  - the print model is CAPTURED and DETACHED: a deep copy taken at the moment
 *    you press Print, so later plan edits cannot mutate the preview;
 *  - cooking requirements are printed, never rounded package/AP demand;
 *  - unresolved cooking amounts stay visible, never omitted and never zeroed;
 *  - method strings print verbatim, with ONE concise scaled notice;
 *  - a selected alternative does not also print its unselected option;
 *  - costs are optional and off by default;
 *  - printing mutates nothing: no plan change, no price refresh, no saved state.
 * ========================================================================== */
(function (global) {
  'use strict';

  var P = global.SmileyPresenter;

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined) continue;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = String(v);
        else node.setAttribute(k, String(v));
      }
    }
    (Array.isArray(children) ? children : (children ? [children] : [])).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function detach(value) { return value === undefined ? null : JSON.parse(JSON.stringify(value)); }

  /* ------------------------------------------------------------- capture */

  /**
   * Build the detached print model from the CURRENT evaluated scenario.
   *
   * @param {object} opts
   *   recipeIds     ordered ids to print
   *   scaled        true = current selection, false = original source batch
   *   selectionFor  fn(recipeId) -> the live selection object
   *   profileId, presetId, context, inventory
   *   includeCosts  default false
   */
  function captureModel(opts) {
    var D = SmileyData.state;
    var ids = opts.recipeIds.slice();
    var selections = ids.map(function (id) {
      var s = opts.selectionFor(id);
      var base = {
        recipe_id: id,
        choices: s.choices,
        choice_occurrences: s.choice_occurrences,
        explicit_text_choice: s.explicit_text_choice,
        include_optional: s.include_optional
      };
      if (opts.scaled) {
        if (s.portions !== null && s.portions !== undefined) base.portions = s.portions;
        if (s.multiplier !== null && s.multiplier !== undefined) base.multiplier = s.multiplier;
      }
      return base;
    });

    var request = {
      selections: selections,
      profile_id: opts.profileId,
      preset_id: opts.presetId,
      context: opts.context,
      inventory: opts.inventory
    };

    var result = SmileyData.evaluatePlan(request);

    var recipes = ids.map(function (id) {
      var rr = (result.recipes || []).filter(function (x) { return x.recipe_id === id; })[0];
      var source = SmileyData.sourceRecipe(id);
      var methodDoc = SmileyData.method(id);
      var indexRow = D.indexById.get(id) || {};
      var sel = opts.selectionFor(id);

      var rows = [];
      (rr && rr.members || []).forEach(function (m) {
        if (m.member.role !== 'selected_recipe') return;   // components are listed separately, never double counted
        rows = rows.concat(m.rows || []);
      });

      return detach({
        recipe_id: id,
        title: rr && rr.title ? rr.title : indexRow.title || id,
        book: indexRow.book || null,
        author: indexRow.author || null,
        page: indexRow.page || null,
        source_yield: rr ? rr.source_yield : null,
        source_yield_display: SmileyYield.text(id),
        source_servings: rr ? rr.source_servings : null,
        yield_note: rr ? rr.yield_note : null,
        multiplier_basis: rr && rr.multiplier ? rr.multiplier.basis : null,
        multiplier_value: rr && rr.multiplier ? rr.multiplier.value || rr.multiplier.multiplier || null : null,
        scaled: !!opts.scaled,
        requested: {
          portions: opts.scaled ? (sel.portions === null ? null : sel.portions) : null,
          multiplier: opts.scaled ? (sel.multiplier === null ? null : sel.multiplier) : null,
          include_optional: !!sel.include_optional
        },
        rows: rows,
        components: source ? P.componentLinks(source, SmileyData.hasRecipe) : [],
        method: methodDoc ? methodDoc.method : [],
        totals: ids.length === 1 && opts.includeCosts && result.totals ? result.totals : null,
        purchase_lines: ids.length === 1 && opts.includeCosts && result.purchase_lines ? result.purchase_lines : null
      });
    });

    return {
      captured_at_utc: new Date().toISOString(),
      generation_id: D.generationId,
      mode: ids.length > 1 ? 'pack' : 'single',
      scaled: !!opts.scaled,
      include_costs: !!opts.includeCosts,
      plan_totals: ids.length > 1 && opts.includeCosts ? detach(result.totals) : null,
      request: detach(request),
      recipes: recipes,
      note: 'Detached capture of the evaluated selection at print time. Later plan edits do not change it.'
    };
  }

  /* -------------------------------------------------------------- render */

  function scaleNotice(recipe) {
    if (!recipe.scaled) return null;
    var m = recipe.requested.multiplier;
    var p = recipe.requested.portions;
    if (m === null && p === null) return null;
    var label = m !== null ? ('×' + m) : (p + ' portions');
    return 'Ingredients scaled ' + label + '. Method remains the original instructions; quantities mentioned inside steps are not rewritten.';
  }

  function headerBlock(recipe) {
    var head = el('header', { class: 'p-head' });
    head.appendChild(el('h1', { class: 'p-title', text: recipe.title }));

    var cite = [recipe.book, recipe.author, recipe.page ? 'p. ' + recipe.page : null]
      .filter(Boolean).join(' · ');
    if (cite) head.appendChild(el('p', { class: 'p-cite', text: cite }));

    head.appendChild(el('p', { class: 'p-yield', text: 'Source yield: ' + recipe.source_yield_display }));
    head.appendChild(el('p', { class: 'p-cite', text: SmileyYield.basis(recipe.source_servings) }));

    var notice = scaleNotice(recipe);
    if (notice) head.appendChild(el('p', { class: 'p-notice', text: notice }));
    else if (!recipe.scaled) head.appendChild(el('p', { class: 'p-notice quiet', text: 'Printed at the original source batch.' }));

    // Selected ingredient choices belong in the header, per the print contract.
    var chosen = [];
    (recipe.rows || []).forEach(function (row) {
      var line = P.cookingLine(row);
      if (line.chosenAlternative) chosen.push(line.chosenAlternative.replace(/-/g, ' '));
    });
    if (chosen.length) head.appendChild(el('p', { class: 'p-choices', text: 'Selected options: ' + chosen.join(', ') }));
    if (recipe.requested.include_optional) head.appendChild(el('p', { class: 'p-choices', text: 'Optional rows included in this scenario.' }));

    return head;
  }

  function ingredientLine(row) {
    var line = P.cookingLine(row);
    var li = el('li', { class: 'p-ing' + (line.optionalNotSelected ? ' p-optional' : '') });

    if (line.amount) {
      li.appendChild(el('span', { class: 'p-amt', text: line.amount.text }));
      li.appendChild(document.createTextNode(' '));
    }
    li.appendChild(el('span', { class: 'p-name', text: line.amount ? line.name : line.sourceText }));
    if (line.amount && line.prep) li.appendChild(el('span', { class: 'p-prep', text: ', ' + line.prep }));

    // No amount: the source wording above carries it, with a compact reason.
    if (!line.amount) li.appendChild(el('span', { class: 'p-qual', text: ' — ' + line.displayQualification }));
    if (line.optionalNotSelected) li.appendChild(el('span', { class: 'p-qual', text: ' (optional — not included)' }));
    if (line.amount && line.amount.warning) li.appendChild(el('span', { class: 'p-qual', text: ' — ' + line.amount.warning }));
    return li;
  }

  function ingredientsBlock(recipe) {
    var wrap = el('section', { class: 'p-block' });
    wrap.appendChild(el('h2', { class: 'p-h2', text: 'Ingredients' }));
    // An empty ingredient list is never printed silently: it means the recipe
    // record was not available to the evaluator, and the paper says so.
    if (!recipe.rows || !recipe.rows.length) {
      wrap.appendChild(el('p', {
        class: 'p-qual',
        text: 'No evaluated ingredient rows were available for this recipe when the document was captured. Nothing is omitted or zeroed here — reopen the recipe and print again.'
      }));
      return wrap;
    }
    var sections = P.groupSections(recipe.rows || []);
    sections.forEach(function (sec) {
      var group = el('div', { class: 'p-group' });
      if (sec.heading) group.appendChild(el('h3', { class: 'p-h3', text: sec.heading }));
      var ul = el('ul', { class: 'p-ings' });
      sec.rows.forEach(function (row) { ul.appendChild(ingredientLine(row)); });
      group.appendChild(ul);
      wrap.appendChild(group);
    });
    return wrap;
  }

  function componentsBlock(recipe) {
    if (!recipe.components || !recipe.components.length) return null;
    var wrap = el('section', { class: 'p-block' });
    wrap.appendChild(el('h2', { class: 'p-h2', text: 'Referenced components' }));
    var ul = el('ul', { class: 'p-ings' });
    recipe.components.forEach(function (c) {
      var li = el('li', { class: 'p-ing' });
      li.appendChild(el('span', { class: 'p-name', text: c.raw }));
      li.appendChild(el('span', {
        class: 'p-qual',
        text: c.available
          ? ' — separate recipe in this library; printed unscaled unless you print it with its own scale'
          : ' — referenced by the source; no matching recipe is available in this library'
      }));
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    return wrap;
  }

  function methodBlock(recipe) {
    var wrap = el('section', { class: 'p-block' });
    wrap.appendChild(el('h2', { class: 'p-h2', text: 'Method' }));
    if (!recipe.method || !recipe.method.length) {
      wrap.appendChild(el('p', { class: 'p-qual', text: 'No source method is supplied for this recipe id.' }));
      return wrap;
    }
    var ol = el('ol', { class: 'p-steps' });
    recipe.method.forEach(function (s) { ol.appendChild(el('li', { text: s.step })); });
    wrap.appendChild(ol);
    return wrap;
  }

  function costsBlock(model, recipe) {
    if (!model.include_costs || !recipe.totals) return null;
    var t = recipe.totals;
    var wrap = el('section', { class: 'p-block p-costs' });
    wrap.appendChild(el('h2', { class: 'p-h2', text: model.mode === 'pack' ? 'Combined plan cost notes (optional)' : 'Recorded cost notes (optional)' }));
    if (model.mode === 'pack') wrap.appendChild(el('p', {class: 'p-cost-scope', text:
      'Combined plan total for all ' + model.recipes.length + ' recipes in this pack: ' + model.recipes.map(function(r){return r.title;}).join('; ') + '. Shared purchasing demand is aggregated once. These costs are not allocated per recipe.'}));
    var use = t.theoretical_ingredient_use_cost;
    var pack = t.package_merchandise_commitment;
    wrap.appendChild(el('p', {
      text: 'Known ingredient-use subtotal: ' + (use.known_line_subtotal_money ? '$' + use.known_line_subtotal_money.display_usd : 'unknown') +
        ' (' + use.known_lines + ' priced, ' + use.unknown_lines + ' unpriced).'
    }));
    wrap.appendChild(el('p', {
      text: 'Package merchandise commitment: ' + (pack.known_line_subtotal_money ? '$' + pack.known_line_subtotal_money.display_usd : 'unknown') + '.'
    }));
    wrap.appendChild(el('p', { text: 'All-in checkout total: unknown. ' + t.all_in_checkout_reason }));
    wrap.appendChild(el('p', { text: 'Recorded prices are observations, not current availability. Printing does not refresh them.' }));
    return wrap;
  }

  function recipeSheet(model, recipe) {
    var sheet = el('article', { class: 'p-sheet' });
    sheet.setAttribute('data-recipe-id', recipe.recipe_id);
    sheet.setAttribute('data-scaled', String(!!recipe.scaled));
    sheet.appendChild(headerBlock(recipe));
    sheet.appendChild(ingredientsBlock(recipe));
    var comps = componentsBlock(recipe);
    if (comps) sheet.appendChild(comps);
    sheet.appendChild(methodBlock(recipe));
    var costs = costsBlock(model, recipe);
    if (costs) sheet.appendChild(costs);
    sheet.appendChild(el('footer', {
      class: 'p-foot',
      text: 'Smiley · ' + (recipe.book || 'source as cited') + ' · generation ' + model.generation_id +
        ' · printed ' + model.captured_at_utc.slice(0, 10) + ' · visual development prototype, recorded partial costs'
    }));
    return sheet;
  }

  /** Render the whole model into a container. Each recipe starts a new page. */
  function buildDocument(model, container) {
    while (container.firstChild) container.removeChild(container.firstChild);
    var doc = el('div', { class: 'p-doc' });
    doc.setAttribute('data-mode', model.mode);
    model.recipes.forEach(function (r) { doc.appendChild(recipeSheet(model, r)); });
    if (model.plan_totals) {
      var summary = el('article', {class: 'p-sheet p-plan-summary'});
      summary.appendChild(costsBlock(model, {totals: model.plan_totals}));
      doc.appendChild(summary);
    }
    container.appendChild(doc);
    return doc;
  }

  global.SmileyPrint = {
    captureModel: captureModel,
    buildDocument: buildDocument,
    scaleNotice: scaleNotice
  };
})(window);
