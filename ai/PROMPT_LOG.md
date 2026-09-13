# Prompt log

*Kept as the work happened, with its gaps marked rather than filled.*

ETHGlobal permits spec-driven workflows provided prompts and planning artifacts are documented. This file records the prompts that shaped the project. It is not a keystroke transcript — routine completions and autocomplete are not logged, and logging them would obscure rather than reveal. What is logged: every prompt that produced a document, a design decision, or a non-trivial piece of code, with a note on what came back and what was changed afterwards.

**Format**

```
### YYYY-MM-DD · [tool] · what it was for
> the prompt, quoted

**Result:** what came back, in one or two lines.
**Changed afterwards:** what the author corrected, rejected or rewrote.
```

The "changed afterwards" line matters more than the prompt. It is the honest record of where the assistant was wrong and where judgement was applied.

**Entries marked *(prompt not captured)*.** Some working sessions were run without
the prompt being kept. Those entries say so rather than carrying an invented
quote: their *Result* and *Changed afterwards* lines are reconstructed from
[`docs/decisions.md`](../docs/decisions.md), which is dated and was written while
the work was happening. A prompt remembered a week later would make this file
longer and less true, and the point of the file is that what is in it can be
believed. Fourteen entries carried that marker on 12 September; seven were filled
in on 13 September from the transcripts of the sessions themselves, and seven
still carry it.

**Entries marked *(recovered from a compacted transcript)*.** The prompts of
9 September were read back out of a session whose early part had already been
compacted, so they come from that summary's message list rather than from the raw
log. Wording, typos and punctuation are preserved as they were found, but it
cannot be ruled out that something was smoothed on the way. Where a prompt in
that summary carried an ellipsis, the entry omits the passage rather than
presenting a shortened quote as verbatim.

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

### 2026-09-05 · Claude Code · the ENSv2 read path, and the registration that was blocked

> *(prompt not captured)*

**Result:** `scripts/spike-read-ens.mjs` reading through the hackathon Universal Resolver; the manager app refusing to register `nextkey.eth` with an HCA budget error; registration done directly against the `ETHRegistrar` instead, and the UserRegistry deployed.
**Changed afterwards:** the first event scanner reported *no events found* when in fact all 45 of its requests had been refused for asking a 9,000-block range. Rewritten to halve the range on refusal and to report how many were refused — a scanner that cannot tell absence from failure is worse than no scanner. This is the first appearance of the pattern the rest of this file keeps returning to.

### 2026-09-05 (evening) · Claude Code · the correction that mattered

> *(prompt not captured)*

**Result:** the discovery that ENSv2 grants no read permission and that the resolver's setter takes a DNS-encoded name — the product description was rewritten around confidentiality-by-cryptography and control-by-roles.
**Changed afterwards:** the assistant had described the product as though ENSv2 could grant a *read* permission, and the plan was written that way. The contracts refused: the Permissioned Resolver's primitive is `grantSetterRoles`, which governs who may **write**, and nothing on a public chain is unreadable anyway. Found by reading the resolver's bytecode after `setText(bytes32,string,string)` reverted with empty data — not by reasoning it out. The product survived the correction; the description did not.

### 2026-09-06 · Claude Code · revocation, expiry, and the release loop

> *(prompt not captured)*

**Result:** `evidence/revocation.log`, the expiry run, and `scripts/release.mjs` acting on the confidential verdict.
**Changed afterwards:** `scripts/demo-expiry.mjs` was rewritten so that it is able to fail. If the name still resolves after expiry it says the run proves nothing and asks for a longer window, instead of printing a conclusion the data does not support. And it reads through the Universal Resolver rather than the resolver directly, because reading the resolver would have kept answering: expiry ends resolution, it does not delete storage.

### 2026-09-06 (later) · Claude Code · v2 — the record name was the leak

> *(prompt not captured)*

**Result:** the v2 construction: wrapping key and record name from one ECDH secret under separate HKDF info strings, one ephemeral keypair per name.
**Changed afterwards:** the construction itself is the author's, as `AI_USAGE.md` states — note here what the assistant drafted around it (the test suites, the module split) and what was rejected.

