# Developer Experience Feedback — ENSv2 hackathon deployment

Collected while building **NextKey** at ETHGlobal ETHOnline 2026, against the dedicated ENSv2 deployment on Sepolia.

Written as we hit each issue rather than reconstructed at the end. Solo developer, TypeScript, viem.

ENS does not ask for a feedback document, so this exists for two other reasons: the findings below would have cost another team the same hours they cost us, and a few of them are documentation bugs that are cheap to fix.

---

## 1. Registration through the manager app is unusable — HCA quoting

**What happened.** Every attempt to register `nextkey.eth` in the manager app failed at the quote step:

```
HCA budget could not be quoted (source: fallback). Refusing to size the funding
permit from the fallback model. Reasons: commit: quote threw — No available
destination-chain balance can cover execution gas. An unsponsored intent must
leave a spendable destination-chain token balance for the gas refund.;
register: quote threw — same; no quote market data (flat per-leg fee used)
```

**What we ruled out, in this order.** An empty wallet — it held 0.05 SepoliaETH. The wrong stablecoin — we then also held 1,000 Circle Sepolia USDC. The wrong *mock* token — we verified on-chain that the wallet held 1,000 MockUSDC (`0xcbfd80f7…`) and 1,000 MockDAI, the deployment's own tokens. The error text never changed.

**What the message hides.** `source: fallback` and `no quote market data` say the pricing service is degraded; "no available destination-chain balance" reads like a wallet problem and sent us chasing faucets for well over an hour. Two suggestions: surface the quoter's own state to the user rather than only its conclusion, and say *which chain* "destination-chain" refers to. If it is the ENSv2 L2, no hackathon team has a way to fund an address there, and that should be stated rather than inferred.

**How we got past it.** We registered directly against `ETHRegistrar` (`0x7d1b7f58…`) with viem — `getRegisterPrice`, `approve` on MockUSDC, `commit`, wait 60s, `register`. That worked first try, and the price oracle answered normally, which confirms the failure was confined to the HCA layer.

---

## 2. `USER_REGISTRY_IMPL` is not in the deployments table

The contract-developer tutorial says to deploy a registry proxy from `USER_REGISTRY_IMPL`. The Sepolia deployments table lists 32 contracts including `PermissionedResolverImpl` and `WrapperRegistryImpl`, but nothing under that name and nothing obviously equivalent.

We recovered it by reading the `ProxyDeployed` events off `VerifiableFactory` and finding the one implementation being proxied that was *not* the resolver: `0x47B442d0CF617c41CAbAFf5f02f44DD1e5f72546`.

That works, but it means a developer following the tutorial cannot complete step 1 from the documentation alone. Adding the row to the table would fix it.

---

## 3. The documented registry initializer is out of date

This one cost the most, because of how it fails.

The tutorial gives the initializer as:

```solidity
initialize(address rootAccount, uint256 roleBitmap)   // selector 0xcd6dc687
```

The deployed implementation expects:

```solidity
initialize((address,uint256)[] assignments)           // selector 0x37cb53a8
```

— an array of account/roleBitmap pairs.

Calling the documented signature reverts **with empty return data**. A proxy delegatecalling into a function that does not exist has no reason string to give, so Etherscan shows `Execution reverted 0x` and nothing else. There is no way to tell from the error that the initializer is the problem.

We found it by decoding a deployment that had worked (`0x711176df…`) and comparing selectors.

Worth noting: the real signature is the better one. Granting several accounts different roles at deployment time is exactly the model we are building on, and the docs undersell it.

---

## 4. The registry and resolver interfaces differ from the documentation

Three more signature mismatches, each found the same way — a call reverting with empty data — and each costing its own debugging session.

| Documented | Actually deployed |
|---|---|
| `getResolver(bytes32 label)` | `getResolver(string label)` |
| `getSubregistry(bytes32 label)` | `getSubregistry(string label)` |
| `setText(bytes32 node, …)` | `setText(bytes name, string key, string value)` — DNS-encoded name |

Two undocumented functions deserve a mention in the docs. **`findTokenId(string)`** answers a question the documentation raises and then leaves open: the Mutable Token IDs page explains that ids change when roles change, but not how to obtain the current one. The obvious guess — derive it from the labelhash — gives a value that is correct until the first `grantRoles` and wrong afterwards, a bug that surfaces far from its cause. There is a function for exactly this, and also `findOwner(string)` and `findExpiry(string)`.

