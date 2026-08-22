/* Direction A — "Ember". Rendering + wiring. Shared behaviour lives in
   ../assets/app-core.js; content lives in ../assets/site-data.js. */
(function () {
  'use strict';
  const { $, esc, asset, reveals, observeNew, header, mobnav, magnetic, lightbox, form,
          heroVideo, videoReel } = window.Core;
  const S = window.SITE;
  const G = window.GALLERY;
  const IMG = '../assets/img/';

  const money = (n) => '$' + n.toLocaleString('en-US');

  /* ------------------------- credential marquee ------------------------- */
  // Duplicated so the -50% translate loops seamlessly.
  $('#credStrip').innerHTML = [...S.CREDENTIALS, ...S.CREDENTIALS]
    .map(
      (c) => `<div class="strip__item">
        <span class="strip__stat">${esc(c.stat)}</span>
        <span class="strip__label">${esc(c.label)}</span>
      </div>`
    )
    .join('');

  /* -------------------------------- plans ------------------------------- */
  $('#plans').innerHTML = S.PLANS.map(
    (p, i) => `
    <article class="plan${p.featured ? ' plan--featured' : ''} reveal" data-d="${i * 110}">
      ${p.featured ? '<span class="plan__tag">Most chosen</span>' : ''}
      <h3 class="plan__name">${esc(p.name)}</h3>
      <p class="plan__servings">${esc(p.servings)}</p>
      <p class="plan__price">
        <span class="plan__from">from</span>
        <span class="plan__num">${money(p.priceFrom)}</span>
        <span class="plan__unit">${esc(p.unit)}</span>
      </p>
      <p class="plan__blurb">${esc(p.blurb)}</p>
      <ul class="plan__list">${p.includes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <a class="btn${p.featured ? '' : ' btn--ghost'}" href="#start" data-plan="${esc(p.name)}">Start with ${esc(p.name.replace('The ', ''))}</a>
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
    (c) =>
      `<button class="chip" role="tab" data-cat="${c.k}" aria-selected="${c.k === 'all'}">${esc(c.label)}</button>`
  ).join('');

  $('#grid').innerHTML = shown
    .map(
      (g, i) => `
    <button class="tile reveal" data-d="${(i % 4) * 70}" data-cat="${g.cat}" data-i="${i}" aria-label="${esc(g.title)} — open larger">
      <img loading="lazy" decoding="async" width="1000" height="1500"
           src="${asset(IMG + g.id + '-p.webp')}"
           srcset="${asset(IMG + g.id + '-ps.webp')} 500w, ${asset(IMG + g.id + '-p.webp')} 1000w"
           sizes="(max-width: 640px) 50vw, (max-width: 1100px) 33vw, 25vw"
           alt="${esc(g.title)} — ${esc(g.note)}">
      <span class="tile__cap"><strong>${esc(g.title)}</strong><span>${esc(g.note)}</span></span>
    </button>`
    )
    .join('');

  $('#filters').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    const cat = chip.dataset.cat;
    $('#filters')
      .querySelectorAll('.chip')
      .forEach((c) => c.setAttribute('aria-selected', String(c === chip)));
    $('#grid')
      .querySelectorAll('.tile')
      .forEach((t) => t.classList.toggle('is-hidden', cat !== 'all' && t.dataset.cat !== cat));
  });

  const openLb = lightbox({
    box: '#lb', img: '#lbImg', title: '#lbTitle', note: '#lbNote',
    close: '#lbX', prev: '#lbPrev', next: '#lbNext',
  });
  $('#grid').addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    // Navigate within whatever is currently filtered in, not the full set.
    const visible = Array.from($('#grid').querySelectorAll('.tile:not(.is-hidden)'));
    const items = visible.map((t) => shown[+t.dataset.i]);
    openLb(items, visible.indexOf(tile));
  });

  /* ------------------------------ services ------------------------------ */
  $('#svcs').innerHTML = S.SERVICES.map(
    (s, i) => `
    <article class="svc reveal" data-d="${i * 110}">
      <div class="svc__img">
        <img loading="lazy" width="800" height="800" src="${asset(IMG + s.image + '-sq.webp')}" alt="${esc(s.name)}">
      </div>
      <div class="svc__body">
        <h3>${esc(s.name)}</h3>
        <p class="svc__price">from ${money(s.priceFrom)} ${esc(s.unit)} <span>· ${esc(s.min)}</span></p>
        <p>${esc(s.body)}</p>
        <a class="svc__link" href="#start" data-plan="${esc(s.name)}">Enquire about ${esc(s.name.toLowerCase())} →</a>
      </div>
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
  // Clicking a plan or service CTA preselects the matching option so the
  // enquiry arrives already knowing what they were reading.
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
    { slug: 'tartare', title: 'Tartare, black plate',  note: 'Currants, arugula, herb oil.' },
    { slug: 'brisket', title: 'Brisket, sliced',       note: 'Bark, smoke ring, rested right.' },
    { slug: 'carrots', title: 'Glazed carrots',        note: 'Char, chimichurri, red onion.' },
    { slug: 'tower',   title: 'Tuna & mango tower',    note: 'Layered cold, rice-paper crisp.' },
  ]);
  header($('#hdr'));
  mobnav($('#burger'), $('#mobnav'));
  magnetic('.btn');
  reveals();
  observeNew(document);
  form({
    form: '#inquiry', bar: '#formBar', count: '#formCount',
    back: '#back', next: '#next', send: '#send', err: '#formErr',
    done: '#sent', doneBody: '#sentBody',
  });
})();
