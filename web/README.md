# nextkey.li — six static pages

No framework, no build step for the HTML, no server of ours. Run `npm run build` once for
the five bundles, then upload the contents of this folder to the web root at Cyon and the
site works.

```
index.html         what the project is, the FAQ, the diagrams
poc.html           the live view — records that already exist, read from chain
demo.html          the playground — make one yourself, no wallet required
explorer.html      what a name carries, and every NextKey record, live
blog.html          community posts: write one, edit one, read them all
donate.html        address, QR code, and what has arrived

app.js             bundled reader for index.html and poc.html  — built, not in git
demo.js            bundled logic for demo.html                 — built, not in git
explorer.js        bundled logic for explorer.html             — built, not in git
blog.js            bundled logic for blog.html                 — built, not in git
donate.js          bundled logic for donate.html               — built, not in git
i18n.js            the nine translations — English is not in here, see below
i18n.patch.json    the working file translations are written into
i18n.stamp.json    the English baseline the checker compares against
.htaccess          cache rules, and addresses without the extension

src/               the sources the bundles are built from
test/              six suites, 221 checks
brand/             the mark, icons, social card and manifest
```

## Deploy

Everything is a plain file with relative paths, so the site also works from a
subdirectory. Upload the six `.html`, the five bundles, `i18n.js`, `.htaccess` and the
whole `brand/` folder. `src/`, `test/`, `i18n.patch.json`, `i18n.stamp.json` and this
README are not needed on the server.

**Upload pages and bundles together.** Each page carries a content hash of the script it
expects (`demo.js?v=09417c32`), and each bundle checks on load that the elements it needs
are there. A mismatch produces a red banner naming what is missing, with a link to a fresh
copy — a better failure than "Cannot set properties of null", which is the one a judge on
a phone actually hit when MetaMask's in-app browser served a cached `demo.html` beside a
current `demo.js`. `i18n.js` is stamped the same way, so a change there means re-uploading
all six pages.

`demo.js` is about 200 KB gzipped, most of it viem and the BIP-39 word list. That is heavy
for a static site and the trade is deliberate: bundling means the page has no CDN to be
blocked by and no third party to trust, on a page whose whole claim is that nothing leaves
the browser. Check that Cyon serves `.js` gzipped.

`brand/site.webmanifest` references icons by absolute path (`/brand/…`), so it assumes the
site sits at the domain root.

## `.htaccess`

An earlier version of this file said no `.htaccess` was required. That stopped being true
when the pages got shareable addresses. It now does two things, and both were written
after something broke.

**Cache.** HTML, JS and JSON are `no-cache, must-revalidate` — which is not `no-store`:
the browser keeps the file and revalidates, so an unchanged bundle comes back as a 304
with no body. Images, fonts and the manifest are cached for a week.

**Addresses without the extension.** `/explorer` rather than `/explorer.html`, plus a 301
from the `.html` form so one spelling stays canonical.

> The test is `RewriteCond %{REQUEST_FILENAME}.html -f`, **not** `%{DOCUMENT_ROOT}`. On
> shared hosting the site usually lives in a subdirectory of the account and
> `DOCUMENT_ROOT` points at the account rather than at the site — so the condition asks
> whether a file exists somewhere it never was, fails quietly, and leaves a 404 that looks
> like a missing page.

## Building the bundles

The five bundles are esbuild output and are **not committed**. A fresh clone has to build
them once; after that, only when something under `src/` changes:

```bash
npm run build            # five esbuild calls, then scripts/stamp-assets.mjs
npm run verify:stamps    # every page matches the bundle it loads — builds nothing
```

**The esbuild version is pinned exactly** (`"esbuild": "0.28.2"`, no caret) and that is
load-bearing, not tidiness. The pages *are* committed and each one carries a content hash
of the script it loads. If a rebuild produced different bytes, every committed page would
be stamped for a file nobody can reproduce, and `git status` would be dirty after every
build. Pinned, a clone rebuilds the same bytes, the stamps still hold, and "built from this
source" is something `npm run verify:stamps` can answer rather than something the README
asserts. Bumping esbuild therefore means rebuilding, re-stamping, committing the pages and
re-uploading the site — a deploy, not a dependency update.

