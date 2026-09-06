/**
 * NextKey — the parts more than one command needs.
 *
 * This file exists because `release.mjs` has to wrap a content key for a
 * recipient in exactly the way `nextkey.mjs share` does. Two implementations of
 * that rule would eventually disagree, and the failure would be a grant nobody
 * can open — discovered, as ours was, three steps downstream of its cause. So
 * the rule lives here once.
 *
 * Nothing in this module prints, writes to disk, or reads a command line. It is
 * the vocabulary; the scripts are the sentences.
 */

import { readFileSync, existsSync } from 'node:fs'
import { webcrypto as wc } from 'node:crypto'
import { createPublicClient, createWalletClient, http, toHex, hexToBytes, zeroAddress } from 'viem'
import { packetToBytes } from 'viem/ens'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
// @noble v2 moved to explicit .js subpaths and renamed sha256's module to
// sha2. The v1 spellings resolve to nothing and fail at import time.
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { ENSV2_SEPOLIA as D } from './deployment.mjs'

export const PARENT = 'nextkey.eth'
export const RECORD_SECRET = 'nextkey.secret'
export const RECORD_PUBKEY = 'nextkey.pubkey'
export const RECORD_REQUEST = 'nextkey.request'
export const AGENT_NAME = `agent.${PARENT}`

/**
 * v2 · One ephemeral public key for the whole name, written once.
 *
 * Every grant on the name is wrapped from this one key. That is safe because
 * each recipient's ECDH lands somewhere else, and it is what makes a grant
 * unfindable: the record it lives under is derived from the shared secret, so
 * only the two parties who can compute it know where to look.
 */
export const RECORD_EPH = 'nextkey.eph'
/** The name's ephemeral private key, wrapped to the owner's own identity. */
export const RECORD_EPH_SEALED = 'nextkey.eph.sealed'

const REGISTRY = process.env.NEXTKEY_REGISTRY ?? '0x612034AB34Ec262d5417EA3163718E7455157908'
const RPC = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
const KEYS = new URL('../.keys/', import.meta.url)

// ─── Encoding ──────────────────────────────────────────────────────────────
export const b64 = (u8) => Buffer.from(u8).toString('base64')
export const un64 = (s) => new Uint8Array(Buffer.from(s, 'base64'))

/**
 * A grant is addressed by the recipient's *key*, not by their name.
 *
 * Names are mutable — they move, expire, and one person may hold several —
 * while the key that can open a grant is the one stable thing about a
 * recipient. Two spellings of the same person once produced two different
 * records here, which is how this rule was learned.
 */
export const fingerprint = (pub) => Buffer.from(sha256(pub)).toString('hex').slice(0, 16)
export const grantKey = (pub) => `nextkey.grant.${fingerprint(pub)}`

// ─── Chain ─────────────────────────────────────────────────────────────────
// viem ships its own Sepolia Universal Resolver address. Overriding it is the
// first thing every entry point does, because forgetting fails silently: every
// lookup quietly resolves against production ENS and returns null.
const hackathonSepolia = {
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: D.upgradableUniversalResolverProxy } },
}
export const reader = createPublicClient({ chain: hackathonSepolia, transport: http(RPC) })

const pk = process.env.REGISTRAR_PRIVATE_KEY
export const writer = pk
  ? createWalletClient({ account: privateKeyToAccount(pk), chain: sepolia, transport: http(RPC) })
  : undefined

const registryAbi = [{ name: 'getResolver', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'label', type: 'string' }], outputs: [{ type: 'address' }] }]
const resolverAbi = [{ name: 'setText', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }],
  outputs: [] }]

export const resolverFor = async (label) => {
  const r = await reader.readContract({
    address: REGISTRY, abi: registryAbi, functionName: 'getResolver', args: [label] })
  if (r === zeroAddress) throw new Error(`${label}.${PARENT} has no resolver — run resolver.mjs attach first`)
  return r
}

