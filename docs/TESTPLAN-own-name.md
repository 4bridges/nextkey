# Testing the two receive lanes by hand

Everything below is a thing a person does with a wallet open. The automated
suites cover what can be checked without one — 87 of them on the playground
alone — and they cannot press a button in MetaMask. Every defect this project
found in the last week was found here, not there: two names for one wallet, a
claim link that scrolled off screen, a panel that said *sealed* above an eye
that still revealed the passphrase.

Read the two warnings first. The rest is a walk through the page.

---

## Before you start

**A claim cannot be undone, and a wallet gets one name for ever.** Not one per
day, not one per session — one, enforced by the contract, with no operator
function to reset it. So every test below that reaches a real claim **spends an
address**. Plan the accounts before you start, not after.

**Prepare four accounts in MetaMask**, on Sepolia, and label them:

| Label | For | Needs Sepolia ETH |
|---|---|---|
| `nk-claim-1` | the happy path, desktop | yes, ~0.01 |
| `nk-claim-2` | the happy path, mobile | yes, ~0.01 |
| `nk-lent` | the lent-name lane | no |
| `nk-broke` | the no-gas case | **no — deliberately empty** |

The lent lane spends a name from a pool of 200 rather than an address, so
`nk-lent` can be reused. The two claim accounts cannot.

**Where things are:**

- page: `https://nextkey.li/demo/id` — **both lanes live on the ID tab**, not on
  the playground. `demo.html` still resolves, but it redirects, and where it
  redirects to is itself a finding below.
- explorer: `https://nextkey.li/demo/explorer`
- registrar: `0xc3b7a8b73ed7022a594f236e60d33f5cc61b1863`
- how many names are left: `node --env-file=.env scripts/deploy-names.mjs show 0xc3b7a8b73ed7022a594f236e60d33f5cc61b1863`

Run that last command before and after the session. `minted` should have gone up
by exactly the number of successful claims you made. If it moved by more, a
button fired twice — which is the defect the guard flag exists to prevent and
worth a bug on its own.

**The network is a path prefix.** `/demo/<tab>` is Sepolia; `/<tab>` is reserved
for mainnet. Every address in this document carries the prefix, because a test
run against the wrong half of that split proves nothing about either.

---

## What can be tested without a wallet

Worth knowing before you spend an account: sections 1 and 2, the whole language
pass, the mobile layout and the no-wallet fallback need **no** wallet and no
gas, and a browser carrying no extension at all is the correct instrument for
them — it is the state real visitors arrive in. Only sections 3 to 7 need
MetaMask. Do the wallet-free half first; it costs nothing and it is where four
of the five findings below came from.

---

## Desktop, with an extension wallet

### 1 · The page before anything is pressed

- [ ] **Both lanes are visible without scrolling past one to find the other**, and *Make me receivable* comes first.
- [ ] The second section says what it costs — Sepolia ether — **before** you touch anything.
- [ ] The input has no example text in it. An example reads as a suggestion, and a suggestion in a field that spends your one allowance is a trap.
- [ ] `.nextkey.eth` is visible beside the field. Nobody should have to guess the ending or type it themselves.
- [ ] The tab bar is a row of symbols. Hovering one names it, and the current tab is the one in the accent colour.

### 2 · A name that cannot work, with no wallet connected

Type `not a name` (with the spaces) and press the button.

- [ ] It is refused **without MetaMask opening at all**.
- [ ] The message says which characters are allowed.
- [ ] There are **no links** in that message. A link means the page fell through to *install a wallet* instead of judging what you typed.
- [ ] The button is still pressable and the field still editable — a refusal must not lock you out of correcting it.

Now clear the field and press again.

- [ ] It asks for a name rather than guessing one.

Then type a label that is perfectly valid — `nk-probe-1` — and press.

- [ ] The refusal is about the **wallet**, not about the name. A valid label answered with *type a name first* means the page is judging something other than the field.

### 3 · The lent lane, with `nk-lent`

- [ ] MetaMask asks for a **signature**, not a transaction. The dialog must not mention gas or a fee.
- [ ] Read the message it shows you. It should say in plain words that it moves nothing and costs nothing.
- [ ] Afterwards the section names the pool name you were given, and the button is disabled.
- [ ] Press it again anyway — nothing should happen.

Now **reload the page and press it again with the same account.**

