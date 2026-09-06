/**
 * Is a signature a key, or only a signature?
 *
 * NextKey v2 can recover a name's ephemeral private key from a signature over a
 * fixed message. That works only if signing is deterministic — same wallet,
 * same message, same bytes, forever. ECDSA as Ethereum uses it derives its
 * nonce from the key and the message (RFC 6979) precisely so that it is, and
 * viem's signer follows that rule. But "the specification says so" and "this
 * wallet does so" are different claims, and the second is the one the design
 * rests on.
 *
 * The failure this catches is quiet and expensive: a non-deterministic signer
 * yields a different ephemeral key every session, so the fallback silently
 * writes grants under addresses nobody will ever look at again. Better to know
 * in four seconds than at revocation time.
 *
 *   node --env-file=.env scripts/probe-signing.mjs [name.eth]
 *
 * Only the owner's wallet is probed, because only the owner derives an
 * ephemeral key. A Ledger in this project is a *recipient* — it contributes an
 * X25519 shared secret, never a signature — so nothing here concerns it. The
 * browser signs with whatever wallet the visitor connected, and try.html runs
 * the same two comparisons before it writes.
 *
 * Sends nothing. Signs a message that is not a transaction, reads no chain,
 * needs no funds.
 */

import { privateKeyToAccount } from 'viem/accounts'
import { x25519 } from '@noble/curves/ed25519.js'
import { b64, ephMessage, ephSecretFromSignature } from './nextkey-core.mjs'

const NAME = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'probe.nextkey.eth'
const ROUNDS = 3

const pk = process.env.REGISTRAR_PRIVATE_KEY
if (!pk) {
  console.error(`
  REGISTRAR_PRIVATE_KEY is not set, so there is nothing to sign with.
  Run it as:  node --env-file=.env scripts/probe-signing.mjs
`)
  process.exit(1)
}

const account = privateKeyToAccount(pk)
const ok = (label, good) => {
  console.log(`  ${good ? '✓' : '✗'}  ${label}`)
  if (!good) process.exitCode = 1
}

const keyFor = async (name) =>
  ephSecretFromSignature(await account.signMessage({ message: ephMessage(name) }), name)

console.log(`\n  Signature determinism · ${account.address}`)
console.log(`  name under test: ${NAME}`)
console.log(`  the message is ${ephMessage(NAME).length} characters and authorises nothing\n`)

const signatures = []
for (let i = 0; i < ROUNDS; i++) {
  signatures.push(await account.signMessage({ message: ephMessage(NAME) }))
}

const same = new Set(signatures).size === 1
ok(`${ROUNDS} signatures over the same message are byte-identical`, same)

if (!same) {
  console.log(`
  This wallet does not sign deterministically. The signature fallback cannot be
  used with it: nextkey.eph.sealed becomes the only way back to a name's
  ephemeral key, and losing that record freezes the name for good.

  Distinct signatures seen:`)
  for (const s of new Set(signatures)) console.log(`    ${s.slice(0, 46)}…`)
  console.log()
  process.exit(1)
}

// The same key three times is necessary but not sufficient: if every name
// derived the same key, per-name separation would be a fiction and one leaked
// ephemeral key would open every name the wallet owns.
const mine = x25519.getPublicKey(await keyFor(NAME))
const other = x25519.getPublicKey(await keyFor(`other-${NAME}`))

ok('the derivation is stable across calls', b64(x25519.getPublicKey(await keyFor(NAME))) === b64(mine))
ok('a different name derives a different key', b64(other) !== b64(mine))

console.log(`
  ephemeral public key for ${NAME}
    ${b64(mine)}

  This is what nextkey.eph would hold. Nothing was written and nothing sent.
`)
