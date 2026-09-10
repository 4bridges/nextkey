/**
 * May the owner of a claimed name write its own records?
 *
 *   node --env-file=.env scripts/probe-own-write.mjs <label> <owner address>
 *   node --env-file=.env scripts/probe-own-write.mjs proof-mtuq9obb 0xFF34…7ddf
 *
 * The lent-name lane works because *our* key writes the record. A name that
 * belongs to the visitor is a different question, and the answer decides what
 * the page can promise: if the owner may write, "get a name of your own" is two
 * transactions they pay for and finish alone. If they may not, the feature does
 * not exist yet however good the contract is, and saying so now is cheaper than
 * discovering it in front of a judge.
 *
 * The registrar registers a claimed name with POOL_RESOLVER as its resolver and
 * gives the owner SET_RESOLVER and SET_SUBREGISTRY — but *writing a text record*
 * is a permission of the resolver, not of the registry, and nothing so far has
 * asked the resolver what it thinks.
 *
 * Everything below is `eth_call`. Nothing is signed, no gas is spent, and no
 * record is changed — a simulation of setText returns without writing.
 *
 * Three askers, so the answer can be read rather than inferred:
 *
 *   the owner        must succeed, or the feature is not possible
 *   this page's key  if it succeeds, our key can overwrite names we handed out,
 *                    which is worth knowing and worth saying out loud
 *   a stranger       must fail, or the resolver is open to anybody
 *
 * Both setText shapes are tried, because the deployment has two and guessing
 * wrong reverts with empty data — indistinguishable from "you are not allowed".
 */
import { createPublicClient, http, toHex, namehash } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { packetToBytes } from 'viem/ens'

const POOL_RESOLVER = process.env.POOL_RESOLVER
  ?? '0x04B2DB6567Cc68d059c061215Adf9a99adD1cA65'
const NEXTKEY_REGISTRY = process.env.NEXTKEY_REGISTRY
  ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const DEMO_ADDRESS = '0x45f0b8e270245e356A1760456ea84eDB8712C62b'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

const RECORD_PUBKEY = 'nextkey.pubkey'

const [label, ownerArg] = process.argv.slice(2)
if (!label) {
  console.error(`\n  Usage: probe-own-write.mjs <label> [owner address]\n`)
  process.exit(1)
}
const name = `${label}.nextkey.eth`

const SHAPES = [
  { id: 'name(bytes)', abi: [{ name: 'setText', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' },
               { name: 'value', type: 'string' }], outputs: [] }],
    arg: toHex(packetToBytes(name)) },
  { id: 'node(bytes32)', abi: [{ name: 'setText', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' },
               { name: 'value', type: 'string' }], outputs: [] }],
    arg: namehash(name) },
]

const registryAbi = [
  { name: 'findOwner', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { name: 'getResolver', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
]

const reader = createPublicClient({ chain: sepolia, transport: http(RPC) })

const [owner, resolver] = await Promise.all([
  reader.readContract({ address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'findOwner', args: [label] }),
  reader.readContract({ address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label] }),
])

console.log(`\nWho may write a record on a claimed name?`)
console.log('─'.repeat(72))
console.log(`  name        ${name}`)
console.log(`  owner       ${owner}${ownerArg && ownerArg.toLowerCase() !== owner.toLowerCase() ? `  (you said ${ownerArg})` : ''}`)
console.log(`  resolver    ${resolver}${resolver.toLowerCase() === POOL_RESOLVER.toLowerCase() ? '  — the pool resolver' : '  — NOT the pool resolver'}\n`)

const stranger = privateKeyToAccount(generatePrivateKey()).address

const askers = [
  { who: 'the owner', address: owner, expect: 'yes' },
  { who: "this page's key", address: DEMO_ADDRESS, expect: 'ideally no' },
  { who: 'a stranger', address: stranger, expect: 'no' },
]

for (const asker of askers) {
  for (const shape of SHAPES) {
    let verdict
    try {
      await reader.simulateContract({
        address: resolver, abi: shape.abi, functionName: 'setText',
        args: [shape.arg, RECORD_PUBKEY, 'probe'], account: asker.address })
      verdict = 'ACCEPTED'
    } catch (e) {
      const raw = e.walk?.((x) => typeof x?.data === 'string')?.data
      verdict = !raw || raw === '0x'
        ? 'refused (empty revert — wrong shape, or simply not allowed)'
        : `refused ${raw.slice(0, 10)}`
    }
    console.log(`  ${asker.who.padEnd(16)}${shape.id.padEnd(16)}${verdict}`)
  }
  console.log(`  ${''.padEnd(16)}${`expected: ${asker.expect}`}\n`)
}

console.log(`  ACCEPTED on a line for the owner is the green light: the visitor can
  finish alone, and "get a name of your own" is a feature rather than a plan.
  Nothing above wrote anything; every call was a simulation.
`)
