/**
 * A key that can hand out names under nextkey.eth, and nothing else.
 *
 * The demo lends a name from a fixed pool. That works and it is honest, but the
 * name stays ours: the visitor receives on it, cannot change its records, and
 * has nothing but our restraint between them and us overwriting what they
 * published. The product answer is a subname whose owner is *their* address.
 *
 * `register` on the UserRegistry is permissioned, and the key that holds the
 * permission today is the owner key — the one that controls nextkey.eth itself.
 * That key can never be in a browser: it could move names, grant anything to
 * anybody, and touch every record under the parent. So this script prepares the
 * middle way.
 *
 *   ROLE_REGISTRAR (bit 0) as a root role lets an account call register(),
 *   and nothing else. Granted WITHOUT its admin bit, the holder cannot pass it
 *   on, cannot revoke it, and cannot take a name that already exists.
 *
 * What such a key can do if it leaks: mint junk subnames under nextkey.eth and
 * burn testnet gas. What it cannot do: transfer a name, change roles, or write
 * a record on a name somebody already holds. That is a bigger blast radius than
 * the published demo key, which reaches one resolver — so it is disclosed the
 * same way, in the same words, rather than hoped about.
 *
 *   node --env-file=.env scripts/name-registrar.mjs new
 *   node --env-file=.env scripts/name-registrar.mjs grant 0xTheNewAddress
 *   node --env-file=.env scripts/name-registrar.mjs check 0xTheNewAddress
 *   node --env-file=.env scripts/name-registrar.mjs register <label> 0xOwner
 *   node --env-file=.env scripts/name-registrar.mjs revoke 0xTheNewAddress
 *
 * The role itself carries no quota: it is one bit, and a limit written into the
 * page would only bind the people who use the page. Grant it to a *key* and the
 * only limits are that key's balance and the revoke below.
 *
 * Which is why the grantee is now a contract rather than a key —
 * contracts/NextKeyNames.sol, which holds the role and enforces one name per
 * address, a hard cap and a deny list where the chain can see them. `grant`
 * does not care which it is given; the difference is entirely in what the
 * grantee will refuse to do.
 *
 * `new` prints a key and signs nothing. `grant` needs the owner key in
 * REGISTRAR_PRIVATE_KEY and is the one transaction only the owner can make.
 * `register` is meant to be run with the new key, to prove the role works from
 * the outside before a single line of it reaches the page.
 */
import { createPublicClient, createWalletClient, http, keccak256, toBytes, zeroAddress } from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const NEXTKEY_REGISTRY = process.env.NEXTKEY_REGISTRY
  ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const POOL_RESOLVER = process.env.POOL_RESOLVER
  ?? '0x04B2DB6567Cc68d059c061215Adf9a99adD1cA65'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'

// ─── Roles ─────────────────────────────────────────────────────────────────
// One nybble each; the admin of a role sits 128 bits higher. The *root* role is
// the one that applies to every name in the registry, which is exactly what
// "may register" has to mean and exactly why nothing else is granted with it.
// It is not resource 0 passed to the ordinary functions — see the ABI below.
const ROLE_REGISTRAR = 1n << 0n
const ROLE_SET_SUBREGISTRY = 1n << 20n
const ROLE_SET_RESOLVER = 1n << 24n
const admin = (role) => role << 128n

/**
 * What the visitor gets on their own name. The same bitmap a stored secret
 * gets: they may point it at another registry and at another resolver, and may
 * pass both of those rights on. No ROLE_REGISTRAR — a leaf does not mint
 * children — and no role that would let them touch anything else in the
 * registry.
 */
const OWNER_ROLES =
  ROLE_SET_SUBREGISTRY | admin(ROLE_SET_SUBREGISTRY) |
  ROLE_SET_RESOLVER | admin(ROLE_SET_RESOLVER)

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
  // EnhancedAccessControl. The resource is a uint256, not a bytes32 — the docs
  // are explicit about it, and a bytes32 here would encode to a call the
  // contract does not have.
  //
  // Root roles have their own entry points, and passing 0 to the general ones
  // does not work: grantRoles(0, …) reverts with EACRootResourceNotAllowed().
  // That is deliberate in EnhancedAccessControl — a role on the root resource
  // applies to every name in the registry, so granting one is a different act
  // from granting a role on a single name and is spelled differently.
  // Confirmed against the deployed contract with scripts/probe-roles.mjs;
  // reading with hasRoles(0, …) is allowed, only writing is not.
  { name: 'grantRootRoles', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [] },
  { name: 'revokeRootRoles', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [] },
  { name: 'hasRootRoles', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'roleBitmap', type: 'uint256' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ type: 'bool' }] },
  // grantRoles / revokeRoles / hasRoles — the per-name versions — exist on the
  // contract but are deliberately absent here. Nothing in this script wants a
  // role on a single name, and an ABI that offers both invites picking the one
  // whose failure mode is a bare selector.
  { name: 'findOwner', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { name: 'findExpiry', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'uint64' }] },
  { name: 'getResolver', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
]

