# Decision log

One dated entry per decision that shaped the build. Written as decisions are made, not reconstructed afterwards.

Format: **what was decided** · why · what was rejected and why not.

---

## 2026-09-04 — Kickoff

**Slot 3 goes to Chainlink Confidential Workflows, not Ledger.**
Ledger's AI Agents track pays more ($3,500 vs $2,000) and fits the motto well — it rewards a clear boundary between autonomous and approved actions. It was dropped once Chainlink Labs confirmed in Discord that `cre workflow simulate` runs confidential workflows without beta access, and the prize accepts a CLI simulation as evidence. Rationale: solo developer, nine days left. Ledger meant an agent stack, DMK, a hardware flow and a second developer-experience feedback document; Chainlink encodes the release condition, which is core product logic we are building anyway. Execution risk outweighed the larger pot.

**The release agent survives that reversal.** It keeps its own ENS namespace holding exactly one role — propose a release, never read, never release. This also satisfies ENS's stated bonus criterion for the hackathon (*agents as namespaces, each with their own identity and permissions*), so the agent now pays into two slots instead of one.

**CRE secrets resolve from the local environment, not the Vault DON.**
Storing secrets on the Vault DON requires the same beta grant we do not have. Resolving `runtime.getSecret()` against local `.env` values keeps the demo reproducible for anyone with the CRE CLI and removes the last dependency on an access grant. The template does it this way regardless.

**Ciphertext goes into an ENS text record first; IPFS only if files are added.**
A seed phrase or a password fits inside a record. This removes an entire integration (pinning service, gateway reliability in the demo) and makes ENS more load-bearing rather than less — it then holds identity, permissions and the data itself. External storage becomes necessary only when the product handles files, which is a stretch goal.

**The recipient's X25519 public key is published as an ENS text record.**
This solves encrypting for someone known only by name, without a key server and without the recipient registering anywhere. It is also why the notification step works for people who have never heard of NextKey: the channel is a text record too.

---

## 2026-09-05 — Two spikes, one blocker

**The ENSv2 read path works against the hackathon deployment.**
`scripts/spike-read-ens.mjs` resolves through the hackathon Universal Resolver (`0xd26f…f142`) and reads text records without throwing. The spike asserts the override took effect *before* doing anything else, because forgetting it is a silent failure: viem ships its own Sepolia Universal Resolver address, and without the override every lookup quietly queries the production deployment and returns null — no error, no warning. That check stays in the code.

**Registration is blocked, and not by us.**
The hackathon manager app refuses to register `nextkey.eth`: *"HCA budget could not be quoted (source: fallback) … No available destination-chain balance can cover execution gas."* The wallet holds 0.05 SepoliaETH plus 1,000 USDC, 1,000 DAI and 100 PayUSD on Sepolia, so this is not an empty account. Working hypothesis: the *destination* chain is the ENSv2 L2 rather than Sepolia, and there is no obvious way for a hackathon team to fund an address there. Asked in the ENS Discord channel. If the hypothesis holds, this blocks every team, not only us. Work continues on the read path meanwhile.

**Chainlink Confidential Workflows: confirmed and unblocked.**
`cre workflow simulate my-workflow` ran the `hello-confidential-workflows` TypeScript template to completion:

```
✓ Workflow Simulation Result:
"APPROVE (score: 644, secret reached API: true)"
```

`secret reached API: true` proves the secret was fetched *inside* the enclave and injected into the outbound call. Three of the five qualification criteria are satisfied by the template as shipped — TEE handler registered and used, a sensitive value processed inside the enclave, successful execution with terminal output as evidence. The CLI confirms in its own words what Chainlink Labs said in Discord: enrollment is required *to deploy*, not to simulate. Evidence committed as `evidence/cre-simulation.log`.

What remains is the substantive criterion: the workflow must be a meaningful part of the product rather than an isolated example. The template's shape already fits — a decision computed over confidential data, with only a verdict crossing back through `usingTheDons()`. The work is replacing `APPROVE/REJECT` by score with `RELEASE/DENY` by guardian quorum and time lock.

