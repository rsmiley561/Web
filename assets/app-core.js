/* ---------------------------------------------------------------------------
   Shared behaviour for both design directions.
   Rendering lives in each direction's own app.js; anything that behaves
   identically regardless of design lives here.
--------------------------------------------------------------------------- */
(function (root) {
  'use strict';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));
  // Resolves an asset path. Normally a no-op; a self-contained preview build
  // (tools/inline.mjs) pre-populates window.__ASSETS with data URIs so the
  // same rendering code works with no external files at all.
  const asset = (p) => (root.__ASSETS && root.__ASSETS[p]) || p;

  const esc = (s) =>
    String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );

  /* ------------------------------ reveals ------------------------------ */
  // Content is visible by default; the hidden start state only applies once
  // the `js` class is on <html> (set by an inline script in the head). So a
  // failed observer, a JS error, or no JS at all still shows the whole page.
  const showAll = (els) => els.forEach((el) => el.classList.add('is-in'));

  function watch(els) {
    if (reduced || !('IntersectionObserver' in window)) return showAll(els);
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.style.setProperty('--d', e.target.dataset.d || 0);
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        });
      },
      // threshold 0 + a small negative bottom margin: fires as soon as any
      // part of the element is meaningfully on screen, so fast scrolling
      // cannot skip a section and leave it blank.
      { rootMargin: '0px 0px -4% 0px', threshold: 0 }
    );
    els.forEach((el) => io.observe(el));
  }

  function reveals() { watch($$('.reveal')); }

  // Elements added after first paint (gallery tiles, plans) need watching too.
  function observeNew(scope) { watch($$('.reveal:not(.is-in)', scope)); }

  /** Reveal everything immediately — used by the screenshot harness. */
  function revealAll() { showAll($$('.reveal')); }

  /* --------------------------- sticky header --------------------------- */
  function header(el) {
    if (!el) return;
    const onScroll = () => el.classList.toggle('is-stuck', window.scrollY > 24);
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------------------------- mobile nav ----------------------------- */
  function mobnav(burger, panel) {
    if (!burger || !panel) return;
    const set = (open) => {
      burger.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      if (open) panel.setAttribute('data-open', '');
      else panel.removeAttribute('data-open');
      document.body.style.overflow = open ? 'hidden' : '';
    };
    burger.addEventListener('click', () =>
      set(burger.getAttribute('aria-expanded') !== 'true')
    );
    panel.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') set(false);
    });
    addEventListener('keydown', (e) => e.key === 'Escape' && set(false));
  }

  /* ---------------------- pointer glow on buttons ---------------------- */
  function magnetic(selector) {
    if (reduced) return;
    document.addEventListener(
      'pointermove',
      (e) => {
        const btn = e.target.closest(selector);
        if (!btn) return;
        const r = btn.getBoundingClientRect();
        btn.style.setProperty('--mx', `${e.clientX - r.left}px`);
        btn.style.setProperty('--my', `${e.clientY - r.top}px`);
      },
      { passive: true }
    );
  }

  /* ------------------------------ lightbox ----------------------------- */
  function lightbox(opts) {
    const box = $(opts.box);
    if (!box) return () => {};
    const img = $(opts.img);
    const title = $(opts.title);
    const note = $(opts.note);
    let list = [];
    let i = 0;
    let lastFocus = null;

    const show = () => {
      const it = list[i];
      if (!it) return;
      img.src = asset(`../assets/img/${it.id}-p.webp`);
      img.alt = `${it.title} — ${it.note}`;
      title.textContent = it.title;
      note.textContent = it.note;
    };
    const open = (items, index) => {
      list = items;
      i = index;
      lastFocus = document.activeElement;
      box.hidden = false;
      document.body.style.overflow = 'hidden';
      show();
      $(opts.close).focus();
    };
    const close = () => {
      box.hidden = true;
      document.body.style.overflow = '';
      if (lastFocus) lastFocus.focus();
    };
    const step = (d) => {
      i = (i + d + list.length) % list.length;
      show();
    };

    $(opts.close).addEventListener('click', close);
    $(opts.prev).addEventListener('click', () => step(-1));
    $(opts.next).addEventListener('click', () => step(1));
    box.addEventListener('click', (e) => {
      if (e.target === box) close();
    });
    addEventListener('keydown', (e) => {
      if (box.hidden) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    });

    return open;
  }

  /* ------------------------------- form -------------------------------- */
  /**
   * Multi-step inquiry form.
   *
   * Submission: if window.FORM_ENDPOINT is set (Formspree, Basin, a Netlify
   * function, whatever) the payload is POSTed there. With no endpoint
   * configured it falls back to opening a prefilled email — which is honest
   * about what happened rather than showing a fake "sent" state.
   */
  function form(opts) {
    const f = $(opts.form);
    if (!f) return;
    const steps = $$('.step', f);
    const bar = $(opts.bar);
    const count = $(opts.count);
    const back = $(opts.back);
    const next = $(opts.next);
    const send = $(opts.send);
    const err = $(opts.err);
    const done = $(opts.done);
    const doneBody = $(opts.doneBody);
    let at = 0;

    const paint = () => {
      steps.forEach((s, n) => s.classList.toggle('is-on', n === at));
      bar.style.width = `${((at + 1) / steps.length) * 100}%`;
      count.textContent = `Step ${at + 1} of ${steps.length}`;
      back.hidden = at === 0;
      next.hidden = at === steps.length - 1;
      send.hidden = at !== steps.length - 1;
      err.hidden = true;
    };

    const valid = () => {
      const cur = steps[at];
      const required = $$('[required]', cur);
      for (const el of required) {
        const ok =
          el.type === 'radio'
            ? !!f.querySelector(`[name="${el.name}"]:checked`)
            : el.checkValidity() && el.value.trim() !== '';
        if (!ok) {
          err.textContent =
            el.type === 'radio'
              ? 'Pick one to carry on.'
              : el.type === 'email'
              ? 'That email does not look right.'
              : 'This one is needed.';
          err.hidden = false;
          if (el.type !== 'radio') {
            el.setAttribute('aria-invalid', 'true');
            el.focus();
          }
          return false;
        }
        el.removeAttribute('aria-invalid');
      }
      return true;
    };

    next.addEventListener('click', () => {
      if (!valid()) return;
      at = Math.min(at + 1, steps.length - 1);
      paint();
      f.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    });
    back.addEventListener('click', () => {
      at = Math.max(at - 1, 0);
      paint();
    });

    const LABELS = {
      service: 'Service', household: 'Household', diet: 'Dietary',
      likes: 'Loves', city: 'City', start: 'Start', budget: 'Budget',
      name: 'Name', email: 'Email', phone: 'Phone', notes: 'Notes',
    };

    f.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!valid()) return;
      const data = new FormData(f);
      if (data.get('_gotcha')) return; // bot

      const payload = {};
      for (const [k, v] of data.entries()) {
        if (k !== '_gotcha' && String(v).trim()) payload[k] = String(v).trim();
      }

      const lines = Object.keys(LABELS)
        .filter((k) => payload[k])
        .map((k) => `${LABELS[k]}: ${payload[k]}`)
        .join('\n');

      const finish = (msg) => {
        f.hidden = true;
        done.hidden = false;
        doneBody.textContent = msg;
        done.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      };

      if (root.FORM_ENDPOINT) {
        send.disabled = true;
        send.textContent = 'Sending…';
        fetch(root.FORM_ENDPOINT, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: data,
        })
          .then((r) => {
            if (!r.ok) throw new Error(r.status);
            finish(
              `Thanks ${payload.name || ''}. I read these myself and come back within a day — usually the same afternoon.`.trim()
            );
          })
          .catch(() => {
            send.disabled = false;
            send.textContent = 'Send it';
            err.textContent =
              'That did not go through. Call (561) 541-8548 or email rsmiley561@gmail.com.';
            err.hidden = false;
          });
        return;
      }

      // No endpoint wired up yet — hand it to their mail client instead.
      const subject = `Enquiry — ${payload.service || 'Chef Smiley'}${payload.name ? ` — ${payload.name}` : ''}`;
      location.href =
        `mailto:rsmiley561@gmail.com?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(lines)}`;
      finish(
        'Your email app should have opened with everything already filled in — just press send.'
      );
    });

    paint();
  }

  root.Core = { $, $$, esc, asset, reveals, observeNew, revealAll, header, mobnav, magnetic, lightbox, form, reduced };
})(window);