**A suggestion beyond the docs:** verifying the deployed contracts on Sepolia Etherscan would remove most of this friction. At the moment *Write as Proxy* resolves the EIP-1967 implementation and then reports *"unable to locate a matching Contract ABI or SourceCode"*, so a team without its own tooling cannot make a single call after deploying a registry. We ended up extracting selector constants from the bytecode and resolving them against a public signature database. It worked, but building an ABI recovery tool is a strange way to spend hackathon hours.

## 5. What "permissioned" means, and what we assumed it meant

We spent a while designing around the idea that the Permissioned Resolver could grant someone the right to *read* one record. It cannot — the primitive is `grantSetterRoles(bytes name, address)`, and it governs writes.

That is correct behaviour; a public chain cannot withhold data from readers, and our design is better for the correction. But the name "Permissioned Resolver", together with documentation describing "fine-grained per-record permissions" without saying *permission to do what*, invites the assumption. One sentence early on that page — these are write permissions — would have saved us half a day, and we doubt we are the only team who read it that way.

## 6. Smaller things

**Log query ranges.** The RPC endpoint viem picks by default for Sepolia refuses `getLogs` ranges of 9,000 blocks with `Request exceeds defined limit`, and a naive scanner reports "no events found" when in truth every request was refused. Not an ENS issue, but anyone reading factory events will hit it. `https://ethereum-sepolia-rpc.publicnode.com` is more permissive.

**The reset notice.** The banner warns that registered names and state may be reset periodically, most recently 2026-07-30. That is useful and we planned around it — worth keeping prominent in the docs too, not only in the app.

## 7. `grantSetterRoles(bytes name, address)` does not take a name

The parameter is called `name`, its type is `bytes`, and every other setter on
this resolver takes the DNS-encoded name as exactly that. So we passed the
DNS-encoded name. It reverts with:

```
UnsupportedResolverProfile(0x05616765)
```

Those four bytes are the first four bytes of the DNS-encoded name — `\x05age`,
the length byte and half of "agent" — read as a function selector. The
parameter is not a name at all. It is **the calldata of the setter being
authorized**: the resolver runs `decodeSetter` on it, takes the profile from
the selector and the name from the arguments, and grants the role for that
pairing. The working call is

```ts
grantSetterRoles(
  encodeFunctionData({ abi, functionName: 'setText', args: [dnsName, key, ''] }),
  account,
)
```

Renaming the parameter to `setterCall` would prevent this entirely, and it
costs nothing.

We lost an evening here, and the reason is worth stating plainly: the revert
was not wrong, it was *unrecognisable*. `UnsupportedResolverProfile` is a
truthful description of what happened, but it describes a layer we did not
know we were in. We read it as a permission failure and went looking at role
bitmaps, because that is what the function name suggested.

**What we did not expect, and what makes the correction worthwhile:** the
permission is finer than the documentation implies. It is not "may write to
this name" but "may call this setter, with this key, on this name". We
verified this rather than assuming it — an account granted
`setText(nextkey.request)` on a name resolves to resource
`0x4fc08dd2…c9bc0d`, while `setText(nextkey.notify)` on the *same* name is
resource `0x85d07a57…33cfee`, where it holds nothing. Per-record, not
per-name. That is a genuinely strong primitive and it deserves a worked
example in the docs, because nobody will find it from the signature.

---

## 8. Role state is readable only through the error path

Having granted the role, we wanted to verify it — a claim like "this agent
holds exactly one permission" should be checkable.

The resolver exposes `roles(uint256 resource, address)`, so the bitmap is
readable *if you know the resource id*. Obtaining it is the problem. It is not
the namehash. `getRecordId(bytes32 node)` exists and looked like the answer,
but `getRecordId(namehash(name))` returns `0`, and a `roles()` query against
resource `0` reports no roles for an account that demonstrably has them — a
wrong answer rather than an error, which is the dangerous kind.

The only reliable source we found for the resource id is the authorization
error itself, which carries `(resource, requiredRoleBitmap, account)`. So our
tooling now provokes a refusal on purpose — a simulated `setText` from the
zero address — and reads the resource out of the revert. It works and it is
gas-free, but a contract whose error path is a more dependable interface than
its getters is a documentation gap worth closing: either document the
derivation, or have `getRecordId` return what `roles` expects.

