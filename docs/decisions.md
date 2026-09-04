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

## Template for further entries

```
## YYYY-MM-DD

**What was decided.**
Why. What was rejected and why not. What it cost or saved.
```

Entries that record a *reversal* are the most valuable ones — they are what makes this log worth reading rather than a list of things that happened to work.
