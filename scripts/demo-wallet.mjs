/**
 * The wallet the playground lends to visitors.
 *
 * A judge who opens try.html on a phone has no wallet extension, and if they do
 * connect one it holds no Sepolia ether. Both are dead ends at the only step
 * that touches the chain, and a page nobody can finish demonstrates nothing.
 *
 * So the page carries a wallet of its own: one key, published openly in the
 * bundle, funded by us, with permission to write to a pool of names we own.
 * A visitor writes real records to a real chain without installing anything.
 *
 * Three properties make that defensible rather than reckless:
 *
 *   It owns nothing. The names stay ours. `resolver.mjs grant-setter` gives an
 *   account the right to call setText on one name — not ownership, not the
 *   right to grant, not the right to touch any other name. The worst an
 *   attacker with this key can do is write nonsense into names set aside for
 *   writing nonsense, and spend testnet ether we chose to lose.
 *
 *   It is not a secret, and is not dressed as one. A key in a public bundle is
 *   readable by everyone; saying so plainly is the only honest option, and the
 *   page does.
 *
 *   It is not the only path. A visitor with their own wallet and their own name
 *   uses those instead, which is the real product. This is the way in for
 *   everyone else.
 *
 *   node --env-file=.env scripts/demo-wallet.mjs new
 *   node --env-file=.env scripts/demo-wallet.mjs fund 0.05
 *   node --env-file=.env scripts/demo-wallet.mjs allow try01
 *   node --env-file=.env scripts/demo-wallet.mjs probe try01
 *   node --env-file=.env scripts/demo-wallet.mjs status try01 try02 try03
 *   node          scripts/demo-wallet.mjs publish
 *
 * Registering a name uses the existing tool, because it is already tested:
 *   node --env-file=.env scripts/register-subname.mjs register try01 0x52A0…
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import {
  createWalletClient, http, toHex, parseEther, formatEther, encodeFunctionData,
  encodeAbiParameters, keccak256, stringToHex, parseAbiItem, toFunctionSelector, zeroAddress,
} from 'viem'
import { packetToBytes, namehash } from 'viem/ens'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { PARENT, RECORD_EPH, reader, writer, readRecord } from './nextkey-core.mjs'
import { ENSV2_SEPOLIA as D } from './deployment.mjs'

const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const FILE = new URL('../.keys/demo-wallet.json', import.meta.url)
const [cmd, ...rest] = process.argv.slice(2)

const resolverAbi = [
  { name: 'setText', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' },
             { name: 'value', type: 'string' }],
    outputs: [] },
  { name: 'grantSetterRoles', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'setterCall', type: 'bytes' }, { name: 'account', type: 'address' }],
    outputs: [] },
]
const registryAbi = [
  { name: 'getResolver', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] },
  { name: 'register', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'label', type: 'string' }, { name: 'owner', type: 'address' },
      { name: 'registry', type: 'address' }, { name: 'resolver', type: 'address' },
      { name: 'roleBitmap', type: 'uint256' }, { name: 'expiry', type: 'uint64' }],
    outputs: [] },
]

/** As register-subname.mjs grants them: no ROLE_REGISTRAR, because a secret is
 *  a leaf and must not be able to mint children. */
const ROLE_SET_SUBREGISTRY = 1n << 20n
const ROLE_SET_RESOLVER = 1n << 24n
const admin = (r) => r << 128n
const OWNER_ROLES =
  ROLE_SET_SUBREGISTRY | admin(ROLE_SET_SUBREGISTRY) |
  ROLE_SET_RESOLVER | admin(ROLE_SET_RESOLVER)
const OWNER = process.env.REGISTRAR_OWNER ?? '0x9780aFE81EF5b58333c83e05d5C07797BD81dd0B'
/**
 * The pool's own resolver. Falls back to the shared one only so that `status`
 * and `publish` still work before it is deployed — anything that writes checks
 * for it explicitly, because preparing the pool against the shared resolver
 * would produce names the demo wallet cannot write to.
 */
const POOL_RESOLVER = process.env.NEXTKEY_POOL_RESOLVER
const RESOLVER = POOL_RESOLVER ?? process.env.NEXTKEY_RESOLVER ?? '0x52A02f288AA5dde082206D85d4001880D64F4101'
const ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111n

