# NextKey

**A human is involved. No human is in control.**

NextKey hands secrets over to the people who should get them — under rules nobody can bypass, not even us.

**Try it without installing anything: [nextkey.li/try.html](https://nextkey.li/try.html).** Encrypt a
passphrase, grant it to an ENS name, put it on Sepolia, open it back off the chain, watch a stranger
fail, revoke it. The whole loop, including the on-chain half — no wallet, no extension, no testnet
ether, on a phone if you like: we lend you a name and pay the gas. If you hold a name on the hackathon
deployment yourself, the same step writes it under *your* name with *your* wallet, which is the real
product.

> **Repository note.** This repository was initialized on 3 September 2026 with scaffolding only (README stub, `.gitignore`, MIT license). All project work begins at the official ETHOnline 2026 kickoff on 4 September 2026 — see the commit history. No code, designs or assets predate the kickoff.

> **Status: prototype.** Built during ETHGlobal ETHOnline 2026, running against the ENSv2 beta on **Sepolia testnet**. Not audited. Do not put a seed phrase you actually rely on into it.

---

## What it does

You place a secret: a seed phrase, a private key, a credential, a document. Then you decide two things — who may open it, and under what conditions. Both are enforced by the protocol, not by our servers and not by anyone's goodwill.

**Who may open it** is answered by cryptography, addressed through ENSv2. Sharing a secret with `anna.eth` wraps its key to the X25519 public key Anna publishes in her own ENS records — you share with a name, not with `0x7f3a…`, and Anna never registers with us. ENSv2 enforces the other half: who may write that grant, revoke it, or delegate the right to. That is state in a registry you own, not a row in our database.

**Under what conditions** is answered inside a trusted execution environment. A release agent can propose but never act alone; the condition itself — a guardian quorum, a time lock, prolonged inactivity — is evaluated inside a Chainlink CRE Confidential Workflow, so the secret never passes a node anyone can inspect.

**Where your own key lives** is your decision alone. A file on your machine, or a Ledger — the difference is invisible to whoever shares with you, because what they read is a public key in your ENS record and nothing else. On a device, opening a secret costs a deliberate button press, so software running on your laptop cannot do it while you are away from it.

And when someone has lost everything, recovery is meant to rest on guardians plus a proof that a unique, living person is asking, rather than on a file they were supposed to keep. That part is designed and not built — see the note under Prize tracks.

---

## How it works

1. **Place a secret.** Encrypted in your browser before it goes anywhere.
2. **Share it with a name.** `anna.eth`, not `0x7f3a…`. NextKey reads the public key from her ENS records and wraps this one secret's key to it — that record and nothing else on your account. Whether her key sits in a file or on a Ledger is her business, and changes nothing for you.
3. **Anna hears about it.** Through whatever channel she declared in her own ENS records. She never signed up for NextKey.
4. **If she loses everything, she gets back in.** Her guardians confirm, and a liveness proof establishes that a unique, living person is asking. *(Designed; the liveness half is not built — see Prize tracks.)*
5. **Some releases happen without you.** The agent proposes; an enclave decides, against rules you wrote yourself.

---

## ENSv2 in NextKey

Access control is not a table in our backend. It is state in a public registry that the user owns.

Each stored secret becomes a **subname** in a `UserRegistry` deployed through the Verifiable Factory and parented under `nextkey.eth`. Every subname is an ERC1155Singleton token with exactly one owner, and carries its own Permissioned Resolver. The product's sharing semantics then coincide with protocol primitives:

**What ENS does and does not do here.** It would be easy to claim that ENSv2 grants Anna permission to *read* a secret. It does not, and no chain could: everything stored on a public chain is publicly readable. We assumed otherwise for a while and the contracts corrected us — the Permissioned Resolver's primitive is `grantSetterRoles`, which governs who may **write** a record — and, as it turned out, which setter they may call with which key on which name.

So NextKey splits the two concerns rather than conflating them. **Confidentiality comes from cryptography**: the record holds ciphertext, and who can decrypt it is decided by wrapping the key to the recipient's X25519 public key — itself published as a text record, which is how we encrypt for someone we know only by name, with no key server and no registration on their side. **Control comes from protocol roles**: who may update the pointer, who may revoke it, who may delegate.

| What the user does | What happens in the protocol |
|---|---|
| Share a secret with `anna.eth` | A key blob wrapped to Anna's `nextkey.pubkey` record, written at a record name only she and the owner can compute. Anyone can see the subname holds *something*; nobody can see for whom |
| Limit access to seven days | The subname's `expiry`. Resolution stops once `block.timestamp >= expiry` — enforced by the registry, not by us. [Watched happen](./evidence/expiry.log): readable at 18s remaining, empty at 2s past, no grace period |
| Revoke access | Clear the grant record. Only accounts holding the setter role can, so revocation is as strong as the role model. [Executed](./evidence/revocation.log): Anna opens, the owner revokes, Anna cannot. Afterwards she reaches an address that holds nothing, and cannot tell a withdrawn grant from one that never existed |
| Delegate writing to the release agent | `grantSetterRoles()` for one setter, one key, one name. The agent may propose; it holds no key material and cannot decrypt anything |
| Keep control while delegating | Roles and their admins are separate. The delegate's bitmap has no admin half, so it can act and cannot pass the right on |
| Give the agent an identity | Its own namespace holding that single role — ENS's own bonus criterion for this hackathon: *agents as namespaces, each with their own identity and permissions* |
| Try it with no wallet at all | A pool of set-aside subnames on a resolver of their own, where a published throwaway key holds root roles. It can write records on those names and nowhere else. [Why not per-record delegation](./FEEDBACK-ENS.md) |

Each user's **notification channel** is a text record too, which is why step 3 above works for people who have never heard of NextKey.

### Where a grant lives is itself a secret

Our first design stored a grant under the recipient's key fingerprint — `nextkey.grant.<first 16 hex of sha256(publicKey)>` — with their name inside the value, for readability. Addressing by key rather than by name was right: names move, and the key that opens a grant does not.

The address was the mistake. It is a pure function of a **public** value. Anyone holding `anna.eth`'s published key can compute it and check any name on the deployment for a grant to her, and get a yes or no without asking anybody. The ciphertext was never the leak. The record name was, and it published the guest list of every secret in the system.

So a name now carries one ephemeral public key at `nextkey.eph`, written once and never replaced, and both the wrapping key and the record name are derived from the ECDH between it and the recipient's key, under different HKDF info strings:

| | v1 | v2 |
|---|---|---|
| Record name | `sha256(recipientPub)` | `HKDF(ECDH, salt = ephPub ‖ recipientPub, info = "nextkey/v2/tag")` |
| Who can compute it | anyone holding a public key | the recipient, and the name's owner |
| Value | `{v, for, epk, iv, ct}` | `{v, iv, ct}` |
| Recipient named in the clear | yes, in `for` | nowhere |

One ephemeral pair serves the whole name rather than one per recipient, because each recipient's ECDH lands somewhere else — a second grant shares no key material with the first. The recipient needs one scalar multiplication to find *and* open her grant, which is why a Ledger is asked to approve once rather than twice. The owner can recompute any recipient's address from that recipient's published key, which is why revocation still needs no index record.

**What an observer gets.** A name with an ephemeral key, a ciphertext, and some records whose names are 32 hex characters. Not who has access, not how many recipients there are in any meaningful sense, and no way to test a guess. That property is not free: a v2 name in the explorer no longer reads as anything, and a working one looks identical to a broken one — which is why `nextkey.mjs eph <name>` exists to answer the two questions the explorer cannot.

**v1 names still open.** `open` consults `nextkey.eph` first and falls back to the fingerprint scheme when there is none. The order is not politeness: a v2 grant lives at an address that cannot be guessed, so "no record here" is indistinguishable from "wrong scheme" unless the ephemeral key is read first.

**The ephemeral private key must outlive the machine that made it**, or a name is frozen after one session and no second recipient can ever be added. Two independent routes back, so that losing either alone costs nothing: `nextkey.eph.sealed`, wrapped to the owner's own identity key; and derivation from a signature over a fixed message, which needs nothing stored at all. Whichever is used, the result is checked against the published `nextkey.eph` before anything is written, and when both are available they are compared with each other. Deterministic signing is what makes the second route a key rather than a coincidence — [measured, not assumed](./scripts/probe-signing.mjs), and confirmed on chain where the two routes agreed.

### Where the role model stopped, and what we did

This is the part worth reading if you maintain the deployment.

The playground lends a visitor one of our names so that somebody with no wallet and no Sepolia ether can still write real records. The natural arrangement is delegation — we keep the names and their roles, and grant a throwaway account the right to call `setText` on each. That is precisely what per-record setter roles are for, and it cannot work here.

A visitor's secret occupies three records. Two have fixed keys. The third is `nextkey.g2.<tag>`, and the tag is computed in the visitor's browser from a keypair that did not exist when we prepared the names. There is no role to grant, because there is no key to name. Confirmed rather than inferred: an account granted `setText(nextkey.secret)` and then asked to write `nextkey.probe` on the same name is refused with `EACUnauthorizedAccountRoles` (`0x4b27a133`).

What we did instead was deploy a second Permissioned Resolver with root roles for that account, and point only the lent names at it. Root authority descends to every name the resolver serves, so the account may write any key there — and nothing anywhere else, because our other names use other resolvers. The blast radius follows from which resolver a name uses rather than from an enumeration of grants.

It is a coarser boundary than we wanted, and the gap is real: the fine primitive covers keys known in advance, and the escape hatch is all keys on all names of one resolver, with nothing in between. Written up as [finding 11](./FEEDBACK-ENS.md) with a suggestion.

**The key that signs those writes is published in the page.** It owns nothing, holds a few cents of testnet ether, and its only power is writing records on names set aside for exactly that. Disclosed rather than hidden, because a demo of a security product that relies on nobody looking is not a demo of anything.

**Verified end to end** on the hackathon deployment, twice over. The resolution path — `nextkey.eth` → our UserRegistry → `visa.nextkey.eth` → its Permissioned Resolver → a text record read back through the **Universal Resolver**, the path any client takes (`scripts/resolver.mjs`). And the product path on top of it (`scripts/nextkey.mjs`): a seed phrase encrypted into `nextkey.secret`, shared with `anna.nextkey.eth`, and opened by Anna with her own key.

| Step | Transaction |
|---|---|
| Anna publishes `nextkey.pubkey` | [`0xd0deb560…20e932`](https://sepolia.etherscan.io/tx/0xd0deb560cbf55ae7df767c8a536ff76864c8bfe61b61436475836d781020e932) |
| Ciphertext into `nextkey.secret` | [`0x88b82fd9…132987`](https://sepolia.etherscan.io/tx/0x88b82fd9c83631a98613d968fb727fe6c860e8fc60c52edb10b7a73c99132987) |
| Grant to the owner | [`0xba8e6925…508ff0`](https://sepolia.etherscan.io/tx/0xba8e69252eb92c650cddaa7ee166ac96f2f92ff108fa7ce30d3d755a3b508ff0) |
| Grant to Anna | [`0x6a051d14…d91290`](https://sepolia.etherscan.io/tx/0x6a051d14f8425b87398a4d093c6068b8bccf9cdff7fbbc5329f38eff06d91290) |

Terminal output in [`evidence/encryption-loop.log`](./evidence/encryption-loop.log).

**And again under v2**, on `vault.nextkey.eth`. Note the fourth row: the record name is not derived from anything public, and the value names nobody.

| Step | Transaction |
|---|---|
| `nextkey.eph` — the name's ephemeral key, written once | [`0x9d1057f9…a58859`](https://sepolia.etherscan.io/tx/0x9d1057f9c77c8c77d12c96c42ce5ab05a52be51466502aa32dfb811cb3a58859) |
| `nextkey.eph.sealed` — that key, wrapped to the owner | [`0xcbec899a…bf573c`](https://sepolia.etherscan.io/tx/0xcbec899aac3421eaaa0e58926730624cca2406f0876483766faf2f38c8bf573c) |
| Ciphertext into `nextkey.secret` | [`0xce9d8ea4…f1f8e5`](https://sepolia.etherscan.io/tx/0xce9d8ea43da7cb220e33832c832068685a15cdcaca0958d5a39b245d70f1f8e5) |
| Grant to the owner, at `nextkey.g2.4315cf86db9a2391…` | [`0x622a6361…c15231`](https://sepolia.etherscan.io/tx/0x622a636105e46f2cbefd732257a69b95d287c0964fbd4872a1e81b8774c15231) |
| Grant to `anna.nextkey.eth`, at `nextkey.g2.eb1914a579630175…` | [`0x7c685dab…6c0ff5`](https://sepolia.etherscan.io/tx/0x7c685dab0c612065d95c43ae7a6c96edaf22c3c9e2010b1f220947de136c0ff5) |
| Revoke Anna's grant | [`0x8f655d6b…d7fddf`](https://sepolia.etherscan.io/tx/0x8f655d6bd3b74e50c2ec696ab503f1843c54aba78465e336c68380ec1bd7fddf) |

Afterwards `open vault anna` is refused and `open vault alice` still works — one identity lost access and the other did not, which is the whole claim and needs both halves. `eph vault alice` reports *both routes were available and agree*: the sealed record and the signature derivation, independent of one another, produced the same 32 bytes on a real name.

**The same loop from a phone**, written by the page itself with no wallet, no extension and no ether, on `hero06.nextkey.eth` — three records and then a revocation, one minute apart.

**And outside our own registry**, on `nextkeyv2.eth`: a second-level `.eth` name registered against the hackathon registrar, with a Permissioned Resolver of its own attached through the `.eth` registry. There the authority to write comes from owning the name rather than from a role we granted ourselves. A browser wrote the three records to it with the owner's wallet; the command line then opened them as `anna.nextkey.eth`, whose key it read from her own name. Two implementations, two registries, no shared state.

That run also settles the assumption the recovery fallback rests on. `nextkeyv2.eth` carries no `nextkey.eph.sealed`, so its ephemeral key could only be recovered by derivation — and the signature viem produced matched the `nextkey.eph` that **MetaMask's** signature had published minutes earlier. Same key, two entirely separate signer implementations, the same 32 bytes, checked against what the chain already held.

All three runs, with the transaction data and a section on what they do *not* show, are in [`evidence/v2-onchain.log`](./evidence/v2-onchain.log).

**The owner is a recipient like any other.** There is no master key and no owner-only branch in the code — keeping one would make "we cannot read your secrets" a lie. The honest cost: lose your local key file and the secret is gone. We would rather state that than hold a key we promise not to use — and a recipient who would rather not carry that risk can put their key on a Ledger instead, which is the section further down.

**Where each row lives in the code.** Named by function rather than by line number: the crypto moved into a shared module when `release.mjs` needed the same key wrapping, and a pinned line would have gone on describing a layout that no longer exists.

| Row above | Code |
|---|---|
| Share a secret with a name | [`nextkey-core.mjs` · `shareSecret`](https://github.com/4bridges/nextkey/blob/main/scripts/nextkey-core.mjs) — reads the recipient's key from *their* record, then `grantFor` wraps the content key to it |
| How a grant is addressed | [`nextkey-core.mjs` · `grantKeyV2` and `tagFor`](https://github.com/4bridges/nextkey/blob/main/scripts/nextkey-core.mjs) — HKDF over the ECDH result, sixteen bytes, under `nextkey/v2/tag`. `grantKey` beside it is the v1 scheme, kept so v1 names still open |
| Key wrapping | [`nextkey-core.mjs` · `wrapKeyV2`](https://github.com/4bridges/nextkey/blob/main/scripts/nextkey-core.mjs) — same ECDH, same salt, different info string, so publishing the address says nothing about the key |
| Finding your own grant | [`nextkey-core.mjs` · `openOwnGrantV2`](https://github.com/4bridges/nextkey/blob/main/scripts/nextkey-core.mjs) — one `sharedWith` call yields both the address and the unwrapping key, which is why a Ledger approves once |
| Recovering a name's ephemeral key | [`nextkey-core.mjs` · `ephSecretFor`](https://github.com/4bridges/nextkey/blob/main/scripts/nextkey-core.mjs) — two independent routes, compared against each other and against the published record |
| Is deterministic signing real? | [`probe-signing.mjs`](https://github.com/4bridges/nextkey/blob/main/scripts/probe-signing.mjs) — measured on the wallet in hand, because the fallback rests on it |
| The same construction in a browser | [`web/src/nk-crypto.mjs`](https://github.com/4bridges/nextkey/blob/main/web/src/nk-crypto.mjs) — checked byte for byte against the Node one by [`web/test/interop.mjs`](https://github.com/4bridges/nextkey/blob/main/web/test/interop.mjs), including the signed message |
| Lending a name to a stranger | [`demo-wallet.mjs` · `resolver` and `prepare`](https://github.com/4bridges/nextkey/blob/main/scripts/demo-wallet.mjs) — and the comment explaining why delegation could not do it |
| Limit access to seven days | [`register-subname.mjs` · `register`](https://github.com/4bridges/nextkey/blob/main/scripts/register-subname.mjs) — the subname's `expiry`; demonstrated by [`demo-expiry.mjs`](https://github.com/4bridges/nextkey/blob/main/scripts/demo-expiry.mjs) |
| The owner's roles on a subname | [`register-subname.mjs` · `OWNER_ROLES`](https://github.com/4bridges/nextkey/blob/main/scripts/register-subname.mjs) — deliberately without `ROLE_REGISTRAR`: a secret is a leaf |
| Revoke access | [`nextkey.mjs` · `revoke`](https://github.com/4bridges/nextkey/blob/main/scripts/nextkey.mjs) — recomputes the recipient's address from their published key, clears it, and says plainly what revocation cannot undo |
| Which scheme is a name on? | [`nextkey.mjs` · `eph`](https://github.com/4bridges/nextkey/blob/main/scripts/nextkey.mjs) — both questions the explorer cannot answer: v1 or v2, and is the ephemeral key still recoverable |
| Delegate one setter to the agent | [`resolver.mjs` · `grant-setter`](https://github.com/4bridges/nextkey/blob/main/scripts/resolver.mjs) — and why the first argument is calldata, not a name |
| Read the resulting roles | [`resolver.mjs` · `show-roles`](https://github.com/4bridges/nextkey/blob/main/scripts/resolver.mjs) — resource id recovered from the contract's own refusal |
| Give the agent an identity | [`agent.mjs` · `propose` and `prove-boundary`](https://github.com/4bridges/nextkey/blob/main/scripts/agent.mjs) |
| Act on a verdict | [`release.mjs`](https://github.com/4bridges/nextkey/blob/main/scripts/release.mjs) — checks the verdict against the live request before writing anything |
| A key that never leaves a device | [`ledger.mjs`](https://github.com/4bridges/nextkey/blob/main/scripts/ledger.mjs) — EIP-1024 key agreement performed on the Ledger |
| Resolve through the Universal Resolver | [`resolver.mjs` · `read-text`](https://github.com/4bridges/nextkey/blob/main/scripts/resolver.mjs) — the path a real client takes |

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
| Permissioned Resolver (serves the subnames) | [`0x52A02f288AA5dde082206D85d4001880D64F4101`](https://sepolia.etherscan.io/address/0x52A02f288AA5dde082206D85d4001880D64F4101) |
| Permissioned Resolver for the lent names only | [`0x04B2DB6567Cc68d059c061215Adf9a99adD1cA65`](https://sepolia.etherscan.io/address/0x04B2DB6567Cc68d059c061215Adf9a99adD1cA65) |
| Release agent | `0xABCf3893FBe9802343f9b444575250Aa979Fb59c` |
| The key the playground publishes | `0x45f0b8e270245e356A1760456ea84eDB8712C62b` — root roles on the resolver above, and on nothing else |
| `nextkeyv2.eth` — v2 outside our registry | resolver [`0x8CC85C123aBC579378A51153aCE7001E00756771`](https://sepolia.etherscan.io/address/0x8CC85C123aBC579378A51153aCE7001E00756771), attached through the `.eth` registry |

The registry proxy address is deterministic: its salt is `keccak256(keccak256("UserRegistry"), namehash("nextkey.eth"), version)` with version `0`. Redeploying requires bumping the version, or the CREATE2 address collides.

`nextkey.eth` was registered directly against the `ETHRegistrar` rather than through the manager app — see [`FEEDBACK-ENS.md`](./FEEDBACK-ENS.md) for why, and `scripts/register-name.mjs` for how.

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

> **Designed, not built.** Sandbox access was requested at the start of the event and has not arrived. This section describes the intended role so the recovery story is legible; no code implements it, and no claim in this repository depends on it.

Selfie Check is used as a **risk and eligibility signal**, not as a login.

The hardest question for a product like this one is how somebody gets back in after losing everything, without opening the same door to an attacker. Plain social recovery fails here: an attacker who can pressure, impersonate or replay their way past the guardian step is through. NextKey requires both — the guardians confirm the request, *and* Selfie Check establishes that a unique, live human is the one asking. The selfie never leaves the device; the app receives only an anonymous proof.

<!-- TODO: link to the recovery flow implementation and add the Sandbox test evidence -->

---

### The release agent, and what stops it

Automation is useful right up to the moment it can act alone. NextKey's release agent is a **namespace, not a service account**: `agent.nextkey.eth` is a name in our registry, the agent signs with its own key, and that key holds one role on one resource.

The permission is finer than "may write to this name". ENSv2 scopes a setter role to a *setter, a key and a name* together, which we measured rather than assumed:

| Account | Name · record | Roles on the name | Roles at the root | May write |
|---|---|---|---|---|
| Agent | `agent.nextkey.eth` · `nextkey.request` | `0x10` — bit 4, no admin half | `0x0` | **yes** |
| Agent | `agent.nextkey.eth` · `nextkey.notify` | `0x0` | `0x0` | no |
| Agent | `visa.nextkey.eth` · `nextkey.secret` | `0x0` | `0x0` | no |
| Owner | any of the above | `0x0` | `0x1111…1111` | yes, everywhere |

Three things follow, and none of them depend on our code behaving well. The agent can write exactly one field, on the one name that is its own — a different key on that same name is a different resource where it holds nothing. It cannot delegate, because its bitmap has no admin half. And the owner's authority descends from the root rather than sitting on any single name, which is what makes ownership and delegation different in kind rather than in degree.

The boundary is filed on chain as a **rejected transaction**: [`0x6f0e35fd…790e68`](https://sepolia.etherscan.io/tx/0x6f0e35fd5ae0d00cd5d5867bfbe60a78356ca83b3d5644afa2ede46234790e68). The agent, signing with its own key, asked the resolver to overwrite `nextkey.secret` on `visa.nextkey.eth`, and the resolver refused. Same contract as the proposal it is allowed to write; only the name differs. Status `reverted` is the result we wanted.

A proposal itself is public — [`0x14796928…ea485c`](https://sepolia.etherscan.io/tx/0x14796928813fd4b495c6a3442c0207d719ab98e4154fb205d1ee7601d7ea485c) — so anyone watching the name sees that a release was requested, for which secret and for whom. What stays confidential is the deliberation, and that happens next.

Full output in [`evidence/agent-boundary.log`](./evidence/agent-boundary.log); the code is `scripts/agent.mjs` and `scripts/resolver.mjs`.

---

## Chainlink CRE in NextKey

Automation is useful right up to the moment it can act alone. NextKey draws that line twice.

The release agent has its own ENS namespace carrying exactly one role: *propose* a release. It cannot read a secret and it cannot release one — that boundary is enforced cryptographically by Enhanced Access Control, not by our code being polite about it.

The second boundary is the enclave. A proposal is evaluated inside a **Chainlink CRE Confidential Workflow**: the key material and the set of guardian approvals go in via `cre.handlerInTee(...)`, the release condition is evaluated there, and only a `RELEASE` or `DENY` verdict crosses back to the DON through `runtime.usingTheDons()`. The value nobody may see is precisely the one that never comes out.

This is deliberately load-bearing rather than decorative: remove the workflow and the release condition degrades from something enforced to something promised.

**A note on what confidentiality means here.** CRE protects data *during execution*, not source code — the workflow's code stays public, as it should for an open-source project. The claim NextKey makes is narrow and true: a secret never passes a node an operator can inspect. It does not claim its release logic is hidden.

**Secrets in this build** are resolved from the local environment rather than from the Vault DON, which keeps the demo reproducible for anyone with the CRE CLI and no beta grant. Chainlink Labs confirmed during the hackathon that `cre workflow simulate` runs confidential workflows without beta access; the grant is only needed to deploy to the confidential workflow DON and to store secrets on the Vault DON.

### Making a confidential verdict checkable

An enclave's inputs are invisible by design, and that creates a gap: *the enclave approved this* cannot be checked by anyone who cannot see what it was given. So the verdict carries the hash of the public request:

```
[USER LOG] Decision for 0x5ab6aad279b3700b: RELEASE (quorum_and_delay_satisfied)
[USER LOG] Bound to on-chain request 0xb74ac56696e0e84612546123e2ec0a495a5b071be625b10141f2af4f59ce5336

"RELEASE — quorum_and_delay_satisfied (request 0x5ab6aad279b3700b,
 bound to 0xb74ac566…, secret in enclave: true)"
```

That hash is of the record the agent wrote at `agent.nextkey.eth · nextkey.request` in [`0x14796928…ea485c`](https://sepolia.etherscan.io/tx/0x14796928813fd4b495c6a3442c0207d719ab98e4154fb205d1ee7601d7ea485c). Read the record, hash it, compare — `bun test` does exactly that against the live fixture. The enclave hashes the stored bytes before parsing them, because re-serialising a parsed object reorders keys and would produce a hash matching nothing on chain.

What crosses back out: request id, verdict, coarse reason, and a hash of something already public. What does not: the guardians, the approval count, the policy, and the credential. `quorum_not_met` reports that a threshold was missed without reporting by how much, because the distance to a threshold is itself useful to an attacker.

### Acting on the verdict

A decision nobody acts on is a decision in name only, so `scripts/release.mjs` closes the loop: it reads the verdict, hashes the request that is on chain **at that moment**, and writes the grant only if the two agree and the verdict says RELEASE.

The run worth reading is the one that fails. Filing a fresh proposal replaces the record, and the previous verdict is then refused:

```
✓ verdict is RELEASE                     RELEASE — quorum_and_delay_satisfied
✗ verdict is bound to the live request   on chain 0x7b2a1ed6…3b8ce0f3
                                         verdict  0xb74ac566…4f59ce5336
✗ request ids agree                      0x57663ef80875b452

REFUSED: verdict is bound to the live request; request ids agree
```

An approval given for one request cannot be spent on another, and the check is arithmetic rather than trust. With the workflow re-run against the current request, the same command releases: [`0xac483f31…e36fd0`](https://sepolia.etherscan.io/tx/0xac483f31175ebe6d376cd10ab0ff613612a43bed21326617e7ad1a901ae36fd0). Anna, whose access had been revoked, can open the secret again — and nobody typed `share`.

**What is not enforced.** Nothing stops the owner from ignoring all of this and calling `nextkey.mjs share` directly; they hold the key and the ENS role, which is the design. In production the DON's signed report would be delivered on chain and a contract would gate the write, making the check the chain's rather than a laptop's. That step is not built, and the difference is real.

The guardian approvals in `fixtures/release-request.json` are fabricated stand-ins — guardians are not built yet, and the fixture says so in its first field. The request they surround is real and on chain.

Source: [`nextkey-cre/my-workflow/workflow.ts`](./nextkey-cre/my-workflow/workflow.ts) and [`scripts/release.mjs`](./scripts/release.mjs) · rule tests in `workflow.test.ts` · evidence in [`evidence/cre-simulation.log`](./evidence/cre-simulation.log), [`evidence/cre-decision.log`](./evidence/cre-decision.log) and [`evidence/release-loop.log`](./evidence/release-loop.log).

---

## Ledger in NextKey

**A recipient decides how well their own key is protected, and nobody else has to know.**

NextKey addresses a recipient by the X25519 public key they publish in their own ENS record. Where the matching private half lives was never part of that interface — so a Ledger can simply be a NextKey identity:

```
node scripts/nextkey.mjs keygen bob --ledger --account 3
```

`.keys/bob.json` then holds a public key and a derivation path and **no private key**, because there is none to hold. Losing that file costs nothing; copying it gains an attacker nothing. The device uses **EIP-1024** — `getEIP1024PublicEncryptionKey` for the published key, `getEIP1024SharedSecret` to perform the ECDH on the device itself.

**The sender's side did not change at all.** Sharing with Bob is the same command, the same arguments and the same code path as sharing with Anna, whose key is a file:

| Step | Transaction |
|---|---|
| Alice shares with `bob.nextkey.eth` | [`0xea187e10…57e50a`](https://sepolia.etherscan.io/tx/0xea187e10a5cd287601bdf79f22a4b0543e5e625b45c3cea2f181369fac57e50a) |

In the codebase this cost one line. `openGrant` used to compute the shared secret from a stored private key; it now asks the identity for it — `await identity.sharedWith(ephPk)` — and a software identity answers locally while a hardware one asks the device. Nothing else branches.

**Opening costs a button press, every time.** The device refuses key agreement without a confirmation, so a secret shared with a Ledger holder cannot be opened by malware on their laptop while they are away from it — only by them, deliberately, with the device in hand. That is the *approval boundary* this project is built around, expressed in hardware rather than in prose.

It also fixes a weakness this README states plainly elsewhere: for a software identity, losing the key file loses the secret. For a device identity, the device is the backup — and it is the kind people already own and already know how to keep.

Full run in [`evidence/ledger-identity.log`](./evidence/ledger-identity.log); code in [`scripts/ledger.mjs`](./scripts/ledger.mjs). Four tooling findings, with reproductions, in [`FEEDBACK-LEDGER.md`](./FEEDBACK-LEDGER.md).

---

## Run it locally

Two paths. The first needs nothing but Node and shows the live state of everything
described above; the second writes to the chain and needs a funded Sepolia key.

### Read-only — no key, no wallet

```bash
git clone https://github.com/4bridges/nextkey.git
cd nextkey
npm install                       # viem, @noble/curves, @noble/hashes

node scripts/agent.mjs   show                              # the agent's open release request
node scripts/resolver.mjs read-text visa nextkey.secret   # the ciphertext, read through the Universal Resolver
node scripts/resolver.mjs show-roles agent 0xABCf3893FBe9802343f9b444575250Aa979Fb59c
node scripts/spike-read-ens.mjs                           # plumbing check — see below
```

The first three return live data. `spike-read-ens.mjs` is different: it verifies that the
Universal Resolver override took effect and that resolution completes without throwing,
and it does that against `nextkey.eth`, the parent, which deliberately carries no records.
Empty values there are the expected result, not a failure — the check is that the calls
return rather than what they return. Forgetting the override is a *silent* failure, since
viem's built-in address quietly resolves against production ENS, which is why this check
exists at all.

The same state in a browser, which is what the demo link opens:

```bash
npx serve web -l 8080     # then http://localhost:8080/demo.html
                          #  and http://localhost:8080/try.html
```

Open `web/` over `http://`, not by double-clicking the file — ES modules are blocked
on `file://` and the failure looks like a bug in the page.

### The decision rule and the confidential workflow

```bash
cd nextkey-cre
bun install
bun test                          # 12 tests: the release rule, and the on-chain binding
cre workflow simulate my-workflow # needs the CRE CLI; no beta access required
```

`cre workflow simulate` fetches `fixtures/release-request.json` over its raw GitHub URL
from inside the enclave, so the simulation reflects whatever is committed on `main`.

### Writing to the chain

Everything below spends Sepolia gas and MockUSDC. **Use a wallet that holds testnet
assets only.** Scripts run in print-only mode without a key — they show the exact call
to make rather than making it — so you can inspect each step before arming it.

```bash
cp .env.example .env    # then fill in the values below
```

| Variable | Needed for | Notes |
|---|---|---|
| `REGISTRAR_PRIVATE_KEY` | every write | Owner key, `0x`-prefixed, 66 characters. Testnet only |
| `SEPOLIA_RPC_URL` | optional | Defaults to `ethereum-sepolia-rpc.publicnode.com`, which permits wider `getLogs` ranges than most public endpoints |
| `NEXTKEY_REGISTRY` | optional | Defaults to our deployed registry; set it to use your own |
| `REGISTRAR_OWNER` | optional | Address the scripts register names to |

Never put a seed phrase in `.env` or a terminal — only a single account's private key.
`.env`, `.keys/` and `.registration-*.json` are gitignored; `git check-ignore -v .env`
confirms it before you commit.

The full path, from an empty account to a shared secret:

```bash
node --env-file=.env scripts/register-name.mjs    check nextkey        # price, then commit-reveal
node --env-file=.env scripts/deploy-registry.mjs  deploy               # your own UserRegistry
node --env-file=.env scripts/register-subname.mjs register visa
node --env-file=.env scripts/resolver.mjs         deploy               # a Permissioned Resolver
node --env-file=.env scripts/resolver.mjs         attach   visa 0xResolver

node scripts/nextkey.mjs keygen alice
node scripts/nextkey.mjs keygen anna
node --env-file=.env scripts/nextkey.mjs publish anna.nextkey.eth anna
node --env-file=.env scripts/nextkey.mjs store   visa alice "correct horse battery staple"
node --env-file=.env scripts/nextkey.mjs share   visa alice anna.nextkey.eth
node scripts/nextkey.mjs open visa anna     # and open visa alice — same path, no master key
```

Requires Node 22 or newer for `--env-file`, and [Bun](https://bun.sh) plus the
[CRE CLI](https://docs.chain.link/cre) for the workflow. The ENSv2 hackathon deployment
resets periodically; if a name has vanished, re-register it.

---

## Demo

- **Try it yourself:** https://nextkey.li/try.html — the full loop in the browser, no wallet needed
- Live view (this deployment's real records, read from Sepolia): https://nextkey.li/demo.html
- About: https://nextkey.li
- Demo video: <!-- TODO -->

The playground runs the same X25519 + HKDF-SHA256 + AES-256-GCM construction the command-line tool
uses, not a stand-in for it. `node web/test/interop.mjs` proves it: it generates a grant with the Node
code, opens it in a headless browser with the browser code, does it the other way round, checks both
halves refuse a stranger's key, and compares the message the two sides sign character for character —
that message is an input to a key derivation, so one stray line break there would derive a different
key and write grants at an address the other side never reads.

`node web/test/playground.mjs` drives the page itself in a real browser, in two languages, which is
the only test that can notice a renamed element or a handler that throws. What it cannot reach is the
writing, opening and revoking, because those need a chain — those are evidenced by an actual run
instead, in [`evidence/v2-onchain.log`](./evidence/v2-onchain.log).

It will not accept a real seed phrase into the on-chain step. There is a generator for a throwaway
BIP-39 phrase, a warning that stays on screen when twelve words appear that the page did not generate,
and a confirmation the visitor has to give before anything is written to a public chain. A box on a
web page asking for a recovery phrase is the theft NextKey exists to answer; building one to
demonstrate the answer would have been an odd choice.

---

## Evidence

Sponsor qualification evidence is collected in [`evidence/`](./evidence) as it is produced, not assembled at the end:

| File | What it evidences |
|---|---|
| [`cre-simulation.log`](./evidence/cre-simulation.log) | A Confidential Workflow running to completion, with the secret reaching the enclave |
| [`encryption-loop.log`](./evidence/encryption-loop.log) | `store` → `share` → `open`, against the hackathon deployment, with transaction hashes |
| [`agent-boundary.log`](./evidence/agent-boundary.log) | The agent's role state read from the resolver, and its forbidden write being refused |
| [`cre-decision.log`](./evidence/cre-decision.log) | The verdict, bound by hash to the request on chain, and how to check it yourself |
| [`revocation.log`](./evidence/revocation.log) | Access withdrawn and the recipient locked out, with what revocation cannot undo |
| [`expiry.log`](./evidence/expiry.log) | A name expiring in real time, read through the Universal Resolver until it stops answering |
| [`release-loop.log`](./evidence/release-loop.log) | Proposal → decision → act, including the run where a stale verdict is refused |
| [`ledger-identity.log`](./evidence/ledger-identity.log) | A recipient whose private key never leaves a Nano X, shared to with the ordinary command |

Transaction hashes for the registry deployment, subname registration, role grants and
the rejected write are in the tables above and in the logs.

Still to come: the Selfie Check flow, once World ID Sandbox access is granted. If it is
not granted before the deadline, that slot is dropped rather than half-built, and this
line will say so.

---

## Prize tracks

This project is submitted to three partner prizes:

| Sponsor | Track |
|---|---|
| ENS | Best Use of ENSv2 |
| Chainlink | Best Confidential Workflow |
| Ledger | AI Agents × Ledger |

**On World.** Selfie Check is designed into the recovery flow and described below, but it is **not built**: Sandbox access was requested at the start of the event and has not arrived, and other teams report the same wait. ETHGlobal allows three partner prizes, so Ledger takes the third slot. If access arrives before submission we will choose the three strongest then — but nothing in this repository claims a World integration that exists.

---

## Documentation

- [`docs/planning/`](./docs/planning) — planning artifacts written before the kickoff, dated
- [`docs/architecture.md`](./docs/architecture.md) — where everything lives, what the boundaries are, and what an observer can and cannot determine
- [`ai/PROMPT_LOG.md`](./ai/PROMPT_LOG.md) — prompts that shaped documents, decisions and code
- [`docs/decisions.md`](./docs/decisions.md) — dated decision log kept during the build
- [`AI_USAGE.md`](./AI_USAGE.md) — AI tool usage disclosure
- [`FEEDBACK-WORLD.md`](./FEEDBACK-WORLD.md) — developer experience feedback for World
- [`FEEDBACK-ENS.md`](./FEEDBACK-ENS.md) — developer experience feedback for ENS
- [`FEEDBACK-LEDGER.md`](./FEEDBACK-LEDGER.md) — developer experience feedback for Ledger
- [`evidence/`](./evidence) — sponsor qualification evidence

---

## Team

Built solo by [@4bridges](https://github.com/4bridges) (Web3Degens, Switzerland) at ETHGlobal ETHOnline 2026.

An earlier project of ours, [pKeep](https://ethglobal.com/showcase/pkeep-unleash-decentralized-safety-0exsj) (ETHIndia 2023), tackled decentralized secret storage and ran aground on exactly one problem: restricting who could access what. NextKey is a fresh start — no code, designs or assets carried over — built because ENSv2 finally makes that problem solvable at the protocol layer.

## License

MIT — see [LICENSE](./LICENSE).
