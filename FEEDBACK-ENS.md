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

## 4. Smaller things

**Log query ranges.** The RPC endpoint viem picks by default for Sepolia refuses `getLogs` ranges of 9,000 blocks with `Request exceeds defined limit`, and a naive scanner reports "no events found" when in truth every request was refused. Not an ENS issue, but anyone reading factory events will hit it. `https://ethereum-sepolia-rpc.publicnode.com` is more permissive.

**The reset notice.** The banner warns that registered names and state may be reset periodically, most recently 2026-07-30. That is useful and we planned around it — worth keeping prominent in the docs too, not only in the app.

---

## What worked well

The Universal Resolver override is documented clearly and the ready-made viem snippet is on the same page as the addresses, which is exactly where it is needed. We wired it first and never had a resolution problem — and we would have, since forgetting it fails silently by resolving against production.

The explorer earns its place. Being able to see other teams' registrations, subregistry deployments and role grants as a readable activity feed is what let us diagnose two of the three problems above without waiting for support. A block explorer would not have shown us that.

Enhanced Access Control is a genuinely good fit for what we are building. Per-record roles, reversible revocation and expiry mean our sharing model *is* protocol state rather than a table we ask people to trust us with. That is the reason we chose ENSv2 for this project rather than adding it as a feature.
