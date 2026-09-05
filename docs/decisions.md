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

## Template for further entries

```
## YYYY-MM-DD

**What was decided.**
Why. What was rejected and why not. What it cost or saved.
```

Entries that record a *reversal* are the most valuable ones — they are what makes this log worth reading rather than a list of things that happened to work.
