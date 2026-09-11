# Prompt log

*Kept continuously, not reconstructed afterwards.*

ETHGlobal permits spec-driven workflows provided prompts and planning artifacts are documented. This file records the prompts that shaped the project. It is not a keystroke transcript — routine completions and autocomplete are not logged, and logging them would obscure rather than reveal. What is logged: every prompt that produced a document, a design decision, or a non-trivial piece of code, with a note on what came back and what was changed afterwards.

**Format**

```
### YYYY-MM-DD · [tool] · what it was for
> the prompt, quoted

**Result:** what came back, in one or two lines.
**Changed afterwards:** what the author corrected, rejected or rewrote.
```

The "changed afterwards" line matters more than the prompt. It is the honest record of where the assistant was wrong and where judgement was applied.

---

## Before the kickoff — planning

### 2026-09-02 · Claude · rules, disqualification risks, prize strategy

> ich habe mich angemeldet beim nächsten ETH Hackathon. Ziel ist es das bereits bei ETH bekannte Projekt pKeep weiterzuentwickeln mit message funktion die den user über neue Nachrichten informiert und welches die 1inch wallet und ENS Namen verwendet. es geht darum, dass du die regeln verstehst, dass man nicht disqualifiziert wird und richtig die git commits sendet, weiter brauchen wir eine github account und prüfe die gewinnchance mit unserem vorhaben, welche preise wir anvisieren sollen von welchen partnern mit unserer lösung.

**Result:** analysis of the ETHOnline 2026 rules, the Continuity/From Scratch distinction, git-history requirements, and a first pass at prize selection.
**Changed afterwards:** the first recommendation (Privy, 1inch Aqua) was wrong — it was made before the assistant had seen what pKeep actually was. Both tracks require money to move. Discarded and redone once the pKeep showcase entry was supplied. See `docs/planning/00-track-and-sponsor-decisions.md` §4.

### 2026-09-03 · Claude · track decision

> [ETHGlobal Discord answer supplied: "From scratch has no tags. Continuity shows: This prize is only available to Continuity Track participants."]

**Result:** every prize track checked against the tag rule; conclusion that Continuity would forfeit all well-fitting prizes.
**Changed afterwards:** nothing — decision accepted and acted on.

### 2026-09-03 · Claude · naming

> das sind alles keine guten namen für ein produkt, dass man international vermarkten möchte über gio und seo soll es auffindbar sein und zugleich einfach zu merken für die leute. das leitmotiv muss überarbeitet werden, da man nicht einfach menschen vertraut, das ziehl ist dem prozess zu trauen und ein mensch ist involviert

**Result:** the motto was rewritten to *"A human is involved. No human is in control."* and three name candidates proposed under GEO/SEO constraints.
**Changed afterwards:** the correction came from the author, not the assistant — the earlier positioning ("secrets to people, not to addresses") was both weaker and technically wrong. `NextKey` was chosen from the candidates by the author.

### 2026-09-03 · Claude · repository plan and landing page specification

> anderer Vorbereitungsschritt für morgen wichtiger, etwa die Repo-Struktur und die Doku-Gerüste als Textplan
>
> schreibe jetzt die Landingpage-Spec, wir haben ja zeit

**Result:** `docs/planning/01-repo-plan.md` and `docs/planning/02-landing-page-spec.md`.
**Changed afterwards:** both were built against and both moved. The repo plan
survived in shape and not in detail — the bundles left the repository on
9 September, the test suites grew from one file to eight. The landing-page spec
was overtaken twice: once when the playground was split into tabs, and once when
the copy was rewritten by the author on the last day. Neither was updated to
match; `docs/decisions.md` is the file that carries the current reasoning, and a
plan kept alive by editing would stop being evidence of what was planned.

---

## During the build

<!--
From here on, log as you go. One entry per prompt that shaped a document, a
decision, or non-trivial code. Keep the "Changed afterwards" line honest —
it is the most useful part of this file for anyone reviewing the work.
-->

### 2026-09-04 · Claude · repository documentation

> Wenn das Repo steht, sag Bescheid — dann schreibe ich dir README, AI_USAGE.md und FEEDBACK-WORLD.md