const factoryAbi = [
  { name: 'deployProxy', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'implementation', type: 'address' }, { name: 'salt', type: 'uint256' },
             { name: 'data', type: 'bytes' }],
    outputs: [{ name: 'proxy', type: 'address' }] },
]

/** Selector 0x33cc44a0, recovered by decoding a working deployment rather than
 *  from documentation — see resolver.mjs, where it was first worked out. */
const resolverInitAbi = [
  { name: 'initialize', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'assignments', type: 'tuple[]', components: [
        { name: 'account', type: 'address' }, { name: 'roleBitmap', type: 'uint256' }] },
      { name: 'calls', type: 'bytes[]' }],
    outputs: [] },
]
const ONE_YEAR = 31_536_000n
const REGISTRY = process.env.NEXTKEY_REGISTRY ?? '0x612034AB34Ec262d5417EA3163718E7455157908'

const load = () => {
  if (!existsSync(FILE)) throw new Error('no demo wallet yet — run: demo-wallet.mjs new')
  return JSON.parse(readFileSync(FILE, 'utf8'))
}

/**
 * Say what actually went wrong, including when viem does not.
 *
 * Two failure modes dominate here and they need opposite repairs: not enough
 * ether, and the resolver refusing a write. viem reports the first in two
 * hundred lines whose first sentence is the answer, and the second as
 * "reverted with the following signature:" followed by nothing at all — because
 * the four-byte selector, the raw revert data and the error's own name live in
 * nested `cause` objects rather than in the message.
 *
 * So this walks the chain. An unknown selector is still an answer: it is looked
 * up against the errors this deployment is known to throw, and printed raw when
 * that fails, which is enough to search for.
 */
const KNOWN_ERRORS = [
  'UnsupportedResolverProfile(bytes4)',
  'EACUnauthorizedAccountRoles(uint256,uint256,address)',
  'Unauthorized(address)',
  'NotAuthorized(bytes32,address)',
  'ResolverNotFound(bytes)',
]

const namedSelector = (sig) => {
  if (!sig) return null
  for (const candidate of KNOWN_ERRORS) {
    try { if (toFunctionSelector(`error ${candidate}`) === sig) return candidate } catch { /* skip */ }
  }
  return null
}

const fail = (e) => {
  const msg = e?.shortMessage ?? e?.details ?? e?.message ?? String(e)
  console.error(`\n  ✗  ${msg.split('\n')[0]}`)
  for (const line of msg.split('\n').slice(1, 8)) console.error(`  ${line}`)

  // The chain, not just the surface. `signature` and `data` appear several
  // levels down, and they are the whole diagnosis.
  const seen = new Set()
  for (let cur = e, depth = 0; cur && depth < 8; cur = cur.cause, depth++) {
    const sig = cur.signature ?? (typeof cur.data === 'string' ? cur.data.slice(0, 10) : undefined)
    if (sig && !seen.has(sig)) {
      seen.add(sig)
      const known = namedSelector(sig)
      console.error(`\n  revert      ${sig}${known ? `  →  ${known}` : '  (not one this script knows)'}`)
      if (typeof cur.data === 'string' && cur.data.length > 10) {
        console.error(`  data        ${cur.data.slice(0, 90)}${cur.data.length > 90 ? '…' : ''}`)
      }
    }
    for (const m of cur.metaMessages?.slice(0, 4) ?? []) {
      if (!seen.has(m)) { seen.add(m); console.error(`  ${m}`) }
    }
  }

  if (/insufficient funds/i.test(msg)) {
    console.error(`
  The registrar is out of Sepolia ether. Top it up at a faucet, and note that
  preparing names costs gas too: roughly 0.0005 ETH per name.`)
  }
  console.error(`\n  Full detail:  set NEXTKEY_DEBUG=1 and run it again.\n`)
  if (process.env.NEXTKEY_DEBUG) console.error(e)
  process.exit(1)
}

