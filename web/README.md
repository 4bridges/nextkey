# nextkey.li — the landing page and the live view

Two static pages, no framework, no build step for the HTML. Upload the contents of
this folder to the web root at Cyon and the site works.

```
index.html      the landing page
demo.html       the live view
app.js          bundled reader for demo.html — built, do not edit
src/app.js      the source app.js is built from
```

## Deploy

Everything is a plain file with relative paths, so it also works from a
subdirectory. Upload `index.html`, `demo.html` and `app.js`. `src/` is not needed
on the server.

**No `.htaccess` is required.** An earlier plan called for SPA routing, which on
Apache needs a rewrite to `index.html` or a direct hit on `/demo` returns 404.
Two real files remove the problem instead of configuring around it — worth the
trade for a page we cannot debug on someone else's server the night before a
deadline.

## Rebuilding app.js

Only needed after editing `src/app.js`:

```bash
npx esbuild web/src/app.js --bundle --format=esm --minify --target=es2022 \
  --outfile=web/app.js
```

`viem` is bundled in rather than loaded from a CDN, so the page has no external
dependency at runtime and keeps working if a CDN is blocked or slow.

## What demo.html shows

Four panels, all read from Sepolia at page load through the hackathon Universal
Resolver (`0xd26f2040…faf142` — overriding viem's built-in address, which would
otherwise resolve silently against production):

| Panel | Reads |
|---|---|
| The secret | `visa.nextkey.eth · nextkey.secret` — the ciphertext |
| The recipient | `anna.nextkey.eth · nextkey.pubkey`, then fingerprints that key **in the browser** to find her grant |
| The owner | the owner's grant, to show it has the same shape and there is no privileged path |
| The agent's proposal | `agent.nextkey.eth · nextkey.request`, hashed in the browser and compared with the hash the enclave returned |

The recipient panel is the one worth watching during a demo: nothing tells the
page where Anna's grant lives. It derives the address from the key she publishes
on her own name, using the same rule `scripts/nextkey.mjs` uses when writing it.

Two values are constants rather than reads, and both are labelled as such in the
source: the owner's grant record (their public key is not published, so it cannot
be derived) and the enclave's verdict from `evidence/cre-decision.log` (CRE
simulation output is not on chain). Everything else is live.

## Honesty constraints

`docs/planning/` fixed these before the page was written, and they hold: no
invented user numbers, no "trusted by" logos, no testimonials, no audit badges,
no "military grade". The testnet notice sits in the first screen rather than the
footer, and the FAQ answers "is this ready for real funds?" with "no".
