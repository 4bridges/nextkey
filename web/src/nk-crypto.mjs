/**
 * The wrapping rule, in the browser.
 *
 * This file is the counterpart of scripts/nextkey-core.mjs and exists for the
 * same reason that one does: the construction that wraps a content key for a
 * recipient has to be stated once. There it is stated for Node, here for a
 * browser, and the two must agree byte for byte or a grant written by the
 * command-line tool would be unopenable on the web and nobody would find out
 * until a demo.
 *
 * Keeping it in its own module is what makes that testable — test/interop.mjs
 * bundles this file alone, generates a grant with the Node construction and
 * opens it with this one. A copy pasted into try.js would have been shorter and
 * would have tested nothing.
 *
 * Differences from the Node file are confined to the platform: `btoa` instead
 * of Buffer, `crypto.subtle` instead of `webcrypto.subtle`. The arithmetic —
 * X25519, HKDF-SHA256 with the salt and info below, AES-256-GCM — is the same
 * arithmetic.
 */

import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

const utf8 = new TextEncoder()

export const b64 = (u8) => btoa(String.fromCharCode(...u8))
export const un64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/**
 * A grant is addressed by the recipient's key, not by their name.
 *
 * Names are mutable — they move, they expire, one person may hold several —
 * while the key that can open a grant is the one stable thing about a
 * recipient. The command-line tool learned this the hard way: two spellings of
 * the same person wrote two different records, both reporting success, and the
 * mismatch only surfaced on the read.
 */
export const fingerprint = (pub) =>
  [...sha256(pub)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)

export const grantKeyFor = (pub) => `nextkey.grant.${fingerprint(pub)}`

/** randomPrivateKey() became randomSecretKey() in @noble v2. Accept either. */
export const randomSecret = () =>
  (x25519.utils.randomSecretKey ?? x25519.utils.randomPrivateKey)()

export const publicKeyOf = (sk) => x25519.getPublicKey(sk)

const aes = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

export const seal = async (key, plaintext) => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, await aes(key), utf8.encode(plaintext)))
  return { iv: b64(iv), ct: b64(ct) }
}

export const unseal = async ({ iv, ct }, key) => new TextDecoder().decode(
  await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(iv) }, await aes(key), un64(ct)))

/** HKDF over the ECDH output, bound to both public keys, so one shared secret
 *  cannot be replayed into a different pairing. */
export const wrapKey = (shared, ephPub, recipientPub) =>
  hkdf(sha256, shared, new Uint8Array([...ephPub, ...recipientPub]),
    utf8.encode('nextkey/v1/wrap'), 32)

/**
 * One grant. A fresh ephemeral keypair each time, so two grants over the same
 * secret share no key material and revoking one tells the other nothing.
 *
 * `for` is a label for whoever reads the record in an explorer. Nothing depends
 * on it: the grant is found by fingerprint and opened by key.
 */
export const grantFor = async (contentKey, recipientPub, forWhom) => {
  const ephSk = randomSecret()
  const ephPk = x25519.getPublicKey(ephSk)
  const kek = wrapKey(x25519.getSharedSecret(ephSk, recipientPub), ephPk, recipientPub)
  const { iv, ct } = await seal(kek, b64(contentKey))
  return { v: 1, for: forWhom, epk: b64(ephPk), iv, ct }
}

export const openGrant = async (grant, sk, pk) => {
  const ephPk = un64(grant.epk)
  const kek = wrapKey(x25519.getSharedSecret(sk, ephPk), ephPk, pk)
  return un64(await unseal(grant, kek))
}

// ═══ v2 ════════════════════════════════════════════════════════════════════
//
// The counterpart of the v2 section in scripts/nextkey-core.mjs, and the same
// arithmetic. Read that file for why the scheme is shaped this way; what
// follows is only how it is spelled where there is no Buffer.
//
// In one sentence: v1 put a grant at `nextkey.grant.<sha256 of the recipient's
// public key>`, which anyone holding that public key could compute, so the
// record name published who had access. v2 derives both the wrapping key and
// the record name from the ECDH between the name's one ephemeral key and the
// recipient's, under different HKDF info strings. Only the two parties who hold
// a private half can compute either.