### 2026-09-07 · Claude Code · the guard that failed by working correctly

> *(prompt not captured)*

**Result:** the zero-address and bytecode checks before a signature is requested, after a simulation passed against a name with no resolver.
**Changed afterwards:** the guard passed against a name that had no resolver at all — which is what the entry is named for. `eth_call` against an address with no code returns empty, and so does a successful `setText`, so a simulation cannot protect a setter with no return value. The check now looks for the zero address and for bytecode explicitly, before a signature is ever requested.

### 2026-09-08 · Claude Code · padding, the live window, and the community page

> der exporer sollte noch eine filtermöglichkeit haben, ich suche z.B. nur Blog Posts etc. schlage eine einfache und gute filtermöglichkeit und optionen vor
>
> jetzt geht es zur Community seite, sprich zum Blog … der browser [soll] nur Posts zeigen, neuster oben und in einem guten design, wie einer sprechblase mit nur Text und nicht so technisch wie im explorer
>
> keine logs, bist du auf dem richtigen explorer?

**Result:** 256-byte padding so the ciphertext length stops being metadata; `web/src/nk-logs.mjs` after viem's `getLogs` turned out to discard a raw `topics` option; the blog reading the chain instead of an allow-list.
**Changed afterwards:** the third line is the one that mattered: the live window was empty on the deployed site, and the assistant had been watching a single resolver address derived from the anchor. It now watches every candidate at once and prints the addresses it looked at even when nothing comes back. Underneath was the worse defect — viem's `getLogs` discards a raw `topics` option without a word, so every filter that looked like it was running at the node had never left the browser, and one place was reading a record id out of an unfiltered result, which could attach a stranger's write to a name. Two link defects were caught by the author, not the assistant: Etherscan where the ENS explorer would do, and 23 external links with no `target="_blank"`.

### 2026-09-09 · Claude Code · the donation page, and the number it refuses to show

> Jetzt kommt noch ein reiter dazu, hinter 'Blog' mit dem Namen 'Donate' … es wird ein wallet eingeblende mit qr code und copy past funktion sowie ein explorer fenster, welches die donation beträge in einem explorer zeigt und die Wallet balance und anzahl donations. das ganze dient der Förderung von Web3, Open Source und dApps.

**Result:** the donation page: address, ENS name, a QR code drawn into the page as a single SVG path with an EIP-681 payment link, balances read live, and the stablecoin donations listed from the chain.
**Changed afterwards:** two things were refused rather than built. A token API was rejected — a page that renders every token that ever touched the address renders whatever a stranger airdropped onto it. And incoming ETH is deliberately not listed: a plain transfer emits no event, so without an indexer there is nothing to filter for; the balance counts it and the page says so, because "3 donations" while ETH arrives unseen is a number worse than no number.

### 2026-09-09 · Claude Code · 150 more pool names, and a cost report that lied

> wir erhöhen zuerst die anzahl subdomains, mach hero51.nextkey.eth bis hero200.nextkey.eth. was muss ich ins terminal schreiben?
>
> ok, das hat geklappt. mich hat nur gewundert, was beim ersten subdomain-block51-100 als ergebnis bei 'spent' steht ( spent -0.268274257835116619 ETH) … was sagst du dazu?

**Result:** `hero51` to `hero200` registered in three blocks of fifty, two transactions per name, with the pool constant raised only after both ends of the new range were probed on chain.
**Changed afterwards:** the run reported `spent -0.268 ETH` — a negative cost, because it subtracted two balances and a top-up arrived mid-run. It now sums `gasUsed × effectiveGasPrice` from the receipts, prints the balance separately as a balance, and names anything the two numbers do not explain. A second bug fell out of the same session: `process.exit(0)` on a no-op path tore the process down while libuv was still closing the RPC socket, so a successful command looked like a crash on Windows.

### 2026-09-09 · Claude Code · World leaves the documentation, not the log

> Remove world-ID komplett aus der readme, wir nehmen sie nicht mit rein.