/**
 * Sign as the owner of our names.
 *
 * The same account that writes records is the one whose signature derives a
 * name's ephemeral key, which is the property that makes the derivation a
 * fallback worth having: whoever can write to the name can also recover the
 * key that addresses its grants, with nothing kept on disk.
 */
export const signAsOwner = (message) => {
  if (!writer) throw new Error('REGISTRAR_PRIVATE_KEY not set — nothing to sign with')
  return writer.signMessage({ message })
}

/** Read the way a client reads: through the Universal Resolver. */
export const readRecord = (name, key) => reader.getEnsText({ name, key })

export const setRecord = async (label, key, value) => {
  if (!writer) throw new Error('REGISTRAR_PRIVATE_KEY not set — this command writes')
  const resolver = await resolverFor(label)
  const hash = await writer.writeContract({
    address: resolver, abi: resolverAbi, functionName: 'setText',
    args: [toHex(packetToBytes(`${label}.${PARENT}`)), key, value],
  })
  process.stdout.write(`  → ${hash} `)
  const r = await reader.waitForTransactionReceipt({ hash })
  console.log(r.status)
  return { hash, status: r.status }
}

// ─── Identities ────────────────────────────────────────────────────────────
// Private keys never leave this machine and never touch the chain. The .keys
// directory is gitignored; losing it means losing access, which is the honest
// property of any system whose operators cannot decrypt for you.
export const identityPath = (name) => new URL(`${name}.json`, KEYS)
export const KEYS_DIR = KEYS

/**
 * An identity is defined by what it can do, not by what it stores.
 *
 * Both kinds expose the same two things: a public key, and a way to arrive at
 * the ECDH shared secret for a grant. A software identity holds a private key
 * and computes it here; a Ledger identity holds nothing and asks the device,
 * which requires a person to approve. Every caller works with either, and no
 * caller can tell the difference — which is why adding hardware support
 * changed nothing on the sending side.
 */
export const loadIdentity = (name) => {
  const p = identityPath(name)
  if (!existsSync(p)) throw new Error(`no identity "${name}" — run: nextkey.mjs keygen ${name}`)
  const j = JSON.parse(readFileSync(p, 'utf8'))
  const pk = un64(j.publicKey)

  if (j.device === 'ledger') {
    return {
      name, pk, device: 'ledger', path: j.path, address: j.address,
      // Imported lazily so that a project without a Ledger attached never
      // loads the native HID module, and never pays for a dependency it is
      // not using.
      sharedWith: async (ephPub) => {
        const { ledgerSharedSecret } = await import('./ledger.mjs')
        return ledgerSharedSecret(ephPub, j.path)
      },
    }
  }

  const sk = un64(j.privateKey)
  return { name, pk, sk, sharedWith: async (ephPub) => x25519.getSharedSecret(sk, ephPub) }
}

// ─── Crypto ────────────────────────────────────────────────────────────────
// AES-256-GCM for the content; X25519 + HKDF-SHA256 to wrap the content key
// for one recipient. An ephemeral keypair per grant means two grants of the
// same secret share no key material.

/** randomPrivateKey() became randomSecretKey() in v2. Accept either. */
export const randomX25519Secret = () =>
  (x25519.utils.randomSecretKey ?? x25519.utils.randomPrivateKey)()

const aes = async (raw) => wc.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

export const seal = async (key, plaintext) => {
  const iv = wc.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await wc.subtle.encrypt({ name: 'AES-GCM', iv },
    await aes(key), new TextEncoder().encode(plaintext)))
  return { iv: b64(iv), ct: b64(ct) }
}

export const unseal = async (key, { iv, ct }) => new TextDecoder().decode(
  await wc.subtle.decrypt({ name: 'AES-GCM', iv: un64(iv) }, await aes(key), un64(ct)))

/** HKDF over the ECDH output, bound to both public keys so a shared secret
 *  cannot be replayed into a different pairing. */