const reader = createPublicClient({ chain: sepolia, transport: http(RPC) })
const pk = process.env.REGISTRAR_PRIVATE_KEY
const writer = pk
  ? createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) })
  : undefined

const [command, ...rest] = process.argv.slice(2)

const usage = () => {
  console.error(`
Usage:
  name-registrar.mjs new                       make a key; signs nothing
  name-registrar.mjs grant <address>           owner grants ROLE_REGISTRAR
  name-registrar.mjs check <address>           does it hold the role?
  name-registrar.mjs register <label> <owner>  mint one subname
  name-registrar.mjs revoke <address>          take the role back
`)
  process.exit(1)
}

console.log(`\nNextKey name registrar`)
console.log('─'.repeat(72))
console.log(`  registry    ${NEXTKEY_REGISTRY}`)
console.log(`  signing as  ${writer ? writer.account.address : '— nothing configured, read only'}`)

if (command === 'new') {
  // Printed, never written to disk. The place it belongs is web/src/demo-wallet.js,
  // beside the other published key and its reasoning — pasting it there is a
  // decision, and a decision should not be a side effect of running a script.
  const key = generatePrivateKey()
  const account = privateKeyToAccount(key)
  const b64 = Buffer.from(key.slice(2), 'hex').toString('base64')
  console.log(`\n  address     ${account.address}`)
  console.log(`  key (b64)   ${b64}`)
  console.log(`
  Two steps, in this order:

    1  node --env-file=.env scripts/name-registrar.mjs grant ${account.address}
    2  paste into web/src/demo-wallet.js:

         export const REGISTRAR_KEY = '${b64}'
         export const REGISTRAR_ADDRESS = '${account.address}'

  Base64 rather than 0x-hex for the same reason as the demo key: a secret
  scanner that cries wolf over a key published on purpose is a scanner people
  stop reading. It is not concealment — this line says what it is.

  Fund it with a little Sepolia ether, or it can register nothing.\n`)
}

else if (command === 'grant') {
  const [account] = rest
  if (!account) usage()
  if (!writer) {
    console.log(`\n  REGISTRAR_PRIVATE_KEY is not set, so nothing can be signed.`)
    console.log(`  This is the one transaction only the owner of the registry can make.\n`)
    process.exit(1)
  }

  const before = await reader.readContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'hasRootRoles',
    args: [ROLE_REGISTRAR, account] })
  console.log(`\n  grantee     ${account}`)
  console.log(`  role        ROLE_REGISTRAR (bit 0), as a root role`)
  console.log(`  admin bit   not granted — it cannot pass the role on or revoke it`)
  console.log(`  holds it    ${before ? 'already, nothing to do' : 'no'}`)
  if (before) { console.log(); process.exit(0) }

  // Simulated first. A revert here is the answer to "does the owner actually
  // hold the admin of this role", and it costs nothing to ask.
  await reader.simulateContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'grantRootRoles',
    args: [ROLE_REGISTRAR, account], account: writer.account.address })

  const hash = await writer.writeContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'grantRootRoles',
    args: [ROLE_REGISTRAR, account], chain: sepolia })
  console.log(`  tx          ${hash}`)
  await reader.waitForTransactionReceipt({ hash })

  const after = await reader.readContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'hasRootRoles',
    args: [ROLE_REGISTRAR, account] })
  console.log(`  confirmed   ${after ? 'yes — it may now register, and only register' : '✗ still not held'}\n`)
  if (!after) process.exitCode = 1
}