**The evidence file was nearly lost to `.gitignore`.**
The Node template's `.gitignore` contains `*.log`, which silently swallowed `evidence/cre-simulation.log`. Added `!evidence/*.log` as an exception. Worth recording because of *how* it would have failed: the file would simply never have reached the repository, and we would have noticed on submission day, if at all.

**Deliberately kept out of the repository:** `.env` (verified with `git check-ignore`), `node_modules`, and `.cre_build_tmp.js` — a build artifact that changes on every compile.

---

## 2026-09-05 (later) — `nextkey.eth` registered, registry deployed

**Registered directly against the `ETHRegistrar`, not through the manager app.**
The app's chain-abstraction layer refused to quote for two days. Working at the contract level took forty minutes: `getRegisterPrice` → `approve` MockUSDC → `commit` → wait 60s → `register`. It worked first try, and the price oracle answered normally — which confirms the failure was confined to the HCA layer and never involved our wallet.

This was not a detour. Subnames, role grants and expiries all have to happen at the contract level anyway; the manager app could never have done them for us. We only brought the work forward.

`nextkey.eth` is owned by `0x9780aFE8…dd0b`, registered for one year.

**Own UserRegistry deployed** at `0x612034AB34Ec262d5417EA3163718E7455157908` via the VerifiableFactory. Salt is deterministic — `keccak256(keccak256("UserRegistry"), namehash("nextkey.eth"), 0)` — so redeploying requires bumping the version or the CREATE2 address collides.

**Two documentation defects cost most of the time, and both are in `FEEDBACK-ENS.md`.**

`USER_REGISTRY_IMPL` is named in the tutorial but absent from the deployments table. Recovered by reading `ProxyDeployed` events off the factory and taking the one implementation being proxied that was not the resolver: `0x47B442d0…72546`.

The documented initializer `initialize(address, uint256)` is out of date; the implementation expects `initialize((address,uint256)[])` — an array of account/roleBitmap pairs. This fails in the worst possible way: a proxy delegatecalling a non-existent function reverts with *empty* data, so Etherscan shows `Execution reverted 0x` and nothing more. Found by decoding a deployment that had worked and comparing selectors.

Worth keeping: the real signature is better than the documented one. Assigning several accounts different roles at deployment time is exactly NextKey's model.

**A tooling note.** The RPC endpoint viem picks for Sepolia by default refuses `getLogs` ranges of 9,000 blocks, and our first event scanner reported "no events found" when in fact all 45 requests had been rejected — a scanner that cannot distinguish absence from failure is worse than no scanner. Rewritten to halve its range on refusal and to report how many were refused. `ethereum-sepolia-rpc.publicnode.com` is the better endpoint.

---

## 2026-09-05 (evening) — the correction that mattered

**ENSv2 does not grant read permission, and we had been describing the product as if it did.**

The plan said sharing a secret meant granting someone the right to read one text record. The contracts disagreed. The Permissioned Resolver's primitive is `grantSetterRoles(bytes name, address)` — it governs who may **write**. There is no read permission to grant, and there could not be: everything on a public chain is publicly readable.

Found by reading the resolver's bytecode after `setText(bytes32,string,string)` reverted with empty data. The real signature is `setText(bytes name, string key, string value)`, taking the DNS-encoded name.

The product survives the correction; the description did not. NextKey now splits the two concerns explicitly:

- **Confidentiality by cryptography.** The record holds ciphertext. Who can decrypt is decided by wrapping the key to the recipient's X25519 public key, which is itself a text record on their name.
- **Control by protocol roles.** Who may update the pointer, revoke it, or delegate — that is what ENSv2 enforces, and it enforces it against us as much as against anyone.

This is the more honest claim, and the stronger one. Asserting that a public chain keeps secrets would have been false, and an ENS judge would have seen through it in a minute.

**Also learned, and now in `FEEDBACK-ENS.md`:** the registry's `getResolver` / `getSubregistry` take the label as a *string*, not `bytes32`; `findTokenId(string)` exists and is the correct way to obtain a mutable token id; and the resolver's setters take DNS-encoded names. None of this is in the documentation.

