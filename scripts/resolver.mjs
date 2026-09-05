/**
 * The Permissioned Resolver — where NextKey's sharing model actually lives.
 *
 * A subname is the secret; the resolver is what the secret *says*. ENSv2 gives
 * each name its own resolver proxy with per-name setter roles — so who may
 * change a record is protocol state rather than a row we ask people to trust
 * us with.
 *
 * What it is not: read control. Everything on a public chain is publicly
 * readable, and no resolver changes that. See the note on resolverAbi below —
 * it corrects an assumption we carried for a while.
 *
 *   node --env-file=.env scripts/resolver.mjs deploy
 *   node --env-file=.env scripts/resolver.mjs attach       visa 0xResolver
 *   node --env-file=.env scripts/resolver.mjs set-text     visa nextkey.notify <value>
 *   node --env-file=.env scripts/resolver.mjs grant-setter agent 0xAgent nextkey.request
 *   node          scripts/resolver.mjs show-roles      agent 0xAgent
 *   node          scripts/resolver.mjs read-text     visa nextkey.notify
 */

import {
  createPublicClient, createWalletClient, http,
  keccak256, toBytes, toHex, stringToHex, namehash,
  encodeAbiParameters, encodeFunctionData, parseAbiItem, zeroAddress,
} from 'viem'
import { packetToBytes } from 'viem/ens'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { ENSV2_SEPOLIA, ENSV2_SEPOLIA as D } from './deployment.mjs'

const PARENT = 'nextkey.eth'
const NEXTKEY_REGISTRY = process.env.NEXTKEY_REGISTRY
  ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const OWNER = process.env.REGISTRAR_OWNER ?? '0x9780aFE81EF5b58333c83e05d5C07797BD81dd0B'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111n

const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC) })
const pk = process.env.REGISTRAR_PRIVATE_KEY
const walletClient = pk
  ? createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) })
  : undefined

// ─── ABIs ──────────────────────────────────────────────────────────────────
const factoryAbi = [
  { name: 'deployProxy', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'implementation', type: 'address' },
      { name: 'salt', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: 'proxy', type: 'address' }] },
]

/**
 * Recovered by decoding a working deployment (scripts/inspect-deploy-tx.mjs),
 * not from the docs — selector 0x33cc44a0. Two parameters: role assignments,
 * and a bytes[] of optional initial calls, which we leave empty and do
 * afterwards one at a time.
 */
const resolverInitAbi = [
  { name: 'initialize', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'assignments', type: 'tuple[]', components: [
        { name: 'account', type: 'address' },
        { name: 'roleBitmap', type: 'uint256' },
      ] },
      { name: 'calls', type: 'bytes[]' },
    ],
    outputs: [] },
]

/**
 * The registry's real interface, read off the deployed bytecode with
 * scripts/probe-abi.mjs. Two corrections to the documentation:
 *
 *   getResolver / getSubregistry take the label as a *string*, not bytes32.
 *   Calling the bytes32 form reverts with empty data, because that function
 *   does not exist.
 *
 *   findTokenId(string) exists and is the right way to obtain a token id.
 *   Token ids are mutable — they change when roles change — so deriving one
 *   from the labelhash and caching it is a bug waiting to happen. Ask the
 *   registry instead.
 */
const registryAbi = [
  { name: 'setResolver', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'anyId', type: 'uint256' }, { name: 'resolver', type: 'address' }],
    outputs: [] },
  { name: 'getResolver', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { name: 'findTokenId', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'uint256' }] },
]

/**
 * The Permissioned Resolver's real interface, read off the bytecode with
 * scripts/probe-abi.mjs. Two things differ from a classic ENS resolver, and
 * both matter.
 *
 * First, setters take the DNS-encoded *name* as bytes rather than a namehash.
 * `\x04visa\x07nextkey\x03eth\x00`, not keccak. The namehash form does not
 * exist and reverts with empty data.
 *
 * Second — and this is a correction to how we described the product — there is
 * no read permission to grant. `grantSetterRoles(bytes name, address)` governs
 * who may *write* a record. Everything stored on chain is publicly readable;
 * no resolver can change that.
 *
 * So NextKey's confidentiality does not come from ENS and never could. The
 * record holds ciphertext; who can decrypt it is decided by key wrapping to the
 * recipient's X25519 public key. What ENS enforces is control: who may update
 * the pointer, who may revoke, who may delegate to the agent — and expiry ends
 * resolution outright. Confidentiality by cryptography, control by protocol
 * roles. Claiming a public chain keeps secrets would be false, and an ENS judge
 * would see through it immediately.
 */
