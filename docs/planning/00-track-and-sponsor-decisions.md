# Track and sponsor decisions

*Planning artifact. Written 2–4 September 2026, before and at the kickoff. Prose only — no code, designs or assets.*

---

## 1. Why From Scratch and not Continuity

We had an eligible prior project: [pKeep](https://ethglobal.com/showcase/pkeep-unleash-decentralized-safety-0exsj), submitted to ETHIndia 2023. It stored passwords and seed phrases on decentralized storage and, by our own account at the time, ran aground on one problem: *restricting who could access what.*

Extending it under the Continuity track was the obvious move, and we rejected it.

ETHGlobal confirmed in Discord how the tracks are marked: prizes without a tag are From Scratch; Continuity prizes carry an explicit "only available to Continuity Track participants" label. Checking every track against that rule showed that the prizes matching our architecture — ENSv2, Selfie Check, Confidential Workflows — are all untagged. As a Continuity team we could have claimed roughly $500 of well-fitting prize money and would have had to distort the product to reach anything more.

The pKeep codebase would not have helped much regardless: three years old, built on a different storage stack, sharing nothing meaningful with ENSv2. We were trading little reusable code for the entire prize list.

So NextKey is a new project with a new name, and nothing from pKeep — no code, no designs, no assets — carries over. What carries over is three years of thinking about the same problem, which is a legitimate thing to bring and belongs in the demo video rather than in the repository.

## 2. The positioning, and a correction to it

An early draft of the positioning was *"secrets to people, not to addresses."* We discarded it as too weak and, more importantly, technically wrong: the entire stack exists so that you do **not** have to trust the person.

The motto became:

> **A human is involved. No human is in control.**

A person takes part at every step — they confirm, they identify themselves, they receive — but nobody can bypass the procedure, ourselves included. It is also the answer to the first question anyone asks a secrets product: *why should I trust you?* You should not have to.

## 3. Why these three sponsors

Three partner prizes may be selected per submission. Ours were chosen so that each one is load-bearing rather than decorative — an integration that can be removed without breaking the product does not deserve a slot.

**ENS — Best Use of ENSv2.** The problem pKeep failed on is exactly the problem ENSv2 solves at the protocol layer. Enhanced Access Control gives per-record permissions, so sharing a secret becomes a role grant rather than a database row; `expiry` gives time-limited access; `revokeRoles()` gives revocation that ENSv1 fuses could not. Remove ENS and NextKey has no access control at all.

**World — Selfie Check.** The hardest question for a secrets product is how somebody gets back in after losing everything, without opening the same door to an attacker. Plain social recovery fails there. Selfie Check supplies the missing signal — a unique, living person is asking — as a risk and eligibility check rather than a login, which is precisely how the track asks for it to be used.

**Chainlink — Best Confidential Workflow.** The release condition is core product logic, not an add-on: evaluating a guardian quorum, a time lock or prolonged inactivity without the secret ever passing an inspectable node. Chainlink Labs confirmed during the hackathon that `cre workflow simulate` runs confidential workflows without beta access, and the track accepts a CLI simulation as evidence.

## 4. What was considered and rejected

**Privy and 1inch Aqua** were the first candidates, before we had examined our own product closely. Both require money to move; a credential vault moves none. An integration forced in for the slot would have cost more in *Practicality* than it earned.

**Ledger — AI Agents × Ledger** ($3,500) was chosen and then reversed. It fit well: the track rewards "a clear boundary between autonomous and approved actions", which is our motto seen from the other side, and we had the devices. It was dropped once Chainlink turned out not to be gated. For a solo developer with nine days left, execution risk outweighed the larger pot — Ledger meant an agent stack, DMK, a hardware flow and a *second* developer-experience feedback document, while Chainlink encodes logic we were building anyway.

**The release agent survived that reversal.** It keeps its own ENS namespace holding exactly one role — propose a release, never read, never release — which also satisfies ENS's stated bonus criterion of *agents as namespaces, each with their own identity and permissions.*

**The Graph, Hedera, Arc, Uniswap, Bazantic** were assessed and set aside as not load-bearing for this product.

## 5. Scope discipline

Built by one person in ten days. The cut line, agreed before the kickoff: the core path — place, share, notify, recover — must run end to end before any secondary feature is started. Two clean integrations beat three half-finished ones, because *Practicality* and *Usability* are two of the five judging categories and an unfinished third sponsor costs points in both.