export const RECORD_EPH = 'nextkey.eph'
export const RECORD_EPH_SEALED = 'nextkey.eph.sealed'

const INFO_EPH = 'nextkey/v2/eph'
const INFO_WRAP = 'nextkey/v2/wrap'
const INFO_TAG = 'nextkey/v2/tag'
const INFO_SEAL = 'nextkey/v2/eph-seal'

const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('')
/** A 0x-prefixed signature as bytes. No viem here; the page bundles enough. */
const unhex = (s) => {
  const h = s.startsWith('0x') ? s.slice(2) : s
  return Uint8Array.from({ length: h.length / 2 }, (_, i) => parseInt(h.substr(i * 2, 2), 16))
}

const pairing = (ephPub, recipientPub) => new Uint8Array([...ephPub, ...recipientPub])

export const wrapKeyV2 = (shared, ephPub, recipientPub) =>
  hkdf(sha256, shared, pairing(ephPub, recipientPub), utf8.encode(INFO_WRAP), 32)

export const tagFor = (shared, ephPub, recipientPub) =>
  hex(hkdf(sha256, shared, pairing(ephPub, recipientPub), utf8.encode(INFO_TAG), 16))

export const grantKeyV2 = (shared, ephPub, recipientPub) =>
  `nextkey.g2.${tagFor(shared, ephPub, recipientPub)}`

/**
 * The message the owner signs to derive this name's ephemeral key.
 *
 * Byte-identical to the Node version, including the line breaks — a stray
 * character here would derive a different key and the failure would surface as
 * a grant nobody can find. web/test/interop.mjs compares the two strings for
 * exactly that reason.
 *
 * The wording is defensive on purpose. Anyone who can persuade an owner to sign
 * this owns every grant on the name, so the message says what it does and where
 * it is safe to sign, in the place the wallet will actually show it.
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

export const ephSecretFromSignature = (signature, name) =>
  hkdf(sha256, unhex(signature), utf8.encode(INFO_EPH), utf8.encode(name), 32)

export const sealEphSecret = async (ephSk, ownerPub) => {
  const wSk = randomSecret()
  const wPk = x25519.getPublicKey(wSk)
  const kek = hkdf(sha256, x25519.getSharedSecret(wSk, ownerPub),
    pairing(wPk, ownerPub), utf8.encode(INFO_SEAL), 32)
  return { v: 2, epk: b64(wPk), ...(await seal(kek, b64(ephSk))) }
}

export const openEphSecret = async (record, sk, pk) => {
  const wPk = un64(record.epk)
  const kek = hkdf(sha256, x25519.getSharedSecret(sk, wPk),
    pairing(wPk, pk), utf8.encode(INFO_SEAL), 32)
  return un64(await unseal(record, kek))
}

/**
 * One grant, v2. Returns the record it belongs in as well as its value: in v2
 * the two are computed together from the same shared secret and neither is
 * derivable from the other, so handing back only the value would leave the
 * caller unable to say where to put it.
 *
 * No `for` field. v1 carried one, naming the recipient in plain text beside the
 * grant, which would give back precisely what the address is here to withhold.
 */
export const grantForV2 = async (contentKey, ephSk, recipientPub) => {
  const ephPk = x25519.getPublicKey(ephSk)
  const shared = x25519.getSharedSecret(ephSk, recipientPub)
  return {
    key: grantKeyV2(shared, ephPk, recipientPub),
    value: { v: 2, ...(await seal(wrapKeyV2(shared, ephPk, recipientPub), b64(contentKey))) },
  }
}

/**
 * The recipient's whole side: one scalar multiplication yields both the address
 * to look at and the key to open what is there.
 */
export const locateGrantV2 = (ephPub, sk, pk) => {
  const shared = x25519.getSharedSecret(sk, ephPub)
  return { key: grantKeyV2(shared, ephPub, pk), kek: wrapKeyV2(shared, ephPub, pk) }
}

export const openGrantV2 = async (grant, ephPub, sk, pk) =>
  un64(await unseal(grant, locateGrantV2(ephPub, sk, pk).kek))
