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

const utf8len = (s) => utf8.encode(s).length

// ═══ Padding ═══════════════════════════════════════════════════════════════
//
// AES-GCM does not pad, so a ciphertext is exactly as long as its plaintext —
// and the ciphertext is a public record. Anybody could therefore tell a
// twelve-word phrase from a two-paragraph message without decrypting either,
// which is a leak the explorer made visible by printing the length. Removing
// the number would have hidden the symptom; this removes the cause.
//
// Only the secret payload is padded. The other things that get sealed — a
// wrapped content key, a wrapped ephemeral key — are fixed-length key material
// already, and padding them would triple three records that leak nothing.
//
// What it does not do: a very long secret still lands in a higher bucket, so
// the length is coarse rather than absent. Blocks of 256 bytes put every
// passphrase, credential and short message in the same one, which is where the
// distinction mattered.
//
// Backwards compatible in both directions. Unpadding strips trailing NUL
// bytes, and a record written before this existed has none, so it comes back
// unchanged. The one thing lost is a secret that deliberately ends in NUL
// bytes — not something a passphrase, a key or a typed message contains.
export const PAD_BLOCK = 256

export const padSecret = (text) => {
  const n = utf8len(text)
  const to = Math.ceil((n + 1) / PAD_BLOCK) * PAD_BLOCK
  return text + '\u0000'.repeat(to - n)
}

export const unpadSecret = (text) => text.replace(/\u0000+$/, '')

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
const INFO_ID = 'nextkey/v2/identity'
const INFO_WRAP = 'nextkey/v2/wrap'
const INFO_TAG = 'nextkey/v2/tag'
const INFO_SEAL = 'nextkey/v2/eph-seal'
/**
 * The fifth info string, and the only one added after v2 shipped.
 *
 * It is additive on purpose: the four above address every grant that exists,
 * and changing any of them would move every v2 record ever written to an
 * address nobody looks at. A new string derives a new, separate address out of
 * the same shared secret and touches none of them.
 */
const INFO_ACK = 'nextkey/v2/ack'

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

/**
 * The identity key, derived rather than generated.
 *
 * The first version of this made a random X25519 secret and wrote it to a file:
 * a brand-new thing to guard, which no ordinary person guards well, and whose
 * loss costs every secret ever sent to them. This derives the same key from a
 * signature instead. Nothing is created, so nothing has to be kept: the wallet
 * the person already protects is the whole of the backup, and the key comes
 * back byte for byte on any machine they can sign from.
 *
 * The message carries no name. An identity belongs to a wallet, not to a name,
 * so one signature serves every ENS name that person holds — and the key stays
 * the same when they move it to another name.
 *
 * `nextkey/v2/identity` is a new info string, not a changed one. Every key
 * derived before this existed still derives exactly as it did.
 */
export const identityMessage = () => [
  'NextKey — derive your identity key',
  '',
  'version: 2',
  '',
  'This signature is not a transaction. It moves nothing, approves nothing and',
  'costs nothing. It derives the key other people encrypt to when they send you',
  'a secret — the same key every time, from this wallet alone, so there is no',
  'file to keep and nothing to lose. Sign it only on a NextKey page you opened',
  'yourself, and never because someone asked you to.',
].join('\n')

export const identitySecretFromSignature = (signature) =>
  hkdf(sha256, unhex(signature), utf8.encode(INFO_ID), utf8.encode('identity'), 32)

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

// ═══ Read receipts ═════════════════════════════════════════════════════════
//
// A receipt is a second record derived from the same shared secret as the
// grant, under INFO_ACK. Two consequences follow from that and both are the
// point: only the two parties can compute where it lives, and either of them
// can compute it alone — the recipient after opening, the sender without
// having to be told anything.
//
// What it does not do is prove who wrote it. Anyone able to write records on
// the name could put something there. It says a receipt exists at an address
// only two parties could have named, which on a page that lends out its own
// names is worth stating plainly rather than dressing up as a signature.
//
// And it costs privacy: the moment it appears, the chain shows *when* the
// secret was read. That is the trade for a delivery confirmation without a
// server, and the page says so where the button is.

export const ackKeyV2 = (shared, ephPub, recipientPub) =>
  `nextkey.a2.${hex(hkdf(sha256, shared, pairing(ephPub, recipientPub), utf8.encode(INFO_ACK), 16))}`