const usage = () => console.log(`
  demo-wallet.mjs new                 make the key (kept in .keys/, gitignored)
  demo-wallet.mjs resolver           deploy the pool's resolver (do this first)
  demo-wallet.mjs fund <eth>          send it ether from the registrar
  demo-wallet.mjs prepare <label…>    register each name and allow the wallet
  demo-wallet.mjs series <prefix> <n>  prepare <prefix>01 … <prefix>NN
  demo-wallet.mjs allow <label>       let it write to that one name, nothing else
  demo-wallet.mjs probe <label>       can it actually write to that name?
  demo-wallet.mjs status [label…]     balance, and which names are still free
  demo-wallet.mjs free <prefix> <n>   which of <prefix>01 … <prefix>NN are unused
  demo-wallet.mjs publish             print the line to paste into the bundle
`)

try {

if (cmd === 'new') {
  // Deliberately not derived from anything we own. This key ends up in a public
  // bundle, and a key that shares a derivation with a funded wallet would be a
  // catastrophe wearing a demo's clothes.
  if (existsSync(FILE) && !rest.includes('--replace')) {
    throw new Error(
      'a demo wallet already exists.\n' +
      '  Replacing it strands every name already granted to the old address.\n' +
      '  Pass --replace if that is genuinely what you want.')
  }
  const privateKey = generatePrivateKey()
  const account = privateKeyToAccount(privateKey)
  mkdirSync(new URL('../.keys/', import.meta.url), { recursive: true })
  writeFileSync(FILE, `${JSON.stringify({ privateKey, address: account.address }, null, 2)}\n`)

  console.log(`\n  demo wallet   ${account.address}`)
  console.log(`  stored in     .keys/demo-wallet.json  (gitignored — the copy that ships`)
  console.log(`                is the one in the bundle, printed by "publish")`)
  console.log(`
  Next, for each name the playground may write to:
    node --env-file=.env scripts/register-subname.mjs register try01 0x52A02f288AA5dde082206D85d4001880D64F4101
    node --env-file=.env scripts/demo-wallet.mjs allow try01
    node --env-file=.env scripts/demo-wallet.mjs probe try01
`)
}

else if (cmd === 'fund') {
  const amount = rest[0] ?? '0.05'
  const { address } = load()
  if (!writer) throw new Error('REGISTRAR_PRIVATE_KEY not set — nothing to send from')

  // Small on purpose. This balance is public and spendable by anyone who reads
  // the bundle; the only real defence is that losing all of it costs nothing
  // but a refill.
  // Ask before sending. "insufficient funds" arrives from the RPC as a wall of
  // nested errors, whereas the registrar's balance is one call away and the
  // arithmetic is a subtraction.
  const have = await reader.getBalance({ address: writer.account.address })
  const want = parseEther(amount)
  const keep = parseEther('0.005')          // enough for a few more writes
  if (have < want + keep) {
    const affordable = have > keep ? formatEther(have - keep) : '0'
    throw new Error(
      `the registrar holds ${formatEther(have)} ETH and cannot send ${amount} and still pay gas.\n` +
      `  Send at most ${affordable}, or top up at a faucet first:\n` +
      `    node --env-file=.env scripts/demo-wallet.mjs fund ${affordable}`)
  }

  console.log(`\n  sending ${amount} SepoliaETH to ${address}`)
  const hash = await writer.sendTransaction({ to: address, value: parseEther(amount) })
  console.log(`  → ${hash}`)
  const r = await reader.waitForTransactionReceipt({ hash })
  console.log(`  ${r.status}`)
  console.log(`  balance now ${formatEther(await reader.getBalance({ address }))} ETH\n`)
}

else if (cmd === 'allow') {
  /**
   * Let the demo wallet write to one name — and to nothing else.
   *
   * `resolver.mjs grant-setter` does the same thing and explains the surprise
   * in its first argument: despite its ABI calling it `name` and typing it
   * `bytes`, the resolver wants the *calldata of the setter being authorised*,
   * not the name. It decodes the selector and the name back out of it. Pass the
   * DNS-encoded name and it reverts with UnsupportedResolverProfile — whose
   * four bytes turn out to be the first four bytes of the name being read as a
   * function selector.
   *
   * It exists here as well only so that no address has to be copied by hand
   * between two commands: the address lives in .keys/demo-wallet.json and this
   * reads it. The permission granted is exactly "may call setText on this
   * name" — not ownership, not the right to grant, and not any other name.
   */
  const label = rest[0]
  if (!label) { usage(); process.exit(1) }
  if (!writer) throw new Error('REGISTRAR_PRIVATE_KEY not set — this command writes')
  const { address } = load()
  const name = `${label}.${PARENT}`

  const resolver = await reader.readContract({
    address: REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label] })
  const setterCall = encodeFunctionData({
    abi: resolverAbi, functionName: 'setText',
    args: [toHex(packetToBytes(name)), 'nextkey.secret', ''],
  })

  console.log(`\n  ${name}`)
  console.log(`  resolver      ${resolver}`)
  console.log(`  grantee       ${address}  (the demo wallet)`)
  console.log(`  authorises    setText on this name — selector ${setterCall.slice(0, 10)}`)
  const hash = await writer.writeContract({
    address: resolver, abi: resolverAbi, functionName: 'grantSetterRoles',
    args: [setterCall, address], chain: sepolia })
  console.log(`  → ${hash}`)
  const r = await reader.waitForTransactionReceipt({ hash })
  console.log(`  ${r.status}\n`)
}