else if (command === 'revoke') {
  // The brake. It belongs beside the grant, because a tool that hands out a
  // role and cannot take it back is half a tool — and because the honest answer
  // to "how do you limit this key" is: its balance, and this.
  const [account] = rest
  if (!account) usage()
  if (!writer) {
    console.log(`\n  REGISTRAR_PRIVATE_KEY is not set. Only the owner can revoke.\n`)
    process.exit(1)
  }

  console.log(`\n  revoking    ROLE_REGISTRAR, the root role`)
  console.log(`  from        ${account}`)
  await reader.simulateContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'revokeRootRoles',
    args: [ROLE_REGISTRAR, account], account: writer.account.address })

  const hash = await writer.writeContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'revokeRootRoles',
    args: [ROLE_REGISTRAR, account], chain: sepolia })
  console.log(`  tx          ${hash}`)
  await reader.waitForTransactionReceipt({ hash })

  const still = await reader.readContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'hasRootRoles',
    args: [ROLE_REGISTRAR, account] })
  console.log(`  result      ${still ? '✗ it still holds the role' : 'gone — it can register nothing further'}`)
  console.log(`
  Names it already handed out are unaffected. They belong to whoever received
  them, and taking this role back never reached into a name.\n`)
  if (still) process.exitCode = 1
}

else if (command === 'check') {
  const [account] = rest
  if (!account) usage()
  const ask = (bitmap) => reader.readContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'hasRootRoles',
    args: [bitmap, account] })
  const [canRegister, canGrant] = await Promise.all([ask(ROLE_REGISTRAR), ask(admin(ROLE_REGISTRAR))])
  console.log(`\n  account     ${account}`)
  console.log(`  may register        ${canRegister ? 'yes' : 'no'}`)
  console.log(`  may grant the role  ${canGrant ? '✗ YES — that is more than it should have' : 'no, as intended'}`)
  // What limits this grantee is not the same question for a key and for a
  // contract, and printing one answer for both was wrong: a contract pays no
  // gas — its callers do — so its balance says nothing at all about how many
  // names it can mint. Ask what the account *is* before saying what bounds it.
  const [balance, code] = await Promise.all([
    reader.getBalance({ address: account }),
    reader.getCode({ address: account }),
  ])
  const isContract = Boolean(code && code !== '0x')
  console.log(`  account type        ${isContract ? 'a contract — its own code is the limit' : 'a plain key — nothing limits it but its balance'}`)
  console.log(`  balance             ${Number(balance) / 1e18} ETH${isContract ? '' : ' — this is the cap on how many names it can ever mint'}`)
  if (isContract) console.log(`
  A contract pays no gas of its own, so read its cap, minted and denied list
  instead:  node --env-file=.env scripts/deploy-names.mjs show ${account}`)
  console.log()
  if (canGrant) process.exitCode = 1
}

else if (command === 'register') {
  const [label, owner] = rest
  if (!label || !owner) usage()
  if (!writer) {
    console.log(`\n  Nothing configured to sign with. Put the registrar key in`)
    console.log(`  REGISTRAR_PRIVATE_KEY and run this again.\n`)
    process.exit(1)
  }

  const taken = await reader.readContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'findOwner', args: [label] })
  console.log(`\n  label       ${label}.nextkey.eth`)
  console.log(`  labelhash   ${keccak256(toBytes(label))}`)
  console.log(`  owner now   ${taken === zeroAddress ? '— free' : taken}`)
  if (taken !== zeroAddress) {
    console.log(`\n  Taken. A registrar cannot take a name somebody already holds,`)
    console.log(`  which is the property that makes the role safe to hand out.\n`)
    process.exit(1)
  }

  const expiry = BigInt(Math.floor(Date.now() / 1000)) + ONE_YEAR
  console.log(`  new owner   ${owner}`)
  console.log(`  resolver    ${POOL_RESOLVER}`)
  console.log(`  roles       SET_SUBREGISTRY + admin, SET_RESOLVER + admin`)
  console.log(`  expiry      ${expiry}  (${new Date(Number(expiry) * 1000).toISOString().slice(0, 10)})`)

  const args = [label, owner, zeroAddress, POOL_RESOLVER, OWNER_ROLES, expiry]
  await reader.simulateContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'register',
    args, account: writer.account.address })

  const hash = await writer.writeContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'register', args, chain: sepolia })
  console.log(`  tx          ${hash}`)
  await reader.waitForTransactionReceipt({ hash })

  const [nowOwner, nowResolver] = await Promise.all([
    reader.readContract({ address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'findOwner', args: [label] }),
    reader.readContract({ address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label] }),
  ])
  console.log(`\n  owner       ${nowOwner}`)
  console.log(`  resolver    ${nowResolver}`)
  console.log(`  ${nowOwner.toLowerCase() === owner.toLowerCase()
    ? 'It is theirs. The registrar cannot take it back.'
    : '✗ The owner is not who was asked for.'}\n`)
  if (nowOwner.toLowerCase() !== owner.toLowerCase()) process.exitCode = 1
}

else usage()
