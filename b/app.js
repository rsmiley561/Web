/* Direction B — "Meridian". Rendering + wiring. Shared behaviour lives in
   ../assets/app-core.js; content lives in ../assets/site-data.js. */
(function () {
  'use strict';
  const { $, esc, reveals, observeNew, header, mobnav, lightbox, form,
          heroVideo, videoReel } = window.Core;
  const S = window.SITE;
  const G = window.GALLERY;
  const IMG = '../assets/img/';

  const money = (n) => '$' + n.toLocaleString('en-US');

  /* ----------------------------- credentials ---------------------------- */
  $('#credRow').innerHTML = S.CREDENTIALS.map(
    (c) => `<div><dt>${esc(c.stat)}</dt><dd>${esc(c.label)}</dd></div>`
  ).join('');

  /* -------------------------------- plans ------------------------------- */
  // Editorial rows: name/blurb, what's included, price + CTA.
  $('#plans').innerHTML = S.PLANS.map(
    (p, i) => `
    <article class="plan${p.featured ? ' plan--featured' : ''} reveal" data-d="${i * 100}">
      <div>
        <h3 class="plan__name">${esc(p.name)}</h3>
        <p class="plan__servings">${esc(p.servings)}</p>
        <p class="plan__blurb">${esc(p.blurb)}</p>
      </div>
      <ul class="plan__list">${p.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="plan__buy">
        <p class="plan__price">
          <span class="plan__from">from</span>
          <span class="plan__num">${money(p.priceFrom)}</span>
          <span class="plan__unit">${esc(p.unit)}</span>
        </p>
        <a class="btn${p.featured ? '' : ' btn--line'}" href="#start" data-plan="${esc(p.name)}">Enquire</a>
      </div>
    </article>`
  ).join('');

  /* -------------------------------- steps ------------------------------- */
  $('#steps').innerHTML = S.STEPS.map(
    (s, i) => `
    <li class="step-card reveal" data-d="${i * 90}">
      <span class="step-card__n">${esc(s.n)}</span>
      <h3>${esc(s.title)}</h3>
      <p>${esc(s.body)}</p>
    </li>`
  ).join('');

  /* ------------------------------- gallery ------------------------------ */
  const CATS = [
    { k: 'all', label: 'Everything' },
    { k: 'signature', label: 'Signature' },
    { k: 'prep', label: 'Prep & volume' },
    { k: 'plated', label: 'Composed plates' },
    { k: 'craveable', label: 'Craveable' },
  ];
  const shown = G.filter((g) => g.cat !== 'chef');

  $('#filters').innerHTML = CATS.map(
    (c) => `<button class="chip" role="tab" data-cat="${c.k}" aria-selected="${c.k === 'all'}">${esc(c.label)}</button>`
  ).join('');

  $('#grid').innerHTML = shown
    .map(
      (g, i) => `
    <button class="tile reveal" data-d="${(i % 4) * 60}" data-cat="${g.cat}" data-i="${i}" aria-label="${esc(g.title)} — open larger">
      <img loading="lazy" decoding="async" width="1000" height="1500"
           src="${IMG}${g.id}-p.webp"
           srcset="${IMG}${g.id}-ps.webp 500w, ${IMG}${g.id}-p.webp 1000w"
           sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 23vw"
           alt="${esc(g.title)} — ${esc(g.note)}">
      <span class="tile__cap"><strong>${esc(g.title)}</strong><span>${esc(g.note)}</span></span>
    </button>`
    )
    .join('');

  $('#filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const cat = chip.dataset.cat;
    $('#filters').querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-selected', String(c === chip)));
    $('#grid').querySelectorAll('.tile').forEach((t) =>
      t.classList.toggle('is-hidden', cat !== 'all' && t.dataset.cat !== cat)
    );
  });

  const openLb = lightbox({
    box: '#lb', img: '#lbImg', title: '#lbTitle', note: '#lbNote',
    close: '#lbX', prev: '#lbPrev', next: '#lbNext',
  });
  $('#grid').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const visible = Array.from($('#grid').querySelectorAll('.tile:not(.is-hidden)'));
    openLb(visible.map((t) => shown[+t.dataset.i]), visible.indexOf(tile));
  });

  /* ------------------------------ services ------------------------------ */
  $('#svcs').innerHTML = S.SERVICES.map(
    (s, i) => `
    <article class="svc reveal" data-d="${i * 100}">
      <div class="svc__img"><img loading="lazy" width="800" height="800" src="${IMG}${s.image}-sq.webp" alt="${esc(s.name)}"></div>
      <h3>${esc(s.name)}</h3>
      <p class="svc__price">from ${money(s.priceFrom)} ${esc(s.unit)} <span>· ${esc(s.min)}</span></p>
      <p>${esc(s.body)}</p>
      <a class="svc__link" href="#start" data-plan="${esc(s.name)}">Enquire →</a>
    </article>`
  ).join('');

  /* --------------------------------- cv --------------------------------- */
  $('#cv').innerHTML = S.RESUME.map(
    (r) => `
    <li>
      <div class="cv__top">
        <span class="cv__role">${esc(r.role)}</span>
        <span class="cv__years">${esc(r.years)}</span>
      </div>
      <span class="cv__org">${esc(r.org)}</span>
      <p class="cv__note">${esc(r.note)}</p>
    </li>`
  ).join('');

  /* --------------------------------- faq -------------------------------- */
  $('#faqs').innerHTML = S.FAQS.map(
    (f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`
  ).join('');

  /* -------------------------------- footer ------------------------------ */
  $('#footArea').textContent = S.BUSINESS.serviceArea.join(' · ');
  $('#yr').textContent = new Date().getFullYear();

  /* ------------------- deep-link a plan into the form ------------------- */
  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-plan]');
    if (!link) return;
    const want = link.dataset.plan;
    const map = {
      'Private Dinners': 'Private dinner',
      'Events & Celebrations': 'Event or celebration',
      'Menu & Kitchen Consulting': 'Restaurant consulting',
    };
    const value = map[want] || 'Weekly meal prep';
    const radio = document.querySelector(`input[name="service"][value="${value}"]`);
    if (radio) radio.checked = true;
    if (!map[want]) {
      const notes = document.getElementById('notes');
      if (notes && !notes.value) notes.value = `Interested in ${want}.`;
    }
  });

  /* ------------------------------- wire up ------------------------------ */
  heroVideo('#heroVid');
  videoReel('#reel', [
    { slug: 'tower',   title: 'Tuna & mango tower',   note: 'Layered cold, rice-paper crisp.' },
    { slug: 'carrots', title: 'Glazed carrots',       note: 'Char, chimichurri, red onion.' },
    { slug: 'tartare', title: 'Tartare, black plate', note: 'Currants, arugula, herb oil.' },
    { slug: 'brisket', title: 'Brisket, sliced',      note: 'Bark, smoke ring, rested right.' },
  ]);
  header($('#hdr'));
  mobnav($('#burger'), $('#mobnav'));
  reveals();
  observeNew(document);
  form({
    form: '#inquiry', bar: '#formBar', count: '#formCount',
    back: '#back', next: '#next', send: '#send', err: '#formErr',
    done: '#sent', doneBody: '#sentBody',
  });
})();