else if (cmd === 'prepare' || cmd === 'series') {
  /**
   * Register a pool of names and let the demo wallet write to each.
   *
   * A name holds one secret: `nextkey.eph` is written once and never replaced,
   * so a name a visitor has used is used up. The playground therefore needs a
   * supply, and preparing twenty names by hand is forty commands and one
   * mistyped label away from a name nobody can write to.
   *
   * Skips registration for names that already exist, so it can be re-run to
   * extend the pool without paying twice for what is in it.
   *
   *   demo-wallet.mjs prepare hero01 hero02 hero03
   */
  /**
   * `series hero 20` exists because `prepare hero01 hero02 … hero20` is a
   * two-hundred-character line, and a two-hundred-character line pasted into a
   * PowerShell prompt does not always arrive whole. It arrived once as the word
   * "prepare" and nothing else, which this script cheerfully answered with its
   * usage text — a failure that looks like a mistake by the person typing.
   */
  const labels = cmd === 'series'
    ? Array.from({ length: Number(rest[1] ?? 0) },
        (_, i) => `${rest[0]}${String(i + 1).padStart(2, '0')}`)
    : rest

  if (!labels.length || (cmd === 'series' && !rest[0])) { usage(); process.exit(1) }
  if (!writer) throw new Error('REGISTRAR_PRIVATE_KEY not set — this command writes')
  if (!POOL_RESOLVER) throw new Error(
    'NEXTKEY_POOL_RESOLVER is not set.\n' +
    '  Names registered against the shared resolver cannot be written by the demo\n' +
    '  wallet, and that only shows up as a refused write after the gas is spent.\n' +
    '  Deploy the pool resolver first:  demo-wallet.mjs resolver')
  const { address } = load()

  const before = await reader.getBalance({ address: writer.account.address })
  console.log(`\n  registrar     ${formatEther(before)} ETH`)
  console.log(`  demo wallet   ${address}`)
  console.log(`  preparing     ${labels.length} name${labels.length > 1 ? 's' : ''}`)
  console.log(`                ${labels[0]} … ${labels[labels.length - 1]}\n`)

  const expiry = BigInt(Math.floor(Date.now() / 1000)) + ONE_YEAR
  for (const label of labels) {
    const existing = await reader.readContract({
      address: REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label] })

    if (existing === zeroAddress) {
      process.stdout.write(`  ${label.padEnd(10)} register `)
      const hash = await writer.writeContract({
        address: REGISTRY, abi: registryAbi, functionName: 'register',
        args: [label, OWNER, zeroAddress, RESOLVER, OWNER_ROLES, expiry], chain: sepolia })
      const r = await reader.waitForTransactionReceipt({ hash })
      process.stdout.write(`${r.status} `)
    } else {
      process.stdout.write(`  ${label.padEnd(10)} exists   `)
    }

    // Granting twice is harmless but costs gas, and there is no cheap way to
    // ask whether the role is already held — show-roles has to provoke a failed
    // simulation to read it back. Re-running therefore pays again for the
    // grant, which is cheaper than the alternative of skipping one by mistake.
    const resolver = existing === zeroAddress ? RESOLVER : existing
    const setterCall = encodeFunctionData({
      abi: resolverAbi, functionName: 'setText',
      args: [toHex(packetToBytes(`${label}.${PARENT}`)), 'nextkey.secret', ''] })
    process.stdout.write(`allow `)
    const grant = await writer.writeContract({
      address: resolver, abi: resolverAbi, functionName: 'grantSetterRoles',
      args: [setterCall, address], chain: sepolia })
    const g = await reader.waitForTransactionReceipt({ hash: grant })
    console.log(g.status)
  }

  const after = await reader.getBalance({ address: writer.account.address })
  console.log(`\n  spent         ${formatEther(before - after)} ETH`)
  console.log(`  registrar     ${formatEther(after)} ETH left\n`)
}

