/**
 * Watching a name expire.
 *
 * The README claims that limiting access to a period is the subname's `expiry`,
 * and that resolution stops once `block.timestamp >= expiry` — enforced by the
 * registry rather than by us. That is a claim about someone else's contract,
 * and the only honest way to make it is to let a name expire and watch.
 *
 * So this registers a throwaway subname with a short life, writes a record to
 * it, reads that record back through the Universal Resolver — the path a real
 * client takes — and then keeps reading until the registry stops answering.
 * Nothing is simulated and nothing is asserted that was not observed.
 *
 * The whole run takes a few minutes and costs a little Sepolia gas. It leaves
 * an expired name behind, which is the point.
 *
 *   node --env-file=.env scripts/demo-expiry.mjs [seconds]
 *
 * Default 240 seconds. Shorter is tempting and unwise: the name has to be
 * registered, given a resolver and written to before it dies, and each of those
 * is a transaction on a public testnet whose timing we do not control.
 */

import {
  createPublicClient, createWalletClient, http, toHex, zeroAddress,
} from 'viem'
import { packetToBytes } from 'viem/ens'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA as D } from './deployment.mjs'

const PARENT = 'nextkey.eth'
const REGISTRY = process.env.NEXTKEY_REGISTRY ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const RESOLVER = process.env.NEXTKEY_RESOLVER ?? '0x52A02f288AA5dde082206D85d4001880D64F4101'
const OWNER = process.env.REGISTRAR_OWNER ?? '0x9780aFE81EF5b58333c83e05d5C07797BD81dd0B'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

const RECORD = 'nextkey.demo'
const VALUE = 'This record is readable until the name expires. Then it is not.'

// Same bitmap register-subname.mjs grants, and for the same reason: no
// ROLE_REGISTRAR, because a leaf should not be able to mint children.
const admin = (r) => r << 128n
const OWNER_ROLES = (1n << 20n) | admin(1n << 20n) | (1n << 24n) | admin(1n << 24n)

const lifetime = BigInt(Number(process.argv[2] ?? 240))

const hackathonSepolia = {
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: D.upgradableUniversalResolverProxy } },
}
const reader = createPublicClient({ chain: hackathonSepolia, transport: http(RPC) })

const pk = process.env.REGISTRAR_PRIVATE_KEY
if (!pk) {
  console.error('\n  REGISTRAR_PRIVATE_KEY not set — this demonstration writes to the chain.\n')
  process.exit(1)
}
const writer = createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) })

const registryAbi = [
  { name: 'register', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' }, { name: 'owner', type: 'address' },
      { name: 'registry', type: 'address' }, { name: 'resolver', type: 'address' },
      { name: 'roleBitmap', type: 'uint256' }, { name: 'expiry', type: 'uint64' },
    ], outputs: [] },
  { name: 'findExpiry', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'uint64' }] },
  { name: 'getResolver', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
]
const resolverAbi = [
  { name: 'setText', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }],
    outputs: [] },
]

const send = async (label, call) => {
  const hash = await writer.writeContract(call)
  process.stdout.write(`  ${label.padEnd(22)} ${hash} `)
  const r = await reader.waitForTransactionReceipt({ hash })
  console.log(r.status)
  if (r.status !== 'success') throw new Error(`${label} reverted`)
  return hash
}

const clock = () => new Date().toISOString().slice(11, 19)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Read the way a client reads: through the Universal Resolver, not the
 *  resolver directly. Resolving directly would keep answering after expiry,
 *  and would therefore prove nothing. */
const readThroughUR = async (fqdn) => {
  try {
    const value = await reader.getEnsText({ name: fqdn, key: RECORD })
    return { ok: true, value }
  } catch (e) {
    return { ok: false, error: e.shortMessage ?? e.message.split('\n')[0] }
  }
}

// ─── Run ───────────────────────────────────────────────────────────────────
const label = `fleeting${Date.now().toString().slice(-5)}`
const fqdn = `${label}.${PARENT}`
const expiry = BigInt(Math.floor(Date.now() / 1000)) + lifetime

console.log(`\nExpiry, demonstrated rather than asserted`)
console.log('─'.repeat(72))
console.log(`  name        ${fqdn}`)
console.log(`  lifetime    ${lifetime}s`)
console.log(`  expires at  ${new Date(Number(expiry) * 1000).toISOString().slice(11, 19)} UTC`)
console.log(`  registry    ${REGISTRY}`)
console.log(`  resolver    ${RESOLVER}\n`)

await send('register', {
  address: REGISTRY, abi: registryAbi, functionName: 'register',
  args: [label, OWNER, zeroAddress, RESOLVER, OWNER_ROLES, expiry],
})

await send('write record', {
  address: RESOLVER, abi: resolverAbi, functionName: 'setText',
  args: [toHex(packetToBytes(fqdn)), RECORD, VALUE],
})

const onChainExpiry = await reader.readContract({
  address: REGISTRY, abi: registryAbi, functionName: 'findExpiry', args: [label] })
console.log(`\n  registry reports expiry ${onChainExpiry}  (${new Date(Number(onChainExpiry) * 1000).toISOString().slice(11, 19)} UTC)`)
console.log(`  we asked for            ${expiry}\n`)

console.log(`  Reading ${fqdn} · ${RECORD} through the Universal Resolver.`)
console.log('─'.repeat(72))

let sawValue = false
let sawEnd = false
const deadline = Number(onChainExpiry) * 1000 + 150_000

while (Date.now() < deadline) {
  const secondsLeft = Number(onChainExpiry) - Math.floor(Date.now() / 1000)
  const r = await readThroughUR(fqdn)

  if (r.ok && r.value) {
    sawValue = true
    console.log(`  ${clock()}  ${String(secondsLeft).padStart(4)}s left   "${r.value.slice(0, 46)}…"`)
  } else if (r.ok) {
    console.log(`  ${clock()}  ${String(secondsLeft).padStart(4)}s left   — empty`)
    if (secondsLeft <= 0) { sawEnd = true; break }
  } else {
    console.log(`  ${clock()}  ${String(secondsLeft).padStart(4)}s left   ✗ ${r.error}`)
    if (secondsLeft <= 0) { sawEnd = true; break }
  }
  await sleep(20_000)
}

console.log('─'.repeat(72))
if (sawValue && sawEnd) {
  console.log(`
  The record was readable while the name was alive and stopped being readable
  once it expired. Nothing was deleted and nobody revoked anything: the
  registry simply stopped answering for a name whose time had run out.

  That is what "limit access to seven days" means in NextKey. The ciphertext
  and the wrapped key are still in the resolver's storage, exactly as before —
  but resolution is how a client finds them, and resolution has ended.
`)
} else if (sawValue && !sawEnd) {
  console.log(`
  The record was readable, but the name had not stopped resolving by the time
  this script gave up watching. Either the deployment tolerates a grace period
  or the endpoint is caching. Worth reporting to ENS rather than glossing over:
  re-run with a longer window before drawing a conclusion.
`)
} else {
  console.log(`
  The record was never readable, so this run proves nothing about expiry.
  Check that the resolver is attached and that the write succeeded before
  reading anything into the result.
`)
  process.exit(1)
}