**The tool that made it possible** is `scripts/probe-abi.mjs`: it follows the EIP-1967 slot to the implementation, extracts the selector constants from the bytecode and looks them up. With unverified contracts and unreliable docs, reading the truth out of the deployed code was the only reliable method — and it turned three separate dead ends into three ten-minute fixes.

**End-to-end verification.** `nextkey.eth` → our UserRegistry → `visa.nextkey.eth` → its Permissioned Resolver → text record, read back through the Universal Resolver rather than the resolver directly. That is the path a real client takes, which is what makes it evidence rather than a self-test.

---

## 2026-09-05 (night) — the encryption path closes

**The product loop runs end to end on the hackathon deployment.**
`scripts/nextkey.mjs` now does the whole thing: `keygen` → `publish` → `store` → `share` → `open`. A seed phrase was encrypted into `visa.nextkey.eth`, shared with `anna.nextkey.eth`, and opened by Anna and by the owner — each with their own key, through the same code path.

| Step | Transaction |
|---|---|
| Anna publishes `nextkey.pubkey` | `0xd0deb560…20e932` |
| Ciphertext into `nextkey.secret` | `0x88b82fd9…132987` |
| Owner's grant | `0xba8e6925…508ff0` |
| Anna's grant | `0x6a051d14…d91290` |

**The owner is a recipient like any other.** There is no master key and no owner-only path in the code, because keeping one would make "we cannot read your secrets" a lie. The cost is real and stated in the README: lose `.keys/`, lose access. We prefer an honest limitation to a dishonest convenience.

**Grants are addressed by key fingerprint, not by name.** This was a bug before it was a decision. `share … anna.nextkey.eth` wrote to `nextkey.grant.anna.nextkey` while `open … anna` read `nextkey.grant.anna` — two spellings of one person, two records, and a failure that surfaced only at decryption.

The name-based fix would have been three lines. It would also have been wrong: a name is mutable — it can move, expire, or be one of several a person holds — while the key that can open a grant is the one stable thing about the recipient. So the record key is now the first 16 hex characters of `sha256(publicKey)`, and the name travels inside the value as `for`, where the explorer still shows it and nothing depends on it.

Worth recording as a pattern: the bug was in the *addressing*, not in the cryptography, and it was invisible until the last step. Both write paths succeeded. Both transactions reported `success`. Only the read failed. Any design where writing and reading derive a shared address independently will fail this way, and the fix is to derive it from something neither side can spell differently.

**Known limitation, not papered over.** `revoke` resolves the recipient's name to the key they currently publish. If they rotate `nextkey.pubkey` between the grant and the revocation, the revoke clears the grant for the new key and leaves the old one standing. The correct fix is an index record listing outstanding grants, so revocation can enumerate rather than guess. Noted in the code and scheduled; a hidden gap would cost more with a judge than an acknowledged one.

**Stale records from the fingerprint change** — `nextkey.grant.alice` and `nextkey.grant.anna.nextkey` — still sit on `visa.nextkey.eth`. They wrap a content key that the re-run of `store` replaced, so they open nothing, but they are confusing in the explorer and get cleared before the demo recording.

---

## 2026-09-06 — the last two claims get evidence

**Revocation and expiry were described in the README and had never been run.** Both are now executed rather than asserted, which closes the gap this project has been punished for twice already: the read-permission assumption, and the "most-used implementation" heuristic. Writing a claim down is not the same as knowing it holds.

**Revocation.** Anna opens the secret, the owner clears her grant, Anna cannot open it — [`evidence/revocation.log`](../evidence/revocation.log), transactions `0xa8951116…67905b` and `0xe83544fb…4826f`. The grant was then restored so the live demo keeps working, and it returned to the same record address, because a grant is addressed by the recipient's key and Anna's key did not change. The fingerprint scheme paying for itself.

The log ends with what revocation cannot do: it does not make Anna forget. No system can retract knowledge, and `revoke` prints that at the moment a user is most likely to assume otherwise.

**Expiry.** A throwaway subname with a 240-second life, a record written to it, and then a read through the Universal Resolver every twenty seconds until the registry stopped answering. Readable at 18 seconds remaining, empty at 2 seconds past. No grace period.