**Result:** World ID removed from `README.md`, `docs/architecture.md` and `AI_USAGE.md`, and `FEEDBACK-WORLD.md` deleted; Sandbox access had been requested on day one and never arrived.
**Changed afterwards:** the 4 September entry explaining why Ledger took the slot stays in `docs/decisions.md`. Deleting the reasoning to make the outcome look inevitable would cost more than the paragraph is worth. A blanket rename in the same session produced `AI AI-agents` in the prize table and *agente de IA de IA* in four translations — a substitution cannot see a word it has already produced.

### 2026-09-09 · Claude Code · MIT was a checkbox; AGPL is a decision

> prüfe weiter ob die regeln von ethglobal es zulassen, dass wir nicht alles, sprich alle dateien und ordner public zeigen, sondern dass wir uns schützen gegen copy cats und einen Teil nicht öffnen. es geht mir darum dass wir jetzt neben der technologie, sprich dem geforderten prototyp von ethGlobal schon relativ viel an produkt haben drumherum, was mein IP ist und ich das nicht verschenken möchte und daher so gut wie möglich schützen. schaue was geht und was nicht.

**Result:** the licence changed from MIT to AGPL-3.0-or-later, with section 13 as the reason: a modified NextKey run as a service owes its users the source.
**Changed afterwards:** BUSL and the other source-available licences were rejected — they are explicitly not open source and would forfeit the ENS prize, which requires a public repository. What the licence cannot do is stated rather than implied: it does not reach backwards over what was already published under MIT, and it does not cover the name, the logo or the ENS names.

### 2026-09-09 · Claude Code · the bundles leave the repository

> nimm das raus aus github: die kompilierten Bundles (`app.js`, `demo.js`, `blog.js`, `explorer.js`, `donate.js`, `i18n.js`, zusammen ~2,9 MB) sind Build-Artefakte aus `web/src/`. Build-Output gehört normalerweise nicht ins Repo.

**Result:** 2.16 MB of minified output removed from the repository, esbuild pinned to an exact version, and `npm run verify:stamps` able to answer *does this page match its bundle* without building anything.
**Changed afterwards:** the assistant advised against it — three days before the
deadline, with the argument that a judge who wants to check whether the served
bundle matches the source can no longer do so. The author overruled that, and
`npm run verify:stamps` answers the same question without a build, which is the
better answer. The change then uncovered more than it did. Three of the six page suites carried a hard-coded absolute path to a container that was not this machine — 106 checks that had never run anywhere but where they were written. Then a fresh clone re-stamped every page, because `i18n.js` checks out with CRLF on Windows and the stamp hashes bytes; `eol=lf` in `.gitattributes` fixed it. The README's check count was wrong by 13, and stayed wrong until the suites were run rather than added up.

### 2026-09-09 · Claude Code · an imprint, a privacy notice, and a checker that could not see a third of what it checked

*(recovered from a compacted transcript)*

> jetzt geht es an die fusszeile, alles was durchgestrichen ist raus, dafür die frei partnerseiten rein ENS, Chainlink und Leger. Weiter ein Impressum und Datenschutz. Verantwortlich hello@nextkey.li, Adresse nur für Impressum: 4bridges by Fundel, Goethestrasse 33, 9008 St. gallen, Switzerland. erstelle die Texte "Impressum und Datenschutz" mit dem besten fachwissen in recht eines schweizer anwalts und schütze dadurch das projekt bzw stärke es nachhaltig..
>
> ok, ist gut
>
> schreibe sie
>
> ist grün , ziehe nach

**Result:** two legal pages in ten languages, and a seventh test suite with 36 checks that assert what they must say — that a chain read tells a public node which names you look up, and that erasure cannot be fulfilled for data already on chain.
**Changed afterwards:** two separate pages rather than one, and ten languages rather than English only, were the author's choices from the options offered. He then struck two sentences from the imprint's liability section, removed the email address and the self-referencing imprint link from that page's own footer, and replaced the "About NextKey" link with a house icon pointing at the index. Shipping unreviewed legal translations was his call against the assistant's recommendation; the risk was met by keeping the text short, checking that every block carries the same tag skeleton as its English, and declaring the English version binding. And `i18n-check.mjs` turned out to look only for `data-i18n` — 46 keys in three other spellings were outside the check while it reported everything present, five of them untranslated in all nine languages.

