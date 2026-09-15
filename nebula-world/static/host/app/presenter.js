/* =============================================================================
 * presenter.js — ONE pure presenter, shared by the quick look, the full recipe
 * page and the print document.
 *
 * It formats values that the unchanged accepted evaluator already produced. It
 * performs no arithmetic: no scaling, no unit conversion, no rounding of a
 * quantity, no yield derivation, no costing. There is no second Rat, yield or
 * cost implementation anywhere in this file.
 *
 * The cooking amount is `row.source_quantity` — the recipe amount at the
 * selected scale. It is NOT `row.canonical_purchase`, which is a purchasing
 * amount and may legitimately be missing while the cooking amount is known.
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ units */

  /**
   * A unit like `count:egg:yolk-large` means "counted items", not a measure.
   * We show the number alone and keep the count identity as a readable note,
   * rather than inventing a measure word.
   */
  function unitLabel(unit) {
    if (!unit) return { text: '', note: null };
    var u = String(unit);
    if (u.indexOf('count:') !== 0) return { text: u, note: null };
    var parts = u.split(':').slice(1).map(function (p) { return p.replace(/-/g, ' '); });
    return { text: '', note: parts.join(' · ') };
  }

  /** Render an evaluator quantity object exactly as it came, never recomputed. */
  function formatAmount(q) {
    if (!q) return null;
    var label = unitLabel(q.unit);
    var value = q.is_range ? (q.min + '–' + q.max) : (q.display || q.min);
    return {
      value: String(value),
      unit: label.text,
      countNote: label.note,
      isRange: !!q.is_range,
      warning: q.warning || null,
      text: String(value) + (label.text ? ' ' + label.text : '')
    };
  }

  /* ------------------------------------------------------- names and states */

  function humanize(id) {
    return String(id === null || id === undefined ? '' : id).replace(/-/g, ' ');
  }

  /** The ingredient this row actually resolves to, honouring a stated choice. */
  function ingredientName(row) {
    var chosen = row.interpretation &&
      row.interpretation.selected_scenarios &&
      row.interpretation.selected_scenarios.alternative_choice;
    if (chosen && chosen.ingredient_id) return humanize(chosen.ingredient_id);
    return humanize(row.source.ingredient_id);
  }

  /* Plain-language qualification for a row whose cooking amount the source did
     not state as a single scalable number. The wording never claims a number. */
  var AMOUNT_QUALIFICATION = {
    TO_TASTE: 'to taste, as written',
    UNQUANTIFIED_OR_NONLEADING_COMPOUND: 'compound amount — see the source line',
    OPTIONAL_INCLUSION_NOT_SELECTED: 'optional, not included in this scenario',
    SHARED_PARENT_RELATION_REQUIRED: 'amount as written'
  };

  /* Purchasing gaps are a purchasing problem. They are described here so the
     purchasing surfaces can say it plainly, and they never touch the cooking
     amount. */
  var PURCHASING_NOTE = 'Some purchasing amounts need a conversion';

  /**
   * The single cooking line for one evaluated ingredient row.
   * @returns {{amount, name, prep, qualification, sourceText, purchasingHeld,
   *            optionalNotSelected, alternatives, chosenAlternative, index}}
   */
  function cookingLine(row) {
    var amount = formatAmount(row.source_quantity);
    var gapReason = row.gap ? row.gap.reason : null;
    var chosen = row.interpretation &&
      row.interpretation.selected_scenarios &&
      row.interpretation.selected_scenarios.alternative_choice;

    return {
      index: row.occurrence.ingredient_index,
      amount: amount,                                   // null when the source gave no scalable number
      name: ingredientName(row),
      prep: row.source.prep || '',
      // Shown only when there is no amount: the source's own wording carries it.
      qualification: amount ? null : (AMOUNT_QUALIFICATION[gapReason] || 'amount as written'),
      // Legacy qualification remains diagnostic for inherited contracts.
      // Surface wording must be supported by the literal source, never a broad category.
      displayQualification: amount ? null : (gapReason === 'TO_TASTE'
        ? (/\bto taste\b/i.test(row.source.raw || '') ? 'to taste, as written' : 'Amount not specified')
        : (AMOUNT_QUALIFICATION[gapReason] || 'amount as written')),
      sourceText: row.source.raw || '',
      // A missing purchase conversion never relabels a known cooking amount.
      purchasingHeld: !row.canonical_purchase,
      purchasingReason: row.canonical_purchase ? null : gapReason,
      optionalNotSelected: gapReason === 'OPTIONAL_INCLUSION_NOT_SELECTED',
      alternatives: (row.source.alternatives || []).map(function (a) { return a.id; }),
      chosenAlternative: chosen ? chosen.ingredient_id : null,
      group: row.source.group || null,
      choiceGroup: row.source.choice_group || null,
      flexibleGroup: row.source.flexible_group || null,
      percentageOf: row.source.percentage_of || null,
      normalisedFrom: (row.source.original_id && row.source.original_id !== row.source.ingredient_id)
        ? row.source.original_id : null
    };
  }

  /**
   * Ingredient rows grouped under their own source section heading, in source
   * order. A row's group comes from the source line itself; nothing is inferred
   * from titles, and the parent recipe is never counted twice.
   */
  function groupSections(rows) {
    var order = [];
    var byKey = {};
    rows.forEach(function (row) {
      var key = row.source.group || '';
      if (!byKey[key]) {
        byKey[key] = { key: key, heading: key ? key : null, rows: [] };
        order.push(key);
      }
      byKey[key].rows.push(row);
    });
    return order.map(function (k) { return byKey[k]; });
  }

  /**
   * Component references declared on the source record. Only an explicit id may
   * link; an id that is not in this library says so instead of guessing by name.
   */
  function componentLinks(source, hasRecipe) {
    return (source.components || []).map(function (c, i) {
      var known = !!(c.id && hasRecipe(c.id));
      return {
        index: i,
        id: c.id || null,
        available: known,
        raw: c.raw || '',
        qty: c.qty === null || c.qty === undefined ? null : c.qty,
        unit: c.unit || null,
        // No supported basis for scaling an appended component is stated here.
        scaledBasis: false,
        note: known
          ? 'Explicit component reference in this library.'
          : 'Referenced by the source, but no matching recipe id is available in this library.'
      };
    });
  }

  /* --------------------------------------------------------------- timing */

  var DURATION = /\b\d+(?:\s*[–-]\s*\d+)?\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|overnight)\b/i;

  /**
   * Literal duration excerpts, quoted from the source method. Nothing is added
   * up, nothing is scaled, and no prep/cook split is manufactured.
   */
  function durationExcerpts(methodSteps, limit) {
    var out = [];
    (methodSteps || []).forEach(function (step, i) {
      if (out.length >= (limit || 3)) return;
      var text = step.step || '';
      var m = text.match(DURATION);
      if (!m) return;
      var at = text.indexOf(m[0]);
      var from = Math.max(0, at - 60);
      var to = Math.min(text.length, at + m[0].length + 60);
      out.push({
        stepNumber: i + 1,
        excerpt: (from > 0 ? '…' : '') + text.slice(from, to).trim() + (to < text.length ? '…' : '')
      });
    });
    return out;
  }

  /**
   * What may honestly be said about time. `time_total_min` exists on some source
   * records, but its provenance is unknown, so it is never presented as a time,
   * never summed and never certified. It is disclosed in the evidence surface.
   */
  function timingStatement(source) {
    return {
      stated: false,
      text: 'Total time: not stated. The source does not carry a verified total, so none is shown.',
      metadataPresent: source && source.time_total_min !== null && source.time_total_min !== undefined,
      metadataValue: source ? source.time_total_min : null,
      metadataNote: 'A total-time metadata value exists on some source records. Its provenance is not established, ' +
        'so it is recorded as evidence only and is never displayed as a time, added up or scaled.'
    };
  }

  /* -------------------------------------------------------------- overview */

  /**
   * A short factual outline built only from tokens that are actually in the
   * source: its own yield wording, its sections, its ingredient count and its
   * first method step. No taste, nutrition, health, dietary or difficulty claim,
   * and no model call.
   */
  function overview(source, methodSteps) {
    var sections = [];
    (source.ingredients || []).forEach(function (ing) {
      if (ing.group && sections.indexOf(ing.group) < 0) sections.push(ing.group);
    });
    return {
      yieldText: source.yield_text || (source.base_yield ? source.base_yield.raw : null) ||
        (source.base_servings ? source.base_servings + ' servings' : null),
      ingredientCount: (source.ingredients || []).length,
      stepCount: (methodSteps || []).length,
      sections: sections,
      componentCount: (source.components || []).length,
      firstStep: (methodSteps && methodSteps[0]) ? methodSteps[0].step : null,
      note: 'Outline assembled from the source record itself — its sections, ingredient rows and method text.'
    };
  }

  global.SmileyPresenter = {
    unitLabel: unitLabel,
    formatAmount: formatAmount,
    humanize: humanize,
    ingredientName: ingredientName,
    cookingLine: cookingLine,
    groupSections: groupSections,
    componentLinks: componentLinks,
    durationExcerpts: durationExcerpts,
    timingStatement: timingStatement,
    overview: overview,
    PURCHASING_NOTE: PURCHASING_NOTE
  };
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof module === 'object' && module.exports) {
  module.exports = (typeof window !== 'undefined' ? window : globalThis).SmileyPresenter;
}