Two choices make it evidence rather than a self-test. It reads through the Universal Resolver, the path a client takes — reading the resolver directly would have kept answering, since the record is still in storage and expiry ends resolution rather than deleting anything. And the deadline was read back from the registry with `findExpiry` instead of assumed from what we passed in.

`scripts/demo-expiry.mjs` reports honestly when it fails: if the name were still resolving after expiry it says the run proves nothing and suggests a longer window, rather than printing a conclusion the data does not support. A demonstration script that can only succeed is a decoration.

**`fleeting23418.nextkey.eth` is left expired on purpose.** It is the artifact.
---

## 2026-09-06 — the loop closes

**`scripts/release.mjs` acts on the verdict.** Until today the chain held a proposal and a decision, and a person then wrote the grant by hand. The gap was in the README as an admission; it is now code.

The order of the demonstration matters more than the demonstration. First revoke Anna's access, so that what follows restores it by process rather than by hand. Then file a fresh proposal, which replaces the record on chain — and watch the previous verdict be **refused**, because its hash no longer matches what is there:

```
✗ verdict is bound to the live request   on chain 0x7b2a1ed6…3b8ce0f3
                                         verdict  0xb74ac566…4f59ce5336
REFUSED
```

An approval given for one request cannot be spent on another. Only after re-running the workflow against the current request does the same command release: `0xac483f31…e36fd0`. Anna can open the secret again, and nobody typed `share`.

**A check nobody has seen fail is not a check**, which is why `evidence/release-loop.log` leads with the refusal and not with the success.

**The crypto moved into `scripts/nextkey-core.mjs`.** `release.mjs` has to wrap a content key exactly as `share` does, and two implementations of that rule would eventually disagree — producing a grant nobody can open, discovered three steps from its cause. That is not hypothetical: it is the shape of the grant-addressing bug from Friday. One rule, one place.

The refactor cost a regression check (`open visa anna` and `open visa alice`, both unchanged) and made the README's pinned line numbers wrong — they pointed at a layout that no longer exists. Replaced with file-and-function references on `main`, which cannot go stale the same way. Precision traded for durability, deliberately.

**What is still not enforced, and the distinction is the point.** Nothing stops the owner from ignoring the verdict and calling `share` directly; they hold the key and the ENS role, which is the design. In production the DON's signed report would be delivered on chain and a contract would gate the write — the check would be the chain's rather than a file on a laptop. That step is not built. Saying "the loop is closed" without that sentence would be the kind of claim this project has spent a week not making.
---

## 2026-09-06 (afternoon) — a Ledger is just a recipient

**Ledger replaces World as the third partner slot.** World's Sandbox access was requested at the start of the event and has not arrived; other teams report the same wait. Waiting produced nothing for three days, so the slot went to something we could build. World is not deleted — it is marked in the README as designed and not built, and if access lands before submission we pick the three strongest then.

**Ledger's track asks for exactly what this project already is.** *"Real user value with clear autonomous/approval boundaries. Practical demos showing why device-backed trust matters."* We had built the agent with one role and an on-chain rejected transaction before knowing anyone was asking for it.

**The device is a recipient, not an integration.** This is the part worth recording. NextKey addresses a recipient by the X25519 public key in their ENS record; where the private half lives was never part of that interface. So the whole feature reduced to one line in `openGrant`:

```js
const shared = await identity.sharedWith(ephPk)
```

A software identity answers with X25519 locally; a Ledger identity asks the device. Nothing else in the project branches on which it is — not the sender, not the grant format, not the record addressing. `share visa alice bob.nextkey.eth` is byte-for-byte the same command whether Bob's key is a file or a Nano X.

That it could be added in an afternoon is a property of the earlier design, not of this afternoon's work.

**EIP-1024 was the deciding discovery.** `getEIP1024PublicEncryptionKey` and `getEIP1024SharedSecret` give a real X25519 public key and perform the ECDH on the device. We had expected to derive an encryption key from a deterministic signature — a known trick with a caveat we would then have had to defend. Found by listing `Eth.prototype`, not from documentation.