### 2026-09-09 · Claude Code · the identity key stops being a file

*(recovered from a compacted transcript)*

> Die Punkte 1 bis 3 umsetzten jetzt

**Result:** the identity key derived from one wallet signature through HKDF under a new info string, so nothing is generated and nothing has to be kept; becoming receivable costs one signature and no gas; and a secret can be sent to somebody who has nothing at all, with the throwaway key in the URL fragment.
**Changed afterwards:** the growth loop is also the only place in the design that trades privacy for reach, and the page says so: whoever holds the link can open the secret. Three defects came out of using it rather than testing it — the same wallet pressed twice took two names, the claim link scrolled off the screen, and a panel said *Sealed* while the eye above it still revealed the passphrase. All three were found by the author using the page rather than by a test, and rejected on the spot. He also cut the verification script the assistant had planned for the follow-up work — *„gehe weg 3 ohne prüfscript"*.

### 2026-09-09 (night) · Claude Code · a rule that lives in a key is not a rule

*(recovered from a compacted transcript)*

> noch eine rückfrage zu diesem punkt, du kannst nicht die Anzahl der namen begrenzen? zum thema "Müllnamen unter nextkey.eth anlegen und Testnetz-Gas verbrennen."

**Result:** `contracts/NextKeyNames.sol` — one name per address written before the external call, a hard cap, a deny list, a pause, and a claim path only the recipient or a named relayer may take. What it cannot do is the point: no funds, no transfer, no editing a name's records, no taking one back.
**Changed afterwards:** "one name per address" had been a sentence in the page's JavaScript, which is a request rather than a limit, since the same call can be made from a terminal. The compiler could not run in the assistant's container — `npm install solc` refused with a 403 — and reporting that was the whole of the correct response; the artifact records the compiler version and optimizer settings so the bytecode can be reproduced. Two reverts surfaced between deploy and proof, both from documentation rather than from the contract: `grantRoles(0, …)` is refused with `EACRootResourceNotAllowed()`, and root roles have their own entry points. The author changed nothing in the result: the question in the prompt — can the number of names not simply be capped — was the whole correction, and the contract was taken as drafted once it answered it.

### 2026-09-10 · Claude Code · owning a name is not the same as being able to use it

> mach weiter
>
> ok

**Result:** before a line of browser code, the question that had not been asked: may the owner of a claimed name write its records? `scripts/probe-own-write.mjs` put the same `setText` to the resolver as three callers and printed each answer — owner refused, page key accepted, stranger refused.
**Changed afterwards:** nothing was changed after the fact — the prompt was two words, and the whole of the work was the assistant's own. Worth recording all the same: the feature as designed would not have worked, and no amount of front-end code would have shown why. The probe is the pattern this project keeps returning to: ask the deployment, and make the script distinguish *refused* from *there is no such function*.

### 2026-09-10 · Claude Code · the second lane

> bau los

**Result:** the owned-name lane under the lent one — a field, the ending beside it, one button; connect, one signature for the identity key, one transaction the visitor pays for.
**Changed afterwards:** nothing — the lane shipped as built. What the two words bought is worth naming, because it is the part a prompt log cannot show: the order is asserted with `compareDocumentPosition` rather than a line number, since a line number goes quietly wrong at the next rearrangement, and the lent name stays first because on a testnet most visitors have nothing to pay a transaction with, and offering only the owned name would turn them away at the door.

### 2026-09-10 · Claude Code · the network becomes a path, and the key gets a name a person can say

> *(prompt not captured)*

**Result:** every hackathon page moved under `/demo/<tab>`, with mainnet addresses reserved and the front door left empty on purpose; and the NextKey ID — 70 bits of SHA-256 over the published key in Crockford's alphabet, plus a check character.
**Changed afterwards:** the ID is one-way by construction, which is stated rather than glossed: it can be recognised by deriving it for names the page can spell, and never turned back into a key. The `.htaccess` rules were desk-checked rather than run, because there is no Apache in the assistant's container — and the verification is six `curl -sI` lines plus the four addresses that must *not* move.