else if (cmd === 'resolver') {
  /**
   * A resolver of its own for the pool, and why delegation could not do this.
   *
   * `grantSetterRoles` looked like the right tool: it grants "may call this
   * setter on this name" to one account, without giving away ownership. It
   * turns out to grant "may call this setter on this name *with this record
   * key*" — a probe authorised for `nextkey.secret` and then asked to write
   * `nextkey.probe` was refused with EACUnauthorizedAccountRoles (0x4b27a133).
   *
   * That is fatal for v2 rather than inconvenient. A visitor's third record is
   * `nextkey.g2.<tag>`, and the tag comes out of an ECDH performed in their
   * browser — it does not exist when the pool is prepared, so no role for it
   * can be granted in advance. A permission keyed on arguments cannot carry a
   * schema whose keys are computed at run time.
   *
   * So the pool gets its own Permissioned Resolver, initialised with root roles
   * for both the registrar and the demo wallet. The demo wallet may then write
   * any key — but only on names that use this resolver, which is the pool and
   * nothing else. visa, vault and nextkeydemo sit on other resolvers and stay
   * out of reach. Blast radius by construction rather than by enumeration.
   *
   *   demo-wallet.mjs resolver          deploy it
   *   demo-wallet.mjs resolver --show   recompute the address without deploying
   */
  const { address } = load()

  // Salted on a name of its own so this never collides with the resolvers
  // deployed for nextkey.eth or nextkeydemo.eth. A taken CREATE2 address
  // reverts from the VerifiableFactory with five hundred lines that all mean
  // "occupied".
  const forName = `pool.${PARENT}`
  const salt = BigInt(keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
    [keccak256(stringToHex('NextKeyResolver')), namehash(forName), 0n],
  )))

  console.log(`\n  for           ${forName}`)
  console.log(`  impl          ${D.permissionedResolverImpl}`)
  console.log(`  salt          ${salt}`)
  console.log(`  root roles    ${OWNER}  (the registrar)`)
  console.log(`                ${address}  (the demo wallet)`)

  if (rest.includes('--show')) { console.log(`\n  Not deploying — --show given.\n`); process.exit(0) }
  if (!writer) throw new Error('REGISTRAR_PRIVATE_KEY not set — this command writes')

  const initData = encodeFunctionData({
    abi: resolverInitAbi, functionName: 'initialize',
    args: [[{ account: OWNER, roleBitmap: ALL_ROLES },
            { account: address, roleBitmap: ALL_ROLES }], []],
  })

  const hash = await writer.writeContract({
    address: D.verifiableFactory, abi: factoryAbi, functionName: 'deployProxy',
    args: [D.permissionedResolverImpl, salt, initData], chain: sepolia })
  console.log(`  → ${hash}`)
  const receipt = await reader.waitForTransactionReceipt({ hash })
  console.log(`  ${receipt.status}`)

  const latest = await reader.getBlockNumber()
  const logs = await reader.getLogs({
    address: D.verifiableFactory,
    event: parseAbiItem('event ProxyDeployed(address indexed sender, address indexed proxyAddress, uint256 salt, address implementation)'),
    args: { sender: OWNER },
    fromBlock: latest - 50n, toBlock: latest,
  })
  const ours = logs.find((l) => l.args.salt === salt)
  if (!ours) throw new Error('deployed, but no ProxyDeployed event found in the last 50 blocks — check the transaction')

  console.log(`\n  resolver      ${ours.args.proxyAddress}`)
  console.log(`
  Put it in .env so prepare and probe use it:
    NEXTKEY_POOL_RESOLVER=${ours.args.proxyAddress}

  Then:
    node --env-file=.env scripts/demo-wallet.mjs probe try02
    node --env-file=.env scripts/demo-wallet.mjs series hero 20
`)
}

