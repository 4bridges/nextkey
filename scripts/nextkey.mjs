/**
 * NextKey — the product loop.
 *
 * Confidentiality by cryptography, control by protocol roles. The two halves
 * are kept apart on purpose, because conflating them is how a design ends up
 * claiming that a public chain keeps secrets.
 *
 *   The ciphertext is public. It sits in the `nextkey.secret` text record of a
 *   subname, where anyone can read it, and that is fine — it is AES-256-GCM
 *   with a key nobody else has.
 *
 *   Access is a grant. Sharing with anna.eth wraps the content key to Anna's
 *   X25519 public key — read from *her* `nextkey.pubkey` record, so she never
 *   registers with us — and writes it to `nextkey.grant.<fingerprint of that
 *   key>`. Addressed by the key rather than the name, because names move and
 *   the key that opens a grant does not. Only Anna can unwrap it.
 *
 *   Revocation is a delete, and ENS enforces who may perform it. Clearing that
 *   grant record requires the setter role on the name. Not our server's opinion:
 *   the registry's.
 *
 * Commands:
 *   keygen  alice                        create an identity, keep the key local
 *   publish alice.eth alice              put alice's public key in her ENS record
 *   store   visa alice "seed words…"     encrypt into visa.nextkey.eth
 *   share   visa alice anna.eth          wrap the content key for anna.eth
 *   open    visa anna                    decrypt, as anna
 *   revoke  visa anna.eth                clear that one grant
 *   clear   visa nextkey.grant.abc123    empty one record outright
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { webcrypto as wc } from 'node:crypto'
import { createPublicClient, createWalletClient, http, toHex, zeroAddress } from 'viem'
import { packetToBytes } from 'viem/ens'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
// @noble v2 moved to explicit .js subpaths and renamed sha256's module to
// sha2. The v1 spellings resolve to nothing and fail at import time.
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ENSV2_SEPOLIA as D } from './deployment.mjs'

/** randomPrivateKey() became randomSecretKey() in v2. Accept either. */
const randomX25519Secret = () =>
  (x25519.utils.randomSecretKey ?? x25519.utils.randomPrivateKey)()

const PARENT = 'nextkey.eth'
const REGISTRY = process.env.NEXTKEY_REGISTRY ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const KEYS = new URL('../.keys/', import.meta.url)

const RECORD_SECRET = 'nextkey.secret'
const RECORD_PUBKEY = 'nextkey.pubkey'

/**
 * A grant is addressed by the recipient's *key*, not by their name.
 *
 * Addressing it by name looked friendlier and was wrong: a name is mutable —
 * it can move, expire, or be one of several a person holds — while the key
 * that can open the grant is the only stable thing about the recipient. Two
 * spellings of the same person ("anna", "anna.nextkey.eth") also produced two
 * different records, which is how this surfaced.
 *
 * The name is not lost; it travels inside the value as `for`, so the ENS
 * explorer still shows who a grant was written for.
 */
const fingerprint = (pub) => Buffer.from(sha256(pub)).toString('hex').slice(0, 16)
const grantKey = (pub) => `nextkey.grant.${fingerprint(pub)}`

// ─── Chain plumbing ────────────────────────────────────────────────────────
const hackathonSepolia = {
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: D.upgradableUniversalResolverProxy } },
}
const reader = createPublicClient({ chain: hackathonSepolia, transport: http(RPC) })
const pk = process.env.REGISTRAR_PRIVATE_KEY
const writer = pk
  ? createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) })
  : undefined

const registryAbi = [{ name: 'getResolver', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] }]
const resolverAbi = [{ name: 'setText', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }],
  outputs: [] }]

const resolverFor = async (label) => {
  const r = await reader.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label] })
  if (r === zeroAddress) throw new Error(`${label}.${PARENT} has no resolver — run resolver.mjs attach first`)
  return r
}

const setRecord = async (label, key, value) => {
  if (!writer) throw new Error('REGISTRAR_PRIVATE_KEY not set — this command writes')
  const resolver = await resolverFor(label)
  const hash = await writer.writeContract({
    address: resolver, abi: resolverAbi, functionName: 'setText',
    args: [toHex(packetToBytes(`${label}.${PARENT}`)), key, value],
  })
  process.stdout.write(`  → ${hash} `)
  const r = await reader.waitForTransactionReceipt({ hash })
  console.log(r.status)
}

const readRecord = (name, key) => reader.getEnsText({ name, key })

// ─── Identities ────────────────────────────────────────────────────────────
// Private keys never leave this machine and never touch the chain. The .keys
// directory is gitignored; losing it means losing access, which is the honest
// property of any system where we cannot decrypt for you.
const b64 = (u8) => Buffer.from(u8).toString('base64')
const un64 = (s) => new Uint8Array(Buffer.from(s, 'base64'))

