/**
 * Which implementation do people actually deploy registry proxies from?
 *
 * The docs say "use USER_REGISTRY_IMPL", but that constant is not in the
 * deployment table — it lists only PermissionedResolverImpl and
 * WrapperRegistryImpl. Rather than guess, read it off the chain: every
 * VerifiableFactory deployment emits ProxyDeployed with the implementation it
 * used, so the addresses other hackathon teams are using are public.
 *
 * Usage:
 *   node scripts/find-registry-impl.mjs            # last ~1 day of blocks
 *   node scripts/find-registry-impl.mjs 60000      # look further back
 *
 * Public RPC endpoints cap how many blocks a single getLogs call may cover, and
 * the cap differs per provider. This starts at 2000 blocks per request and
 * halves on rejection rather than reporting "no events found" when what really
 * happened is that every request was refused.
 */

import { createPublicClient, http, parseAbiItem } from 'viem'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA } from './deployment.mjs'

// The endpoint the CRE project.yaml already uses — more generous with log
// ranges than the one viem picks by default.
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const LOOKBACK = BigInt(process.argv[2] ?? 20_000) // ≈ one day at 12s blocks

const client = createPublicClient({ chain: sepolia, transport: http(RPC) })

const event = parseAbiItem(
  'event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)',
)

const latest = await client.getBlockNumber()
const floor = latest > LOOKBACK ? latest - LOOKBACK : 0n

console.log(`\nVerifiableFactory  ${ENSV2_SEPOLIA.verifiableFactory}`)
console.log(`RPC                ${RPC}`)
console.log(`Blocks             ${floor} … ${latest}`)
console.log('─'.repeat(72))

const byImpl = new Map()
let span = 2_000n
let refusals = 0
let to = latest

while (to > floor) {
  const from = to - span > floor ? to - span : floor
  try {
    const logs = await client.getLogs({
      address: ENSV2_SEPOLIA.verifiableFactory,
      event,
      fromBlock: from,
      toBlock: to,
    })
    for (const log of logs) {
      const impl = log.args.implementation.toLowerCase()
      const entry = byImpl.get(impl) ?? { count: 0, examples: [] }
      entry.count += 1
      if (entry.examples.length < 3) {
        entry.examples.push({ proxy: log.args.proxyAddress, tx: log.transactionHash })
      }
      byImpl.set(impl, entry)
    }
    to = from - 1n
    process.stdout.write(`\r  at block ${to}, ${byImpl.size} implementation(s), span ${span}   `)
  } catch (err) {
    if (span > 100n) {
      span /= 2n // provider refused this range — try a smaller one
      refusals += 1
      continue
    }
    console.log(`\n  ! giving up on ${from}–${to}: ${err.shortMessage ?? err.message}`)
    to = from - 1n
  }
}

console.log('\n')
if (refusals > 0) {
  console.log(`  (the provider refused ${refusals} range(s); settled on ${span} blocks per request)\n`)
}

if (byImpl.size === 0) {
  console.log(`  No ProxyDeployed events in this range — which now means genuinely none,
  not that every request failed. Look further back:

    node scripts/find-registry-impl.mjs 100000\n`)
  process.exit(0)
}

const known = Object.fromEntries(
  Object.entries(ENSV2_SEPOLIA).map(([k, v]) => [v.toLowerCase(), k]),
)

for (const [impl, { count, examples }] of [...byImpl].sort((a, b) => b[1].count - a[1].count)) {
  const label = known[impl] ? `   ← ${known[impl]} (deployment table)` : ''
  console.log(`  ${impl}   ${count}×${label}`)
  for (const e of examples) {
    console.log(`      proxy  ${e.proxy}`)
    console.log(`      tx     https://sepolia.etherscan.io/tx/${e.tx}`)
  }
  console.log()
}

console.log(`The most-used address is almost certainly USER_REGISTRY_IMPL. Confirm by
opening one transaction: a registry deployment is followed shortly after by a
setSubregistry call on the ETHRegistry.\n`)