One consequence is worth flagging on its own. Per-resource roles are only half
of the picture: the owner of a name shows `0x0` on that name's resource and can
nevertheless write, because authority also descends from `ROOT_RESOURCE`. Any
tool that reports only the per-resource bitmap — ours did, for an hour — will
tell a user they have no permissions while they are in fact fully privileged.
`hasRootRoles` and `ROOT_RESOURCE` are in the bytecode but not in the tutorial.

---

---

---

## 9. `publicResolverV2` refuses the owner of a name on this deployment

Registering `nextkeydemo.eth` directly against the registrar worked. Attaching
the deployment's own `publicResolverV2` (`0xf9de4979…33f6`) worked. Writing a
text record to it did not, and there was nothing in the failure to say why.

```
name owner  0x9780aFE81EF5b58333c83e05d5C07797BD81dd0B   ← us
may write   false
setText(bytes32 node, string, string)   reverted, revert data: empty
```

`canModifyName(namehash, owner)` returns `false` for the address the `.eth`
registry names as the owner. `setText` then reverts with no data at all, which
is indistinguishable from calling a function that does not exist — and its
selector `0x10f13a8c` **is** in the bytecode, so that is not the explanation.

`ensV2Resolver` (`0xb1b2d8c4…fae4`) behaves the same way, except that
`canModifyName` itself reverts.

Our reading, offered as a guess rather than a finding: both resolvers address
records by `bytes32 node`, the classic namehash, while ENSv2 resolves by
traversing registries per label — which is presumably why the Permissioned
Resolver takes the DNS-encoded name instead. If these two are v1-compatibility
resolvers rather than general-purpose ones for this deployment, that is
reasonable; it just is not written anywhere near their addresses.

Deploying a Permissioned Resolver for the name and attaching that works on the
first attempt.

**What it cost.** Most of an afternoon, and two transactions spent attaching a
resolver that could never have worked. The deployment table lists three
resolvers with no note about which are usable for names registered on it, and
the failure mode gives a developer nothing: an owner is told, silently, that
they may not write to their own name.

**Suggestions.** Mark in the deployments table which resolvers accept writes
for ENSv2 names. Give `setText` a named error for the authorisation failure —
finding 8 above is the argument for why that pays for itself. And if these
resolvers are v1-only, say so beside the address rather than in a design
discussion elsewhere.

---

## 10. The VerifiableFactory reverts without a reason on a used salt

`deployProxy(implementation, salt, data)` reverts with empty data when a proxy
already exists at the CREATE2 address for that salt. That is correct
behaviour and completely opaque: what arrives at the developer is a
five-hundred-line viem stack trace whose entire content is *execution
reverted*.

Our salt was derived deterministically from a fixed string, so a second
deployment recomputed the same address. Obvious in hindsight; it looked exactly
like the malformed-initializer failure from finding 3, which is where we spent
the first twenty minutes.

**Suggestion.** `revert ProxyAlreadyDeployed(address proxy)`. One custom error
turns a debugging session into a sentence — and it would hand the caller the
address it was probably looking for anyway.

---

## What worked well

The Universal Resolver override is documented clearly and the ready-made viem snippet is on the same page as the addresses, which is exactly where it is needed. We wired it first and never had a resolution problem — and we would have, since forgetting it fails silently by resolving against production.

The explorer earns its place. Being able to see other teams' registrations, subregistry deployments and role grants as a readable activity feed is what let us diagnose several of the problems above without waiting for support — twice we recovered a missing address or signature by decoding somebody else's working transaction. A block explorer would not have shown us that.

Enhanced Access Control is a genuinely good fit for what we are building, and better than we knew when we chose it. Reversible revocation, *per-record* setter roles, the separation of a role from its admin, root authority that descends while a delegated role stays nailed to one node, and expiry enforced by the registry mean the *control* half of our model is protocol state rather than a table we ask people to trust us with. The confidentiality half is ours to solve with cryptography, as it should be — and being pushed to draw that line clearly made the design better.

**Reverts that carry their reasons.** Findings 7 and 8 above were both solved by reading structured revert data — a resource id, a required role bitmap, an account, a profile selector. Compare that with the empty `0x` reverts of finding 3, where a proxy delegatecalling a non-existent function leaves nothing to read. Every custom error the resolver throws saved us hours, and one of them ended up as our only reliable way to query role state at all. Whoever wrote those errors should know they are load-bearing.

Once past the interface mismatches, the whole chain worked on the first attempt: `nextkey.eth` → our own UserRegistry → a subname → its Permissioned Resolver → a text record read back through the Universal Resolver. That is a lot of moving parts to get right on a beta deployment, and it did.