- [ ] It says you already have a name and names the same one. Nothing is written and no second name is spent. *This is the check that caught `hero150`/`hero02` — one wallet holding two names — so do not skip it.*

### 4 · The claim, with `nk-claim-1`

Choose a label nobody will have taken. Press the button.

- [ ] First MetaMask asks for a **signature** (the identity key).
- [ ] Then it asks for **one transaction** — one, not two. The name and the key are written together.
- [ ] The transaction is addressed to `0xc3b7…1863`, not to the registry and not to the resolver.
- [ ] While it is pending the page says so rather than looking dead.

After it confirms:

- [ ] The panel says the name is yours and shows the name, your address as owner, and the published key.
- [ ] The transaction link opens Etherscan **in a new tab**, and the page you were on is still there behind it.
- [ ] The section above now also says you are receivable — at the new name, not at a pool name.
- [ ] Both buttons are disabled and the label field is locked. There is nothing left to press twice.

Then check it from the outside:

- [ ] `https://nextkey.li/demo/explorer` shows the write.
- [ ] `https://nextkey.li/demo/passphrase` accepts your new name as a recipient in step 2 and finds a key on it.
- [ ] `https://api.nextkey.li/demo/v1/id/<your name>.nextkey.eth` answers with the same NextKey ID the page showed you. Two implementations disagreeing here is the failure that makes two people conclude they are looking at different keys.

### 5 · The second claim, same account

Reload, type a different label, press.

- [ ] It says this wallet already has a name, and names it.
- [ ] **No wallet dialog opens** — the contract is asked before you are asked to sign.

### 6 · A name somebody already holds

Use `nk-claim-2` and type the label `nk-claim-1` just took.

- [ ] It is refused, and the message explains that nothing can take a name from whoever holds it — including us.
- [ ] No transaction was sent. Nothing was paid for the answer.
- [ ] Correct the label to a free one and it goes through. `nk-claim-2` is now spent — do this step on the account you meant to spend.

### 7 · No gas, with `nk-broke`

- [ ] The signature still works.
- [ ] The transaction fails or MetaMask refuses to send it, and the page says something a person can act on rather than printing a stack trace.
- [ ] The button is pressable again afterwards.

---

## Mobile

Do this in a **wallet's own browser** (MetaMask → Browser, or Rainbow), not in
Safari or Chrome — mobile browsers carry no wallet.

Repeat sections 1, 3 and 4 with `nk-claim-2`, and watch for the things that only
go wrong on a small screen:

- [ ] **Every tab in the header is reachable.** Count them: home, ID, passphrase, message, sandbox, explorer, blog, donate. A tab you cannot see is a tab that does not exist, and the bar does not scroll sideways to reveal one.
- [ ] The two sections do not overlap and nothing runs off the right edge. Turn the phone sideways too.
- [ ] The label field is wide enough to read what you typed, and `.nextkey.eth` has not wrapped onto its own line.
- [ ] **After each press, the message appears where you can see it** without scrolling up or down to find it. This is the one that was wrong before: the page jumped and the answer was off screen, so it looked like the button had done nothing — and the obvious response is to press it again.
- [ ] Coming back from the wallet's confirmation screen lands you on the page in the state you left it, not at the top.
- [ ] The long addresses and the key wrap instead of forcing the page sideways.

Then, in Safari or Chrome **without** a wallet:

- [ ] Pressing either button offers links to reopen the page inside a wallet.
- [ ] Those links carry the **path you were on** — `/demo/id` — and the language you were reading in.
- [ ] Read the message itself. It must describe the page you are actually on: no steps that this tab does not have, and no advice to use a lane that just refused you.

A desktop browser with no extension is the same code path and a far easier place
to run it. Use it for this block, then confirm on a phone.

---

## Languages

Open `/demo/id?lang=de`, and one right-to-left language: `/demo/id?lang=fa`.

- [ ] Both sections are fully translated — headings, paragraph, button, the cost note. Nothing shows an English sentence.
- [ ] Press with a bad label: the refusal is in that language too.
- [ ] In `fa` the layout mirrors, and `.nextkey.eth`, the addresses and the key stay in Latin script and read left to right. Watch the leading dot in particular: under `direction: rtl` it moves to the other end and `.nextkey.eth` renders as `nextkey.eth.`
- [ ] No tag arrives as text. `<span class="mono">` printed mid-sentence means a translation carrying markup was written into `textContent`; English cannot show this fault, so it can only be found in one of the other nine.
- [ ] The tab bar's symbols still name themselves on hover, in that language.