const resolverAbi = [
  { name: 'setText', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'bytes' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'string' },
    ],
    outputs: [] },
  { name: 'grantSetterRoles', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'setterCall', type: 'bytes' }, { name: 'account', type: 'address' }],
    outputs: [] },
]

/**
 * Role state, recovered from the implementation's bytecode with probe-abi.mjs.
 * Two things the documentation does not say: the resource is a `uint256`
 * record id rather than a namehash, and `getRecordId(bytes32 node)` is how you
 * obtain it.
 */
const rolesAbi = [
  { name: 'getRecordId', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { name: 'roles', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'resource', type: 'uint256' }, { name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
  { name: 'hasRoles', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'resource', type: 'uint256' }, { name: 'roleBitmap', type: 'uint256' },
             { name: 'account', type: 'address' }],
    outputs: [{ type: 'bool' }] },
  { name: 'ROOT_RESOURCE', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }] },
]

const send = async ({ to, abi, functionName, args }) => {
  if (!walletClient) {
    const inputs = abi.find((f) => f.name === functionName).inputs
    console.log(`\n  Execute yourself — ${to} · ${functionName}`)
    args.forEach((a, i) => console.log(`    ${i + 1}. ${inputs[i].name.padEnd(12)} ${a}`))
    console.log()
    return
  }
  const hash = await walletClient.writeContract({ address: to, abi, functionName, args })
  console.log(`  → sent ${hash}`)
  const r = await publicClient.waitForTransactionReceipt({ hash })
  console.log(`  → ${r.status}`)
  return r
}

const [command, label, a, b] = process.argv.slice(2)
console.log(`\nNextKey resolver`)
console.log('─'.repeat(72))
console.log(`  mode        ${walletClient ? 'signing' : 'print-only'}`)

if (command === 'deploy') {
  // Our own salt scheme, so the resolver cannot collide with the registry.
  // Deterministic, so the address stays recomputable; bump the version if a
  // redeploy is ever needed.
  const salt = BigInt(keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
    [keccak256(stringToHex('NextKeyResolver')), namehash(PARENT), 0n],
  )))
  const initData = encodeFunctionData({
    abi: resolverInitAbi,
    functionName: 'initialize',
    args: [[{ account: OWNER, roleBitmap: ALL_ROLES }], []],
  })
  console.log(`  impl        ${ENSV2_SEPOLIA.permissionedResolverImpl}`)
  console.log(`  salt        ${salt}`)
  await send({
    to: ENSV2_SEPOLIA.verifiableFactory, abi: factoryAbi, functionName: 'deployProxy',
    args: [ENSV2_SEPOLIA.permissionedResolverImpl, salt, initData],
  })
  const latest = await publicClient.getBlockNumber()
  const logs = await publicClient.getLogs({
    address: ENSV2_SEPOLIA.verifiableFactory,
    event: parseAbiItem('event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)'),
    args: { sender: OWNER },
    fromBlock: latest - 50n, toBlock: latest,
  })
  const ours = logs.find((l) => l.args.salt === salt)
  if (ours) console.log(`\n  resolver    ${ours.args.proxyAddress}\n`)
}

else if (command === 'attach') {
  const resolver = a
  // Ask the registry for the current token id rather than deriving it.
  const labelId = await publicClient.readContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'findTokenId', args: [label],
  })
  console.log(`  subname     ${label}.${PARENT}`)
  console.log(`  tokenId     ${labelId}`)
  console.log(`  resolver    ${resolver}`)
  await send({
    to: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'setResolver',
    args: [labelId, resolver],
  })
}

else if (command === 'set-text') {
  const key = a
  const fqdn = `${label}.${PARENT}`
  const dnsName = toHex(packetToBytes(fqdn))
  const resolver = await publicClient.readContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label],
  })
  if (resolver === zeroAddress) {
    console.error(`\n  \u2717 ${fqdn} has no resolver yet \u2014 run attach first\n`)
    process.exit(1)
  }
  console.log(`  name        ${fqdn}`)
  console.log(`  dns-encoded ${dnsName}`)
  console.log(`  resolver    ${resolver}`)
  console.log(`  key         ${key}`)
  await send({ to: resolver, abi: resolverAbi, functionName: 'setText', args: [dnsName, key, b] })
}