`web/i18n.js` is committed even though `scripts/i18n-merge.mjs` writes it. It is the base
that script merges into and it cannot be rebuilt from `i18n.patch.json` alone, so it is a
source file with a tool attached, not build output.

Three modules are shared, so that two copies of a constant cannot drift apart:

- `src/nk-crypto.mjs` — the wrapping rule, the padding, the derivation. See below
- `src/nk-logs.mjs` — the resolver's two event signatures, and `eth_getLogs` issued
  directly, because viem's `getLogs` discards a raw `topics` option without a word
- `src/demo-wallet.js` — the published demo key, its resolver, and the 200 lendable names

## Ten languages, and where English lives

The selector top right switches between EN, DE, FR, IT, ES, PT, CN, UA, RU and FA.
**494 keys**, complete in all nine translated languages.

**English is in the pages themselves, not in `i18n.js`.** Each page is therefore complete
and readable before a single line of script runs, and a JavaScript failure degrades to
English rather than to a blank document. The English baseline is snapshotted from the DOM
at load; keeping a second copy in `i18n.js` would only give the two a chance to drift, and
the one that drifts is always the one nobody reads.

A missing key falls back to English **for that one string**, so a partial translation costs
a sentence rather than a page.

The overlay translates four things: `data-i18n` (text), `data-i18n-html` (markup),
`data-i18n-ph` (a placeholder) and `data-i18n-title` (a tooltip — the only text an icon
has). An element carrying *only* a title has no text key, and the loop must skip it:
without that guard it collects `base[null]` — the element's own text — and writes it back
over the contents. That is how the home icon in the header once turned into the word
"Home", on the two pages whose overlay was a version behind.

**Persian is right-to-left.** `dir="rtl"` is set for it and a handful of rules mirror the
step numbers, the FAQ markers and the footer. The handover diagram deliberately stays
left-to-right: it depicts a sequence of events, and mirroring it would reverse the story
rather than translate it.

**Each language has a shareable address** — `?lang=de` and so on — and the `hreflang`
links in the head point at them. Be honest about the limit: this is a client-side
switcher, so the translated text is not in the served HTML. Search engines that execute
JavaScript will see it; real per-language indexing would want pre-rendered files, which is
a build step this project does not have. The selector serves readers well; it is not an
SEO strategy.

Choices persist in `localStorage` under `nextkey.lang`, wrapped in try/catch — a browser
that refuses storage still switches, it just forgets.

### Changing or adding text

```bash
# 1. add the keys to web/i18n.patch.json, in all nine languages
node scripts/i18n-merge.mjs --force     # patch → i18n.js
node scripts/i18n-check.mjs             # anything missing? anything stale?
node scripts/i18n-check.mjs --stamp     # accept the English as the new baseline
node scripts/stamp-assets.mjs           # re-stamp the pages
```

`i18n-check` only knows the pages and sources listed in its own `PAGES` and `SOURCES`.
**A new page must be added there** — and to `stamp-assets.mjs` — or its untranslated
strings are never reported. Not hypothetical: the blog and the explorer sat 138 keys deep
in English until the checker was told they existed.

## What poc.html shows

Four panels, all read from Sepolia at page load through the hackathon Universal
Resolver (`0xd26f2040…faf142` — overriding viem's built-in address, which would
otherwise resolve silently against production):

| Panel | Reads |
|---|---|
| The secret | `visa.nextkey.eth · nextkey.secret` — the ciphertext |
| The recipient | `anna.nextkey.eth · nextkey.pubkey`, then fingerprints that key **in the browser** to find her grant |
| The owner | the owner's grant, to show it has the same shape and there is no privileged path |
| The AI-agent's proposal | `agent.nextkey.eth · nextkey.request`, hashed in the browser and compared with the hash the enclave returned |

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


## What demo.html does, and the one thing it refuses to do

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