/** The recipient's side: one scalar multiplication, from the public eph key. */
export const locateAckV2 = (ephPub, sk, pk) =>
  ackKeyV2(x25519.getSharedSecret(sk, ephPub), ephPub, pk)

/** The sender's side: the same address, from the ephemeral private key. */
export const ackKeyForSender = (ephSk, recipientPub) => {
  const ephPk = x25519.getPublicKey(ephSk)
  return ackKeyV2(x25519.getSharedSecret(ephSk, recipientPub), ephPk, recipientPub)
}

// ═══ The NextKey ID ════════════════════════════════════════════════════════
//
// What a person is shown instead of their key.
//
// The published key is 44 characters of base64 — `k9Xm2/pQ...==` — and it is
// the wrong thing to put in front of somebody. It cannot be read aloud, it
// cannot be compared at a glance, a truncated copy of it looks exactly like a
// complete one, and its punctuation does not survive being pasted into a chat
// window that thinks a slash starts a command. Every one of those is a way to
// send a secret to the wrong person.
//
// So the ID is a *presentation* of the key, not a second identifier:
//
//   NK-9F3KD-2M0RQ-7XB4T
//
// It is derived, never issued. There is no registry, no allocation, nothing to
// look up and nothing to lose — the same key gives the same ID on any machine,
// computed offline by anyone holding the public value. Nothing is written to
// the chain for it, no record changes, and every name that already publishes a
// key already has one. That was the whole reason to derive rather than assign:
// an issued ID would need a registry, a registry needs an indexer, and a
// collision would need somebody to resolve it.
//
// What it is not: a secret, a permission, or a replacement for the key. The
// key stays in `nextkey.pubkey` and is what the arithmetic uses. The ID is what
// the interface says.
//
// The alphabet is Crockford's Base32 — no I, L, O or U — so a one cannot be
// read as an el and there is no word the last letter could complete. The
// grouping is fours and fives because that is how people read card and licence
// numbers, and the `NK-` prefix is there so an ID pasted into a support thread
// is recognisable as one.
//
// 70 bits of a SHA-256 over the key, plus one check symbol. 70 bits is not a
// cryptographic commitment and is not offered as one: it is enough that two
// people in a room will never see the same ID, and the check symbol catches the
// single mistyped and the single transposed character, which are the mistakes
// somebody copying by hand actually makes. Anyone verifying rather than reading
// compares the key.

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * The check symbol: a position-weighted sum, so a swap of two neighbours moves
 * it. An unweighted sum would not — and transposing two characters is exactly
 * what happens when somebody reads an ID off one screen and types it into
 * another.
 */
const checkSymbol = (symbols) =>
  B32[symbols.reduce((acc, v, i) => acc + v * (i + 1), 0) % 32]

/** `NK-9F3KD-2M0RQ-7XB4T` from an X25519 public key. */
export const nextkeyId = (pub) => {
  const h = sha256(pub)
  // 70 bits, taken as fourteen 5-bit symbols out of the first nine bytes.
  let bits = 0n
  for (let i = 0; i < 9; i++) bits = (bits << 8n) | BigInt(h[i])
  bits >>= 2n                                   // 72 bits read, 70 used
  const symbols = []
  for (let i = 13; i >= 0; i--) symbols[i] = Number((bits >> BigInt(5 * (13 - i))) & 31n)
  const s = symbols.map((v) => B32[v]).join('') + checkSymbol(symbols)
  return `NK-${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10, 15)}`
}

/**
 * Is this a well-formed NextKey ID?
 *
 * Only that. It says the characters are in the alphabet and the check symbol
 * agrees — never that anybody holds it, and never that a name publishes the key
 * it came from. Answering "yes" to a string somebody invented would be the
 * worst thing this function could do, so the name says `looksLike` and not
 * `isValid`, and every caller has to keep meaning it.
 */
export const looksLikeNextkeyId = (s) => {
  const raw = String(s).trim().toUpperCase().replace(/^NK-/, '').replace(/-/g, '')
  if (!/^[0-9A-HJKMNP-TV-Z]{15}$/.test(raw)) return false
  const symbols = [...raw.slice(0, 14)].map((c) => B32.indexOf(c))
  return checkSymbol(symbols) === raw[14]
}