**Result:** first drafts of `README.md`, `AI_USAGE.md`, `FEEDBACK-WORLD.md`, including the ENSv2 hackathon deployment addresses and the viem Universal Resolver override.
**Changed afterwards:** `FEEDBACK-WORLD.md` was deleted on 9 September when World
Sandbox access never arrived and Ledger took the third slot — documenting an
intention rather than a deliverable. The README has been rewritten many times
since, most often to correct a number it claimed: the check count was wrong
twice, and the last correction came from running the suites rather than from
adding them up.

---

## 2026-09-05 to 2026-09-10 — the build

<!-- 5 to 8 September are scaffolding; 9 and 10 are filled in from the decision
     log, and need only the prompt line. -->

<!--
  SCAFFOLDING. One block per working session, in the order the decision log
  records them, so that a prompt can be dropped in beside the thing it produced.
  Paste your prompt into the quote line and delete the placeholder comment; the
  Result line can stay as it is where it already matches, since it is taken from
  docs/decisions.md rather than invented here.

  A session with no entry is not a problem — this file says in its own header
  that it logs what shaped a document, a decision or non-trivial code, not
  every keystroke. Leaving a block empty and deleting it is better than filling
  it with a prompt reconstructed from memory: the value of this file is that
  what is in it is true.
-->

### 2026-09-05 · Claude Code · the ENSv2 read path, and the registration that was blocked

> <!-- prompt -->

**Result:** `scripts/spike-read-ens.mjs` reading through the hackathon Universal Resolver; the manager app refusing to register `nextkey.eth` with an HCA budget error; registration done directly against the `ETHRegistrar` instead, and the UserRegistry deployed.
**Changed afterwards:** <!-- what you corrected or rejected -->

### 2026-09-05 (evening) · Claude Code · the correction that mattered

> <!-- prompt -->

**Result:** the discovery that ENSv2 grants no read permission and that the resolver's setter takes a DNS-encoded name — the product description was rewritten around confidentiality-by-cryptography and control-by-roles.
**Changed afterwards:** <!-- the assistant had assumed a read permission existed; note who caught it and how -->

### 2026-09-06 · Claude Code · revocation, expiry, and the release loop

> <!-- prompt -->

**Result:** `evidence/revocation.log`, the expiry run, and `scripts/release.mjs` acting on the confidential verdict.
**Changed afterwards:** <!-- -->

### 2026-09-06 (later) · Claude Code · v2 — the record name was the leak

> <!-- prompt -->

**Result:** the v2 construction: wrapping key and record name from one ECDH secret under separate HKDF info strings, one ephemeral keypair per name.
**Changed afterwards:** the construction itself is the author's, as `AI_USAGE.md` states — note here what the assistant drafted around it (the test suites, the module split) and what was rejected.

### 2026-09-07 · Claude Code · the guard that failed by working correctly

> <!-- prompt -->

**Result:** the zero-address and bytecode checks before a signature is requested, after a simulation passed against a name with no resolver.
**Changed afterwards:** <!-- -->

### 2026-09-08 · Claude Code · padding, the live window, and the community page

> <!-- prompt -->

**Result:** 256-byte padding so the ciphertext length stops being metadata; `web/src/nk-logs.mjs` after viem's `getLogs` turned out to discard a raw `topics` option; the blog reading the chain instead of an allow-list.
**Changed afterwards:** <!-- -->

### 2026-09-09 · Claude Code · the donation page, and the number it refuses to show

> <!-- prompt -->

**Result:** the donation page: address, ENS name, a QR code drawn into the page as a single SVG path with an EIP-681 payment link, balances read live, and the stablecoin donations listed from the chain.
**Changed afterwards:** two things were refused rather than built. A token API was rejected — a page that renders every token that ever touched the address renders whatever a stranger airdropped onto it. And incoming ETH is deliberately not listed: a plain transfer emits no event, so without an indexer there is nothing to filter for; the balance counts it and the page says so, because "3 donations" while ETH arrives unseen is a number worse than no number.

### 2026-09-09 · Claude Code · 150 more pool names, and a cost report that lied

> <!-- prompt -->