export const wrapKey = (shared, ephPub, recipientPub) =>
  hkdf(sha256, shared, new Uint8Array([...ephPub, ...recipientPub]),
    new TextEncoder().encode('nextkey/v1/wrap'), 32)

export const grantFor = async (contentKey, recipientPubKey, forWhom) => {
  const ephSk = randomX25519Secret()
  const ephPk = x25519.getPublicKey(ephSk)
  const kek = wrapKey(x25519.getSharedSecret(ephSk, recipientPubKey), ephPk, recipientPubKey)
  const { iv, ct } = await seal(kek, b64(contentKey))
  // `for` is a label for humans reading the explorer. Nothing depends on it:
  // the grant is found by key fingerprint and opened by key.
  return JSON.stringify({ v: 1, for: forWhom, epk: b64(ephPk), iv, ct })
}

export const openGrant = async (grantJson, identity) => {
  const g = JSON.parse(grantJson)
  const ephPk = un64(g.epk)
  // The only line that differs between a key file and a hardware wallet, and
  // it differs by delegation rather than by branching.
  const shared = await identity.sharedWith(ephPk)
  const kek = wrapKey(shared, ephPk, identity.pk)
  return un64(await unseal(kek, g))
}

/**
 * Share one secret with one recipient, named by ENS.
 *
 * The whole product in six lines: open your own grant to recover the content
 * key, read the recipient's published key from *their* name, wrap to it, write
 * it under their key's fingerprint. Used by `nextkey.mjs share` and by
 * `release.mjs`, which is the reason it lives here.
 */
export const shareSecret = async ({ label, identity, recipient, log = () => {} }) => {
  const own = await readRecord(`${label}.${PARENT}`, grantKey(identity.pk))
  if (!own) throw new Error(`${identity.name} holds no grant on ${label} — cannot re-share what you cannot open`)
  const contentKey = await openGrant(own, identity)

  const theirPub = await readRecord(recipient, RECORD_PUBKEY)
  if (!theirPub) throw new Error(`${recipient} has published no ${RECORD_PUBKEY} record — nothing to encrypt to`)

  const key = grantKey(un64(theirPub))
  log(key)
  await setRecord(label, key, await grantFor(contentKey, un64(theirPub), recipient))
  return key
}

// ═══ v2 ════════════════════════════════════════════════════════════════════
//
// What changes, and why.
//
// In v1 a grant lives at `nextkey.grant.<first 16 hex of sha256(recipient's
// public key)>`. That address is a pure function of a public value, so anyone
// holding anna.eth's published key can check any name in the world for a grant
// to her and get a yes or no. The ciphertext was never the leak. The *record
// name* was: it published the guest list of every secret.
//
// v2 addresses a grant by the ECDH result instead. One ephemeral keypair is
// generated per *name* — not per recipient, because one pair already yields a
// different shared secret with every recipient — and its public half is written
// once to `nextkey.eph`. Both the wrapping key and the record name are then
// derived from that shared secret by HKDF under different info strings, so:
//
//   · a stranger cannot compute the record name, having neither private half;
//   · the recipient computes it with one ECDH, the same one that unwraps the
//     content key, so a hardware wallet is asked to approve once, not twice;
//   · the owner computes every recipient's, because the ephemeral private key
//     is theirs — which is what keeps `revoke` working without an index.
//
// The salt binds both derivations to this exact pairing (`ephPub || recipient`),
// so a shared secret cannot be replayed into a different one. The info strings
// separate the two derivations from each other, so publishing the tag on-chain
// says nothing about the wrapping key.
//
// The `for` label of v1 is gone. It named the recipient in plain text next to
// the grant, which would have handed back exactly what the tag is here to
// withhold. The owner does not need it — they can recompute any recipient's tag
// from that recipient's published key. The cost is an explorer view that no
// longer reads as a guest list, which is the point rather than a regression.
//
// `nextkey.eph` is written once and never replaced. Replacing it moves every
// grant on the name to a new address at once, and the old records, unreadable
// and unfindable, stay behind as litter. Both writers check before writing.

