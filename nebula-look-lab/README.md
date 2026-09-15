# Nebula look lab — static packaging of Deep Nebula × Culinary Cosmos v4

Tooling that turns the accepted v4 candidate into a server-free static site with
real recorded data, for publishing to Cloudflare Pages.

The candidate itself is **not** in this repo — it comes from the 1.35 GB handoff
zip. Nothing here modifies the candidate's renderer, shaders, motion or CSS.

## Contents

| Path | What it is |
|---|---|
| `recorder/record.mjs` | Records the requested API surface byte-exact from the live v4 server |
| `recorder/record-prefixes.mjs` | Records search prefixes (the box debounces per keystroke) and the honest-state templates |
| `recorder/record-extra.mjs` | Records the reverse ingredient ordering a garlic-first journey produces |
| `recorder/proxy.mjs` | Transparent proxy used to capture what the package's own browser tests fetch |
| `recorded/` | 180 recorded responses + `index.json` (1.7 MB) |
| `api-shim.js` | Answers `fetch('/api/...')` from the recordings; the only new runtime file |
| `build.mjs` | Assembles the static folder from the candidate + recordings |
| `serve.mjs` | Local static server for checking the build |
| `verify-static.mjs` | 13-check browser verification of the static build |
| `run-deep-motion-static.mjs` | The package's 16-chapter test, gate mechanism swapped for the shim's hold hook |
| `validation/` | Results and screenshots from the verified run |

## Rebuilding

```sh
# 1. from the handoff working copy, with Node 22+
node launch.cjs                      # serves 127.0.0.1:8836

# 2. record (paths inside the scripts point at the working copy)
node recorder/record.mjs
node recorder/record-prefixes.mjs
node recorder/record-extra.mjs

# 3. build and check
node build.mjs
node serve.mjs <static-folder> 8900
node verify-static.mjs
```

See `README-LOOK-LAB.md` for the honesty boundary and what only works with the
real server. That file ships inside the deployed folder.