**Result:** `hero51` to `hero200` registered in three blocks of fifty, two transactions per name, with the pool constant raised only after both ends of the new range were probed on chain.
**Changed afterwards:** the run reported `spent -0.268 ETH` — a negative cost, because it subtracted two balances and a top-up arrived mid-run. It now sums `gasUsed × effectiveGasPrice` from the receipts, prints the balance separately as a balance, and names anything the two numbers do not explain. A second bug fell out of the same session: `process.exit(0)` on a no-op path tore the process down while libuv was still closing the RPC socket, so a successful command looked like a crash on Windows.

### 2026-09-09 · Claude Code · World leaves the documentation, not the log

> <!-- prompt -->

**Result:** World ID removed from `README.md`, `docs/architecture.md` and `AI_USAGE.md`, and `FEEDBACK-WORLD.md` deleted; Sandbox access had been requested on day one and never arrived.
**Changed afterwards:** the 4 September entry explaining why Ledger took the slot stays in `docs/decisions.md`. Deleting the reasoning to make the outcome look inevitable would cost more than the paragraph is worth. A blanket rename in the same session produced `AI AI-agents` in the prize table and *agente de IA de IA* in four translations — a substitution cannot see a word it has already produced.

### 2026-09-09 · Claude Code · MIT was a checkbox; AGPL is a decision

> <!-- prompt -->

**Result:** the licence changed from MIT to AGPL-3.0-or-later, with section 13 as the reason: a modified NextKey run as a service owes its users the source.
**Changed afterwards:** BUSL and the other source-available licences were rejected — they are explicitly not open source and would forfeit the ENS prize, which requires a public repository. What the licence cannot do is stated rather than implied: it does not reach backwards over what was already published under MIT, and it does not cover the name, the logo or the ENS names.

### 2026-09-09 · Claude Code · the bundles leave the repository

> <!-- prompt -->

**Result:** 2.16 MB of minified output removed from the repository, esbuild pinned to an exact version, and `npm run verify:stamps` able to answer *does this page match its bundle* without building anything.
**Changed afterwards:** the change uncovered more than it did. Three of the six page suites carried a hard-coded absolute path to a container that was not this machine — 106 checks that had never run anywhere but where they were written. Then a fresh clone re-stamped every page, because `i18n.js` checks out with CRLF on Windows and the stamp hashes bytes; `eol=lf` in `.gitattributes` fixed it. The README's check count was wrong by 13, and stayed wrong until the suites were run rather than added up.

### 2026-09-09 · Claude Code · an imprint, a privacy notice, and a checker that could not see a third of what it checked

> <!-- prompt -->

**Result:** two legal pages in ten languages, and a seventh test suite with 36 checks that assert what they must say — that a chain read tells a public node which names you look up, and that erasure cannot be fulfilled for data already on chain.
**Changed afterwards:** shipping unreviewed legal translations was the author's call against the assistant's recommendation; the risk was met by keeping the text short, checking that every block carries the same tag skeleton as its English, and declaring the English version binding. And `i18n-check.mjs` turned out to look only for `data-i18n` — 46 keys in three other spellings were outside the check while it reported everything present, five of them untranslated in all nine languages.

### 2026-09-09 · Claude Code · the identity key stops being a file

> <!-- prompt -->

**Result:** the identity key derived from one wallet signature through HKDF under a new info string, so nothing is generated and nothing has to be kept; becoming receivable costs one signature and no gas; and a secret can be sent to somebody who has nothing at all, with the throwaway key in the URL fragment.
**Changed afterwards:** the growth loop is also the only place in the design that trades privacy for reach, and the page says so: whoever holds the link can open the secret. Three defects came out of using it rather than testing it — the same wallet pressed twice took two names, the claim link scrolled off the screen, and a panel said *Sealed* while the eye above it still revealed the passphrase.

### 2026-09-09 (night) · Claude Code · a rule that lives in a key is not a rule

> <!-- prompt -->

**Result:** `contracts/NextKeyNames.sol` — one name per address written before the external call, a hard cap, a deny list, a pause, and a claim path only the recipient or a named relayer may take. What it cannot do is the point: no funds, no transfer, no editing a name's records, no taking one back.
**Changed afterwards:** "one name per address" had been a sentence in the page's JavaScript, which is a request rather than a limit, since the same call can be made from a terminal. The compiler could not run in the assistant's container — `npm install solc` refused with a 403 — and reporting that was the whole of the correct response; the artifact records the compiler version and optimizer settings so the bytecode can be reproduced. Two reverts surfaced between deploy and proof, both from documentation rather than from the contract: `grantRoles(0, …)` is refused with `EACRootResourceNotAllowed()`, and root roles have their own entry points.

