# Culinary Universe — build plan

Owner: Smiley. Branch: `claude/nebula-look-lab-static-lzndi4`. Live target: https://nebula-world.pages.dev
(Cloudflare Pages project `nebula-world`; `nebula-look` is the separate v4 look-lab, leave it alone.)

This file is the contract for any model or session picking the work up cold. Read it fully before
touching code. Everything under `static/` except `world.js` is verified and stays.

## Decisions — locked by the owner, do not reopen

1. **No score of any kind.** No Affinity number, no weight, no ranking, no "constellation affinity",
   no Jaccard/"ghost" affinities, no recipe reranking. Food is subjective; the app never claims one
   pairing tastes better than another.
2. **A pairing is a printed recommendation** from The Flavor Bible (FB) or The Vegetarian Flavor
   Bible (VFB). A missing line means the books don't print it — never "bad pairing".
3. **Book emphasis is shown as printed, never as a number.** Bold / CAPS / asterisk in the source may
   render as a heavier or brighter thread and the evidence row says "★ author highlight". It is
   never converted to 1.0/2.0/3.0/4.0 or summed. The FB "AVOID" lists, if present in the extraction,
   are their own visible kind (a printed caution), never a negative weight. Check the data before
   drawing them; do not invent them.
4. **Recipes underneath:** every recipe that contains every ingredient in the chain, alphabetical.
   1,497 recipes, generation `gen-2026-09-08T14-45-07-748Z`; recipe IDs match the Smiley OS work
   surface exactly, so a recipe opens in the real cooking workspace (`host/app/index.html?recipe=ID`).
5. **Tomato family** (owner rule): every tomato form folds onto one `tomatoes` parent for navigation
   and recipe matching; each evidence row still shows the original printed form.
6. **Device priority:** iPad first, phone second, desktop third. Adaptive quality, never a static fallback
   as the design.

## Visual direction — locked (reference: the two Higgsfield videos the owner supplied)

- **One medium.** Viridian green, near-monochrome: near-black cloud walls → white-hot light pockets.
  No colour-family clouds. No blue-white stars. Colour exists only as faint warmth in a pocket or ink.
- **Enclosure.** You are inside tunnels and cavities; cloud passes in front of things; real occlusion.
- **An ingredient is a light pocket with a dark, fibrous, root-like tangle silhouetted in front of it.**
  The light is the presence; the form absorbs. Never a bright coloured blob on black.
- **Few lights.** Two or three lit pockets per view, not hundreds. The rest is dim medium.
- **Travel, not zoom.** The camera moves through the cloud toward a pocket; foreground walls slide past.
- **Threads** between chosen ingredients: thin warm light travelling along a printed connection, inside
  the fog. A folio (recipe) surfaces edge-first out of mist and settles into Smiley OS.
- Honest limit: the references are offline generated video. The browser gets the *grammar* of them,
  not their pixel fidelity.

## What exists and is verified (keep)

| Path | What | Status |
|---|---|---|
| `build-data.mjs`, `families.mjs` | FB+VFB browsing graph → `static/data/{nodes,edges,recipes}.json` (966 places, 36,895 pairings, 41,032 printed occurrences, 3D force layout, tomato fold, label cleanup) | verified; `families.mjs` colour is navigation metadata only, not cloud colour |
| `static/app.js` | chain state (add/remove/undo/overview), pairings & connections sheets with the books' own wording, recipe matching (20 for basil+garlic+tomato = QA receipt), Smiley OS overlay, URL hash state, `window.UNIVERSE` test hooks | verified 11/11 |
| `static/host/`, `static/reference/`, `static/source-methods.json` | Smiley OS recipe workspace (unchanged v4 bytes) | verified |
| `verify.mjs` | Playwright journey Basil→Garlic→Tomato→recipes→Smiley OS→back; phone; no-score assertion | passes |
| `static/world.js` | **SUPERSEDED.** Billboard-sprite world. Owner rejected the look ("Christmas tree"). Replaced by Phase 1. Keep its public API (`setPlaces/setStates/setFilaments/setLabels/go/frame/pause/setReading/metrics`) so `app.js` needs minimal change. |

