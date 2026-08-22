/* ---------------------------------------------------------------------------
   Chef Smiley — shared content layer
   Both design directions (/a and /b) read from this single file, so the copy,
   pricing and gallery stay identical and the only difference is the design.

   >>> PRICING IS PLACEHOLDER <<<
   Every number in PLANS and SERVICES below is a market-rate estimate for
   Palm Beach County, not a quote from Rashard. Replace them before this site
   goes live. They are deliberately kept in one place so it is a two-minute
   edit — search for `priceFrom`.
--------------------------------------------------------------------------- */
(function (root) {
  'use strict';

  const BUSINESS = {
    name: 'Chef Smiley',
    legalName: 'Rashard Smiley',
    role: 'Private Chef & Weekly Meal Prep',
    base: 'Delray Beach, Florida',
    region: 'Palm Beach County',
    phone: '(561) 541-8548',
    phoneHref: 'tel:+15615418548',
    email: 'rsmiley561@gmail.com',
    instagram: '@smileyssmoke',
    instagramHref: 'https://instagram.com/smileyssmoke',
    serviceArea: [
      'Delray Beach', 'Boca Raton', 'Boynton Beach', 'Wellington',
      'Palm Beach', 'West Palm Beach', 'Jupiter', 'Highland Beach',
    ],
  };

  // Résumé facts — all verified from Rashard's own CV. Do not embellish.
  const CREDENTIALS = [
    { stat: '15+', label: 'years in professional kitchens' },
    { stat: 'BLT Prime', label: 'Trump National Doral, Miami' },
    { stat: 'Head Chef', label: 'Oak & Ember · Carmela’s, Boca Raton' },
    { stat: 'FIU', label: 'Hospitality & Tourism Management' },
  ];

  const RESUME = [
    {
      role: 'Head Chef / Kitchen Manager',
      org: 'Oak & Ember · Carmela’s — Boca Raton',
      years: '2021 – 2026',
      note: 'Ran daily high-volume service, trained back-of-house on prep standards and execution, and led BOH for new store openings.',
    },
    {
      role: 'Private Chef',
      org: 'Private Client — Wellington',
      years: '2020 – 2021',
      note: 'Sourced, prepped and executed customised menus for one household, and handled every private event end to end.',
    },
    {
      role: 'Lead Pitmaster / Sous Chef',
      org: 'Big Lock Mobile Kitchen — South Florida',
      years: '2009 – 2020',
      note: 'Large-scale events and high-volume catering. Smoked meats, heavy prep loads, large-batch scratch cooking.',
    },
    {
      role: 'Chef de Partie / Sous Chef',
      org: 'BLT Prime at Trump National Doral — Miami',
      years: '2013 – 2016',
      note: 'High-volume line in a AAA Four Diamond resort. Strict standards, strict organisation, heavy covers.',
    },
  ];

  /* ------------------------------------------------------------------
     WEEKLY MEAL PREP — the primary offer. Everything on the page points
     here. Prices are PLACEHOLDER (see header note).
  ------------------------------------------------------------------ */
  const PLANS = [
    {
      id: 'essentials',
      name: 'The Essentials',
      priceFrom: 375,
      unit: '/ week',
      servings: '10 servings',
      blurb: 'One or two people who want to stop thinking about dinner.',
      includes: [
        'Two to three mains, rotating sides',
        'Groceries sourced and included',
        'Packed, labelled, reheat instructions on every container',
        'One delivery a week',
      ],
    },
    {
      id: 'signature',
      name: 'The Signature',
      priceFrom: 560,
      unit: '/ week',
      servings: '16 servings',
      blurb: 'The one most households land on. Enough range that nobody gets bored.',
      featured: true,
      includes: [
        'Three to four mains, sides, one breakfast or snack item',
        'Menu built with you each week',
        'Groceries sourced and included',
        'Dietary adjustments handled per person',
        'One delivery a week',
      ],
    },
    {
      id: 'household',
      name: 'The Household',
      priceFrom: 780,
      unit: '/ week',
      servings: '24 servings',
      blurb: 'A full family week, breakfast through dinner, with different people eating differently.',
      includes: [
        'Full weekly menu across all three meals',
        'Separate dietary tracks under one household',
        'Groceries sourced and included',
        'Two deliveries a week so nothing sits',
        'Priority on private dinner dates',
      ],
    },
  ];

  const STEPS = [
    {
      n: '01',
      title: 'Tell me about your table',
      body: 'How many people, how you eat, what nobody will touch, what you are tired of. Two minutes on the form below.',
    },
    {
      n: '02',
      title: 'We calibrate the first week',
      body: 'Week one is a read on your household — portions, spice, how much protein, how you actually reheat things. It gets adjusted from there.',
    },
    {
      n: '03',
      title: 'I shop and cook',
      body: 'I source it and cook it — in your kitchen or in mine, whichever you prefer. Everything is made that day, not assembled from something older.',
    },
    {
      n: '04',
      title: 'Packed, labelled, delivered',
      body: 'Portioned into containers, labelled with what it is and how to bring it back, and in your refrigerator on your delivery day.',
    },
  ];

  const SERVICES = [
    {
      id: 'dinners',
      name: 'Private Dinners',
      priceFrom: 175,
      unit: '/ guest',
      min: 'four guest minimum',
      body: 'A multi-course dinner cooked and served in your home. I bring everything, cook in front of you or out of the way, and leave the kitchen cleaner than I found it.',
      image: 'tuna-tower',
    },
    {
      id: 'events',
      name: 'Events & Celebrations',
      priceFrom: 85,
      unit: '/ guest',
      min: 'twenty guests and up',
      body: 'Ten years of large-format catering and event work behind this. Service lines, holding, timing, and food that looks the same on plate two hundred as it did on plate one.',
      image: 'chef-live',
    },
    {
      id: 'consulting',
      name: 'Menu & Kitchen Consulting',
      priceFrom: 2500,
      unit: '/ engagement',
      min: 'for restaurants and operators',
      body: 'Menu development and costing, back-of-house systems, prep standards, staff training and opening support — the work I did as a head chef, for your kitchen.',
      image: 'flatbread',
    },
  ];

  const FAQS = [
    {
      q: 'Where do you deliver?',
      a: 'Across Palm Beach County — Delray Beach, Boca Raton, Boynton Beach, Wellington, Palm Beach, West Palm Beach and Jupiter. If you are just outside that, ask; it is usually workable.',
    },
    {
      q: 'Do you cook at my house or yours?',
      a: 'Either. Plenty of clients like the kitchen being used and the smell in the house. Plenty would rather it arrive done. Both cost the same.',
    },
    {
      q: 'Are groceries included in the price?',
      a: 'Yes. Sourcing is part of the job and it is built into the weekly number. If you want a specific purveyor, a particular cut, or a wine to cook with, that gets quoted on top.',
    },
    {
      q: 'How do you handle allergies and dietary requirements?',
      a: 'Directly. Gluten-free, dairy-free, nut allergies, kosher-style, low sodium, high protein, one person eating differently from the rest of the house — tell me on the form and it gets built into the menu, not worked around at the end.',
    },
    {
      q: 'What does the food come in?',
      a: 'Portioned containers, labelled with the dish and how to bring it back up. Food is built to reheat — sauces held separately where they should be, nothing that turns to mush on day three.',
    },
    {
      q: 'Can I skip a week?',
      a: 'Yes. Tell me by the Wednesday before and that week is off with no charge. Travel, guests, a week away — it happens.',
    },
    {
      q: 'Is there a contract?',
      a: 'No lock-in. Weekly prep runs week to week. Most people settle in after the first month, but you are not signing anything that traps you.',
    },
    {
      q: 'Can you do a dinner party and my weekly prep?',
      a: 'That is the most common combination. Weekly prep clients get first call on dinner dates, which matters around the holidays.',
    },
  ];

  root.SITE = { BUSINESS, CREDENTIALS, RESUME, PLANS, STEPS, SERVICES, FAQS };
})(window);
