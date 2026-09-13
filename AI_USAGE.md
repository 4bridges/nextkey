# AI Usage Disclosure

ETHGlobal permits AI tools to assist development but not to create the entire project, requires full attribution, and permits spec-driven workflows on the condition that prompts and planning artifacts are documented. This file is that disclosure. It is updated as the project progresses rather than written at the end.

## Where to find the evidence

| What | Where |
|---|---|
| Planning artifacts, dated, from before the kickoff | [`docs/planning/`](./docs/planning) |
| Prompts that shaped documents, decisions and code | [`ai/PROMPT_LOG.md`](./ai/PROMPT_LOG.md) |
| Decisions taken during the build, dated | [`docs/decisions.md`](./docs/decisions.md) |
| The kickoff boundary, in machine-checkable form | `git log` |

`ai/PROMPT_LOG.md` is honest about its own gaps: seven of its forty-two entries
carry no quoted prompt, because the prompt was not kept at the time, and they are
marked *(prompt not captured)* rather than filled in from memory. Their result
lines come from `docs/decisions.md`, which is dated and was written as the work
happened. Fourteen entries carried that marker until 13 September, when seven
prompts were recovered from the transcripts of the sessions that produced them;
the entries say where a prompt came out of a compacted summary rather than a raw
log, and where a passage was dropped rather than quoted short. A log with visible
holes can be checked; one with no holes cannot.

## Tools used

| Tool | Used for |
|---|---|
| Claude (Anthropic), in the Claude desktop app | Rules research, sponsor track analysis, positioning, architecture discussion, documentation drafting |
| Claude Code (Anthropic) | Code assistance in the repository: drafting scripts and page code, writing tests, drafting the site copy and its nine translations, editing files under review |

No editor-integrated completion was used — there is no Copilot, Cursor or
Codeium in this project.

## How it was used

**Planning, before the kickoff.** Claude was used to read and cross-check the ETHOnline 2026 rules, the submission guidelines and every sponsor prize page; to decide between the Continuity and From Scratch tracks; and to choose the three partner prizes. It also drafted the product positioning and the project description. All of this is prose, and all of it is in `docs/planning/` with its dates. No code, designs or assets predate the kickoff.

**During the build.** Claude is used as a coding assistant: drafting boilerplate, explaining unfamiliar SDK surfaces (ENSv2 Enhanced Access Control, Chainlink CRE, the Ledger device stack), reviewing code and drafting documentation. Architecture decisions, integration design and debugging are the author's.

**Where the assistant was wrong.** Worth stating plainly, because it is the honest measure of how the tool was used. Its first prize recommendation (Privy, 1inch Aqua) was wrong and was discarded — both tracks require value transfer, which a credential vault does not do. It also misread the Chainlink documentation and concluded that CLI simulation needed no beta access, then reversed that, and then reversed again once Chainlink Labs answered directly in Discord. Each correction is recorded in `ai/PROMPT_LOG.md` and `docs/planning/00-track-and-sponsor-decisions.md` rather than quietly edited away.

The same pattern held to the last day, and the useful part is what caught it. Building the name registrar, the assistant wrote the role grant against `grantRoles(ROOT_RESOURCE, …)` — from the documentation, not from the contract, which refuses that call with `EACRootResourceNotAllowed()`. It then wrote a check that read a text record straight off the resolver, which has no such function and reverts empty, and reported a working contract as broken. Neither was found by reasoning; both were found by putting the question to the deployed contract with a script that distinguishes *refused* from *there is no such function* — a distinction that has now cost this project time three separate times, and is written into `docs/decisions.md` each time. The assistant is fastest at exactly the thing it should be trusted least on: producing a confident interface from documentation.

On the last day it happened twice more, and both are worth the space because
the pattern is the same one. Asked why the community page showed no posts, the
assistant probed `hero1.nextkey.eth` and reported that the pool carried none —
the names are zero-padded, `hero01`, and the question had never reached the
chain. What broke the deadlock was a sentence from the author about how that
post had been written; reading the record directly then produced the finding the
day turned on, which is that a record can exist here with no write event a public
node will serve. Later, asked why the donation page could see so little history,
the assistant diagnosed a limit on the *width* of a block range and proposed
narrower windows. Measuring the endpoint showed a wall of *age*: an 800-block
window is served at the head and refused a few thousand blocks back. Narrower
windows would have asked more often and reached no further. Both times the
correct answer came from putting the question to the deployment rather than to
the model, and both times the wrong answer had arrived with no less confidence
than the right one.

**The last day, and the video.** The shooting script for the demo video was drafted with the assistant and reworked twice: once to change the shooting format, and once because the first cut served one sponsor well and the other two badly — Chainlink's strongest evidence, a verdict being *refused* because the request underneath it had changed, was not in it at all, and Ledger was not in it. The author decided the balance; the assistant restructured the script and prepared the two takes command by command. Rehearsing the Ledger take produced a better beat than the one that had been written: the script said to let the confirmation time out, and the device instead answers a deliberate rejection with a sentence in plain words, which is a decision on camera rather than an absence of one.

Preparing the Chainlink take also produced two defects in `scripts/release.mjs`, and both are the kind worth recording. The first was introduced by the assistant hours earlier: appending a second workflow run to `evidence/cre-decision.log` made the file carry two verdicts, and the parser used `String.match` without `/g`, so it kept reading the first one. The check would have compared the live request against a verdict from a week earlier and refused — correct arithmetic, entirely the wrong reason, and it would have failed on camera. The second was the author's machine answering: a successful run ended with a libuv assertion, because `process.exit()` tears the process down while the RPC socket is still closing. The same bug had already cost this project two commands in `nextkey.mjs`; it was still present here, in four places, and only a real run on Windows surfaced it.

