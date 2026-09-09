/**
 * Prove the registrar works — from outside, before a line of it reaches a page.
 *
 *   node --env-file=.env scripts/prove-names.mjs 0xTheContract
 *
 * A contract that compiles and deploys has proved nothing. What has to be true
 * before the browser is allowed to know this exists:
 *
 *   1  a stranger, paying their own gas, can claim a name
 *   2  the registry says that stranger owns it — not us
 *   3  the same stranger cannot claim a second one
 *   4  we cannot claim one *for* somebody else while no relayer is set
 *
 * The fourth is the one worth spending a transaction on. Without it a passer-by
 * could burn a victim's single allowance on a name the victim never wanted, and
 * that failure would look like nothing at all until somebody complained.
 *
 * The stranger is a key made here and thrown away afterwards, funded with a
 * little Sepolia ether from REGISTRAR_PRIVATE_KEY. Using the owner key as the
 * claimant would be easier and would prove the wrong thing: the owner is not a
 * stranger, and its one allowance would be spent for good on a test.
 *
 * Nothing here is undoable. A name claimed during this run belongs to a key
 * that exists for ninety seconds and is then gone — which is itself the point
 * being demonstrated, since the contract cannot take it back either.
 */
import { createPublicClient, createWalletClient, http, formatEther, parseEther, zeroAddress } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const artifact = JSON.parse(readFileSync(join(here, '..', 'contracts', 'NextKeyNames.json'), 'utf8'))

const NEXTKEY_REGISTRY = process.env.NEXTKEY_REGISTRY
  ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const FUNDING = parseEther(process.env.PROVE_FUNDING ?? '0.01')

const contract = process.argv[2]
if (!contract) {
  console.error(`\n  Usage: prove-names.mjs <contract address>\n`)
  process.exit(1)
}

const registryAbi = [{
  name: 'findOwner', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }],
}]

const reader = createPublicClient({ chain: sepolia, transport: http(RPC) })
const pk = process.env.REGISTRAR_PRIVATE_KEY
if (!pk) {
  console.error(`\n  REGISTRAR_PRIVATE_KEY is not set — there is nothing to fund the stranger with.\n`)
  process.exit(1)
}
const owner = createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) })

const strangerKey = generatePrivateKey()
const stranger = createWalletClient({
  account: privateKeyToAccount(strangerKey), chain: sepolia, transport: http(RPC) })

// Distinctive enough that a name left behind by a proof run is recognisable as
// one, rather than looking like somebody's real name.
const label = `proof-${Date.now().toString(36)}`

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`)
  if (!ok) failures++
}

/** Run a call that must revert, and report which error came back. */
const mustRevert = async (name, expected, run) => {
  try {
    await run()
    check(name, false, 'it went through, which is the defect')
  } catch (e) {
    const named = e.walk?.((x) => x?.data?.errorName)?.data?.errorName
      ?? e.cause?.data?.errorName
    check(name, named === expected, named ? `reverted ${named}` : `reverted, but as ${e.shortMessage ?? e.message}`)
  }
}

console.log(`\nProving NextKeyNames`)
console.log('─'.repeat(72))
console.log(`  contract    ${contract}`)
console.log(`  registry    ${NEXTKEY_REGISTRY}`)
console.log(`  owner       ${owner.account.address}`)
console.log(`  stranger    ${stranger.account.address}  (made now, discarded after)`)
console.log(`  label       ${label}.nextkey.eth\n`)

// ─── Fund the stranger ──────────────────────────────────────────────────────
const fundHash = await owner.sendTransaction({
  to: stranger.account.address, value: FUNDING, chain: sepolia })
await reader.waitForTransactionReceipt({ hash: fundHash })
console.log(`  funded      ${formatEther(FUNDING)} ETH  tx ${fundHash}\n`)

// ─── 1 · a stranger can claim, paying their own gas ─────────────────────────
const claimHash = await stranger.writeContract({
  address: contract, abi: artifact.abi, functionName: 'claim',
  args: [label, stranger.account.address], chain: sepolia })
const claimReceipt = await reader.waitForTransactionReceipt({ hash: claimHash })
check('a stranger can claim a name, paying their own gas',
  claimReceipt.status === 'success', `gas ${claimReceipt.gasUsed}`)

// ─── 2 · the registry says it is theirs ─────────────────────────────────────
const registryOwner = await reader.readContract({
  address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'findOwner', args: [label] })
check('the registry says the stranger owns it, not us',
  registryOwner.toLowerCase() === stranger.account.address.toLowerCase(), registryOwner)

const recorded = await reader.readContract({
  address: contract, abi: artifact.abi, functionName: 'nameOf', args: [stranger.account.address] })
check('the contract recorded which name went to them', recorded === label, recorded || '(empty)')

// ─── 3 · not a second one ───────────────────────────────────────────────────
await mustRevert('the same address cannot claim a second name', 'AlreadyClaimed', () =>
  reader.simulateContract({
    address: contract, abi: artifact.abi, functionName: 'claim',
    args: [`${label}-again`, stranger.account.address], account: stranger.account.address }))

// ─── 4 · and nobody can claim on somebody else's behalf ─────────────────────
const victim = privateKeyToAccount(generatePrivateKey()).address
await mustRevert('we cannot claim a name for somebody else', 'NotYoursToClaim', () =>
  reader.simulateContract({
    address: contract, abi: artifact.abi, functionName: 'claim',
    args: [`${label}-victim`, victim], account: owner.account.address }))

// ─── 5 · a name already held cannot be taken ────────────────────────────────
const fresh = privateKeyToAccount(generatePrivateKey()).address
await mustRevert('an existing name cannot be handed to anybody else', 'LabelTaken', () =>
  reader.simulateContract({
    address: contract, abi: artifact.abi, functionName: 'claim',
    args: [label, fresh], account: fresh }))

// ─── What the counters say afterwards ───────────────────────────────────────
const [minted, remaining] = await Promise.all(['minted', 'remaining'].map((fn) =>
  reader.readContract({ address: contract, abi: artifact.abi, functionName: fn })))
console.log(`\n  minted      ${minted}`)
console.log(`  remaining   ${remaining}`)

console.log(`
  ${failures === 0
    ? 'All five hold. The role is on a contract whose rules are public, and the'
    + '\n  name it handed out belongs to an address nothing here can reach.'
    : `${failures} of five did not hold. Nothing goes near the page until they do.`}
`)
if (failures) process.exitCode = 1