### 2026-09-10 · Claude Code · a server, named rather than glossed over

> hab gerade gesehen, dass die architecture.md noch nicht aktuell ist. aktualisiere Sie, gerade zu Themen wie "Nothing comes from a server of ours, because there isn't one."

**Result:** the Sandbox tab and the open read-only API, and the imprint's sentence *"there is no server of ours between you and the chain"* rewritten the moment it stopped being true.
**Changed afterwards:** nothing — the correction was the prompt. The author had spotted the stale sentence in `docs/architecture.md` himself and named it; the assistant had not noticed that shipping the API falsified a claim it had written. A claim that was true when written and quietly stopped being true is the same fault as one never checked, with a longer fuse. What the API costs in privacy is stated on the page itself: a caller tells us which name they look up, there is nowhere for that to be written down, and Cloudflare's edge logging is named as the part we do not control.

### 2026-09-10 (evening) · Claude Code · the page said `<span class="mono">` out loud

> *(prompt not captured)*

**Result:** nine keys carried markup as a *string* into `textContent`, so every language except English printed the tag on screen; two had been wrong for weeks.
**Changed afterwards:** English is structurally incapable of showing this fault — its markup never passes through the overlay — which is why it could ship. The checker now reports stray markup in a translated string as its own class of finding rather than leaving it to whoever happens to read that language.

### 2026-09-10 (night) · Claude Code · three tabs nobody could reach

> ich habe gelesen, du hast jetzt einen eigenenbrowser bekommen, glückwunsch. gehe den testplan durch auf github: https://github.com/4bridges/nextkey/blob/main/docs/TESTPLAN-own-name.md du kannst den weg mit "ohne wallet" testen
>
> ja mache das. weiter baue bitte die kopfzeile um, dass alles symbole sind anstelle text. das home ist ja schon fertig als haus. dann comitte ich die anpassungen
>
> schreib einen eintrag und dann was muss auf cyon?
>
> und 2 und 3 gleich miterledigen
>
> setzte 4 und 5 um
>
> das korrigieren: Was mir auffällt: 63 ungenutzte Schlüssel je Sprache. 716 liegen in der Datei, 653 werden benutzt. Meine drei toten (t.s6.mobile, t.s6.nowallet, t.s6.nowalletnote) sind darin enthalten — die anderen 60 lagen schon vorher da. und zur leiste, diese auch korrigieren, insbesondere dass die symbole über die ganze seite verteilt sind, sie können sich ja ander zeile darüber orientieren, die sprachumstellung ist ja ganz rechts aussen, sprich bis dahin ist der bereich sichtbar. git push
>
> Mein Angebot von vorhin steht noch , ok mach es

**Result:** the test plan walked through in a browser rather than reasoned about, which is what surfaced the finding the entry is named for. The header bar became symbols: eight words need 462px; at 375px the last three destinations — explorer, blog, donate — were off the right edge, and the page does not scroll sideways, so no gesture reached them. Eight icons need 327px. In the same session, 63 unused keys per language were removed from `i18n.js` and the direct address was rebuilt across all ten languages.
**Changed afterwards:** the bar was measured rather than estimated, by building it into the live page at 375px before a file was edited, and the check that now guards it asserts reachability rather than existence — the distinction this file has recorded three times. Three of the author's decisions in this session went against the assistant's recommendation, and all three are his to own. The header was rebuilt a second time: the first pass left the icons clustered at the left, and he asked for them spread across the full width to the edge of the language switch, taking their alignment from the row above. The 63 unused keys were deleted over the objection that two days before submission tidying is the wrong order of work — and the count in the prompt is his, not the assistant's, including the three dead keys the assistant had just created. And the direct address was rebuilt in all ten languages rather than German alone; when the interim count came back at 161 keys against an estimate of 44, he had it carried through rather than stopped or reverted.


---

## 2026-09-11 — the last day before submission

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
**Changed afterwards:** *(not recorded)*