const INFO_EPH = 'nextkey/v2/eph'
const INFO_WRAP = 'nextkey/v2/wrap'
const INFO_TAG = 'nextkey/v2/tag'
const INFO_SEAL = 'nextkey/v2/eph-seal'
const utf8 = (s) => new TextEncoder().encode(s)
const hex = (u8) => Buffer.from(u8).toString('hex')

/** The salt both derivations share: this ephemeral key, this recipient. */
const pairing = (ephPub, recipientPub) => new Uint8Array([...ephPub, ...recipientPub])

export const wrapKeyV2 = (shared, ephPub, recipientPub) =>
  hkdf(sha256, shared, pairing(ephPub, recipientPub), utf8(INFO_WRAP), 32)

/** Sixteen bytes, not eight: the tag is the only thing standing between an
 *  observer and the fact that a grant exists, so it may as well be wide. */
export const tagFor = (shared, ephPub, recipientPub) =>
  hex(hkdf(sha256, shared, pairing(ephPub, recipientPub), utf8(INFO_TAG), 16))

export const grantKeyV2 = (shared, ephPub, recipientPub) =>
  `nextkey.g2.${tagFor(shared, ephPub, recipientPub)}`

/**
 * The message the owner signs to derive this name's ephemeral key.
 *
 * Deterministic signing (RFC 6979) is what makes this a key rather than a
 * coincidence: the same wallet over the same message returns the same bytes
 * forever, on any machine, with nothing stored. It is a fallback, not the
 * primary path — see ephSecretFor — because a wallet that ever signs
 * non-deterministically would silently produce a different key, and the
 * consistency check below is what catches that.
 *
 * The wording matters. Anyone who can make an owner sign this owns every grant
 * on the name, so the message says what it does and where it is safe to sign.
 */
export const ephMessage = (name) => [
  'NextKey — derive the ephemeral key for a name',
  '',
  `name: ${name}`,
  'version: 2',
  '',
  'This signature is not a transaction. It moves nothing and approves nothing.',
  'It derives the key that addresses every grant on this name, so treat it as',
  'you would the key itself: sign it only on a NextKey page you opened',
  'yourself, and never because someone asked you to.',
].join('\n')

/** 32 bytes from the signature. X25519 clamps the scalar itself, so any 32
 *  bytes are a usable secret key. */
export const ephSecretFromSignature = (signature, name) =>
  hkdf(sha256, hexToBytes(signature), utf8(INFO_EPH), utf8(name), 32)

/**
 * Wrap the name's ephemeral private key to the owner's own identity key.
 *
 * This needs its own ephemeral pair — wrapping a key to itself would be
 * circular — so the record carries `epk` the way a v1 grant does. Its info
 * string is separate, so this ciphertext and a grant ciphertext can never be
 * confused for one another even under the same pairing.
 */
export const sealEphSecret = async (ephSk, ownerPub) => {
  const wSk = randomX25519Secret()
  const wPk = x25519.getPublicKey(wSk)
  const kek = hkdf(sha256, x25519.getSharedSecret(wSk, ownerPub),
    pairing(wPk, ownerPub), utf8(INFO_SEAL), 32)
  const { iv, ct } = await seal(kek, b64(ephSk))
  return JSON.stringify({ v: 2, epk: b64(wPk), iv, ct })
}

export const openEphSecret = async (json, identity) => {
  const s = JSON.parse(json)
  const wPk = un64(s.epk)
  const kek = hkdf(sha256, await identity.sharedWith(wPk),
    pairing(wPk, identity.pk), utf8(INFO_SEAL), 32)
  return un64(await unseal(kek, s))
}