### 2026-09-10 · Claude Code · owning a name is not the same as being able to use it

> <!-- prompt -->

**Result:** before a line of browser code, the question that had not been asked: may the owner of a claimed name write its records? `scripts/probe-own-write.mjs` put the same `setText` to the resolver as three callers and printed each answer — owner refused, page key accepted, stranger refused.
**Changed afterwards:** the feature as designed would not have worked, and no amount of front-end code would have shown why. The probe is the pattern this project keeps returning to: ask the deployment, and make the script distinguish *refused* from *there is no such function*.

### 2026-09-10 · Claude Code · the second lane

> <!-- prompt -->

**Result:** the owned-name lane under the lent one — a field, the ending beside it, one button; connect, one signature for the identity key, one transaction the visitor pays for.
**Changed afterwards:** the order is asserted with `compareDocumentPosition` rather than a line number, because a line number goes quietly wrong at the next rearrangement. The lent name stays first: on a testnet most visitors have nothing to pay a transaction with, and offering only the owned name would turn them away at the door.

### 2026-09-10 · Claude Code · the network becomes a path, and the key gets a name a person can say

> <!-- prompt -->

**Result:** every hackathon page moved under `/demo/<tab>`, with mainnet addresses reserved and the front door left empty on purpose; and the NextKey ID — 70 bits of SHA-256 over the published key in Crockford's alphabet, plus a check character.
**Changed afterwards:** the ID is one-way by construction, which is stated rather than glossed: it can be recognised by deriving it for names the page can spell, and never turned back into a key. The `.htaccess` rules were desk-checked rather than run, because there is no Apache in the assistant's container — and the verification is six `curl -sI` lines plus the four addresses that must *not* move.

### 2026-09-10 · Claude Code · a server, named rather than glossed over

> <!-- prompt -->

**Result:** the Sandbox tab and the open read-only API, and the imprint's sentence *"there is no server of ours between you and the chain"* rewritten the moment it stopped being true.
**Changed afterwards:** a claim that was true when written and quietly stopped being true is the same fault as one never checked, with a longer fuse. What the API costs in privacy is stated on the page itself: a caller tells us which name they look up, there is nowhere for that to be written down, and Cloudflare's edge logging is named as the part we do not control.

### 2026-09-10 (evening) · Claude Code · the page said `<span class="mono">` out loud

> <!-- prompt -->

**Result:** nine keys carried markup as a *string* into `textContent`, so every language except English printed the tag on screen; two had been wrong for weeks.
**Changed afterwards:** English is structurally incapable of showing this fault — its markup never passes through the overlay — which is why it could ship. The checker now reports stray markup in a translated string as its own class of finding rather than leaving it to whoever happens to read that language.

### 2026-09-10 (night) · Claude Code · three tabs nobody could reach

> <!-- prompt -->

**Result:** the header bar became symbols. Eight words need 462px; at 375px the last three destinations — explorer, blog, donate — were off the right edge, and the page does not scroll sideways, so no gesture reached them. Eight icons need 327px.
**Changed afterwards:** measured rather than estimated, by building the new bar into the live page at 375px before a file was edited. The check that now guards it asserts reachability, not existence — the distinction this file has recorded three times.


---

## 2026-09-11 — the last day before submission

<!--
  These entries are complete: the prompts are quoted verbatim from the working
  session of 11 September. Read them once and correct anything that misstates
  what you asked for — this file is yours, and it is the one a judge is most
  likely to open.
-->

### 2026-09-11 · Claude Code · records that exist without a findable write event

> weiter fehlen im Explorer auch die Posts und ggf. noch weitere ereignisse, z.B. haben wir auch zurückgezogene ereignisse. die suche nach anna.nextkey.eth liefert z.B. auch kein ergebnis, da stimmt was nicht, fixe es

