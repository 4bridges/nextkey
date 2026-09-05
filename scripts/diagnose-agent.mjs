/**
 * Why can the agent not write to its own name?
 *
 * The resolver rejected `setText` with a custom error carrying three fields:
 * a resource id, a required role bitmap of 1<<4, and the agent's address. The
 * resource id is not the namehash of `agent.nextkey.eth` and not the keccak of
 * its DNS encoding, so the resolver derives it some third way — and rather than
 * guess at that derivation, this asks the deployed contract.
 *
 * Three questions, in the order that narrows fastest:
 *
 *   1. Can the *owner* write to agent.nextkey.eth? If yes, the name, the
 *      resolver attachment and the record are all fine and the problem is the
 *      grant alone. If no, the problem is further upstream and the grant is a
 *      red herring.
 *   2. What roles does each account actually hold on that resource? The answer
 *      distinguishes "the grant never landed" from "the grant landed on a
 *      different resource or a different bit".
 *   3. Which role-reading functions does the resolver even expose? Printed when
 *      the guesses in step 2 all revert, so the next attempt is informed.
 *
 *   node --env-file=.env scripts/diagnose-agent.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { createPublicClient, http, toHex, zeroAddress } from 'viem'
import { packetToBytes } from 'viem/ens'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA as D } from './deployment.mjs'

const PARENT = 'nextkey.eth'
const REGISTRY = process.env.NEXTKEY_REGISTRY ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const AGENT_KEYFILE = new URL('../.keys/agent-eoa.json', import.meta.url)

/** Taken straight from the revert payload of the failed propose. */
const RESOURCE = '0x4fc08dd2f1ee163dc8f69c31c0a701d127c63b500848fae212785e3524c9bc0d'
const REQUIRED_ROLE = 1n << 4n

const client = createPublicClient({ chain: sepolia, transport: http(RPC) })

const registryAbi = [{ name: 'getResolver', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] }]
const resolverAbi = [{ name: 'setText', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }],
  outputs: [] }]

const owner = process.env.REGISTRAR_PRIVATE_KEY
  ? privateKeyToAccount(process.env.REGISTRAR_PRIVATE_KEY).address
  : (process.env.REGISTRAR_OWNER ?? '0x9780aFE81EF5b58333c83e05d5C07797BD81dd0B')

const agent = existsSync(AGENT_KEYFILE)
  ? JSON.parse(readFileSync(AGENT_KEYFILE, 'utf8')).address
  : undefined

const line = () => console.log('  ' + '─'.repeat(70))

console.log(`\nNextKey — agent permission diagnosis`)
line()
console.log(`  owner     ${owner}`)
console.log(`  agent     ${agent ?? '— no .keys/agent-eoa.json'}`)
console.log(`  resource  ${RESOURCE}`)
console.log(`  needs     0x${REQUIRED_ROLE.toString(16)}  (bit ${REQUIRED_ROLE.toString(2).length - 1})`)

const resolver = await client.readContract({
  address: REGISTRY, abi: registryAbi, functionName: 'getResolver', args: ['agent'] })
console.log(`  resolver  ${resolver}${resolver === zeroAddress ? '   ← nothing attached!' : ''}`)
line()

if (resolver === zeroAddress) {
  console.log(`
  agent.nextkey.eth has no resolver attached. Nothing else matters until
  that is fixed:  scripts/resolver.mjs attach agent <resolver>\n`)
  process.exit(1)
}

// ─── 1. Can the owner write? ───────────────────────────────────────────────
console.log(`\n  1. Can the owner write to agent.${PARENT}?`)
const probe = (account) => client.simulateContract({
  address: resolver, abi: resolverAbi, functionName: 'setText',
  args: [toHex(packetToBytes(`agent.${PARENT}`)), 'nextkey.diagnostic', 'probe'],
  account,
})

try {
  await probe(owner)
  console.log(`     yes — the name, its resolver and the record path are all sound.`)
  console.log(`     So the missing piece is the agent's grant, nothing upstream.`)
} catch (e) {
  console.log(`     NO — ${e.shortMessage ?? e.message.split('\n')[0]}`)
  console.log(`     The owner cannot write either, so this is not about the agent.`)
  console.log(`     Check that register-subname granted the owner its roles on "agent".`)
}

if (agent) {
  console.log(`\n     And the agent?`)
  try {
    await probe(agent)
    console.log(`     yes — the agent CAN write. Then the earlier failure was transient;`)
    console.log(`     re-run propose.`)
  } catch (e) {
    console.log(`     no — ${e.shortMessage ?? e.message.split('\n')[0]}`)
  }
}

// ─── 2. What roles are actually held? ──────────────────────────────────────
// Enhanced Access Control exposes its role state, but the getter's name is not
// documented for this deployment. Try the plausible spellings; the first that
// answers is the real one.
console.log(`\n  2. Roles held on that resource`)

const readers = [
  { name: 'roles',    abi: [{ name: 'roles', type: 'function', stateMutability: 'view',
      inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [{ type: 'uint256' }] }] },
  { name: 'rolesOf',  abi: [{ name: 'rolesOf', type: 'function', stateMutability: 'view',
      inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [{ type: 'uint256' }] }] },
  { name: 'getRoles', abi: [{ name: 'getRoles', type: 'function', stateMutability: 'view',
      inputs: [{ type: 'bytes32' }, { type: 'address' }], outputs: [{ type: 'uint256' }] }] },
]

let answered = false
for (const r of readers) {
  try {
    const forOwner = await client.readContract({
      address: resolver, abi: r.abi, functionName: r.name, args: [RESOURCE, owner] })
    const forAgent = agent ? await client.readContract({
      address: resolver, abi: r.abi, functionName: r.name, args: [RESOURCE, agent] }) : 0n
    answered = true
    console.log(`     via ${r.name}(bytes32,address)`)
    console.log(`     owner  0x${forOwner.toString(16)}`)
    console.log(`     agent  0x${forAgent.toString(16)}`)
    console.log(`     agent holds the required bit: ${(forAgent & REQUIRED_ROLE) === REQUIRED_ROLE ? 'YES' : 'NO'}`)
    if (forAgent === 0n) {
      console.log(`
     The agent holds nothing at all on this resource. Either grant-setter
     never succeeded, or it wrote to a different resource than the one
     setText checks. Compare the owner's bitmap above with 0x${REQUIRED_ROLE.toString(16)}:
     if the owner does hold it, grantSetterRoles is the right call and it
     simply did not land.`)
    }
    break
  } catch { /* try the next spelling */ }
}

if (!answered) {
  console.log(`     none of roles / rolesOf / getRoles answered.`)
  console.log(`     Next step: scripts/probe-abi.mjs ${resolver}`)
  console.log(`     and look for a view function taking (bytes32, address).`)
}

console.log()
