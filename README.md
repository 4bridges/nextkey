# NextKey

**A human is involved. No human is in control.**

NextKey hands secrets over to the people who should get them — under rules nobody can bypass, not even us.

> **Repository note.** This repository was initialized on 3 September 2026 with scaffolding only (README stub, `.gitignore`, MIT license). All project work begins at the official ETHOnline 2026 kickoff on 4 September 2026 — see the commit history. No code, designs or assets predate the kickoff.

> **Status: prototype.** Built during ETHGlobal ETHOnline 2026, running against the ENSv2 beta on **Sepolia testnet**. Not audited. Do not put a seed phrase you actually rely on into it.

---

## What it does

You place a secret: a seed phrase, a private key, a credential, a document. Then you decide two things — who may open it, and under what conditions. Both are enforced by the protocol, not by our servers and not by anyone's goodwill.

**Who may open it** is answered by cryptography, addressed through ENSv2. Sharing a secret with `anna.eth` wraps its key to the X25519 public key Anna publishes in her own ENS records — you share with a name, not with `0x7f3a…`, and Anna never registers with us. ENSv2 enforces the other half: who may write that grant, revoke it, or delegate the right to. That is state in a registry you own, not a row in our database.

**Under what conditions** is answered inside a trusted execution environment. A release agent can propose but never act alone; the condition itself — a guardian quorum, a time lock, prolonged inactivity — is evaluated inside a Chainlink CRE Confidential Workflow, so the secret never passes a node anyone can inspect.

And when someone has lost everything — device gone, backup gone — recovery does not depend on a file they were supposed to keep. Their guardians confirm, and World's Selfie Check proves that a unique, living person is the one asking.

---

## How it works

1. **Place a secret.** Encrypted in your browser before it goes anywhere.
2. **Share it with a name.** `anna.eth`, not `0x7f3a…`. NextKey reads the public key from her ENS records and wraps this one secret's key to it — that record and nothing else on your account.
3. **Anna hears about it.** Through whatever channel she declared in her own ENS records. She never signed up for NextKey.
4. **If she loses everything, she gets back in.** Her guardians confirm, and Selfie Check proves a unique, living person is asking.
5. **Some releases happen without you.** The agent proposes; an enclave decides, against rules you wrote yourself.

---

## ENSv2 in NextKey

Access control is not a table in our backend. It is state in a public registry that the user owns.

Each stored secret becomes a **subname** in a `UserRegistry` deployed through the Verifiable Factory and parented under `nextkey.eth`. Every subname is an ERC1155Singleton token with exactly one owner, and carries its own Permissioned Resolver. The product's sharing semantics then coincide with protocol primitives:

**What ENS does and does not do here.** It would be easy to claim that ENSv2 grants Anna permission to *read* a secret. It does not, and no chain could: everything stored on a public chain is publicly readable. We assumed otherwise for a while and the contracts corrected us — the Permissioned Resolver's primitive is `grantSetterRoles(bytes name, address)`, which governs who may **write** a record.

So NextKey splits the two concerns rather than conflating them. **Confidentiality comes from cryptography**: the record holds ciphertext, and who can decrypt it is decided by wrapping the key to the recipient's X25519 public key — itself published as a text record, which is how we encrypt for someone we know only by name, with no key server and no registration on their side. **Control comes from protocol roles**: who may update the pointer, who may revoke it, who may delegate.

| What the user does | What happens in the protocol |
|---|---|
| Share a secret with `anna.eth` | A key blob wrapped to Anna's `nextkey.pubkey` record is written into the subname. Anna can decrypt it; anyone can see that something was shared |
| Limit access to seven days | The subname's `expiry`. Resolution stops once `block.timestamp >= expiry` — enforced by the registry, not by us |
| Revoke access | Overwrite or clear the record. Only accounts holding the setter role can do it, so revocation is as strong as the role model |
| Delegate writing to the release agent | `grantSetterRoles()` on exactly one name. The agent may propose; it holds no key material and cannot decrypt anything |
| Keep control while delegating | Roles and their admins are separate. The owner keeps the admin role, so a delegate can act but cannot pass the right on |
| Give the agent an identity | Its own namespace with that single role — ENS's own bonus criterion for this hackathon: *agents as namespaces, each with their own identity and permissions* |

Each user's **notification channel** is a text record too, which is why step 3 above works for people who have never heard of NextKey.

A grant is stored under the recipient's **key fingerprint**, not their name — `nextkey.grant.<first 16 hex of sha256(publicKey)>` — with the name carried inside the value for readability. Names move; the key that opens a grant does not. See [`docs/decisions.md`](./docs/decisions.md) for the bug that taught us this.

