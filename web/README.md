# nextkey.li — the landing page, the live view and the playground

Three static pages, no framework, no build step for the HTML. Upload the contents
of this folder to the web root at Cyon and the site works.

```
index.html         the landing page, in ten languages
demo.html          the live view — a secret that already exists, read from chain
try.html           the playground — make one yourself, no wallet required
i18n.js            the nine translations — English is not in here, see below
app.js             bundled reader for demo.html   — built, do not edit
try.js             bundled logic for try.html     — built, do not edit
brand/             the mark, icons, social card and manifest — see brand/README.md
src/app.js         the source app.js is built from
src/try.js         the source try.js is built from
src/nk-crypto.mjs  the wrapping rule, shared — see below
test/interop.mjs   proves it matches the command-line tool
```

## Deploy

Everything is a plain file with relative paths, so it also works from a
subdirectory. Upload `index.html`, `demo.html`, `try.html`, `i18n.js`, `app.js`,
`try.js` and the whole `brand/` folder. `src/`, `test/` and this README are not
needed on the server.

`try.js` is about 200 KB gzipped, most of it viem and the BIP-39 word list. That
is heavy for a static site and the trade is deliberate: bundling means the page
has no CDN to be blocked by and no third party to trust, on a page whose whole
claim is that nothing leaves the browser. Check that Cyon serves `.js` gzipped —
uncompressed it is 630 KB, which is a different experience on a phone.

`brand/site.webmanifest` references icons by absolute path (`/brand/…`), so it
assumes the site sits at the domain root. Serving from a subdirectory means
editing those four paths.

**No `.htaccess` is required.** An earlier plan called for SPA routing, which on
Apache needs a rewrite to `index.html` or a direct hit on `/demo` returns 404.
Two real files remove the problem instead of configuring around it — worth the
trade for a page we cannot debug on someone else's server the night before a
deadline.

## Rebuilding the bundles

Only needed after editing something under `src/`:

```bash
npx esbuild web/src/app.js --bundle --format=esm --minify --target=es2022 \
  --outfile=web/app.js
npx esbuild web/src/try.js --bundle --format=esm --minify --target=es2022 \
  --outfile=web/try.js
```

`viem` is bundled in rather than loaded from a CDN, so the page has no external
dependency at runtime and keeps working if a CDN is blocked or slow.

## Ten languages, and where English lives

The selector top right switches between EN, DE, FR, IT, ES, PT, CN, UA, RU and FA.

**English is in `index.html` itself, not in `i18n.js`.** The page is therefore
complete and readable before a single line of script runs — which the planning
notes required — and a JavaScript failure degrades to English rather than to a
blank document. The English baseline is snapshotted from the DOM at load; keeping
a second copy in `i18n.js` would only give the two a chance to drift, and the one
that drifts is always the one nobody is looking at.

A missing key falls back to English **for that one string**, so a partial
translation costs a sentence rather than a page.

**Persian is right-to-left.** `dir="rtl"` is set for it and a handful of rules
mirror the step numbers, the FAQ markers and the footer. The handover diagram
deliberately stays left-to-right: it depicts a sequence of events, and mirroring
it would reverse the story rather than translate it.

**Each language has a shareable address** — `?lang=de` and so on — and the
`hreflang` links in the head point at them. Be honest about the limit: this is a
client-side switcher, so the translated text is not in the served HTML. Search
engines that execute JavaScript will see it; for real per-language indexing you
would want ten pre-rendered files, which is a build step this project does not
have. The selector serves readers well; it is not an SEO strategy.

Choices persist in `localStorage` under `nextkey.lang`, wrapped in try/catch —
a browser that refuses storage still switches, it just forgets.

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


## What try.html does, and the one thing it refuses to do

Six steps. The first five run entirely in the browser and need no wallet, no
account and no testnet ether, so a judge with two minutes can finish the loop:
write a secret, make or look up a recipient, encrypt and grant, open it as the
recipient, watch a stranger fail, revoke, watch the recipient fail too.

The sixth is optional and writes the two records to a name **the visitor already
owns** on the hackathon deployment, signed by their own wallet. Not to a name of
ours — a system demonstrated only on the author's own name has not been
demonstrated. It simulates both writes before asking for a signature, so a
refusal arrives as a reason rather than as a spent transaction.

It does **not** offer to get them a name, and an earlier draft that did was
wrong. On this deployment a `.eth` name is `approve` → `commit` → sixty seconds
→ `register`, paid in mock USDC, and the manager app has been unreliable through
the hackathon; a subname in NextKey's own registry needs the registrar role,
which a stranger does not have and which no static site could lend them. So the
page says plainly that step 6 needs a name you already hold, and that stopping
at step 5 costs you nothing but the chain.

**The refusal.** A box on a web page asking for a recovery phrase is the oldest
theft in this industry, and building one to demonstrate a product that exists
because of it would be an odd way to spend a week. So the page generates a real
throwaway BIP-39 phrase on request, warns permanently when twelve words appear
that it did not generate, and step 6 will not write anything until the visitor
has ticked a box saying the phrase guards nothing. Steps 1 to 5 never leave the
tab, so they are safe whatever is typed; step 6 writes to a public chain, and a
chain does not forget.

Private keys live in a JavaScript variable and nowhere else — not `localStorage`,
not a cookie, not a request. Reloading destroys them, and the page says so,
because that is exactly what happens to a recipient who loses their key.

## src/nk-crypto.mjs, and why it is a separate file

`scripts/nextkey-core.mjs` states the wrapping rule for Node; `src/nk-crypto.mjs`
states it for the browser. They must agree byte for byte, and the failure mode
if they drift is not a crash but a grant that writes cleanly, reads cleanly and
refuses to open — discovered three steps downstream of its cause. This project
has had that bug once already.

So the rule lives in its own module, which is what makes it testable:

```bash
node web/test/interop.mjs
```

It imports that file directly — Node provides `btoa`, `atob` and `crypto.subtle`,
so the browser's own module runs here unmodified — generates a grant with the
Node construction and opens it with the browser one, does it the other way
round, and checks both halves refuse a stranger's key.

If Playwright happens to be installed it then repeats all five inside a real
Chromium, because "the specification says these are the same" and "these are the
same" are different claims. That pass is optional and its absence is reported,
not treated as a pass: a test that needs a 130 MB download is a test that does
not get run.
