# Chef Smiley — Private Chef & Weekly Meal Prep

Marketing site for **Rashard "Chef Smiley" Smiley**, Delray Beach, Florida.
Built around weekly meal prep as the primary revenue line, with private dinners,
events and restaurant consulting as secondary offers.

Two complete design directions are included. Open `index.html` to compare them,
pick one, then run the "Going live" steps below to promote it.

| | |
|---|---|
| **`/a`** | **Ember** — near-black, cinematic, warm ember + gold, Fraunces display |
| **`/b`** | **Meridian** — cool bone, editorial grid, deep Atlantic green, Cormorant Garamond |

Both render the *same* copy, pricing, gallery and enquiry form from
`assets/site-data.js`, so the only difference between them is design.

---

## ⚠️ Pricing is placeholder

Every number on the site is a market-rate estimate for Palm Beach County —
**not a quote from Rashard.** Replace them before launch.

They all live in one place: `assets/site-data.js`, on the `priceFrom` fields.

| Offer | Placeholder |
|---|---|
| The Essentials (10 servings/wk) | from $375 / week |
| The Signature (16 servings/wk) | from $560 / week |
| The Household (24 servings/wk) | from $780 / week |
| Private dinners | from $175 / guest |
| Events | from $85 / guest |
| Consulting | from $2,500 / engagement |

---

## Running it locally

No build step and no framework — it is plain HTML, CSS and JS. It needs a
static server rather than opening the file directly, because the pages load
sibling assets:

```bash
npx serve .          # or: python3 -m http.server
```

Then visit `http://localhost:3000`.

## Editing content

Almost everything readable is in **`assets/site-data.js`** — business details,
credentials, résumé, meal-prep plans, the four how-it-works steps, the three
secondary services, and the FAQs. Change it there once and both directions
update.

Photo captions and gallery categories live in **`data/gallery.json`**.
After editing it, regenerate the browser copy:

```bash
node tools/build-data.mjs
```

## The enquiry form

The four-step form validates in the browser and then submits one of two ways:

1. **With a form backend** — set `window.FORM_ENDPOINT` to a Formspree / Basin /
   Netlify Forms URL before `app.js` loads, and the form POSTs there.
   ```html
   <script>window.FORM_ENDPOINT = 'https://formspree.io/f/xxxxxxxx';</script>
   ```
2. **With nothing configured (current state)** — it opens the visitor's email
   client with every answer pre-filled and tells them plainly that it did that.
   It never shows a fake "sent" confirmation.

Wire up option 1 before launch. Option 2 works, but loses people on phones
without a mail client set up.

## Assets

| Path | What it is |
|---|---|
| `assets/source/` | Original photographs, untouched. The masters. |
| `assets/img/` | Generated web derivatives (WebP, several crops/sizes). |
| `assets/video/` | Web-encoded silent loops + poster frames. |
| `assets/fonts/` | Self-hosted webfont subsets. |

### Regenerating derivatives

```bash
node tools/build-images.mjs      # assets/source -> assets/img
node tools/build-data.mjs        # data/gallery.json -> assets/gallery-data.js
bash  tools/build-fonts.sh       # re-download + self-host the webfonts
SRC_DIR=/path/to/movs bash tools/build-video.sh
```

**A note on the photography.** Nearly every source frame is an 864×1536 phone
photo taken in a working kitchen, so several have stainless counters, power
outlets, sheet trays and staff around the edges. Automatic smart-cropping was
not reliable on these, so the problem frames carry an explicit `focus` window in
`data/gallery.json` (`[left, top, width, height]` as fractions of the source)
which is extracted before resizing. If a new photo crops badly, give it a
`focus` rather than fighting the algorithm.

## Checks

```bash
node tools/test.mjs              # 24 interaction checks per direction
node tools/shoot.mjs a           # full-page screenshots into .shots/
node tools/shoot.mjs b hero      # just the first viewport
```

`test.mjs` covers the multi-step form (validation, step gating, progress),
the gallery filters, the lightbox, and the plan → form deep-linking.

## Going live

1. **Pick a direction.** Move `a/` (or `b/`) contents to the repo root, fix the
   `../assets/` paths to `assets/`, and delete the other one plus this chooser.
2. **Replace the placeholder pricing** in `assets/site-data.js`.
3. **Wire the form** to a real endpoint (see above).
4. **Set the real domain** in the `<link rel="canonical">` and `og:image` tags.
5. Deploy the folder to Netlify, Vercel, Cloudflare Pages or GitHub Pages —
   it is fully static, so any of them work with zero configuration.

## Known gaps

- **No client testimonials.** For a service people invite into their home, two
  or three real quotes with first name + city would lift conversion more than
  any design change. There is no honest way to invent these.
- **No photographs of Rashard cooking in a client's home.** The library has one
  live-demonstration shot and one studio portrait. In-home lifestyle images are
  the highest-value photography gap.
- **Placeholder pricing**, as above.

## Structure

```
index.html              chooser — compare the two directions
a/                      Direction A "Ember"    (index.html, style.css, app.js)
b/                      Direction B "Meridian" (index.html, style.css, app.js)
assets/
  site-data.js          ← all copy, pricing, résumé, FAQs
  app-core.js           shared behaviour: reveals, lightbox, form, video
  gallery-data.js       GENERATED from data/gallery.json
  fonts.css, fonts/     GENERATED self-hosted webfonts
  img/, video/          GENERATED derivatives
  source/               original photographs
data/gallery.json       gallery manifest + crop windows
tools/                  build + test scripts
```

### Accessibility and robustness notes

- Scroll reveals are progressive enhancement: the hidden start state is scoped
  to `.js`, so with JavaScript off or broken the whole page is still readable.
- `[hidden] { display: none !important }` is set globally — a component class
  that sets `display` otherwise silently overrides the attribute.
- Background video is skipped for `prefers-reduced-motion`, Save-Data, and 2G
  connections; the poster image carries the page instead.
- Reel videos only play while on screen.