**Verified end to end** on the hackathon deployment, twice over. The resolution path — `nextkey.eth` → our UserRegistry → `visa.nextkey.eth` → its Permissioned Resolver → a text record read back through the **Universal Resolver**, the path any client takes (`scripts/resolver.mjs`). And the product path on top of it (`scripts/nextkey.mjs`): a seed phrase encrypted into `nextkey.secret`, shared with `anna.nextkey.eth`, and opened by Anna with her own key.

| Step | Transaction |
|---|---|
| Anna publishes `nextkey.pubkey` | [`0xd0deb560…20e932`](https://sepolia.etherscan.io/tx/0xd0deb560cbf55ae7df767c8a536ff76864c8bfe61b61436475836d781020e932) |
| Ciphertext into `nextkey.secret` | [`0x88b82fd9…132987`](https://sepolia.etherscan.io/tx/0x88b82fd9c83631a98613d968fb727fe6c860e8fc60c52edb10b7a73c99132987) |
| Grant to the owner | [`0xba8e6925…508ff0`](https://sepolia.etherscan.io/tx/0xba8e69252eb92c650cddaa7ee166ac96f2f92ff108fa7ce30d3d755a3b508ff0) |
| Grant to Anna | [`0x6a051d14…d91290`](https://sepolia.etherscan.io/tx/0x6a051d14f8425b87398a4d093c6068b8bccf9cdff7fbbc5329f38eff06d91290) |

Terminal output in [`evidence/encryption-loop.log`](./evidence/encryption-loop.log).

**The owner is a recipient like any other.** There is no master key and no owner-only branch in the code — keeping one would make "we cannot read your secrets" a lie. The honest cost: lose your local key file and the secret is gone. We would rather state that than hold a key we promise not to use.

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

### NextKey's own contracts on this deployment

| What | Address / value |
|---|---|
| `nextkey.eth` owner | `0x9780aFE81EF5b58333c83e05d5C07797BD81dd0B` |
| NextKey UserRegistry | [`0x612034AB34Ec262d5417EA3163718E7455157908`](https://sepolia.etherscan.io/address/0x612034AB34Ec262d5417EA3163718E7455157908) |
| Registry deployment tx | [`0xb6b94e4f…924749`](https://sepolia.etherscan.io/tx/0xb6b94e4f5675cb8273960482e3926ee6523d3f4baa1e03b266d6f6a699924749) |
| Registry implementation | `0x47B442d0CF617c41CAbAFf5f02f44DD1e5f72546` |
| `visa.nextkey.eth` Permissioned Resolver | [`0x52A02f288AA5dde082206D85d4001880D64F4101`](https://sepolia.etherscan.io/address/0x52A02f288AA5dde082206D85d4001880D64F4101) |

The registry proxy address is deterministic: its salt is `keccak256(keccak256("UserRegistry"), namehash("nextkey.eth"), version)` with version `0`. Redeploying requires bumping the version, or the CREATE2 address collides.

`nextkey.eth` was registered directly against the `ETHRegistrar` rather than through the manager app — see [`FEEDBACK-ENS.md`](./FEEDBACK-ENS.md) for why, and `scripts/register-name.mjs` for how.

<!-- TODO: add the Permissioned Resolver proxy address once deployed -->

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
- `encryption-loop.log` — store, share and open, run against the hackathon deployment
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

- [`docs/planning/`](./docs/planning) — planning artifacts written before the kickoff, dated
- [`ai/PROMPT_LOG.md`](./ai/PROMPT_LOG.md) — prompts that shaped documents, decisions and code
- [`docs/decisions.md`](./docs/decisions.md) — dated decision log kept during the build
- [`AI_USAGE.md`](./AI_USAGE.md) — AI tool usage disclosure
- [`FEEDBACK-WORLD.md`](./FEEDBACK-WORLD.md) — developer experience feedback for World
- [`FEEDBACK-ENS.md`](./FEEDBACK-ENS.md) — developer experience feedback for ENS
- [`evidence/`](./evidence) — sponsor qualification evidence

`docs/architecture.md` follows once the data model is settled.

---

## Team

Built solo by [@4bridges](https://github.com/4bridges) (Web3Degens, Switzerland) at ETHGlobal ETHOnline 2026.

An earlier project of ours, [pKeep](https://ethglobal.com/showcase/pkeep-unleash-decentralized-safety-0exsj) (ETHIndia 2023), tackled decentralized secret storage and ran aground on exactly one problem: restricting who could access what. NextKey is a fresh start — no code, designs or assets carried over — built because ENSv2 finally makes that problem solvable at the protocol layer.

## License

MIT — see [LICENSE](./LICENSE).