## What explorer.html shows

Three questions, in order of how much they cost the visitor.

**What does this name carry?** Five records read through the Universal Resolver, each
explained in words rather than hex, and phrased for what the name *is*: a recipient, a
name holding a secret, both, an author, or a name that has nothing to do with us. The
first draft asked every name the same questions and reported a recipient as five absences
and a line saying she was "not a v2 name" — describing one thing as a defective version of
another, which the reader then has to undo before learning anything.

**Can an observer tell who has access?** The attack, offered rather than described. Name
somebody who publishes a key and the page does exactly what a stranger watching the chain
could do: compute where their grant would live, and look. On a v1 name it finds it and
says that this is the flaw v2 exists to fix. On a v2 name it deliberately does not compute
an address that would point nowhere, and explains that the missing input is a private key
rather than a lookup.

**Everything ever written to it**, and below that a live window over every `nextkey.*`
record on the resolver — newest first, polling while the page is open, with filters. The
filters are asked of the node where the protocol allows it and sorted by hand where it does
not, and the difference is printed: a grant's record name is derived, so it cannot be
selected on, and a list of grants is therefore what is in the searched range rather than
what exists.

Every empty answer says where it looked and how far back. A refused block range is reported
as a refusal, with the node's own words.

## What blog.html shows

Community posts, read from the chain's own events rather than from a list of names in the
source, and rendered as speech bubbles: the title and body as one piece of text, because
the split is an artefact of the record format rather than something the author meant.
Underneath, small: the name, the date, and one link out.

The date comes from the **block**, not from the post. A post can claim any time it likes;
the chain cannot.

A name appears only where a creation event proves which record the post belongs to — and
the answer to that query is checked against the record it asked for, because a borrowed
name under somebody else's words is the one mistake on this page that would actually
matter. Where it cannot be proved, the post stands without an author and says so.

Two folded steps underneath: write a post (on a lent name with our gas, or on your own name
with your own wallet) and edit one. Editing is a write to the same record, which only the
owner of a name can make — the resolver enforces that, and the page does not duplicate the
judgement, it just reports the refusal clearly.

## What donate.html shows

The address, a QR code and a copy button; the option to send from the page; and what has
arrived, read live from **Ethereum mainnet** — the one page here that is not on a testnet.

The QR is an EIP-681 payment link (`ethereum:0x54Dd…@1`) drawn into the page as a single
SVG path: no library, no request, and a white quiet zone in both themes, because a
dark-mode page that inverts a code produces one half the scanners in the world refuse.

The address exists three times — in the markup, inside the QR code, and in the script — and
`test/donate.mjs` checks all three are the same string. On a page asking for money, a
wrong address is the only failure that matters.

**What it will not do:** list incoming ETH. A plain transfer emits no event, so there is
nothing on the chain to filter for and this page has no indexer. The balance counts it
exactly, Etherscan has the list, and the page says both. A donation count that quietly
omitted ETH would be a number worse than no number.

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

## Tests

```bash
node web/test/v2.mjs           # 18 — the v2 construction, padding, backwards compatibility
node web/test/interop.mjs      # 26 — the same 13 checks in Node and again in Chromium
node web/test/playground.mjs   # 71 — demo.html in a real browser, in two languages
node web/test/feed.mjs         # 43 — the explorer's live window and its filters
node web/test/blog.mjs         # 42 — the community page, its names and its editing step
node web/test/donate.mjs       # 21 — the donation page: address, QR code, balances
```

The four newer suites answer a **mocked node**: Playwright intercepts the RPC calls and
replies with logs chosen for the case. That is not a shortcut — it is what lets them assert
what a reader ends up seeing rather than that a request went out. A post arriving as a
sentence and not as the JSON it is stored in. A date from the block and not from the post's
own claim. A name only where it is proved. An icon that survives the translation overlay,
on all six pages, because it broke on the two nobody thought to check.

What none of them reach is writing, opening and revoking against a real chain. Those are
evidenced by actual runs in `../evidence/`.
