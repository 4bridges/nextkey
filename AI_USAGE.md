# AI Usage Disclosure

ETHGlobal permits AI tools to assist development but not to create the entire project, requires full attribution, and permits spec-driven workflows on the condition that prompts and planning artifacts are documented. This file is that disclosure. It is updated as the project progresses rather than written at the end.

## Where to find the evidence

| What | Where |
|---|---|
| Planning artifacts, dated, from before the kickoff | [`docs/planning/`](./docs/planning) |
| Prompts that shaped documents, decisions and code | [`ai/PROMPT_LOG.md`](./ai/PROMPT_LOG.md) |
| Decisions taken during the build, dated | [`docs/decisions.md`](./docs/decisions.md) |
| The kickoff boundary, in machine-checkable form | `git log` |

## Tools used

| Tool | Used for |
|---|---|
| Claude (Anthropic), in the Claude desktop app | Rules research, sponsor track analysis, positioning, architecture discussion, documentation drafting |
| Claude Code (Anthropic) | Code assistance in the repository: drafting scripts and page code, writing tests, drafting the site copy and its nine translations, editing files under review |

No editor-integrated completion was used — there is no Copilot, Cursor or
Codeium in this project. Commits carrying substantial assistance keep a
`Co-Authored-By` line, so which parts of the history had help is a question
`git log` answers rather than this table.

## How it was used

**Planning, before the kickoff.** Claude was used to read and cross-check the ETHOnline 2026 rules, the submission guidelines and every sponsor prize page; to decide between the Continuity and From Scratch tracks; and to choose the three partner prizes. It also drafted the product positioning and the project description. All of this is prose, and all of it is in `docs/planning/` with its dates. No code, designs or assets predate the kickoff.

**During the build.** Claude is used as a coding assistant: drafting boilerplate, explaining unfamiliar SDK surfaces (ENSv2 Enhanced Access Control, World ID Selfie Check, Chainlink CRE), reviewing code and drafting documentation. Architecture decisions, integration design and debugging are the author's.

**Where the assistant was wrong.** Worth stating plainly, because it is the honest measure of how the tool was used. Its first prize recommendation (Privy, 1inch Aqua) was wrong and was discarded — both tracks require value transfer, which a credential vault does not do. It also misread the Chainlink documentation and concluded that CLI simulation needed no beta access, then reversed that, and then reversed again once Chainlink Labs answered directly in Discord. Each correction is recorded in `ai/PROMPT_LOG.md` and `docs/planning/00-track-and-sponsor-decisions.md` rather than quietly edited away.

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

**The feedback documents.** `FEEDBACK-ENS.md`, `FEEDBACK-LEDGER.md` and
`FEEDBACK-WORLD.md` report what the author hit while building against these
SDKs. An assistant can draft a sentence; it cannot have the experience the
sentence is about.

What did have substantial assistance: prose and documentation throughout, the
nine translations, much of the test scaffolding, and boilerplate in the scripts
and page code. In the final days that extended to the explorer, the community
page and the donation page — drafted in a working session with the assistant,
reviewed screen by screen by the author, and committed by him. Those commits say
so in their trailers.

## Statement

AI tools assisted this project. They did not create it. Every integration was designed, wired and debugged by the author; the assistant accelerated reading documentation and writing prose. The planning artifacts and prompt log in this repository exist so that this claim can be checked rather than taken on faith.
