/**
 * Does v2 do what v2 claims?
 *
 * The claim is unusual enough to be worth stating precisely, because it is not
 * "the ciphertext is safe" — v1 already had that — but "the *address* is safe".
 * A grant on a v2 name lives at a record whose name is derived from an ECDH
 * result, so an observer who holds every public value in the system still
 * cannot say whether a given name grants access to a given recipient. That is
 * the property this file tests, and it is the kind of property that fails
 * silently: a construction that leaked the pairing would still encrypt, still
 * decrypt, still pass a round-trip test, and quietly publish the guest list.
 *
 *   node web/test/v2.mjs
 *
 * Reads no chain, sends nothing, needs no wallet and no funds. It imports
 * scripts/nextkey-core.mjs directly — the file the command line actually runs —
 * because a reimplementation here would test this file's opinion of v2 rather
 * than v2. (web/test/interop.mjs makes the opposite choice for the opposite
 * reason: there the point is that two independent implementations agree.)
 */

import { x25519 } from '@noble/curves/ed25519.js'
import { privateKeyToAccount } from 'viem/accounts'
import {
  b64, un64, unseal, randomX25519Secret,
  ephMessage, ephSecretFromSignature, sealEphSecret, openEphSecret,
  grantForV2, grantKeyV2, wrapKeyV2, tagFor,
} from '../../scripts/nextkey-core.mjs'

const results = []
const check = (label, ok) => {
  results.push(ok)
  console.log(`  ${ok ? '✓' : '✗'}  ${label}`)
}

/** A software identity, shaped the way loadIdentity shapes one, so that the
 *  functions under test cannot tell this from the real thing. */
const identity = (name) => {
  const sk = randomX25519Secret()
  return { name, sk, pk: x25519.getPublicKey(sk), sharedWith: async (p) => x25519.getSharedSecret(sk, p) }
}

const owner = identity('owner')
const anna = identity('anna')
const mallory = identity('mallory')

// A fixed key: the wallet is a stand-in for whoever owns the name, and this
// test cares only that signing is deterministic, which viem's signer is.
const wallet = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const NAME = 'v2test.nextkey.eth'
const deriveFor = async (name) =>
  ephSecretFromSignature(await wallet.signMessage({ message: ephMessage(name) }), name)

console.log(`\n  The ephemeral key\n`)

const ephSk = await deriveFor(NAME)
const ephPk = x25519.getPublicKey(ephSk)

check('the same wallet and name derive the same key twice',
  b64(await deriveFor(NAME)) === b64(ephSk))
check('a different name derives a different key',
  b64(await deriveFor(`other.${NAME}`)) !== b64(ephSk))

// Recovery route two. Losing either route alone must cost nothing, which is
// the entire reason there are two.
const sealed = await sealEphSecret(ephSk, owner.pk)
check('the sealed record returns the ephemeral key byte for byte',
  b64(await openEphSecret(sealed, owner)) === b64(ephSk))

let refused = false
try { await openEphSecret(sealed, mallory) } catch { refused = true }
check('a stranger cannot open the sealed record', refused)

console.log(`\n  Grants\n`)

const contentKey = crypto.getRandomValues(new Uint8Array(32))
const toOwner = await grantForV2(contentKey, ephSk, owner.pk)
const toAnna = await grantForV2(contentKey, ephSk, anna.pk)

check('one ephemeral key serves several recipients at different addresses',
  toOwner.key !== toAnna.key)
check('the address is nextkey.g2. plus 32 hex characters',
  /^nextkey\.g2\.[0-9a-f]{32}$/.test(toAnna.key))
// v1 carried a `for` label naming the recipient beside the grant, which would
// hand back exactly what the address is here to withhold.
check('the grant names no recipient anywhere in its value',
  !('for' in JSON.parse(toAnna.value)))

// Anna's side: one scalar multiplication yields both the address and the key,
// which is why a hardware wallet is asked to approve once rather than twice.
const annaShared = await anna.sharedWith(ephPk)
check('the recipient computes her own address from the published key alone',
  grantKeyV2(annaShared, ephPk, anna.pk) === toAnna.key)
check('and unwraps the content key',
  b64(un64(await unseal(wrapKeyV2(annaShared, ephPk, anna.pk), JSON.parse(toAnna.value)))) === b64(contentKey))

console.log(`\n  What an observer cannot do\n`)

// The interesting adversary is not a passer-by: it is someone who holds every
// public value the system publishes — the name's ephemeral key and Anna's
// public key, both readable by anyone — and wants to know whether this name
// grants to Anna. Under v1 that was one sha256 away.
const mallorysShared = await mallory.sharedWith(ephPk)
check('holding the ephemeral key and Anna\'s public key does not yield her address',
  grantKeyV2(mallorysShared, ephPk, anna.pk) !== toAnna.key)

let opened = false
try {
  await unseal(wrapKeyV2(mallorysShared, ephPk, mallory.pk), JSON.parse(toAnna.value))
  opened = true
} catch { /* expected */ }
check('and the grant does not open under a stranger\'s key', !opened)

// The tag is published on-chain in plain sight. If it were the wrapping key's
// prefix, or derived without separating the two, publishing it would be
// publishing part of the key.
const kek = wrapKeyV2(annaShared, ephPk, anna.pk)
check('the published tag is not a prefix of the wrapping key',
  !Buffer.from(kek).toString('hex').startsWith(tagFor(annaShared, ephPk, anna.pk)))

// Binding: the same shared secret under a different pairing must land
// elsewhere, or a grant could be replayed onto another name or recipient.
check('the derivation is bound to this exact pairing',
  grantKeyV2(annaShared, anna.pk, ephPk) !== toAnna.key)

const failed = results.filter((r) => !r).length
console.log(failed
  ? `\n  ${failed} of ${results.length} failed.\n`
  : `\n  All ${results.length} checks passed.\n`)
if (failed) process.exitCode = 1