### 2026-09-11 · Claude Code · the test plan leaves the repository

> nimm "TESTPLAN-own-name.md" von github runter, das gehört auf die maschine nicht auf github.

**Result:** `git rm --cached`, an entry in `.gitignore` beside the shooting script and the brand material, and the dangling reference in `docs/decisions.md` rewritten so it no longer points at a file a reader cannot open.
**Changed afterwards:** nothing.

---

## 12–13 September — the video, and the last passes over the site

### 2026-09-12 · Claude · the shooting script, and a camera in the frame

> es geht um das video, dieses würde ich heute drehen. bitte überarbeite nochmal das video skript und sag mir, welche freeware ich benutzen kann, um das video aufzunehmen, ich möchte im Bild sein und dann über den bildschirm führen.

**Result:** the script reworked for a webcam inset running the whole length, the opening take moved from a phone screen recording to a desktop browser at phone width, and a recording kit named — OBS Studio for the capture, Shotcut for the cut, both free and without a watermark or a length limit.
**Changed afterwards:** the author chose the format from the options offered (inset throughout rather than a full-screen opener, browser rather than phone).

### 2026-09-12 · Claude · one sponsor served, two shortchanged

> ist das für den chainlink preis "best confidential workflow" genug oder sollte das video nicht stärker auf die drei partner eingehen, auch ledger kommt mir aktuell noch zu kurz

**Result:** the honest answer was no. Chainlink's strongest evidence — `release.mjs` refusing a verdict whose request had been replaced underneath it — was not in the script, and Ledger appeared nowhere at all. Restructured from seven takes to nine, so each partner has an unbroken block: ENS in takes 1, 3, 5 and 6; Chainlink in take 7, built around the refusal before the release; Ledger in take 8, with the device in frame.
**Changed afterwards:** the author decided the two things that shaped it — that the audit disclaimer could leave the footer, and that the video would run to 3:50 rather than 3:30 to make room.

### 2026-09-12 · Claude Code · a header that was too tall, diagnosed twice as too wide

> zum anderen ist die Kopfzeile zu breit
>
> die kopfzeile ist noch nicht ok, Sie ist noch zu breit von der höhe und weiter sind die symbole nicht verteilt, wie in der fusszeile

**Result:** `header{padding:3rem 0 2rem}` on `poc.html`, `imprint.html` and `privacy.html` was written for a page-title block those pages no longer have — the only `<header>` in each document is the sticky bar, so the rule added 80px of dead height around a row of 34px controls. Removed; the bar is 57px, the same as on the other seven pages.
**Changed afterwards:** the assistant read "breit" as width and changed `justify-content` twice — first to group the icons, which was the wrong fix for the wrong problem, then back to `space-between` when the author said they should be spread like the footer's row. Only the third pass measured the element instead of guessing at it, and the padding was visible immediately.

### 2026-09-12 · Claude Code · one footer line on every tab

> jetzt noch die Fusszeile für PoC, ID, Passphrase, Explorer und Blog anpassen auf einheitlich: "Prototyp · ENSv2-Beta im Sepolia-Testnetz"

**Result:** the PoC's own footer key removed, all six tabs on the shared one, shortened in English and in nine languages.
**Changed afterwards:** the assistant argued once for keeping "· nicht auditiert", and the author decided against it. A check in `web/test/blog.mjs` asserted that every tab writing to a chain says both which chain and that nobody audited it; half of it no longer held, so it was narrowed to the half that does, with a comment naming what was given up and where the disclaimer still lives.

### 2026-09-12 · Claude Code · a zero that was never asked

> ein weiterer punkt bei spenden, dort muss der markierte textblock raus
>
> "0 Stablecoins · unvollständig" sieht schlecht aus. wenn es keine sind, einfach "0 Stablecoins"

**Result:** the paragraph explaining a partial scan is gone. In its place the count line distinguishes two states: blocks were read and the figure stands, or the node refused the very first window and the line says *Konnte nicht gelesen werden* instead of printing a zero.
**Changed afterwards:** the author rejected the qualifier the assistant had put beside the figure. The distinction between a refused scan and an empty one stayed, because the screenshot that started it read "die letzten 0 Blöcke" — nothing had been read at all, and a zero there is a question nobody got to ask, printed as a result.

