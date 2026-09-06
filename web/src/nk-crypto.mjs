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
