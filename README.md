# NextKey

**A human is involved. No human is in control.**

NextKey hands secrets over to the people who should get them — under rules nobody can bypass, not even us.

> **Repository note.** This repository was initialized on 3 September 2026 with scaffolding only (README stub, `.gitignore`, MIT license). All project work begins at the official ETHOnline 2026 kickoff on 4 September 2026 — see the commit history. No code, designs or assets predate the kickoff.

> **Status: prototype.** Built during ETHGlobal ETHOnline 2026, running against the ENSv2 beta on **Sepolia testnet**. Not audited. Do not put a seed phrase you actually rely on into it.

---

## What it does

You place a secret: a seed phrase, a private key, a credential, a document. Then you decide two things — who may open it, and under what conditions. Both are enforced by the protocol, not by our servers and not by anyone's goodwill.

**Who may open it** is answered by ENSv2. Sharing a secret with someone means granting a read permission on your own permissioned resolver, addressed by their ENS name instead of a hex address. You share with `anna.eth`, not with `0x7f3a…`, and the permission lives in a registry you control rather than in our database.

**Under what conditions** is answered inside a trusted execution environment. A release agent can propose but never act alone; the condition itself — a guardian quorum, a time lock, prolonged inactivity — is evaluated inside a Chainlink CRE Confidential Workflow, so the secret never passes a node anyone can inspect.

And when someone has lost everything — device gone, backup gone — recovery does not depend on a file they were supposed to keep. Their guardians confirm, and World's Selfie Check proves that a unique, living person is the one asking.

---

## How it works

1. **Place a secret.** Encrypted in your browser before it goes anywhere.
2. **Share it with a name.** `anna.eth`, not `0x7f3a…`. NextKey grants her a read permission on that one record — nothing else on your account.
3. **Anna hears about it.** Through whatever channel she declared in her own ENS records. She never signed up for NextKey.
4. **If she loses everything, she gets back in.** Her guardians confirm, and Selfie Check proves a unique, living person is asking.
5. **Some releases happen without you.** The agent proposes; an enclave decides, against rules you wrote yourself.

---

## ENSv2 in NextKey

Access control is not a table in our backend. It is state in a public registry that the user owns.

Each stored secret becomes a **subname** in a `UserRegistry` deployed through the Verifiable Factory and parented under `nextkey.eth`. Every subname is an ERC1155Singleton token with exactly one owner, and carries its own Permissioned Resolver. The product's sharing semantics then coincide with protocol primitives:

| What the user does | What happens in the protocol |
|---|---|
| Share a secret with `anna.eth` | `grantRoles()` on that resource. The Permissioned Resolver exposes 11 roles, 8 of them per-record — so we delegate the right to **one** text record and nothing else |
| Limit access to seven days | The subname's `expiry` field. Access ends once `block.timestamp >= expiry` |
| Revoke access | `revokeRoles()`. Unlike ENSv1 fuses, Enhanced Access Control is reversible |
| Stop Anna from passing it on | Simply never grant `ROLE_CAN_TRANSFER_ADMIN` — the access becomes non-transferable |
| Name a guardian | A role scoped to the recovery resource only: may confirm, may not read |
| Run a release agent | Its own namespace holding exactly one role — *propose* a release. It cannot read and cannot release |

That last row is also ENS's own bonus criterion for this hackathon: *agents as namespaces, each with their own identity and permissions.*

Two more ENSv2 features carry real weight here: the recipient's **X25519 public key** lives in a text record, so we can encrypt for someone we know only by name — no key server, no registration. And each user's **notification channel** is a text record too, which is why step 3 above works for people who have never heard of NextKey.

<!-- TODO: add file/line pointers into the code for each row above before submission -->

### Hackathon deployment

This project builds against the dedicated ENSv2 hackathon deployment on Sepolia, **not** the production ENS addresses.

| Contract | Address |
|---|---|
| UpgradableUniversalResolverProxy | `0xd26f2040d083af1cd2962ba303f4bea0c4faf142` |
| UniversalResolverV2 | `0xfea8d4b7fcce0b8765c793d6695eac384aaa458f` |
| BatchRegistrar | `0xc8efa80d9f645b26bacd1bae8638492df3bae8ca` |
| ContractNamer | `0x21a2b577709727119f1901314e0ba0150eafa15e` |
| ENSV1Resolver | `0x1f11e5b8bca2ccfe13bd8431853db159c4e9849c` |
| DNSTLDResolver | `0x10107255fda20ab6c37a0efca1e9465f25066a00` |
| DNSTXTResolver | `0x0ebc944ac29f91cc24ee507a2d46aa4901bbc748` |
| DNSAliasResolver | `0x005a3bf1d92ebe4b1e1641a0c6fa49f38e1762a6` |
| DNSSECGatewayProvider | `0xfedb5c2fea17cef8547d534c3125f7601d3e30bd` |
| DefaultReverseRegistrarAdapter | `0x0a8d7ed4061548fb3cb192d0cbe9e1a57b3b1ae9` |

<!-- TODO: add our own UserRegistry + Permissioned Resolver addresses once deployed -->

