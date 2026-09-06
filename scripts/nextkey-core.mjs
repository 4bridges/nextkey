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

export const PARENT = 'nextkey.eth'
export const RECORD_SECRET = 'nextkey.secret'
export const RECORD_PUBKEY = 'nextkey.pubkey'
export const RECORD_REQUEST = 'nextkey.request'
export const AGENT_NAME = `agent.${PARENT}`

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

export const loadIdentity = (name) => {
  const p = identityPath(name)
  if (!existsSync(p)) throw new Error(`no identity "${name}" — run: nextkey.mjs keygen ${name}`)
  const j = JSON.parse(readFileSync(p, 'utf8'))
  return { name, sk: un64(j.privateKey), pk: un64(j.publicKey) }
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
  const kek = wrapKey(x25519.getSharedSecret(identity.sk, ephPk), ephPk, identity.pk)
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