/**
 * Recover this name's ephemeral private key, by whichever route is open.
 *
 * Two roots of trust, deliberately: the sealed record needs only the owner's
 * identity key, the derivation needs only their wallet. Losing either one alone
 * costs nothing. When both are available they are compared, because a mismatch
 * means one of the two assumptions this design rests on has quietly failed —
 * a wallet that signs non-deterministically, or a sealed record written under a
 * different key — and finding that out at revocation time would be far worse.
 *
 * Whatever the route, the result is checked against the published `nextkey.eph`
 * before it is returned. That check costs one scalar multiplication and makes
 * every failure mode above loud instead of silent.
 */
export const ephSecretFor = async ({ name, identity, sign, published }) => {
  const wanted = published ?? await readRecord(name, RECORD_EPH)
  if (!wanted) throw new Error(`${name} publishes no ${RECORD_EPH} — it is a v1 name`)

  // The sealed record is only a route if an identity is on hand to open it.
  // Commands that need the ephemeral key but not the content key — `revoke` is
  // the one — can pass a signer alone and skip it.
  const sealedJson = identity ? await readRecord(name, RECORD_EPH_SEALED) : undefined
  const fromSeal = sealedJson ? await openEphSecret(sealedJson, identity) : undefined
  const fromSig = sign ? ephSecretFromSignature(await sign(ephMessage(name)), name) : undefined

  if (fromSeal && fromSig && b64(fromSeal) !== b64(fromSig)) {
    throw new Error(
      `${name}: the sealed ephemeral key and the one derived from your signature disagree.\n` +
      `  One of them is wrong and this tool cannot tell which. Do not write to this\n` +
      `  name until you know why — a wrong key writes grants nobody can find.`)
  }

  const sk = fromSeal ?? fromSig
  if (!sk) throw new Error(
    `${name}: no ${RECORD_EPH_SEALED} record and no signer — the ephemeral key cannot be recovered`)

  if (b64(x25519.getPublicKey(sk)) !== wanted) throw new Error(
    `${name}: the recovered ephemeral key does not match the published ${RECORD_EPH}.\n` +
    `  Either the record was replaced, or this is not the owner's key.`)

  return { sk, source: fromSeal ? 'sealed' : 'signature' }
}

/** One grant, v2. Returns the record it belongs in as well as its value,
 *  because in v2 the two are computed together and neither is derivable from
 *  the other. */
export const grantForV2 = async (contentKey, ephSk, recipientPub) => {
  const ephPk = x25519.getPublicKey(ephSk)
  const shared = x25519.getSharedSecret(ephSk, recipientPub)
  const { iv, ct } = await seal(wrapKeyV2(shared, ephPk, recipientPub), b64(contentKey))
  return { key: grantKeyV2(shared, ephPk, recipientPub), value: JSON.stringify({ v: 2, iv, ct }) }
}

/**
 * Find and open one's own grant on a name — the recipient's whole side of v2.
 *
 * Returns null when the name publishes no `nextkey.eph`, which is how a caller
 * knows to fall back to v1 rather than concluding that access was refused.
 * `sharedWith` is called exactly once: a Ledger asks its owner to approve
 * finding the record and opening it as one act, because it is one ECDH.
 */
export const openOwnGrantV2 = async (name, identity) => {
  const ephB64 = await readRecord(name, RECORD_EPH)
  if (!ephB64) return null

  const ephPk = un64(ephB64)
  const shared = await identity.sharedWith(ephPk)
  const key = grantKeyV2(shared, ephPk, identity.pk)
  const grantJson = await readRecord(name, key)
  if (!grantJson) throw new Error(
    `no grant for "${identity.name}" at ${name} — access was never given, or was revoked.\n` +
    `  (looked at ${key}, which only you and the owner can compute)`)

  return { contentKey: un64(await unseal(wrapKeyV2(shared, ephPk, identity.pk), JSON.parse(grantJson))), key }
}