**The last four days.** The same division held through the end. The assistant
drafted the registrar contract, the identity-key derivation, the imprint and
privacy notice in ten languages, the NextKey ID and the move of every page under
`/demo/<tab>`; the author decided each of them, ran them against the chain and
committed them. Three corrections in that stretch are worth naming because the
assistant was confidently wrong in the same direction each time. It read *"die
Kopfzeile ist zu breit"* as width and changed `justify-content` twice before
measuring the element and finding 80px of padding written for a page-title block
that no longer existed. It proposed an `addr`-record sweep for the explorer's
address search, which would have found nothing, when the registrar's own
`mapping(address => string)` was already the answer. And asked to take the
compiled bundles out of the repository, it argued against doing so three days
before the deadline; the author overruled it, and `npm run verify:stamps` turned
out to answer the objection better than keeping them would have.

That last shape — the assistant recommending against, the author deciding anyway —
recurs often enough to be worth stating as a pattern rather than as three
anecdotes. In one session on 10 September it happened three times: the 63 unused
translation keys were deleted over the objection that tidying two days before
submission is the wrong order of work; the direct address was rebuilt in all ten
languages rather than in German alone; and when that rebuild came back at 161 keys
against an estimate of 44, it was carried through rather than abandoned. The
assistant's advice is in `ai/PROMPT_LOG.md` next to the decision that went the
other way, which is the only form in which such advice is checkable.

The licence changed from MIT to AGPL-3.0-or-later on 9 September after the
assistant read the ETHGlobal rules and the sponsor prize pages: ENS requires the
code to be open source and on a public platform, so a private repository was
never available, and the choice was which open-source licence rather than whether
to have one. What the licence cannot do is stated in the README rather than
implied.

**Verification.** Every factual claim in the submission — contract addresses, SDK behaviour, sponsor qualification requirements — was checked against primary sources: the sponsor documentation, the prize pages, and answers given by sponsor teams in the event Discord.

## What is not AI-generated

**The construction.** The v2 derivation is the author's. v1 addressed a grant at
a record name derived from the recipient's *published* key, which made the record
name itself the leak: anyone holding that key could test every name for grants to
it. v2 derives the wrapping key and the record name from the same ECDH secret,
separated by HKDF info strings and salted with `ephPub ‖ recipientPub`, from one
ephemeral keypair per name. Recognising that the leak was the address rather than
the ciphertext, and choosing one scalar multiplication so a Ledger is asked to
sign once instead of twice, was not assistant output.

**Every integration, and every transaction.** The ENSv2 role model — which key
may write which record on which name, and why a Permissioned Resolver is needed
for the lent-name pool — was worked out against the deployment itself. Every
on-chain run in `evidence/` was executed and read back by the author: the grant
written from a phone with no wallet, the one written in a browser on a name
outside our registry and opened from a command line, and the recovery in which
MetaMask and viem reconstructed the same 32 bytes.

**The bugs, and what they taught.** These are worth naming because each changed
the code around it. `grantSetterRoles` binds to the record *key*, so a v2 grant
whose tag is only computed in the visitor's browser cannot be delegated — found
by reproducing it down to the revert selector `0x4b27a133`, and written up as
Finding 11 in `FEEDBACK-ENS.md`. A simulation cannot protect a setter with no
return value: `eth_call` against an address with no code returns nothing, and so
does a successful `setText`, which is why `demo.js` now checks for the zero
address and for bytecode explicitly. `toFunctionSelector('error X(...)')` hashes
the word "error" along with the signature and yields the wrong selector. And a
page and its bundle, cached separately on a static host, drift — the symptom was
`Cannot set properties of null` on a page about cryptography, and the answer was
`stamp-assets.mjs`.

Three more came out of the later pages, and they have the same shape: a tool that
answers a question you did not ask. viem's `getLogs` discards a raw `topics`
option without a word, so filters that looked like they were running at the node
never left the browser — which mattered exactly once, where a record id was being
read out of an unfiltered result. viem also caches `getBlockNumber` for the length
of its polling interval, which is long enough to make a live window ask a cache
how new the chain is and go still. And a balance delta was being printed as a
cost, so a top-up arriving mid-run reported a negative spend. In each case the
correct value was already available — in the request, in an option, in the
receipts — and the fix was to ask for it rather than to work around the answer.

**The feedback documents.** `FEEDBACK-ENS.md` and `FEEDBACK-LEDGER.md` report
what the author hit while building against these SDKs. An assistant can draft a sentence; it cannot have the experience the
sentence is about.

What did have substantial assistance: prose and documentation throughout, the
nine translations, much of the test scaffolding, and boilerplate in the scripts
and page code. In the final days that extended to the explorer, the community
page, the donation page, the imprint and privacy notice, and the registrar
contract — drafted in working sessions with the assistant, reviewed screen by
screen by the author, run against the chain by him, and committed by him. Every
commit in this repository was made by the author; the assistant has never had
credentials to push.

The copy is the author's in a stricter sense than that on the pages a visitor
reads. On the last day he went through all 110 status messages in the explorer
and rewrote 38 of them himself; the assistant extracted the list, applied what
came back, carried it into nine languages and updated the checks that asserted
the old sentences. The same holds for the page text throughout: the assistant
drafted, the author struck out, and what is on the site is what he wrote. Where
the assistant corrected something in his copy — two typos and the spelling of
the project's own name — it said so rather than fixing it quietly, because a
disclosure file that claims the words are his has to mean it.

## Statement

AI tools assisted this project. They did not create it. Every integration was designed, wired and debugged by the author; the assistant accelerated reading documentation and writing prose. The planning artifacts and prompt log in this repository exist so that this claim can be checked rather than taken on faith.