**Result:** the assistant first concluded there were no posts at all — it had probed `hero1.nextkey.eth` while the pool is zero-padded (`hero01`). Corrected by reading the record directly. Underneath was the real finding: on this deployment a record can exist with no write event a public node will serve — measured over 1.5 million blocks in 50,000-block windows with no refusals. Both reading pages now read records directly and keep the log sweep for provenance and for names nobody listed.
**Changed afterwards:** the author supplied the fact that unlocked it — *"weisst du noch, wie dieser Post geschrieben wurde — über die Blogseite: ja über die blogseite mit einem walllet von uns, sprich es wurde ein pool name gezogen"* — which is what made the padding mistake findable at all.

### 2026-09-11 · Claude Code · searching by address and by NextKey ID

> weiter sollte es im explorer auch möglich sein, nach einer eth adresse zu suchen, nicht nur nach namen
>
> grundsätzlich noch bei den Filtern dazu, suchen nach Nextkey ID
>
> ich habe gerade die folgende Adresse gesucht im explorer und nichts gefunden, da muss aber was stehen, es ist die adresse von hero147. 0x4dc65DF76B39D7e310A3dCa140338f37f967Ae9b

**Result:** the address search was answering honestly but uselessly — a lent name has no reverse record and no `addr` record, measured on three names. Reading `contracts/NextKeyNames.sol` showed the registrar keeps `mapping(address => string) public nameOf`, because one name per address is a rule it enforces. Address → name is now one `eth_call`, exact for every name claimed on the site.
**Changed afterwards:** the assistant's first instinct was an `addr`-record sweep; it would have found nothing, since `claim()` writes exactly one record. The mapping that already existed was the answer.

### 2026-09-11 · Claude Code · the pages, in the author's words

> es geht um anpassungen auf den seiten … [nine rounds of page edits, each with screenshots and struck-out text]

**Result:** the ID, passphrase, message, explorer, blog, sandbox, donate and landing pages rewritten to the author's copy; one reading measure across the landing page; the tab bar ending where its page ends; per-page titles and descriptions; canonical links; the footer dropping the tab you are standing on.
**Changed afterwards:** three deletions were carried out as asked and flagged rather than argued: the explorer's block-range line and its folded panel, which cost three checks and a claim the decision log had defended; the privacy-notice link inside the sandbox panel; and the paragraph under the blog's list. Two typos in the supplied copy were corrected silently and reported afterwards.

### 2026-09-11 · Claude Code · the donation page could not tell "none" from "refused"

> [from the live walkthrough] mache 1 und 2

**Result:** the public mainnet endpoint answers log queries only for the most recent blocks — measured: an 800-block window is served at the head and refused a few thousand blocks back, with *archive requests require a personal token*. The page stops at the first refusal instead of spending five more requests on the same answer, and says which stretch the figure covers.
**Changed afterwards:** the assistant's first diagnosis was a width limit and it proposed narrower windows. The measurement showed a wall of age, not of width — narrower windows would have asked more often and reached no further.

### 2026-09-11 · Claude Code · every status message in the explorer, rewritten by the author

> gib mir eine tabelle aller englische statusmeldungen und ich aktualisiere sie dir

**Result:** all 110 messages extracted and grouped by where they appear; 38 came back changed and were applied in English and in nine languages, with five checks updated to the new sentences.
**Changed afterwards:** the author rewrote them; the assistant corrected two typos and the project's own spelling of its name, and reported each correction rather than applying it quietly.

### 2026-09-11 · Claude Code · swipe between tabs, and filters that fit on a phone

> zwei dinge, hier brauchen wir eine andere lösung, es sollen alle button sichtbar sein, nicht rausscrollen. lose das. und 2.) weiter bitte als neues feature, dass man mobil mit dem tousch links und rechts zwischen den reitern wecheseln kann. sprich hin und her wischen. setzt das um.

**Result:** the filter row wraps instead of scrolling, and a horizontal swipe moves between tabs in the order the bar itself lists — with four checks that assert the rule rather than the hardware.
**Changed afterwards:** <!-- add anything you corrected after trying it on the phone -->

### 2026-09-11 · Claude Code · the test plan leaves the repository

> nimm "TESTPLAN-own-name.md" von github runter, das gehört auf die maschine nicht auf github.

**Result:** `git rm --cached`, an entry in `.gitignore` beside the shooting script and the brand material, and the dangling reference in `docs/decisions.md` rewritten so it no longer points at a file a reader cannot open.
**Changed afterwards:** nothing.