### 2026-09-13 · Claude Code · the Ledger take

> ich will den ledger take jetzt machen, wie gehe ich genau vor? … es gibt 6 konten auf meinem ledger, wir nehmen für den dreh account 3

**Result:** the identity file was checked before anything was filmed — `bob` is on `44'/60'/2'/0/0`, which is Ledger Live's Account 3, so the take would not discover a wrong wallet on camera. Three commands: list the accounts, open and reject, open and confirm.
**Changed afterwards:** the script had said to let the confirmation lapse. The rehearsal showed the device answers a deliberate rejection with a full sentence — *"The device declined. If you pressed reject, that is the system working."* — so the take shows a decision instead of a timeout.

### 2026-09-13 · Claude Code · preparing the Chainlink take, and two defects in the way

> ok, jetzt kommt der chainlink take, gib mir ebenfalls eine schritt für schritt anleitung, dass der take gut wird

**Result:** the take sequenced around the enclave's own timing — revoke, propose, refuse on camera; then fixture, push, and a wait for the raw GitHub URL the enclave fetches from; then execute and open. Two bugs found before the camera ran. `fromLog` read the first workflow run in `evidence/cre-decision.log` rather than the last, so a log with two verdicts verified against the older one; it now takes the newest result and the hash printed before it, so two runs cannot be crossed. And every exit after the chain read used `process.exit()`, which on Windows aborts with a libuv assertion after the output — a successful run that looks like a crash. Both fixed and verified against the live chain before filming.
**Changed afterwards:** the first of those two was the assistant's own doing, from appending a second run to the log earlier the same day without checking how the file is read. The second only appeared because the author ran the check on his own machine rather than trusting that it would work.

### 2026-09-13 · Claude Code · a file that reported itself written and was not

> [from the run output] page.waitForFunction: Timeout 15000ms exceeded … donate.mjs:121

**Result:** a test edit reported as written had not reached the disk; the failing line number gave it away, because the patched file would have moved that call four lines down. Re-applied and read back from the machine before saying it was done.
**Changed afterwards:** every later edit to a test file in this session was read back after writing rather than trusted to the success message.

---

## 13 September — before submission

### 2026-09-13 · Claude Code · finishing this file

> ich habe mit einem anderen Zugang weitergearbeitet, hier der prompt log und Ai Usage, vervollständige das dokument, dass wir es gleich commiten können

**Result:** the scaffolding comments removed, the six entries whose prompts were still held verbatim filled in, and the reconstructed *Changed afterwards* lines for 5 to 8 September written from `docs/decisions.md`.
**Changed afterwards:** the assistant could not supply the fourteen prompts it had never seen, and said so instead of writing them. They were marked *(prompt not captured)* — a disclosure file whose gaps are visible is worth more than one whose gaps are filled from memory.

### 2026-09-13 · Claude Code · seven of the fourteen gaps, closed from the transcripts

> hier das feedback für die prompt datei und ai usage, mache alles fertig zum commiten

**Result:** seven prompts recovered from the sessions that produced them and written into their entries — the imprint and privacy notice, the identity key, `NextKeyNames.sol`, the ownership probe, the second lane, the Sandbox API, and the header rebuilt into symbols. Four *Changed afterwards* lines gained what only the author could supply: that he took the registrar, the probe, the second lane and the architecture correction as they came, and that three decisions in the header session went against the assistant's advice.
**Changed afterwards:** the remaining seven prompts are still not captured and still say so; 5 to 8 September were not recovered. Two limits are declared in the preamble rather than left for a reader to discover: the 9 September prompts come from a compacted session's summary, so smoothing cannot be ruled out, and where such a prompt carried an ellipsis the passage was dropped rather than quoted short — which is why the detail question about the `nextkey.pubkey` record and the *"setzte das um"* prompt on the registrar contract are absent from this file rather than present in an abbreviated form.