**The device refusing without confirmation is a feature we did not design.** `boolDisplay: false` answers 0x6985, which the library renders as "denied by the user?" although nothing was shown. The behaviour is right: key agreement always needs a person present. So a secret shared with a Ledger holder cannot be opened by malware on their laptop — the approval boundary this project is about, expressed in hardware instead of prose.

**Four tooling findings in the first hour**, all in `FEEDBACK-LEDGER.md` with reproductions: the ESM build cannot be imported by Node, npm's script gating silently skips node-hid's binary, the EIP-1024 encodings are hex and undocumented, and 0x6985's message misdirects. Ledger's criteria require tooling feedback; ours is the kind that can be acted on.

**One thing I got wrong and fixed:** the first version took only a full derivation path, which is awkward to type in PowerShell and wrong for anyone with several wallets on one device. `--account 3` now matches Ledger Live's numbering, and `ledger-accounts` lists addresses so the right wallet is recognised rather than counted. Ledger Live's "Account 3" is `44'/60'/2'/0/0` — the index is the third component, and getting it wrong derives a different valid key that fails much later.
---

## Template for further entries

```
## YYYY-MM-DD

**What was decided.**
Why. What was rejected and why not. What it cost or saved.
```

Entries that record a *reversal* are the most valuable ones — they are what makes this log worth reading rather than a list of things that happened to work.

---

## 2026-09-05 (late) — the agent gets a namespace, and a limit

**The release agent is a namespace, not a service account.** `agent.nextkey.eth` is a name in our own registry; the agent signs with its own key, funded separately, and holds one role on one resource. An agent that signs with the owner's key is not an agent with a permission — it is the owner with extra steps, and every claim about the boundary would be theatre.