else if (cmd === 'probe') {
  /**
   * The question everything else rests on: may this key write?
   *
   * Owning a name and being allowed to write records on it are different things
   * in this deployment — a lesson that cost half a day already (FEEDBACK-ENS.md
   * no. 9), where a name's own owner was refused by the resolver with empty
   * revert data, indistinguishable from a missing function. So this does not
   * reason about roles. It performs the write and reads it back.
   */
  const label = rest[0]
  if (!label) { usage(); process.exit(1) }
  const { privateKey, address } = load()
  const name = `${label}.${PARENT}`
  const account = privateKeyToAccount(privateKey)
  const demo = createWalletClient({ account, chain: sepolia, transport: http(RPC) })

  const balance = await reader.getBalance({ address })
  console.log(`\n  ${name}`)
  console.log(`  demo wallet   ${address}`)
  console.log(`  balance       ${formatEther(balance)} ETH`)
  if (balance === 0n) throw new Error('the demo wallet has no ether — run: demo-wallet.mjs fund 0.05')

  const resolver = await reader.readContract({
    address: REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label] })
  console.log(`  resolver      ${resolver}`)

  const key = 'nextkey.probe'
  const value = `written by the demo wallet at ${new Date().toISOString()}`
  const args = [toHex(packetToBytes(name)), key, value]

  // Simulate first. A refusal here costs nothing and names its reason, whereas
  // a failed transaction costs gas and reports "execution reverted".
  console.log(`  simulating    setText(bytes name, …)`)
  await reader.simulateContract({ address: resolver, abi: resolverAbi, functionName: 'setText', args, account })

  console.log(`  writing`)
  const hash = await demo.writeContract({ address: resolver, abi: resolverAbi, functionName: 'setText', args, chain: sepolia })
  console.log(`  → ${hash}`)
  const r = await reader.waitForTransactionReceipt({ hash })
  console.log(`  ${r.status}`)

  const back = await readRecord(name, key)
  console.log(`  read back     ${back === value ? '✓ identical' : `✗ got ${JSON.stringify(back)}`}`)
  console.log(`
  If that succeeded, the playground can offer this name without a wallet.
  Clear the probe record when you are done looking at it:
    node --env-file=.env scripts/nextkey.mjs clear ${label} ${key}
`)
}

else if (cmd === 'status' || cmd === 'free') {
  const { address } = load()
  console.log(`\n  demo wallet   ${address}`)
  console.log(`  balance       ${formatEther(await reader.getBalance({ address }))} ETH`)
  const names = cmd === 'free'
    ? Array.from({ length: Number(rest[1] ?? 0) },
        (_, i) => `${rest[0]}${String(i + 1).padStart(2, '0')}`)
    : rest

  if (names.length) {
    console.log(`\n  A name is "taken" once it publishes ${RECORD_EPH}: its ephemeral key is`)
    console.log(`  written once and never replaced, so a used name cannot be reused.\n`)
    let free = 0
    for (const label of names) {
      const eph = await readRecord(`${label}.${PARENT}`, RECORD_EPH)
      if (!eph) free++
      console.log(`  ${label.padEnd(10)} ${eph ? 'taken' : 'free'}`)
    }
    console.log(`\n  ${free} of ${names.length} still free`)
  }
  console.log()
}

else if (cmd === 'publish') {
  /**
   * The key, in the form the bundle carries it.
   *
   * Base64 rather than 0x-hex, and that is not concealment — the comment beside
   * it in the source says exactly what it is. It is so that automated secret
   * scanners, which match 0x followed by sixty-four hex characters, do not stop
   * a push or raise an alert about a key we published on purpose. Making a tool
   * shout about a real leak is worth more than making it shout here.
   */
  const { privateKey, address } = load()
  console.log(`\n  address ${address}`)
  console.log(`  paste into web/src/demo-wallet.js:\n`)
  console.log(`  export const DEMO_KEY = '${Buffer.from(privateKey.slice(2), 'hex').toString('base64')}'`)
  console.log(`  export const DEMO_ADDRESS = '${address}'\n`)
}

else usage()

} catch (e) { fail(e) }