The strings to watch are the twenty added on 10 September. They fall back to
English silently when a translation is missing, which is correct behaviour and
also the reason a missing one is invisible — the *Make me receivable* section ran
in English in all nine languages for a day before anyone noticed.

---

## Fixed on 10 September — verify after the next deploy

Three of the five findings have a fix in the repository and none of them has
been seen working on the live host. Run these first; a fix nobody has watched
take effect is a claim, not a fix.

**1 · Three tabs were unreachable on a phone.** `nav.barnav` was a flex row that
never wrapped, and eight words needed 462px. At 375px *explorer*, *blog* and
*donate* were cut off the right edge, and the page does not scroll sideways, so
there was no way to reach them; at 414px two were still gone. The bar is symbols
now and wraps. Measured at 327px in an injected copy — not yet on the host.

- [ ] At 375px and again at **320px**: all eight reachable, one line or two, and `document.scrollWidth === document.clientWidth`.
- [ ] Hover names each icon, in `de` and in `fa` as well as English — `data-i18n-title` is one of the spellings `i18n-check` only learned to read yesterday.

**2 · `/send` served Sepolia from the mainnet namespace**, and **3 ·
`demo.html` landed on the wrong tab.** Both were `.htaccess`: the stripper turns
`/send.html` into `/send`, `send` is absent from the mainnet list because that
list is tabs, and the catch-all then found `send.html` on disk and served it
200. `demo.html` fell into the `demo` prefix's front door and took
`?mode=message` to a page where it means nothing. Five explicit 301s now answer
the old spellings with the tab they meant.

Check with `curl -sI`, **not** in a browser — these are 301s and a browser will
cache a wrong answer for a long time.

- [ ] `curl -sI https://nextkey.li/send.html` → 301 to `/demo/passphrase`
- [ ] `curl -sI https://nextkey.li/send` → 301 to `/demo/passphrase`
- [ ] `curl -sI https://nextkey.li/demo/send` → 301 to `/demo/passphrase`
- [ ] `curl -sI 'https://nextkey.li/demo.html'` → 301 to `/demo/passphrase`
- [ ] `curl -sI 'https://nextkey.li/demo.html?mode=message'` → 301 to `/demo/message`
- [ ] `curl -sI 'https://nextkey.li/demo.html?lang=fa'` → 301 that still carries `lang=fa`
- [ ] **And the ones that must not have moved:** `/demo/passphrase` and `/demo/message` answer 200 with the playground; `/demo` still 302s to `/demo/id`; `/explorer.html` still 301s to `/demo/explorer`. The new rules sit above the stripper and are guarded by `THE_REQUEST`, because `/demo/passphrase` is rewritten to `/send.html` internally and an unguarded rule would bounce the page it had just decided to serve. If that guard is wrong, these four are where it shows.

---

## Open findings

Found on 10 September in a browser carrying no wallet, and unfixed today.

**4 · Three sentences in the no-wallet panel do not describe the ID tab.**
Identical in English and German, so not a translation artefact. *"This browser
carries no wallet — mobile browsers cannot"* is asserted unconditionally and is
false on the desktop browser where the panel actually appeared. *"The page
starts again from step 1 there, because steps 1 to 5 happen entirely inside a
tab"* describes the playground; the ID tab has no steps. *"Or use the lane
above, which needs no wallet at all"* points at *Make me receivable* — the
button that produced the panel. The German copy also switches to *Sie* in this
one panel while the whole page says *du*.

**5 · The current tab is marked wrongly, or not at all.** `poc.html` carries
`aria-current="page"` on **Sandbox**, so the live view highlights a tab it is
not. `send.html` carries it nowhere, so `/demo/passphrase` and `/demo/message`
highlight nothing — one file serving two tabs cannot say in markup which one it
is, and nothing sets it at runtime.

---

## When something fails

Capture these four things before trying anything else. Every debugging session
this week was shortened by having them and lengthened by not having them.

1. **A screenshot of the page**, including the panel with the message in it.
2. **The browser console** — the whole thing, not the last line.
3. **The transaction hash**, if one was sent, or the wallet's error if it refused.
4. **What you typed and which account you were on.**

And do not repeat a failed claim on the same account before reporting it. If it
half-succeeded — the name registered, the record missing — pressing again turns
one clear bug into two states nobody can tell apart afterwards.
