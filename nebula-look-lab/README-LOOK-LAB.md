# Deep Nebula x Culinary Cosmos v4 — static look lab

A packaging-only static build of the accepted v4 candidate
(`Smiley-Deep-Nebula-Culinary-Cosmos-Candidate-v4.zip`,
sha256 `4b07cb9b6dbbf4aa9d5be393eda236b65e8342a15729f0b15f0b07778b9332b6`).

**No renderer, shader, motion or CSS file was changed.** The front-end modules,
stylesheets, the nebula asset, the vendored Three.js build and the whole recipe
work surface are the candidate's own bytes. `index.html` differs from the
candidate's by exactly one inserted tag: `<script src="api-shim.js"></script>`
before the existing `slice-app.js` module, so the shim installs before the app
evaluates.

## How the API works here

There is no server. `api-shim.js` patches `window.fetch` and answers
`/api/...` from `api/responses/*.json`, which were recorded byte-exact from the
real v4 server running `node launch.cjs`.

Recorded payloads replay unmodified. The only fields rewritten per request are
the three correlation fields the client regenerates on every call:

- `transport.client_request_id`
- `transport.requested_client_generation`
- `transport.allocated_producer_generation`

`host-client.js` rejects any envelope whose transport block does not echo the
request it just made (`BRIDGE_CORRELATION_MISMATCH`), so replaying these
verbatim would break every call. `payload`, `pins`, `producer`, `generation`,
`request_id` and every recipe body are untouched recorded bytes.

## Honesty boundary

A query that was not recorded returns the producer's own rejection envelope with
`code: NOT_RECORDED_IN_STATIC_CAPTURE`, `accepted: false`, `payload: null`.

It never returns zero, a fabricated relationship, or a `NOT_ESTABLISHED` state
that was not actually observed. Absences that *were* observed — for example
garlic + cinnamon — replay the real server's `NOT_ESTABLISHED` with numeric
`null`, and unmapped pairs replay the real `UNMAPPED_CANONICAL_TO_SOURCE`.

See `api/COVERAGE.json` for exactly what is recorded.

## Preserved semantic invariants

Verified in a headless browser against this build: Basil + Garlic = 100,
garlic's complete 29-partner neighborhood across pages, 41 recipes over the
source's 24 + 17 pagination, Bienville Stuffing reachable, exact evidence
lineage, `NOT_ESTABLISHED` as numeric null.

## Not available without the real server

- Live search beyond the recorded terms and their prefixes.
- Partner neighborhoods for anything other than garlic and basil.
- Relationships/evidence outside the recorded pairs.
- Recipes-using-both for pairs other than basil + garlic.
- `/api/flavor-generalized/cancel` is answered locally and cancels nothing;
  there is no in-flight producer generation in a static build.
- Physical iPad, physical iPhone, Safari on device and VoiceOver remain NOT_RUN.