/* ---------------------------------------------------------------------------
   Video helpers — shared by both directions.
--------------------------------------------------------------------------- */
(function (root) {
  'use strict';
  const C = root.Core;

  // Autoplaying background video is a real cost on a phone plan, so it is
  // opt-out on three signals: reduced motion, Save-Data, and 2g/3g.
  const wantsVideo = () => {
    if (C.reduced) return false;
    const c = navigator.connection;
    if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ''))) return false;
    return true;
  };

  /** Attach a hero video's source only once it is worth the bytes. */
  function heroVideo(sel) {
    const v = C.$(sel);
    if (!v || !v.dataset.src || !wantsVideo()) return;
    v.addEventListener('playing', () => v.classList.add('is-playing'), { once: true });
    v.src = v.dataset.src;
    v.load();
    const go = () => v.play().catch(() => {}); // autoplay can still be refused
    v.readyState >= 2 ? go() : v.addEventListener('loadeddata', go, { once: true });
  }

  /**
   * A row of looping clips. Each one only plays while it is on screen, so a
   * page with several videos is not decoding all of them at once.
   */
  function videoReel(sel, items) {
    const box = C.$(sel);
    if (!box) return;
    box.innerHTML = items
      .map(
        (it) => `
        <figure class="reel__item">
          <video muted loop playsinline preload="none"
                 poster="${C.asset(`../assets/video/${it.slug}-poster.jpg`)}"
                 data-src="${C.asset(`../assets/video/${it.slug}-720.mp4`)}" aria-label="${C.esc(it.title)}"></video>
          <figcaption><strong>${C.esc(it.title)}</strong><span>${C.esc(it.note)}</span></figcaption>
        </figure>`
      )
      .join('');

    if (!wantsVideo() || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          const v = e.target;
          if (e.isIntersecting) {
            if (!v.src) { v.src = v.dataset.src; v.load(); }
            v.play().catch(() => {});
          } else {
            v.pause();
          }
        });
      },
      { threshold: 0.3 }
    );
    box.querySelectorAll('video').forEach((v) => io.observe(v));
  }

  C.heroVideo = heroVideo;
  C.videoReel = videoReel;
})(window);