Headless Chromium here has no GPU (SwiftShader): use it only for "loads, no errors, state correct".
**Look and performance are judged by the owner on the iPad**, via a Pages deploy. Don't spend tokens
on aesthetic screenshots.

## Phases

### Phase 1 — the medium, alone  (model: Opus / Fable, effort HIGH — do not delegate)
Deliverable: `static/medium.html` + `static/medium.js`. No data, no UI. Deployed to `nebula-world`.
- Full-screen raymarch in a fragment shader (Three.js r0.180, WebGL2). Render at half resolution
  into a target, upsample (bilateral if cheap enough, else linear).
- Density: baked 3D noise texture (`Data3DTexture`, 64³–96³, RGBA8: fBm in R, Worley in G) sampled
  with trilinear filtering; `density = fbm − k·worley` carves tunnels/cavities; slow domain drift with time.
- Light: Beer-Lambert extinction; dual-lobe Henyey-Greenstein; one warm-white point light in a pocket;
  short light-march (4–6 steps) for self-shadow; "powder" term for the wisps. ACES tone mapping. Bloom optional.
- Steps 40–56, early exit at transmittance < 0.02. Adaptive: drop to quarter-res on low fps.
- Camera: inertial fly (drag = look, pinch/scroll = move along view, WASD on desktop). No OrbitControls.
- Pass criterion: the owner says it feels like being inside the reference video, and the iPad holds
  ≈30 fps. Iterate on this until it passes. Nothing else is built until it does.

### Phase 2 — ingredients as pockets  (model: Sonnet 5, effort MEDIUM)
- Replace `world.js` behind the same API. Places from `data/nodes.json` become light pockets at their
  positions; a dendritic SDF tangle (domain-warped cylinders, smooth-min) sits in front of each lit one.
- LOD: only pockets near the camera / in the chain / focus are lit; others are dim medium.
- Labels: reuse the projected-DOM label layer; depth-test against the volume so names sit in the fog.
- `go(id)` = fly through the medium to the pocket; `frame(points)` = pull back to see the chain.
- Verify with `verify.mjs` unchanged (it drives `window.UNIVERSE`, not the renderer).

### Phase 3 — threads and chain glow  (model: Sonnet 5, effort MEDIUM)
- `setFilaments`: thin emissive segments inside the fog with a travelling light; chosen-chain threads
  steady, just-added thread pulses once. Book emphasis may thicken a thread (as printed). AVOID, if in
  data, is a distinct treatment. Depth-clipped against the volume.

### Phase 4 — folio, reduced motion, phone, polish  (model: Haiku 4.5 or Sonnet 5, effort LOW)
- Recipe folio surfaces from mist before Smiley OS opens; medium slows and darkens behind it.
- `prefers-reduced-motion`: static medium, instant travel, same information.
- Phone density/composition; label collision on small screens; pause control.

Escalate back to Opus/Fable at HIGH if a phase hits a shader, precision (iOS Metal/WebGL2), or frame-rate
problem — those are where cheaper models write plausible code that is subtly wrong.

## How to run

```sh
node build-data.mjs            # optional; needs the FB-VFB handoff at the path inside; outputs are committed
node ../nebula-look-lab/serve.mjs static 8910
node verify.mjs                # BASE_URL=... to point elsewhere
npx wrangler@4.132.0 pages deploy static --project-name nebula-world --branch main --commit-dirty=true
```
Cloudflare: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` from the owner; never commit them.
Playwright for headless checks: 1.56.0 matches the container's Chromium 1194.

## Current live state
`nebula-world.pages.dev` serves the superseded sprite build (deployment 1720ca5e). Phase 1 replaces it.