const identityPath = (name) => new URL(`${name}.json`, KEYS)

const loadIdentity = (name) => {
  const p = identityPath(name)
  if (!existsSync(p)) throw new Error(`no identity "${name}" — run: nextkey.mjs keygen ${name}`)
  const j = JSON.parse(readFileSync(p, 'utf8'))
  return { name, sk: un64(j.privateKey), pk: un64(j.publicKey) }
}

// ─── Crypto ────────────────────────────────────────────────────────────────
// AES-256-GCM for the content; X25519 + HKDF-SHA256 to wrap the content key
// for one recipient. An ephemeral keypair per grant means two grants of the
// same secret share no key material.
const aes = async (raw) => wc.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

const seal = async (key, plaintext) => {
  const iv = wc.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await wc.subtle.encrypt({ name: 'AES-GCM', iv },
    await aes(key), new TextEncoder().encode(plaintext)))
  return { iv: b64(iv), ct: b64(ct) }
}

const unseal = async (key, { iv, ct }) => new TextDecoder().decode(
  await wc.subtle.decrypt({ name: 'AES-GCM', iv: un64(iv) }, await aes(key), un64(ct)))

/** HKDF over the ECDH output, bound to both public keys so a shared secret
 *  cannot be replayed into a different pairing. */
const wrapKey = (shared, ephPub, recipientPub) =>
  hkdf(sha256, shared, new Uint8Array([...ephPub, ...recipientPub]),
    new TextEncoder().encode('nextkey/v1/wrap'), 32)

const grantFor = async (contentKey, recipientPubKey, forWhom) => {
  const ephSk = randomX25519Secret()
  const ephPk = x25519.getPublicKey(ephSk)
  const kek = wrapKey(x25519.getSharedSecret(ephSk, recipientPubKey), ephPk, recipientPubKey)
  const { iv, ct } = await seal(kek, b64(contentKey))
  // `for` is a label for humans reading the explorer. Nothing depends on it:
  // the grant is found by key fingerprint and opened by key.
  return JSON.stringify({ v: 1, for: forWhom, epk: b64(ephPk), iv, ct })
}

const openGrant = async (grantJson, identity) => {
  const g = JSON.parse(grantJson)
  const ephPk = un64(g.epk)
  const kek = wrapKey(x25519.getSharedSecret(identity.sk, ephPk), ephPk, identity.pk)
  return un64(await unseal(kek, g))
}

// ─── Commands ──────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2)

const usage = () => {
  console.log(`
  nextkey.mjs keygen  <identity>
  nextkey.mjs publish <ens-name> <identity>
  nextkey.mjs store   <label> <identity> "<secret>"
  nextkey.mjs share   <label> <identity> <recipient.eth>
  nextkey.mjs open    <label> <identity>
  nextkey.mjs revoke  <label> <recipient.eth>
  nextkey.mjs clear   <label> <record key>
`)
}

if (cmd === 'keygen') {
  const [name] = rest
  if (!name) { usage(); process.exit(1) }
  mkdirSync(KEYS, { recursive: true })
  const sk = randomX25519Secret()
  const pub = x25519.getPublicKey(sk)
  writeFileSync(identityPath(name), JSON.stringify({ privateKey: b64(sk), publicKey: b64(pub) }, null, 2))
  console.log(`\n  identity    ${name}`)
  console.log(`  public key  ${b64(pub)}`)
  console.log(`  stored in   .keys/${name}.json  (gitignored — losing it loses access)\n`)
}

else if (cmd === 'publish') {
  const [ensName, identity] = rest
  const id = loadIdentity(identity)
  const label = ensName.replace(`.${PARENT}`, '')
  console.log(`\n  publishing ${identity}'s public key to ${ensName} · ${RECORD_PUBKEY}`)
  await setRecord(label, RECORD_PUBKEY, b64(id.pk))
  console.log()
}

else if (cmd === 'store') {
  const [label, identity, secret] = rest
  const id = loadIdentity(identity)
  const contentKey = wc.getRandomValues(new Uint8Array(32))
  const sealed = await seal(contentKey, secret)

  console.log(`\n  ${label}.${PARENT}`)
  console.log(`  encrypting ${secret.length} characters with a fresh AES-256-GCM key`)
  await setRecord(label, RECORD_SECRET, JSON.stringify({ v: 1, alg: 'A256GCM', ...sealed }))

  // The owner is a recipient like any other. No special path, no master key —
  // if we kept one, "we cannot read your secrets" would be a lie.
  console.log(`  granting the owner access the same way as anyone else`)
  console.log(`  grant record  ${grantKey(id.pk)}`)
  await setRecord(label, grantKey(id.pk), await grantFor(contentKey, id.pk, identity))
  console.log()
}

