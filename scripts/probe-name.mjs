/**
 * Would try.html's step 6 succeed on this name?
 *
 * Step 6 does three things before it asks for a signature: find the resolver
 * through the Universal Resolver, work out which `setText` signature that
 * resolver speaks, and simulate the write. This script does the same three
 * things from Node and sends nothing, so a name can be checked before any gas
 * is spent — and, more usefully, so a failure can be attributed. In a browser
 * all three collapse into one red box.
 *
 *   node --env-file=.env scripts/probe-name.mjs nextkeydemo.eth
 *   node --env-file=.env scripts/probe-name.mjs nextkeydemo.eth 0xSomeAddress
 *   node --env-file=.env scripts/probe-name.mjs nextkeydemo.eth --resolver 0xCandidate
 *
 * `--resolver` asks a resolver that is not attached yet: would this one accept
 * the write, if we pointed the name at it? Attaching costs a transaction and
 * finding out afterwards costs another, so the question is worth asking first.
 *
 * The second argument is the address that would sign. It defaults to
 * REGISTRAR_OWNER, and it matters: the simulation asks "may *this* account
 * write here", which is the question the page is really asking.
 *
 * Two lookups, deliberately both:
 *
 *   The registry knows what was attached. The Universal Resolver knows what a
 *   client will find. They should agree, and if they do not, the page is
 *   looking at a different resolver than `resolver.mjs attach-eth` set — which
 *   is exactly the kind of divergence that reads as "you have no permission".
 */

import { createPublicClient, http, toHex, namehash, zeroAddress } from 'viem'
import { packetToBytes } from 'viem/ens'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA as D } from './deployment.mjs'

const argv = process.argv.slice(2)
const flag = (f) => { const i = argv.indexOf(f); return i === -1 ? null : argv[i + 1] }
const candidate = flag('--resolver')
const positional = argv.filter((a, i) =>
  !a.startsWith('--') && argv[i - 1] !== '--resolver')

const name = positional[0]
const account = positional[1] ?? process.env.REGISTRAR_OWNER
  ?? '0x9780aFE81EF5b58333c83e05d5C07797BD81dd0B'

if (!name?.includes('.')) {
  console.error('\nUsage: node --env-file=.env scripts/probe-name.mjs <full.name.eth> [signer]\n')
  process.exit(1)
}

const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const client = createPublicClient({
  chain: {
    ...sepolia,
    contracts: { ...sepolia.contracts,
      ensUniversalResolver: { address: D.upgradableUniversalResolverProxy } },
  },
  transport: http(RPC),
})

const registryAbi = [
  { name: 'getResolver', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { name: 'findOwner', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
]

/**
 * The resolver's own opinion about who may write. Both selectors were read off
 * its bytecode with probe-abi.mjs, so asking is cheaper than inferring: a
 * revert tells you *that* it refused, this tells you *whether it thinks you are
 * allowed*, which is a different fact and the one worth having.
 */
const resolverViewAbi = [
  { name: 'canModifyName', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }, { name: 'addr', type: 'address' }],
    outputs: [{ type: 'bool' }] },
  { name: 'findOwner', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { name: 'ROOT_REGISTRY', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'address' }] },
]

/** The four bytes a revert starts with, when it carries any data at all. */
const revertSelector = (e) => {
  for (let c = e; c; c = c.cause) if (typeof c.data === 'string' && c.data.length >= 10) return c.data
  return null
}

/** The same two candidates try.js carries, in the same order. */
const SHAPES = [
  { id: 'setText(bytes name, string, string)',
    abi: [{ name: 'setText', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' },
               { name: 'value', type: 'string' }], outputs: [] }],
    arg: (n) => toHex(packetToBytes(n)) },
  { id: 'setText(bytes32 node, string, string)',
    abi: [{ name: 'setText', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' },
               { name: 'value', type: 'string' }], outputs: [] }],
    arg: (n) => namehash(n) },
]

const short = (e) => (e?.shortMessage ?? e?.message ?? String(e)).split('\n')[0].slice(0, 150)

console.log(`\n  ${name}`)
console.log('─'.repeat(72))
console.log(`  signer      ${account}`)

// ── 1 · what the registry has, and what a client finds ────────────────────
const labels = name.split('.')
const secondLevel = labels.length === 2
if (secondLevel) {
  const fromRegistry = await client.readContract({
    address: D.ethRegistry, abi: registryAbi, functionName: 'getResolver', args: [labels[0]],
  }).catch((e) => `✗ ${short(e)}`)
  console.log(`  registry    ${fromRegistry === zeroAddress ? '✗ none attached' : fromRegistry}`)
}

let resolver
try {
  resolver = await client.getEnsResolver({ name })
  console.log(`  found by UR ${resolver}`)
  if (candidate) {
    resolver = candidate
    console.log(`  probing     ${resolver}  (not attached — a hypothetical)`)
  }
} catch (e) {
  console.error(`  found by UR ✗ ${short(e)}`)
  console.error(`
  The page would stop here. The Universal Resolver could not find a resolver
  for this name, so nothing after this matters.\n`)
  process.exit(1)
}

// ── 2 · which signature does it speak, and may this account use it ────────
// A harmless value under the real record key: nothing is sent, and using the
// real key means the simulation answers the question the page will ask.
const probe = ['nextkey.secret', JSON.stringify({ v: 1, alg: 'A256GCM', iv: '', ct: '' })]

// ── Ask the resolver directly who it thinks may write ─────────────────────
const node = namehash(name)
const ask = (fn, args) => client.readContract({
  address: resolver, abi: resolverViewAbi, functionName: fn, args })
  .then((v) => String(v)).catch((e) => `\u2717 ${short(e)}`)

console.log()
console.log(`  namehash    ${node}`)
if (secondLevel) {
  console.log(`  name owner  ${await client.readContract({
    address: D.ethRegistry, abi: registryAbi, functionName: 'findOwner', args: [labels[0]],
  }).catch((e) => `\u2717 ${short(e)}`)}`)
}
console.log(`  may write   ${await ask('canModifyName', [node, account])}`)
console.log(`  root reg.   ${await ask('ROOT_REGISTRY', [])}`)

console.log()
let ok = null
for (const shape of SHAPES) {
  try {
    await client.simulateContract({
      address: resolver, abi: shape.abi, functionName: 'setText',
      args: [shape.arg(name), ...probe], account,
    })
    console.log(`  ✓ ${shape.id}`)
    ok = ok ?? shape
  } catch (e) {
    // The revert data separates the two explanations that matter. Empty data
    // means the function is not there at all; four bytes mean it is there and
    // said no, and says which no.
    const data = revertSelector(e)
    console.log(`  ✗ ${shape.id}`)
    console.log(`      ${short(e)}`)
    console.log(`      revert data ${data ? `${data.slice(0, 10)}  (a named error — the function exists and refused)`
                                          : 'empty  (usually: no such function on this contract)'}`)
  }
}

console.log(ok
  ? `\n  Step 6 would work on this name, using the first accepted form above.\n`
  : `\n  Step 6 would fail. If the name is yours and has a resolver, that resolver
  speaks a third signature and try.js needs to learn it — the two refusals
  above are what to send.\n`)
process.exit(ok ? 0 : 1)