else if (command === 'grant-setter') {
  /**
   * Delegate write access to another account — the release agent, for instance.
   * Note what this is not: it is not read access. There is no such thing on a
   * public chain.
   *
   * The first argument is NOT the name, though its type (`bytes`) and its name
   * in the ABI (`name`) both suggest it is. Passing the DNS-encoded name
   * reverts with `UnsupportedResolverProfile(0x05616765)` — and those four
   * bytes are the first four bytes of that very name, read as a function
   * selector. The parameter is the *calldata of the setter being authorized*:
   * the resolver runs `decodeSetter` on it, takes the profile from the
   * selector and the name from the arguments, and grants the role for that
   * pairing.
   *
   * Which makes the permission finer than we assumed. It is not "may write to
   * this name" but "may call this setter on this name" — so the agent can be
   * given `setText` and nothing else, on one name and no other.
   *
   * The value passed here is irrelevant to the grant; only selector and name
   * are read out. We send an empty string to make that obvious.
   *
   *   resolver.mjs grant-setter <label> <account> [key]
   */
  const account = a
  const key = b ?? 'nextkey.request'
  const fqdn = `${label}.${PARENT}`
  const dnsName = toHex(packetToBytes(fqdn))
  const resolver = await publicClient.readContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label],
  })

  const setterCall = encodeFunctionData({
    abi: resolverAbi, functionName: 'setText', args: [dnsName, key, ''],
  })

  console.log(`  name        ${fqdn}`)
  console.log(`  grantee     ${account}`)
  console.log(`  authorizes  setText(${key}) — selector ${setterCall.slice(0, 10)}`)
  console.log(`  calldata    ${setterCall.slice(0, 42)}…`)
  await send({ to: resolver, abi: resolverAbi, functionName: 'grantSetterRoles', args: [setterCall, account] })
}

