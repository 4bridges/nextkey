/**
 * Register a subname inside NextKey's own registry.
 *
 * This is where the product starts. Each secret NextKey stores becomes a
 * subname — an ERC1155 token with exactly one owner, its own resolver and its
 * own roles. From here, "share this secret with anna.eth" is a role grant on a
 * single record, "expire in seven days" is the subname's expiry, and "revoke"
 * is revokeRoles. None of it is a row in a database of ours.
 *
 *   node scripts/register-subname.mjs register visa
 *   node scripts/register-subname.mjs register visa 0xResolverAddress
 *   node scripts/register-subname.mjs show     visa
 *
 * Without REGISTRAR_PRIVATE_KEY set, nothing is sent: the contract, function
 * and arguments are printed for Etherscan's Write Contract tab.
 */

import { createPublicClient, createWalletClient, http, keccak256, toBytes, zeroAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

/** NextKey's UserRegistry, deployed 2026-09-05 and linked under nextkey.eth. */
const NEXTKEY_REGISTRY = process.env.NEXTKEY_REGISTRY
  ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const OWNER = process.env.REGISTRAR_OWNER ?? '0x9780aFE81EF5b58333c83e05d5C07797BD81dd0B'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

// ─── Enhanced Access Control role constants ────────────────────────────────
// Each role occupies one nybble; the admin of a role sits 128 bits higher.
// Holding a role lets you do the thing; holding its admin lets you grant and
// revoke it for others. That split is what makes NextKey's sharing model work:
// the owner keeps the admin, the recipient gets only the plain role.
const ROLE_REGISTRAR        = 1n << 0n
const ROLE_SET_SUBREGISTRY  = 1n << 20n
const ROLE_SET_RESOLVER     = 1n << 24n
const admin = (role) => role << 128n

/**
 * What the subname's owner receives. Deliberately not "everything": no
 * ROLE_REGISTRAR, because a secret is a leaf and should not be able to mint
 * children. This mirrors the bitmap the tutorial's SimpleSubnameRegistrar
 * applies at registration.
 */
const OWNER_ROLES =
  ROLE_SET_SUBREGISTRY | admin(ROLE_SET_SUBREGISTRY) |
  ROLE_SET_RESOLVER    | admin(ROLE_SET_RESOLVER)

const ONE_YEAR = 31_536_000n

const registryAbi = [
  { name: 'register', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' },
      { name: 'owner', type: 'address' },
      { name: 'registry', type: 'address' },
      { name: 'resolver', type: 'address' },
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'expiry', type: 'uint64' },
    ],
    outputs: [] },
  // Read off the deployed bytecode with scripts/probe-abi.mjs. The docs give
  // these as taking bytes32; the deployed contract takes the label as a string.
  // The bytes32 form does not exist and reverts with empty data.
  { name: 'getResolver', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { name: 'getSubregistry', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  // Undocumented but present, and the right way to handle mutable token ids:
  // ask the registry rather than deriving one from the labelhash.
  { name: 'findTokenId', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'uint256' }] },
  { name: 'findOwner', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { name: 'findExpiry', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'uint64' }] },
]

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) })
const pk = process.env.REGISTRAR_PRIVATE_KEY
const walletClient = pk
  ? createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) })
  : undefined

const [command, label, resolverArg] = process.argv.slice(2)
if (!command || !label) {
  console.error(`\nUsage: node scripts/register-subname.mjs <register|show> <label> [resolver]\n`)
  process.exit(1)
}

const labelHash = keccak256(toBytes(label))

console.log(`\nNextKey subname — ${label}.nextkey.eth`)
console.log('─'.repeat(72))
console.log(`  registry    ${NEXTKEY_REGISTRY}`)
console.log(`  labelhash   ${labelHash}`)
console.log(`  mode        ${walletClient ? 'signing' : 'print-only'}`)

if (command === 'show') {
  const read = (fn) => publicClient
    .readContract({ address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: fn, args: [label] })
    .catch((e) => `✗ ${e.shortMessage ?? e.message}`)

  const [owner, expiry, tokenId, resolver, subregistry] = await Promise.all(
    ['findOwner', 'findExpiry', 'findTokenId', 'getResolver', 'getSubregistry'].map(read))

  const addr = (v) => (typeof v === 'string' && v === zeroAddress ? '— none' : v)
  console.log(`\n  owner       ${addr(owner)}`)
  console.log(`  expiry      ${expiry}${typeof expiry === 'bigint' ? `  (${new Date(Number(expiry) * 1000).toISOString().slice(0, 10)})` : ''}`)
  console.log(`  tokenId     ${tokenId}`)
  console.log(`  resolver    ${addr(resolver)}`)
  console.log(`  subregistry ${addr(subregistry)}`)
  console.log(`\n  Token ids are mutable — they change when roles change — so this asks
  the registry with findTokenId rather than deriving one. Never cache a token id.\n`)
}

else if (command === 'register') {
  const resolver = resolverArg ?? zeroAddress
  const expiry = BigInt(Math.floor(Date.now() / 1000)) + ONE_YEAR

  console.log(`\n  owner       ${OWNER}`)
  console.log(`  resolver    ${resolver === zeroAddress ? '— none yet, set later with setResolver' : resolver}`)
  console.log(`  roles       0x${OWNER_ROLES.toString(16)}`)
  console.log(`              SET_SUBREGISTRY + admin, SET_RESOLVER + admin`)
  console.log(`              deliberately without ROLE_REGISTRAR: a secret is a leaf`)
  console.log(`  expiry      ${expiry}  (one year from now)`)

  const args = [label, OWNER, zeroAddress, resolver, OWNER_ROLES, expiry]

  if (!walletClient) {
    const inputs = registryAbi.find((f) => f.name === 'register').inputs
    console.log(`\n  Execute this yourself:`)
    console.log(`    Contract  ${NEXTKEY_REGISTRY}`)
    console.log(`    Function  register`)
    args.forEach((a, i) => console.log(`      ${i + 1}. ${inputs[i].name.padEnd(12)} ${a}`))
    console.log(`\n  Then verify: node scripts/register-subname.mjs show ${label}\n`)
  } else {
    const hash = await walletClient.writeContract({
      address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'register', args,
    })
    console.log(`\n  → sent ${hash}`)
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    console.log(`  → ${receipt.status}\n`)
  }
}

else {
  console.error(`\n  unknown command: ${command}\n`)
  process.exit(1)
}
