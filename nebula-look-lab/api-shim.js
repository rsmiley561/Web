/* Static API shim for the Deep Nebula x Culinary Cosmos v4 look lab.
 *
 * Answers fetch('/api/...') from responses recorded byte-exact from the real v4
 * server. Recorded payloads are replayed unmodified; only the per-request
 * correlation fields the client generates fresh each call (request id, client
 * generation) are re-stamped, because host-client.js rejects an envelope whose
 * transport block does not echo the request it just made.
 *
 * Anything not recorded returns the producer's own rejection envelope with
 * NOT_RECORDED_IN_STATIC_CAPTURE. It never returns zero, a fabricated
 * relationship, or a NOT_ESTABLISHED state that was not actually observed.
 */
(function () {
  'use strict';

  var BASE = new URL('.', document.currentScript.src).href;
  var nativeFetch = window.fetch.bind(window);

  // Must mirror the recorder's key function exactly.
  var VOLATILE = {generation: 1, request_id: 1, delay: 1, intent: 1};
  function keyFor(pathname, params) {
    var parts = [];
    var entries = [];
    params.forEach(function (v, k) { entries.push([k, v]); });
    entries.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
    for (var i = 0; i < entries.length; i++) {
      if (!VOLATILE[entries[i][0]]) parts.push(entries[i][0] + '=' + entries[i][1]);
    }
    return pathname + (parts.length ? '?' + parts.join('&') : '');
  }

  var indexPromise = nativeFetch(BASE + 'api/index.json').then(function (r) { return r.json(); });
  var notRecordedPromise = nativeFetch(BASE + 'api/not-recorded.json').then(function (r) { return r.json(); });

  // Test hook. The package's own motion test holds a LIST_GENERIC_PARTNERS
  // response at the network layer to photograph the honest loading state. A
  // fetch-level shim never reaches that layer, so the same pause is offered
  // here. It is inert unless a harness calls it.
  var holds = Object.create(null);
  function heldFor(operation) {
    return operation && holds[operation] ? holds[operation] : null;
  }

  function json(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: {'content-type': 'application/json; charset=utf-8'},
    });
  }

  function notRecorded(operation, requestId, generation) {
    return notRecordedPromise.then(function (tmpl) {
      var body = JSON.parse(JSON.stringify(tmpl));
      body.operation = operation || null;
      body.request_id = requestId || null;
      body.transport.client_request_id = requestId || null;
      body.transport.requested_client_generation = generation;
      // accepted:false makes the app surface its own honest failure path.
      return json(body, 200);
    });
  }

  function handle(url) {
    var pathname = url.pathname;
    var params = url.searchParams;
    var requestId = params.get('request_id');
    var generation = Number(params.get('generation'));
    var operation = params.get('operation');

    // Fire-and-forget cancel: the app ignores the body, but answer truthfully.
    if (pathname === '/api/flavor-generalized/cancel') {
      return Promise.resolve(json({
        cancelled: false,
        transport: {
          schema: 'smiley.flavor-generalized-bridge-correlation.v1',
          client_request_id: requestId,
          requested_client_generation: null,
          allocated_producer_generation: null,
          cancelled: false,
        },
        note: 'Static capture: there is no in-flight producer generation to cancel.',
      }, 200));
    }

    var held = heldFor(operation);
    return (held || Promise.resolve()).then(function () {
    return indexPromise.then(function (index) {
      var key = keyFor(pathname, params);
      var hit = index[key];
      if (!hit) {
        if (pathname === '/api/flavor-generalized') return notRecorded(operation, requestId, generation);
        return json({code: 'NOT_RECORDED_IN_STATIC_CAPTURE', error: 'NOT_RECORDED_IN_STATIC_CAPTURE',
                     detail: 'This query was not recorded from the real v4 server.'}, 404);
      }
      return nativeFetch(BASE + 'api/responses/' + hit.file).then(function (r) { return r.text(); })
        .then(function (text) {
          if (pathname !== '/api/flavor-generalized') {
            // /api/recipes, /api/recipe/:id, /api/catalog, /api/binding carry no
            // per-request correlation — replay the recorded bytes untouched.
            return new Response(text, {status: hit.status,
              headers: {'content-type': 'application/json; charset=utf-8'}});
          }
          var body = JSON.parse(text);
          // Re-stamp ONLY the correlation block. payload, pins, producer and the
          // producer-allocated generation stay exactly as recorded.
          if (body.transport) {
            body.transport.client_request_id = requestId;
            body.transport.requested_client_generation = generation;
            body.transport.allocated_producer_generation = body.generation;
          }
          return json(body, hit.status);
        });
    });
    });
  }

  window.fetch = function (input, init) {
    var raw = typeof input === 'string' ? input : (input && input.url) || String(input);
    var url;
    try { url = new URL(raw, location.href); } catch (e) { return nativeFetch(input, init); }
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
      return nativeFetch(input, init);
    }
    // Honour an already-aborted signal the way the network path would.
    var signal = init && init.signal;
    if (signal && signal.aborted) {
      return Promise.reject(Object.assign(new Error('The operation was aborted.'), {name: 'AbortError'}));
    }
    return new Promise(function (resolve, reject) {
      var onAbort = function () {
        reject(Object.assign(new Error('The operation was aborted.'), {name: 'AbortError'}));
      };
      if (signal) signal.addEventListener('abort', onAbort, {once: true});
      handle(url).then(function (res) {
        if (signal) signal.removeEventListener('abort', onAbort);
        if (signal && signal.aborted) return onAbort();
        resolve(res);
      }, function (err) {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(err);
      });
    });
  };

  window.__NEBULA_STATIC_SHIM__ = {
    ready: indexPromise.then(function (i) { return Object.keys(i).length; }),
    // hold('LIST_GENERIC_PARTNERS') -> call the returned name to release.
    hold: function (operation) {
      var release;
      holds[operation] = new Promise(function (r) { release = r; });
      window.__NEBULA_RELEASE__ = function () { delete holds[operation]; release(); };
      return true;
    },
  };
})();
