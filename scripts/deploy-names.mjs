/**
 * Deploy NextKeyNames, and say what still has to happen afterwards.
 *
 *   node --env-file=.env scripts/build-contract.mjs
 *   node --env-file=.env scripts/deploy-names.mjs
 *   node --env-file=.env scripts/deploy-names.mjs show 0xTheContract
 *
 * Deploying it changes nothing on its own: a contract with no role registers
 * nothing. The step that matters comes after, and it is one transaction from
 * the registry owner:
 *
 *   node --env-file=.env scripts/name-registrar.mjs grant 0xTheContract
 *
 * That is the whole point of the contract. The role goes to something whose
 * rules are public and cannot be talked out of, rather than to a key whose only
 * limits are its balance and how fast somebody notices.
 */
import { createPublicClient, createWalletClient, http, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ARTIFACT = join(here, '..', 'contracts', 'NextKeyNames.json')

const NEXTKEY_REGISTRY = process.env.NEXTKEY_REGISTRY
  ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const POOL_RESOLVER = process.env.POOL_RESOLVER
  ?? '0x04B2DB6567Cc68d059c061215Adf9a99adD1cA65'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

// Chosen rather than defaulted. A cap is a promise about the most this can ever
// cost and the most junk it can ever create, so it is a number somebody picked
// and can raise later with setCap — not "a lot".
const CAP = BigInt(process.env.NAMES_CAP ?? 500)
const DURATION = BigInt(process.env.NAMES_DURATION ?? 31_536_000)

const reader = createPublicClient({ chain: sepolia, transport: http(RPC) })
const pk = process.env.REGISTRAR_PRIVATE_KEY
const writer = pk
  ? createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) })
  : undefined

let artifact
try { artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) } catch {
  console.error(`\n  No contracts/NextKeyNames.json — run: node scripts/build-contract.mjs\n`)
  process.exit(1)
}

const [command, arg] = process.argv.slice(2)

console.log(`\nNextKeyNames`)
console.log('─'.repeat(72))
console.log(`  compiler    ${artifact.solc}`)
console.log(`  registry    ${NEXTKEY_REGISTRY}`)
console.log(`  resolver    ${POOL_RESOLVER}`)

if (command === 'show') {
  if (!arg) { console.error(`\n  Usage: deploy-names.mjs show <address>\n`); process.exit(1) }
  const read = (fn, args = []) => reader
    .readContract({ address: arg, abi: artifact.abi, functionName: fn, args })
    .catch((e) => `✗ ${e.shortMessage ?? e.message}`)
  const [operator, relayer, cap, minted, remaining, paused, duration] = await Promise.all(
    ['operator', 'relayer', 'cap', 'minted', 'remaining', 'paused', 'duration'].map((f) => read(f)))
  console.log(`\n  contract    ${arg}`)
  console.log(`  operator    ${operator}`)
  console.log(`  relayer     ${relayer}`)
  console.log(`  cap         ${cap}`)
  console.log(`  minted      ${minted}`)
  console.log(`  remaining   ${remaining}`)
  console.log(`  duration    ${duration} s`)
  console.log(`  paused      ${paused}`)
  console.log(`
  A name already handed out is not listed here, and cannot be. It belongs to
  the address that claimed it; nothing in this contract reaches into one.\n`)
  process.exit(0)
}

if (!writer) {
  console.log(`\n  REGISTRAR_PRIVATE_KEY is not set — nothing can be deployed.`)
  console.log(`  Deploy with the owner key; it becomes the contract's operator.\n`)
  process.exit(1)
}

const balance = await reader.getBalance({ address: writer.account.address })
console.log(`  deployer    ${writer.account.address}`)
console.log(`  balance     ${formatEther(balance)} ETH`)
console.log(`  cap         ${CAP}`)
console.log(`  duration    ${DURATION} s  (${Number(DURATION) / 86_400} days)`)

const hash = await writer.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [NEXTKEY_REGISTRY, POOL_RESOLVER, CAP, DURATION],
  chain: sepolia,
})
console.log(`\n  tx          ${hash}`)
const receipt = await reader.waitForTransactionReceipt({ hash })
console.log(`  contract    ${receipt.contractAddress}`)
console.log(`  gas used    ${receipt.gasUsed}`)

console.log(`
  It can do nothing yet. Three steps, in this order:

    1  let it register names — only the registry owner can:
         node --env-file=.env scripts/name-registrar.mjs grant ${receipt.contractAddress}

    2  let it publish the key on the name it just made — only the resolver's
       owner can, and without it every name it hands out is unusable by the
       person who receives it:
         node --env-file=.env scripts/name-registrar.mjs grant-write ${receipt.contractAddress}
         node --env-file=.env scripts/name-registrar.mjs check ${receipt.contractAddress}

    3  if the page is to pay the gas for visitors, name the relayer:
         cast send ${receipt.contractAddress} "setRelayer(address)" <the page's key address>
       Leave it unset and every claimant pays their own gas, which is the
       version with nothing of ours in it at all.

  Then prove it from outside before any of it reaches the page:
    node --env-file=.env scripts/prove-names.mjs ${receipt.contractAddress}

  And take both roles off whatever held them before, so there is one door and
  not two:
    node --env-file=.env scripts/name-registrar.mjs revoke <the old contract>
    node --env-file=.env scripts/name-registrar.mjs revoke-write <the old contract>

  If it ever needs to stop: setPaused(true) halts new claims, and revoke plus
  revoke-write end it entirely. None of the three touches a name that was
  already handed out, or a record already written on one.
`)