else if (command === 'show-roles') {
  /**
   * Read the role bitmap an account holds on one name, straight from the
   * resolver. A claim like "the agent holds exactly one permission" should be
   * checkable rather than believed, and this is where it is checked.
   *
   * Roles are addressed by a numeric resource id. It is not the namehash, and
   * `getRecordId(namehash)` answers 0 — the derivation is internal and
   * undocumented, so guessing it is a waste of an evening.
   *
   * We do not have to guess. The resolver states the resource itself whenever
   * it refuses a call: its authorization error carries (resource, required
   * role, account). So we ask it to refuse one on purpose — a simulated
   * `setText` from the zero address, which holds nothing anywhere — and read
   * the resource out of the refusal. No transaction, no gas, and it stays
   * correct if ENS changes the derivation tomorrow.
   *
   * Roles occupy nybbles; a role's admin sits at `role << 128`, so an account
   * that may use a permission but not pass it on shows bits in the low half
   * only.
   *
   *   resolver.mjs show-roles <label> <account> [key]
   */
  const account = a
  const key = b ?? 'nextkey.request'
  const fqdn = `${label}.${PARENT}`
  const dnsName = toHex(packetToBytes(fqdn))
  const resolver = await publicClient.readContract({
    address: NEXTKEY_REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label],
  })

  /** Walk the error chain for the raw revert payload viem could not decode. */
  const rawRevert = (e) => {
    for (let cur = e, i = 0; cur && i < 12; cur = cur.cause, i++) {
      const v = cur.raw ?? cur.data
      if (typeof v === 'string' && v.startsWith('0x') && v.length >= 202) return v
    }
  }

  let resource, required
  try {
    await publicClient.simulateContract({
      address: resolver, abi: resolverAbi, functionName: 'setText',
      args: [dnsName, key, ''], account: zeroAddress,
    })
    console.log(`  The zero address was allowed to write. That is not a role model.\n`)
    process.exit(1)
  } catch (e) {
    const raw = rawRevert(e)
    if (!raw) {
      console.log(`  could not read the resource out of the refusal:`)
      console.log(`  ${e.shortMessage ?? e.message.split('\n')[0]}\n`)
      process.exit(1)
    }
    resource = BigInt('0x' + raw.slice(10, 74))
    required = BigInt('0x' + raw.slice(74, 138))
  }

  const bitmap = await publicClient.readContract({
    address: resolver, abi: rolesAbi, functionName: 'roles', args: [resource, account] })

  // Per-resource roles are only half the picture, and reporting them alone is
  // misleading: the name's owner shows 0x0 here and can nevertheless write,
  // because authority also descends from a root resource. An account with root
  // roles rules every name; an account with one resource role rules one node.
  // That difference is the delegation model, so both halves get printed.
  let rootBitmap = null
  try {
    const root = await publicClient.readContract({
      address: resolver, abi: rolesAbi, functionName: 'ROOT_RESOURCE' })
    rootBitmap = await publicClient.readContract({
      address: resolver, abi: rolesAbi, functionName: 'roles', args: [root, account] })
  } catch { /* left null and reported as unread rather than as zero */ }

  const split = (bm) => {
    const bits = []
    for (let i = 0n; i < 256n; i++) if ((bm >> i) & 1n) bits.push(Number(i))
    return { use: bits.filter((n) => n < 128), admin: bits.filter((n) => n >= 128).map((n) => n - 128) }
  }
  const here = split(bitmap)
  const root = rootBitmap === null ? null : split(rootBitmap)
  const effective = rootBitmap === null ? bitmap : bitmap | rootBitmap

  console.log(`  name        ${fqdn}`)
  console.log(`  setter      setText(${key})`)
  console.log(`  resource    0x${resource.toString(16)}   (from the contract's own refusal)`)
  console.log(`  requires    0x${required.toString(16)}`)
  console.log(`  account     ${account}`)
  console.log(`  ${'─'.repeat(70)}`)
  console.log(`  on this name   0x${bitmap.toString(16)}`)
  console.log(`    may use      ${here.use.length ? here.use.join(', ') : '— none'}`)
  console.log(`    admin over   ${here.admin.length ? here.admin.join(', ') : '— none, cannot delegate onward'}`)
  if (root) {
    console.log(`  at the root    0x${rootBitmap.toString(16)}`)
    console.log(`    may use      ${root.use.length ? root.use.join(', ') : '— none'}`)
    console.log(`    admin over   ${root.admin.length ? root.admin.join(', ') : '— none'}`)
  } else {
    console.log(`  at the root    — could not read ROOT_RESOURCE`)
  }
  console.log(`  ${'─'.repeat(70)}`)
  console.log(`  may write   ${(effective & required) === required ? 'YES' : 'no'}`)
  console.log(`  authority   ${
    (bitmap & required) === required && rootBitmap && (rootBitmap & required) === required
      ? 'both — root and this name'
      : (bitmap & required) === required ? 'this name only — scoped, cannot reach any other'
      : rootBitmap && (rootBitmap & required) === required ? 'inherited from the root — reaches every name'
      : 'none'}`)
  console.log()
}

else if (command === 'read-text') {
  // Read through the Universal Resolver rather than the resolver directly.
  // That is how a real client resolves, so it proves the whole chain works:
  // .eth registry \u2192 our subregistry \u2192 the subname's resolver.
  const key = a
  const fqdn = `${label}.${PARENT}`
  const hackathonSepolia = {
    ...sepolia,
    contracts: { ...sepolia.contracts, ensUniversalResolver: { address: D.upgradableUniversalResolverProxy } },
  }
  const resolving = createPublicClient({ chain: hackathonSepolia, transport: http(RPC) })
  console.log(`  name        ${fqdn}`)
  console.log(`  via         Universal Resolver ${D.upgradableUniversalResolverProxy}`)
  console.log(`  key         ${key}`)
  try {
    const value = await resolving.getEnsText({ name: fqdn, key })
    console.log(`  value       ${value === null || value === '' ? '\u2014 empty' : value}\n`)
  } catch (err) {
    console.log(`  value       \u2717 ${err.shortMessage ?? err.message}\n`)
  }
}

else {
  console.error(`\n  Usage: resolver.mjs <deploy|attach|set-text|grant-setter|read-text> [label] [arg] [value]\n`)
  process.exit(1)
}