else if (cmd === 'share') {
  const [label, identity, recipient] = rest
  const id = loadIdentity(identity)

  const ownGrant = await readRecord(`${label}.${PARENT}`, grantKey(id.pk))
  if (!ownGrant) throw new Error(`${identity} holds no grant on ${label} — cannot re-share what you cannot open`)
  const contentKey = await openGrant(ownGrant, id)

  const theirPub = await readRecord(recipient, RECORD_PUBKEY)
  if (!theirPub) throw new Error(`${recipient} has published no ${RECORD_PUBKEY} record — nothing to encrypt to`)

  console.log(`\n  sharing ${label}.${PARENT} with ${recipient}`)
  console.log(`  their public key comes from their own ENS record — they never registered with us`)
  console.log(`  grant record  ${grantKey(un64(theirPub))}`)
  await setRecord(label, grantKey(un64(theirPub)), await grantFor(contentKey, un64(theirPub), recipient))
  console.log()
}

else if (cmd === 'open') {
  const [label, identity] = rest
  const id = loadIdentity(identity)
  const [sealedJson, grantJson] = await Promise.all([
    readRecord(`${label}.${PARENT}`, RECORD_SECRET),
    readRecord(`${label}.${PARENT}`, grantKey(id.pk)),
  ])
  if (!sealedJson) throw new Error(`${label}.${PARENT} holds no secret`)
  if (!grantJson) throw new Error(
    `no grant at ${grantKey(id.pk)} for "${identity}" — access was never given, or was revoked`)

  const contentKey = await openGrant(grantJson, id)
  const plaintext = await unseal(contentKey, JSON.parse(sealedJson))
  console.log(`\n  ${label}.${PARENT}  opened as ${identity}`)
  console.log(`  ${plaintext}\n`)
}

else if (cmd === 'revoke') {
  const [label, recipient] = rest
  // Revocation resolves the name to the key it currently publishes. If the
  // recipient has since rotated their `nextkey.pubkey`, this clears the grant
  // for the new key and leaves the old one standing — so rotation is an event
  // the owner has to see. Listing outstanding grants is the fix, and it needs
  // an index record; noted rather than pretended away.
  const theirPub = await readRecord(recipient, RECORD_PUBKEY)
  if (!theirPub) throw new Error(`${recipient} publishes no ${RECORD_PUBKEY} — cannot tell which grant is theirs`)

  console.log(`\n  revoking ${recipient}'s access to ${label}.${PARENT}`)
  console.log(`  grant record  ${grantKey(un64(theirPub))}`)
  console.log(`  the ciphertext stays; the wrapped key is cleared`)
  await setRecord(label, grantKey(un64(theirPub)), '')
  console.log(`\n  Note what this does and does not do. Anyone who already decrypted
  the secret still knows it — no system can retract knowledge. What ends is
  future access, and who may end it is enforced by the setter role on the name.\n`)
}

else if (cmd === 'clear') {
  /**
   * Clear one record outright.
   *
   * `revoke` is the product operation: it takes a recipient, resolves their
   * name to the key they publish, and clears the grant addressed to it. This is
   * the janitorial one — it takes a raw record key and empties it, which is what
   * you need for records no recipient corresponds to any more. Ours came from
   * changing how grants are addressed: `nextkey.grant.alice` and
   * `nextkey.grant.anna.nextkey` are leftovers from the name-based scheme, and
   * they wrap a content key that a later `store` replaced. They open nothing,
   * but they are confusing to anyone reading the name in an explorer, and a
   * confusing record on a page that exists to be inspected is a real cost.
   *
   *   nextkey.mjs clear <label> <record key>
   */
  const [label, key] = rest
  if (!label || !key) { usage(); process.exit(1) }

  // The ciphertext is not litter. Clearing it destroys the secret for every
  // recipient at once, and there is no undo — so it is not something a cleanup
  // command should do because an argument was mistyped.
  if (key === RECORD_SECRET && !rest.includes('--yes-destroy-the-secret')) {
    console.error(`
  Refusing to clear ${RECORD_SECRET} on ${label}.${PARENT}.

  That record holds the ciphertext. Emptying it does not revoke access — it
  destroys the secret for everyone, including you, and no grant will open
  anything afterwards. If that is genuinely what you want, repeat the command
  with --yes-destroy-the-secret.
`)
    process.exit(1)
  }

  const current = await readRecord(`${label}.${PARENT}`, key)
  console.log(`\n  ${label}.${PARENT} · ${key}`)
  if (!current) {
    console.log(`  already empty — nothing to do\n`)
    process.exit(0)
  }
  console.log(`  currently   ${current.length} characters`)
  console.log(`  clearing`)
  await setRecord(label, key, '')
  console.log()
}

else usage()
