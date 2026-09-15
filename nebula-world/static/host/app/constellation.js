/* =============================================================================
 * constellation.js — the optional connections map.
 *
 * V02: this is a way to explore what the sources record, not a landing page and
 * not outer space. It is reached only from an explicit "Explore connections"
 * action, it never selects anything on load, and its decoration is restrained:
 * no star field, no shimmer, no celestial language.
 *
 * Rules this file keeps:
 *  - Only two relations are ever drawn:
 *      recipe -> listed ingredient entry   (from index ingredient_ids)
 *      recipe -> recipe, same source book  (opt-in, off by default)
 *    No similarity, affinity or "goes well with" link is invented.
 *  - Position, ring and angle carry NO meaning. They are a deterministic
 *    function of the focused node and each id, so the layout never reshuffles.
 *  - The node cap limits DRAWING only. Search always covers all 1,497 recipes.
 *  - The pantry filter hides links from view, discloses how many, is reversible,
 *    and never hides an ingredient the user has actually focused.
 *  - No physics loop, no animation behind text, no hover-only behaviour.
 * ========================================================================== */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var VIEW_W = 1200, VIEW_H = 800;

  var cfg = {
    svg: null,
    onSelectNode: function () {},
    onEdgeInspect: function () {},
    onNeighborhood: function () {}
  };

  var view = {
    focus: null,              // {type:'recipe'|'ingredient', id}
    hidePantry: true,
    showBookLinks: false,
    cx: 0, cy: 0, scale: 1,   // pan/zoom of the viewBox
    nodes: [],
    edges: [],
    hiddenPantryCount: 0,
    cap: 48
  };

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, String(attrs[k]));
    return node;
  }

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }

  function isMobile() { return window.matchMedia('(max-width: 860px)').matches; }

  function nodeCap() { return isMobile() ? 22 : 48; }

  /* SVG user units per CSS pixel, so node and label sizes stay constant on
     screen instead of shrinking on a narrow phone viewport. */
  function unitsPerPx() {
    var w = cfg.svg && cfg.svg.clientWidth ? cfg.svg.clientWidth : 1200;
    var h = cfg.svg && cfg.svg.clientHeight ? cfg.svg.clientHeight : 800;
    var scale = Math.min(w / (VIEW_W / view.scale), h / (VIEW_H / view.scale));
    return scale > 0 ? 1 / scale : 1;
  }

  function titleFor(id) {
    var row = SmileyData.state.indexById.get(id);
    return row ? row.title : id;
  }

  function ingredientLabel(id) {
    return String(id).replace(/-/g, ' ');
  }

  /* ------------------------------------------------------------------ model */

  /**
   * Build the focus neighborhood.
   * Ring 0 = the focused node. Ring 1 = its direct source-backed neighbours.
   * Ring 2 = one further step, kept small, so the field stays legible.
   */
  function buildNeighborhood() {
    var D = SmileyData.state;
    var cap = view.cap = nodeCap();
    var nodes = [];
    var edges = [];
    var seen = new Set();
    view.hiddenPantryCount = 0;

    function addNode(n) {
      if (seen.has(n.key)) return false;
      if (nodes.length >= cap) return false;
      seen.add(n.key);
      nodes.push(n);
      return true;
    }

    var focus = view.focus;
    if (!focus) return { nodes: nodes, edges: edges };

    if (focus.type === 'recipe') {
      var row = D.indexById.get(focus.id);
      if (!row) return { nodes: nodes, edges: edges };
      addNode({ key: 'r:' + row.recipe_id, kind: 'recipe', id: row.recipe_id, label: row.title, ring: 0 });

      var ings = (row.ingredient_ids || []).slice();
      var shown = ings.filter(function (i) {
        if (view.hidePantry && D.pantryIds.has(i) && !(focus.type === 'ingredient' && focus.id === i)) {
          view.hiddenPantryCount++;
          return false;
        }
        return true;
      });
      // rarest first: a single-recipe ingredient says more about this recipe
      shown.sort(function (a, b) { return (D.ingredientCounts.get(a) || 0) - (D.ingredientCounts.get(b) || 0); });

      shown.forEach(function (ing) {
        if (addNode({ key: 'i:' + ing, kind: 'ingredient', id: ing, label: ingredientLabel(ing), ring: 1 })) {
          edges.push({ kind: 'contains', from: 'r:' + row.recipe_id, to: 'i:' + ing, recipe_id: row.recipe_id, ingredient_id: ing });
        }
      });

      // Ring 2: other recipes that list the rarest of those ingredients.
      var budget = Math.max(0, cap - nodes.length);
      var perIngredient = isMobile() ? 1 : 4;
      for (var s = 0; s < shown.length && budget > 0; s++) {
        var others = SmileyData.recipesWithIngredient(shown[s]).filter(function (rid) { return rid !== row.recipe_id; });
        for (var o = 0; o < others.length && o < perIngredient && budget > 0; o++) {
          var rid = others[o];
          if (addNode({ key: 'r:' + rid, kind: 'recipe', id: rid, label: titleFor(rid), ring: 2 })) {
            budget--;
            edges.push({ kind: 'contains', from: 'r:' + rid, to: 'i:' + shown[s], recipe_id: rid, ingredient_id: shown[s] });
          } else if (seen.has('r:' + rid)) {
            edges.push({ kind: 'contains', from: 'r:' + rid, to: 'i:' + shown[s], recipe_id: rid, ingredient_id: shown[s] });
          }
        }
      }

      if (view.showBookLinks && row.book) {
        var sameBook = D.index.recipes.filter(function (x) { return x.book === row.book && x.recipe_id !== row.recipe_id; });
        var take = isMobile() ? 3 : 6;
        for (var b = 0; b < sameBook.length && b < take; b++) {
          var br = sameBook[b];
          var added = addNode({ key: 'r:' + br.recipe_id, kind: 'recipe', id: br.recipe_id, label: br.title, ring: 2 });
          if (added || seen.has('r:' + br.recipe_id)) {
            edges.push({ kind: 'same_book', from: 'r:' + row.recipe_id, to: 'r:' + br.recipe_id, book: row.book });
          }
        }
      }
    } else {
      // focused ingredient: the recipes that actually list it
      addNode({ key: 'i:' + focus.id, kind: 'ingredient', id: focus.id, label: ingredientLabel(focus.id), ring: 0 });
      var members = SmileyData.recipesWithIngredient(focus.id);
      for (var m = 0; m < members.length; m++) {
        var mid = members[m];
        if (!addNode({ key: 'r:' + mid, kind: 'recipe', id: mid, label: titleFor(mid), ring: 1 })) break;
        edges.push({ kind: 'contains', from: 'r:' + mid, to: 'i:' + focus.id, recipe_id: mid, ingredient_id: focus.id });
      }
    }

    return { nodes: nodes, edges: edges, memberTotal: focus.type === 'ingredient' ? SmileyData.recipesWithIngredient(focus.id).length : null };
  }

  /* Deterministic layout: ring radius by depth, angle by position in ring plus a
     stable per-id offset. Same focus -> same picture, every time. */
  function layout(nodes) {
    var byRing = { 0: [], 1: [], 2: [] };
    nodes.forEach(function (n) { byRing[n.ring].push(n); });

    byRing[0].forEach(function (n) { n.x = 0; n.y = 0; });

    [1, 2].forEach(function (ring) {
      var list = byRing[ring];
      var radius = ring === 1 ? 210 : 400;
      var count = list.length || 1;
      list.forEach(function (n, i) {
        var jitter = ((hash(n.key) % 1000) / 1000 - 0.5) * (Math.PI / (count * 1.6));
        var angle = (i / count) * Math.PI * 2 + (ring === 2 ? Math.PI / count : 0) + jitter;
        var rr = radius + ((hash(n.key + ring) % 60) - 30);
        n.x = Math.cos(angle) * rr;
        n.y = Math.sin(angle) * rr * 0.72;
      });
    });
    return nodes;
  }

  /* ------------------------------------------------------------------ render */

  function applyViewBox() {
    var w = VIEW_W / view.scale, h = VIEW_H / view.scale;
    cfg.svg.setAttribute('viewBox', (view.cx - w / 2) + ' ' + (view.cy - h / 2) + ' ' + w + ' ' + h);
  }

  /* V02: the decorative star field was removed. The map's background is plain. */

  function nodeShape(n, focused, k) {
    var g = el('g', {
      class: 'node',
      'data-key': n.key,
      transform: 'translate(' + n.x.toFixed(1) + ',' + n.y.toFixed(1) + ')',
      tabindex: '0',
      role: 'button'
    });
    g.setAttribute('aria-label',
      (n.kind === 'recipe' ? 'Recipe: ' : 'Ingredient: ') + n.label +
      (n.kind === 'ingredient' ? ' — listed in ' + (SmileyData.state.ingredientCounts.get(n.id) || 0) + ' recipes' : ''));

    var r = (n.ring === 0 ? 13 : (n.kind === 'recipe' ? 9 : 6)) * k;

    if (focused) {
      g.appendChild(el('circle', { r: r + 10 * k, fill: 'none', stroke: '#baf76a', 'stroke-width': 1.2 * k, opacity: '.55' }));
    }

    if (n.kind === 'recipe') {
      // A rounded card mark: recipes read as recipe cards, not as stars.
      var w = r * 1.9, h = r * 1.45, rad = r * 0.42;
      g.appendChild(el('rect', {
        x: (-w / 2).toFixed(2), y: (-h / 2).toFixed(2), width: w.toFixed(2), height: h.toFixed(2), rx: rad.toFixed(2),
        fill: focused ? '#def5e2' : '#7db7c4', opacity: n.ring === 2 ? '.78' : '1'
      }));
      g.appendChild(el('rect', {
        x: (-w / 2).toFixed(2), y: (-h / 2).toFixed(2), width: w.toFixed(2), height: h.toFixed(2), rx: rad.toFixed(2),
        fill: 'none', stroke: '#baf76a', 'stroke-width': (focused ? 1.6 : 0.9) * k, opacity: focused ? '.9' : '.45'
      }));
      g.appendChild(el('line', {
        x1: (-w / 2 + rad * 0.6).toFixed(2), y1: (h / 2 - h * 0.3).toFixed(2),
        x2: (w / 2 - rad * 0.6).toFixed(2), y2: (h / 2 - h * 0.3).toFixed(2),
        stroke: '#25464d', 'stroke-width': 0.9 * k, opacity: '.7'
      }));
    } else {
      // ingredients are open circles
      g.appendChild(el('circle', { r: r, fill: '#10232e', stroke: focused ? '#baf76a' : '#77d5c3', 'stroke-width': (focused ? 2.4 : 1.6) * k }));
      g.appendChild(el('circle', { r: Math.max(1.6, r * 0.34), fill: focused ? '#baf76a' : '#77d5c3' }));
    }

    g.appendChild(el('circle', { class: 'node-hit', r: Math.max(24 * k, r + 12 * k), fill: 'transparent', stroke: 'transparent', 'stroke-width': 0 }));
    return g;
  }

  function nodeLabel(n, focused, k) {
    var cls = 'node-label ' + (n.ring === 0 ? 'near' : n.ring === 1 ? 'near' : 'far');

    /* Labels sit radially outward from the centre so a ring-1 name cannot land
       on top of the focused node or on the ring's inner neighbours. */
    var dx = 0, dy = (n.ring === 0 ? 42 : n.kind === 'recipe' ? 24 : 20) * k, anchor = 'middle';
    if (n.ring !== 0) {
      var len = Math.sqrt(n.x * n.x + n.y * n.y) || 1;
      var ux = n.x / len, uy = n.y / len;
      var off = (n.kind === 'recipe' ? 20 : 15) * k;
      dx = ux * off;
      dy = uy * off + 4 * k;
      anchor = ux > 0.34 ? 'start' : ux < -0.34 ? 'end' : 'middle';
      if (anchor === 'middle') dy += (uy >= 0 ? 8 : -4) * k;
    }

    var text = el('text', {
      class: cls,
      x: dx.toFixed(1),
      y: dy.toFixed(1),
      'text-anchor': anchor,
      'font-size': ((n.ring === 0 || focused) ? 14 : n.ring === 1 ? 12 : 10.5) * k
    });
    var label = n.label;
    var max = isMobile() ? (n.ring === 0 ? 22 : 16) : (n.ring === 2 ? 22 : 34);
    if (label.length > max) label = label.slice(0, max - 1) + '…';
    text.appendChild(document.createTextNode(label));
    var g = el('g', { transform: 'translate(' + n.x.toFixed(1) + ',' + n.y.toFixed(1) + ')', 'aria-hidden': 'true' });
    if (focused) text.setAttribute('class', cls + ' near');
    g.appendChild(text);
    return g;
  }

  function render() {
    var old = {}; view.nodes.forEach(function(n){old[n.key]=n;});
    var built = buildNeighborhood();
    var nodes = layout(built.nodes);
    var edges = built.edges;
    view.nodes = nodes;
    view.edges = edges;

    var k = unitsPerPx();
    var byKey = {};
    nodes.forEach(function (n) { byKey[n.key] = n; });

    while (cfg.svg.firstChild) cfg.svg.removeChild(cfg.svg.firstChild);

    var edgeLayer = el('g', { 'aria-hidden': 'true' });
    var hitLayer = el('g');
    edges.forEach(function (e, i) {
      var a = byKey[e.from], b = byKey[e.to];
      if (!a || !b) return;
      var line = el('line', {
        class: 'edge' + (e.kind === 'same_book' ? ' book' : ''),
        'stroke-width': k,
        x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1)
      });
      edgeLayer.appendChild(line);

      var hit = el('line', {
        class: 'edge-hit', 'stroke-width': 16 * k, x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1),
        tabindex: '0', role: 'button'
      });
      hit.setAttribute('aria-label', e.kind === 'same_book'
        ? 'Link: same source book, ' + e.book
        : 'Link: ' + titleFor(e.recipe_id) + ' lists ' + ingredientLabel(e.ingredient_id) + '. Open the source line.');
      function inspect(ev) { ev.preventDefault(); ev.stopPropagation(); cfg.onEdgeInspect(e); }
      hit.addEventListener('click', inspect);
      hit.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') inspect(ev); });
      hitLayer.appendChild(hit);
    });
    cfg.svg.appendChild(edgeLayer);
    cfg.svg.appendChild(hitLayer);

    var labelLayer = el('g', { 'aria-hidden': 'true' });
    var nodeLayer = el('g');
    nodes.forEach(function (n) {
      var focused = view.focus && ((view.focus.type === 'recipe' && n.kind === 'recipe' && n.id === view.focus.id) ||
                                   (view.focus.type === 'ingredient' && n.kind === 'ingredient' && n.id === view.focus.id));
      var shape = nodeShape(n, focused, k);
      function select(ev) { ev.preventDefault(); ev.stopPropagation(); cfg.onSelectNode({ type: n.kind, id: n.id }); }
      shape.addEventListener('click', select);
      shape.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') select(ev); });
      nodeLayer.appendChild(shape);
      // Shared nodes travel from their previous position to the new neighborhood.
      // New nodes enter close to the selected center; edges remain factual/static.
      if(document.body.dataset.motion==='on') { var prev=old[n.key],dx=prev?prev.x-n.x:-n.x*.12,dy=prev?prev.y-n.y:-n.y*.12;
        shape.animate([{transform:'translate('+(n.x+dx)+'px,'+(n.y+dy)+'px)',opacity:prev?1:.3},{transform:'translate('+n.x+'px,'+n.y+'px)',opacity:1}],{duration:360,easing:'cubic-bezier(.2,.8,.2,1)'});
      }
      // Progressive labels: the focus and its direct neighbours stay readable;
      // the outer ring stays subordinate, and on a phone it is not labelled at all
      // (those nodes are still tappable and are listed in the list view).
      if (focused || n.ring !== 2 || (!isMobile() && nodes.length <= 30)) labelLayer.appendChild(nodeLabel(n, focused, k));
    });
    cfg.svg.appendChild(labelLayer);
    cfg.svg.appendChild(nodeLayer);

    applyViewBox();
    cfg.onNeighborhood({
      nodes: nodes,
      edges: edges,
      cap: view.cap,
      hiddenPantryCount: view.hiddenPantryCount,
      hidePantry: view.hidePantry,
      showBookLinks: view.showBookLinks,
      memberTotal: built.memberTotal,
      focus: view.focus
    });
  }

  /* ------------------------------------------------------------------- input */

  function wirePanZoom() {
    var dragging = false, last = null;
    function down(ev) {
      if (ev.target.closest && (ev.target.closest('.node') || ev.target.closest('.edge-hit'))) return;
      dragging = true;
      last = pointer(ev);
      cfg.svg.style.cursor = 'grabbing';
    }
    function move(ev) {
      if (!dragging) return;
      var p = pointer(ev);
      var k = (VIEW_W / view.scale) / cfg.svg.clientWidth;
      view.cx -= (p.x - last.x) * k;
      view.cy -= (p.y - last.y) * k;
      last = p;
      applyViewBox();
    }
    function up() { dragging = false; cfg.svg.style.cursor = ''; }
    function pointer(ev) {
      var t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      return { x: t.clientX, y: t.clientY };
    }
    cfg.svg.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    cfg.svg.addEventListener('touchstart', down, { passive: true });
    cfg.svg.addEventListener('touchmove', move, { passive: true });
    cfg.svg.addEventListener('touchend', up);
  }

  function init(options) {
    cfg.svg = options.svg;
    cfg.onSelectNode = options.onSelectNode || cfg.onSelectNode;
    cfg.onEdgeInspect = options.onEdgeInspect || cfg.onEdgeInspect;
    cfg.onNeighborhood = options.onNeighborhood || cfg.onNeighborhood;
    cfg.svg.setAttribute('viewBox', '-600 -400 1200 800');
    wirePanZoom();
    window.addEventListener('resize', function () {
      if (view.focus) render();
    });
  }

  function focus(target) {
    view.focus = target;
    view.cx = 0; view.cy = 0; view.scale = 1;
    render();
  }

  function setPantryHidden(flag) { view.hidePantry = !!flag; render(); }
  function setBookLinks(flag) { view.showBookLinks = !!flag; render(); }
  function resetView() { view.cx = 0; view.cy = 0; view.scale = 1; applyViewBox(); }
  function zoom(factor) {
    view.scale = Math.min(2.6, Math.max(0.45, view.scale * factor));
    applyViewBox();
  }

  global.SmileyMap = {
    init: init,
    focus: focus,
    current: function () { return view.focus; },
    setPantryHidden: setPantryHidden,
    setBookLinks: setBookLinks,
    resetView: resetView,
    zoom: zoom,
    rerender: render
  };
})(window);
