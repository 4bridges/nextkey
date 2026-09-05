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

---

## What worked well

The Universal Resolver override is documented clearly and the ready-made viem snippet is on the same page as the addresses, which is exactly where it is needed. We wired it first and never had a resolution problem — and we would have, since forgetting it fails silently by resolving against production.

The explorer earns its place. Being able to see other teams' registrations, subregistry deployments and role grants as a readable activity feed is what let us diagnose several of the problems above without waiting for support — twice we recovered a missing address or signature by decoding somebody else's working transaction. A block explorer would not have shown us that.

Enhanced Access Control is a genuinely good fit for what we are building. Reversible revocation, per-name setter roles, the separation of a role from its admin, and expiry enforced by the registry mean the *control* half of our model is protocol state rather than a table we ask people to trust us with. The confidentiality half is ours to solve with cryptography, as it should be — and being pushed to draw that line clearly made the design better.

Once past the interface mismatches, the whole chain worked on the first attempt: `nextkey.eth` → our own UserRegistry → a subname → its Permissioned Resolver → a text record read back through the Universal Resolver. That is a lot of moving parts to get right on a beta deployment, and it did.