**The boundary is demonstrated, not asserted.** `agent.mjs prove-boundary --onchain` files the forbidden call as a real transaction so it can be opened on Etherscan: [`0x6f0e35fd…790e68`](https://sepolia.etherscan.io/tx/0x6f0e35fd5ae0d00cd5d5867bfbe60a78356ca83b3d5644afa2ede46234790e68), status `reverted`. Gas estimation refuses to send a call it knows will fail, so the script sets the gas limit explicitly. A rejected transaction anyone can inspect is worth more than a paragraph of prose about least privilege.

**The permission turned out finer than we designed for.** We expected `grantSetterRoles` to mean "may write to this name". It means "may call this setter, with this key, on this name": `setText(nextkey.request)` on `agent.nextkey.eth` is resource `0x4fc08dd2…c9bc0d`, while `setText(nextkey.notify)` on the *same* name is `0x85d07a57…33cfee`, where the agent holds nothing. Measured, not assumed — and the README now claims per-record scoping because we checked it.

**Two corrections to my own tooling, both recorded because both were the kind that produce confident wrong answers.**

`grantSetterRoles(bytes name, address)` does not take a name. It takes the encoded calldata of the setter being authorized. The parameter's ABI name says otherwise and we believed it, which cost an evening. Now finding 7 in `FEEDBACK-ENS.md`.

`show-roles` first derived the resource id from the namehash via `getRecordId`, which returns `0`, and a `roles()` query on resource `0` answers "no roles" for an account that has them. A wrong answer, not an error. It now provokes a refusal from the zero address and reads the resource out of the revert — the contract's error path is a more dependable interface than its getters, which is finding 8.

And it reported per-resource roles only, which told us the *owner* had no permissions on a name he can freely write. Authority also descends from `ROOT_RESOURCE`, and a tool that shows one half of a two-half model is not incomplete, it is misleading. Both halves are printed now.

**Still open.** The workflow does not yet evaluate this request. The agent writes a proposal and a `requestHash`; binding a confidential verdict to that hash is the next piece, and it is what turns the Chainlink slot from qualified into earned.

---

## 2026-09-05 (night, later) — the verdict is bound to the request

**The confidential workflow now decides about a real on-chain request, and says which one.**

The gap it closes is specific. An enclave's inputs are invisible by design, so "the enclave approved this" is a claim about something nobody else can see — worth very little on its own. The workflow now hashes the request record verbatim as stored at `agent.nextkey.eth · nextkey.request` and returns that hash with the verdict. Read the record, hash it, compare. `bun test` does it against the live fixture, so the assertion is executable rather than described.

```
"RELEASE — quorum_and_delay_satisfied (request 0x5ab6aad279b3700b,
 bound to 0xb74ac566…, secret in enclave: true)"
```

**Hash first, parse second.** Re-serialising a parsed object reorders keys and yields a hash that matches nothing on chain. The request therefore travels through the schema as an opaque string and is parsed only after hashing. Easy to get wrong, and it would have failed silently — the hash would simply never have matched, and the obvious suspicion would have fallen on the chain read.

**The fixture is generated, not written.** `agent.mjs fixture` reads the record off the chain and wraps the confidential half around it. Only the guardian approvals are invented, and the file's first field says so. A fixture that quietly hand-copies the request would make the whole binding circular.

**What this changes for the Chainlink slot.** The substantive criterion is that the workflow is a meaningful part of the product rather than an isolated example. Until tonight our honest answer was *not yet*: the rule was tested, the simulation ran, but it judged invented data. It now judges a request an independent agent filed on chain under a scoped ENS role, and its verdict is checkable against that request. Qualified became earned.

**Still deliberately out of scope.** Delivering the signed report to a contract via `evmClient.writeReport` — so a RELEASE would write the grant itself. The decision path is complete; the actuation path is one step short, and saying so is better than implying otherwise.
---

## 2026-09-06 — the demo becomes something you can use

**Until today the site let a judge watch. Now it lets them do it.**

`demo.html` reads a secret that already exists — real records, read live, and a
good answer to "is this actually on chain". It is a bad answer to "does this
work for *me*", which is the question a prize is decided on. So there is a third
page, `try.html`, and it runs the whole loop: write a secret, make or look up a
recipient, encrypt and grant, open it as the recipient, watch a stranger fail,
revoke, watch the recipient fail too.

**No wallet for the first five steps.** That was the constraint everything else
followed from. A judge with two minutes and no Sepolia ether has to be able to
finish, or the page is a gate rather than a demonstration. So steps 1 to 5 are
arithmetic in the browser: no account, no gas, no server, nothing to install.

**The sixth step writes to a name the visitor owns, not to one of ours.** It
would have been easier to grant strangers a setter role on a subname of
`nextkey.eth` and let them write there. It would also have proved less: a system
demonstrated only on the author's own name has not been demonstrated. They
register at the ENS app, connect a wallet, and NextKey writes two text records to
their name — which is the actual claim, that this is a pattern on ENS and not a
service we host.

Both writes are simulated before a signature is asked for. A revert then arrives
as a reason rather than as a transaction hash and a shrug, and the three likely
causes — not your name, no resolver attached, no gas — are named in the failure
message, because "execution reverted" tells a visitor nothing about which.

**The refusal we designed in.** A box on a web page asking for a recovery phrase
is the oldest theft in this industry, and it is the theft NextKey exists to
answer. Building one to demonstrate the answer would have been an odd week's
work. So: a generator for a real throwaway BIP-39 phrase, a warning that appears
and stays whenever twelve words show up that the page did not generate, and a
confirmation the visitor must give before step 6 writes anything. Steps 1 to 5
are safe whatever is typed, because nothing leaves the tab. Step 6 writes to a
public chain, and a chain does not forget.

The phrase the generator makes is a *valid* mnemonic. An invalid one would let a
sceptic dismiss the whole thing as a toy — and no address is derived from it
anywhere in the page, so it stays worth nothing.

**The one thing the page will not do, and says so.** Grant to a real ENS name and
it encrypts to the key that name publishes and then reports that it cannot open
the result. That is not a missing feature. The recipient's private key is on the
recipient's machine; if a web page could open the grant, the product would not
work. Hiding that would have been the lie, so it is stated in the interface.

**`src/nk-crypto.js` exists because of a bug we already had.** The wrapping rule
now has two implementations — `scripts/nextkey-core.mjs` for Node,
`src/nk-crypto.js` for the browser — and if they drift the failure is not a
crash. It is a grant that writes cleanly, reads cleanly and refuses to open,
discovered three steps downstream of its cause. That has happened once in this
project already.

Pasting the crypto into `try.js` would have been shorter and would have tested
nothing. Keeping it in its own module makes it reachable: `node
web/test/interop.mjs` bundles that file alone into a headless Chromium,
generates a grant with the Node construction and opens it with the browser one,
does it the other way round, and checks both halves refuse a stranger's key.
Five checks, and they pass.

**What is still unverified.** Step 6 has never touched the chain. This container
cannot reach the Sepolia RPC, so the whole write path — resolver discovery, the
simulation, the two `setText` calls — is written and reviewed but not executed.
Everything else on the page is tested in a real browser in all ten languages. The
line between the two is worth keeping visible rather than rounding up.

**A defect found on the way.** A two-column definition list with `white-space:
nowrap` on the term assumes the label is short. It is in English. It is not in
Russian: *опубликованный ключ* pushed the page eight pixels sideways on a
320-pixel screen. The list stacks below 30rem now, on `demo.html` too, where the
same latent bug was waiting.


---

## 2026-09-06 (later) — v2: the record name was the leak

**A grant is no longer addressed by the recipient's fingerprint.**
Until today a grant lived at `nextkey.grant.<first 16 hex of sha256(recipient's
public key)>`. That address is a pure function of a public value: anyone holding
`anna.eth`'s published key could compute it and check any name in the world for
a grant to her, getting a yes or a no without asking anybody. The ciphertext was
never the leak. The record name was, and it published the guest list of every
secret in the system.

v2 derives the address from the ECDH result instead. Both the wrapping key and
the record name come out of `HKDF(shared, salt = ephPub ‖ recipientPub)` under
different info strings — `nextkey/v2/wrap` and `nextkey/v2/tag` — so an observer
holding every public value in the system cannot compute the address, cannot test
a guess, and learns nothing from the fact that a name carries five unnamed
records rather than two.

**One ephemeral keypair per name, not per recipient.**
One pair suffices for any number of recipients, because each recipient's ECDH
lands somewhere different. Its public half goes to `nextkey.eph`, written once
and never replaced — replacing it would move every grant on the name to a new
address simultaneously and strand the old records, unreadable and unfindable.
Both writers refuse to overwrite a `nextkey.eph` that disagrees with the key
they hold, rather than treating it as a stale value.

**Rejected: a fresh ephemeral pair per grant**, which is what v1 did and what the
textbook construction does. It is not wrong, but it puts the ephemeral public
key *inside* each grant, so the recipient cannot compute the address until she
has already found the record — which is circular. One pair on the name breaks
the circle, and the pairing salt keeps the grants independent anyway.

**The `for` label is gone.** v1 wrote the recipient's name in plain text beside
the grant, as a courtesy to whoever read the record in an explorer. It would
have handed back precisely what the new address withholds. The owner does not
need it: they hold the ephemeral private key and can recompute any recipient's
address from that recipient's published key, which is also why revocation still
works without an index record.

The cost is real and is not being talked around: a v2 name in the ENS explorer
no longer reads as anything. That is the design working, and it is
indistinguishable from the design broken — so `nextkey.mjs eph <name>` exists to
answer both questions the explorer cannot.

**The ephemeral private key must outlive the machine that made it.**
Otherwise a name is frozen after the first session: no second recipient can ever
be added, because nobody can compute where their grant belongs. Two independent
routes back, deliberately, so that losing either alone costs nothing:

  · `nextkey.eph.sealed` — the key wrapped to the owner's own identity key,
    under its own info string. Needs no wallet.
  · Derivation from a signature over a fixed message. Needs no stored file.

Whichever route is used, the result is checked against the published
`nextkey.eph` before anything is written; when both are available they are also
compared with each other, and a mismatch is a hard error rather than a warning.
A silent disagreement here would mean writing grants to addresses nobody will
ever look at again.

**The derivation rests on deterministic signing, so it was measured, not assumed.**
RFC 6979 says ECDSA as Ethereum uses it derives its nonce from the key and the
message, which makes a signature reproducible. `scripts/probe-signing.mjs` checks
that the wallet in hand actually behaves that way: three signatures over the same
message, byte-compared, plus a check that a different name derives a different
key. Verified today on `0x9780…dd0B`. If it had failed, the fallback would have
been removed rather than documented as a caveat.

**The browser derives, but does not seal.**
`try.html` steps 1 to 5 run without a wallet — that is the strongest claim the
page makes — so the ephemeral pair there is random and lives in a JS variable.
Step 6, which already asks for a wallet, derives a real one from a signature and
recomputes both records before requesting the first transaction signature. It
then says that the grant address moved, and shows both values, because writing
something other than what step 3 displayed would be a small lie in the one place
the page is being inspected.

It writes no `nextkey.eph.sealed`: sealing needs an identity key file, a browser
has none, and inventing a key nobody could reproduce would be worse than
offering no second route. Recovery in the browser means signing the same message
again.

**Rejected: asking for the wallet in step 3** so that display and construction
would agree throughout. It would have cost the sentence that makes the page
worth visiting — that the first five steps need no wallet, no account and no
ether.

**Three test files now, each testing something the others cannot.**
`web/test/v2.mjs` checks the construction against the file the command line
actually runs, including the case that matters: an adversary holding the name's
ephemeral key *and* the recipient's public key still reaches neither the address
nor the grant. `web/test/interop.mjs` checks that two independent
implementations agree — and now compares the signing message character for
character, because it is an input to a key derivation and one stray line break
would derive a different key. `web/test/playground.mjs` drives try.html in a
real browser, which is the only one of the three that can notice a renamed
element or a handler that throws.

26 interop checks (13 in Node, the same 13 in Chromium), 13 construction checks,
13 playground checks.

**v1 names still open.** `open` consults `nextkey.eph` first and falls back to
the fingerprint scheme when there is none. The order is not politeness, it is the
only way to tell the two apart: a v2 grant lives at an address that cannot be
guessed, so "no record here" is indistinguishable from "wrong scheme" unless the
ephemeral key is consulted first. And `visa.nextkey.eth` and `nextkeydemo.eth`
are v1 — they are the names `evidence/playground-onchain.log` points at, and a
demo that cannot open its own evidence is worse than no demo.

---

## 2026-09-07 — The guard that failed by working correctly

**A write was aimed at the zero address, and our own safety check approved it.**
The playground's bring-your-own-name lane resolves the name, then simulates the
write before asking for a signature. A visitor entered a name with no resolver
on this deployment; `getEnsResolver` returned the zero address, and the code
carried on. The simulation — the step whose entire purpose is to catch this —
passed.

It passed because it was working. `setText` returns nothing, so an `eth_call`
against an address with no code comes back empty, and for a function with no
outputs empty *is* the valid answer. There is no way for a simulation to
distinguish "this contract accepted the call" from "there is no contract here"
when the correct response to both is silence. That is a property of the ABI, not
a bug in viem, and it applies to every setter without a return value.

What actually caught it was MetaMask, whose burn-address warning stood between a
judge and a transaction that would have cost gas and changed nothing. Worth
recording plainly: on this one, the wallet's paranoia outperformed ours.

**The fix is two explicit checks rather than a better simulation.** The resolver
must not be the zero address, and `getBytecode` must return something. Both run
before any signature is requested, and both fail with a sentence rather than a
revert — including the case a visitor is most likely to hit, which is holding a
name on *production* ENS and not on the hackathon deployment.

**A second thing came out of the same report.** The lane asks for a name and
offers no help finding one, which is backwards: the address is only evidence
that you may write to a name, so the name is the thing being connected. The page
now reverse-resolves the connected account and fills the field in. Enumerating
every name an address owns needs an indexer, which a page served from static
files does not have — so when no primary name is set, it says that instead of
leaving an empty box and an error.

**Rejected: letting the page register a name.** Four transactions, a
sixty-second commit–reveal wait and mock USDC the visitor has to obtain
somewhere. Building that into a playground means building a registrar, and the
lent-name lane beside it already solves the problem the visitor actually has.