**Important:** viem and ethers ship with a built-in Universal Resolver address. It must be overridden once, or resolution silently hits the wrong deployment:

```ts
import { createPublicClient, http } from 'viem'
import { sepolia } from 'viem/chains'

const hackathonSepolia = {
  ...sepolia,
  contracts: {
    ...sepolia.contracts,
    ensUniversalResolver: {
      address: '0xd26f2040d083af1cd2962ba303f4bea0c4faf142',
    },
  },
} as const

export const client = createPublicClient({
  chain: hackathonSepolia,
  transport: http(),
})
```

Explorer and registration app for this deployment:
- Explorer — https://hackathon-deployment-portal-app.ens-cf.workers.dev/
- Register names — https://hackathon-deployment-manager-app-v4.ens-cf.workers.dev/

---

## World ID Selfie Check in NextKey

Selfie Check is used as a **risk and eligibility signal**, not as a login.

The hardest question for a product like this one is how somebody gets back in after losing everything, without opening the same door to an attacker. Plain social recovery fails here: an attacker who can pressure, impersonate or replay their way past the guardian step is through. NextKey requires both — the guardians confirm the request, *and* Selfie Check establishes that a unique, live human is the one asking. The selfie never leaves the device; the app receives only an anonymous proof.

<!-- TODO: link to the recovery flow implementation and add the Sandbox test evidence -->

---

## Chainlink CRE in NextKey

Automation is useful right up to the moment it can act alone. NextKey draws that line twice.

The release agent has its own ENS namespace carrying exactly one role: *propose* a release. It cannot read a secret and it cannot release one — that boundary is enforced cryptographically by Enhanced Access Control, not by our code being polite about it.

The second boundary is the enclave. A proposal is evaluated inside a **Chainlink CRE Confidential Workflow**: the key material and the set of guardian approvals go in via `cre.handlerInTee(...)`, the release condition is evaluated there, and only a `RELEASE` or `DENY` verdict crosses back to the DON through `runtime.usingTheDons()`. The value nobody may see is precisely the one that never comes out.

This is deliberately load-bearing rather than decorative: remove the workflow and the release condition degrades from something enforced to something promised.

**A note on what confidentiality means here.** CRE protects data *during execution*, not source code — the workflow's code stays public, as it should for an open-source project. The claim NextKey makes is narrow and true: a secret never passes a node an operator can inspect. It does not claim its release logic is hidden.

**Secrets in this build** are resolved from the local environment rather than from the Vault DON, which keeps the demo reproducible for anyone with the CRE CLI and no beta grant. Chainlink Labs confirmed during the hackathon that `cre workflow simulate` runs confidential workflows without beta access; the grant is only needed to deploy to the confidential workflow DON and to store secrets on the Vault DON.

<!-- TODO: link to the workflow source and reference evidence/cre-simulation.log -->

---

## Run it locally

<!-- TODO: fill in once the app scaffold exists. Must be tested from a clean clone before submission. -->

```bash
git clone https://github.com/4bridges/nextkey.git
cd nextkey
# ...
```

Required environment variables: <!-- TODO -->

---

## Demo

- Live demo: https://nextkey.li
- Demo video: <!-- TODO -->

---

## Evidence

Sponsor qualification evidence is collected in [`evidence/`](./evidence) as it is produced, not assembled at the end:

- `cre-simulation.log` — terminal output of a successful Confidential Workflow simulation
- ENSv2 transaction hashes for registry deployment, subname registration and role grants
- Selfie Check flow captured from the World ID Sandbox App

<!-- TODO: fill in as each piece is produced -->

---

## Prize tracks

This project is submitted to three partner prizes:

| Sponsor | Track |
|---|---|
| ENS | Best Use of ENSv2 |
| World | Selfie Check |
| Chainlink | Best Confidential Workflow |

---

## Documentation

## Documentation

- [`docs/planning/`](./docs/planning) — planning artifacts written before the kickoff, dated
- [`ai/PROMPT_LOG.md`](./ai/PROMPT_LOG.md) — prompts that shaped documents, decisions and code
- [`docs/decisions.md`](./docs/decisions.md) — dated decision log kept during the build
- [`AI_USAGE.md`](./AI_USAGE.md) — AI tool usage disclosure
- [`FEEDBACK-WORLD.md`](./FEEDBACK-WORLD.md) — developer experience feedback for World
- [`evidence/`](./evidence) — sponsor qualification evidence

`docs/architecture.md` follows once the data model is settled.

---

## Team

Built solo by [@4bridges](https://github.com/4bridges) (Web3Degens, Switzerland) at ETHGlobal ETHOnline 2026.

An earlier project of ours, [pKeep](https://ethglobal.com/showcase/pkeep-unleash-decentralized-safety-0exsj) (ETHIndia 2023), tackled decentralized secret storage and ran aground on exactly one problem: restricting who could access what. NextKey is a fresh start — no code, designs or assets carried over — built because ENSv2 finally makes that problem solvable at the protocol layer.

## License

MIT — see [LICENSE](./LICENSE).
