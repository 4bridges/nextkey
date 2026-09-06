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
 *   registers with us. Only Anna can unwrap it.
 *
 *   Where that grant lives is itself a secret (v2). The name carries one
 *   ephemeral public key at `nextkey.eph`, and the record holding Anna's grant
 *   is named by an HKDF of the ECDH between that key and hers. Anna computes it
 *   with one scalar multiplication; the owner computes every recipient's; a
 *   stranger holding Anna's public key computes nothing and cannot even test a
 *   guess. v1 addressed grants by `sha256(recipient's public key)`, which was
 *   public arithmetic over a public value — the ciphertext was never the leak,
 *   the record name was, and it published the guest list of every secret.
 *   v1 names still open: `open` consults `nextkey.eph` and falls back.
 *
 *   Revocation is a delete, and ENS enforces who may perform it. Clearing that
 *   grant record requires the setter role on the name. Not our server's opinion:
 *   the registry's.
 *
 * Commands:
 *   keygen  alice                        create an identity, keep the key local
 *   keygen  bob --ledger --account 3     the key stays on the device instead
 *   ledger-accounts                      which wallet is which, by address
 *   publish alice.eth alice              put alice's public key in her ENS record
 *   store   visa alice "seed words…"     encrypt into visa.nextkey.eth
 *   share   visa alice anna.eth          wrap the content key for anna.eth
 *   open    visa anna                    decrypt, as anna
 *   open    other.eth anna               …from any name, not just ours
 *   revoke  visa anna.eth                clear that one grant
 *   clear   visa nextkey.grant.abc123    empty one record outright
 *   eph     visa                         which scheme, and is the key recoverable
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { webcrypto as wc } from 'node:crypto'
import { x25519 } from '@noble/curves/ed25519.js'
import {
  PARENT, RECORD_SECRET, RECORD_PUBKEY, RECORD_EPH, RECORD_EPH_SEALED,
  grantKey, b64, un64, KEYS_DIR as KEYS, identityPath, loadIdentity,
  randomX25519Secret, seal, unseal, grantFor, openGrant,
  readRecord, setRecord, shareSecret, signAsOwner,
  ephMessage, ephSecretFromSignature, ephSecretFor, sealEphSecret,
  grantForV2, grantKeyV2, openOwnGrantV2,
} from './nextkey-core.mjs'

// Everything above the command list now lives in nextkey-core.mjs, because
// release.mjs needs the same key wrapping and two copies of that rule would
// eventually disagree. See that file for why the grant is addressed by key.

// ─── Commands ──────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2)

/**
 * A refused open is not a crash, and must not look like one.
 *
 * Half of what this tool demonstrates is access being denied — the grant that
 * was revoked, the identity that never had one. Node's default for a throw in
 * top-level code is forty lines of stack trace, which reads as a broken program
 * rather than a working access-control system. On a recording it reads worse
 * still, and the recording is where this gets judged.
 *
 * So the message is printed and the exit code is kept non-zero, because a shell
 * and a CI job should still be able to tell success from refusal. The stack is
 * behind NEXTKEY_DEBUG for the cases where the failure is genuinely ours.
 */
const fail = (e) => {
  const [first, ...more] = (e?.message ?? String(e)).split('\n')
  console.error(`\n  ✗  ${first}`)
  for (const line of more) console.error(`  ${line}`)
  console.error()
  if (process.env.NEXTKEY_DEBUG) console.error(e)
  process.exit(1)
}

/**
 * A label means a subname of ours; anything containing a dot is a name in its
 * own right.
 *
 * Reading was never restricted to our own names — a grant is found by key
 * fingerprint on whatever name holds it, and that is the whole point of the
 * scheme. The restriction was an accident of spelling: every read said
 * `${label}.${PARENT}`, so a secret written to a name outside nextkey.eth was
 * unreachable by the tool that is supposed to open it. try.html can write to
 * any name the visitor owns; this is what lets the command line read it back.
 *
 * Writing keeps the old rule, because writing needs the setter role and our
 * registry is the only place we hold one.
 */
const fqdn = (label) => (label.includes('.') ? label : `${label}.${PARENT}`)

const usage = () => {
  console.log(`
  nextkey.mjs keygen  <identity> [--ledger [--account <n> | --path <p>]]
  nextkey.mjs ledger-accounts [count]
  nextkey.mjs publish <ens-name> <identity>
  nextkey.mjs store   <label> <identity> "<secret>"
  nextkey.mjs share   <label> <identity> <recipient.eth>
  nextkey.mjs open    <label|full.name.eth> <identity>
  nextkey.mjs revoke  <label> <recipient.eth> [identity]
  nextkey.mjs clear   <label> <record key>
  nextkey.mjs eph     <label|full.name.eth> [identity]
`)
}

try {

if (cmd === 'keygen') {
  const name = rest.find((a) => !a.startsWith('--'))
  if (!name) { usage(); process.exit(1) }
  mkdirSync(KEYS, { recursive: true })

  if (rest.includes('--ledger')) {
    // A hardware identity stores no private key, because there is none to
    // store. What lands on disk is a public key and a derivation path — losing
    // the file costs nothing, and copying it gains an attacker nothing.
    const { ledgerPublicKey, ledgerAddress, disconnect, DEFAULT_PATH, accountPath } =
      await import('./ledger.mjs')

    // Two ways to say which wallet, because one device commonly holds several.
    // `--account 3` matches the numbering Ledger Live shows; `--path` is there
    // for anyone who knows exactly what they want. A full path is awkward to
    // type in PowerShell, where apostrophes delimit strings.
    const idxOf = (f) => rest.indexOf(f)
    const path =
      idxOf('--path') !== -1 ? rest[idxOf('--path') + 1]
      : idxOf('--account') !== -1 ? accountPath(rest[idxOf('--account') + 1])
      : DEFAULT_PATH
    console.log(`\n  reading the public key from the device (path ${path})`)
    const pub = await ledgerPublicKey(path)
    const address = await ledgerAddress(path)
    await disconnect()

    writeFileSync(identityPath(name), JSON.stringify(
      { device: 'ledger', path, address, publicKey: b64(pub) }, null, 2))
    console.log(`\n  identity    ${name}  (Ledger)`)
    console.log(`  address     ${address}`)
    console.log(`  public key  ${b64(pub)}`)
    console.log(`  stored in   .keys/${name}.json — public key and path only,`)
    console.log(`              because the private half exists nowhere but the device`)
    console.log(`
  Publish it the same way as any other identity:
    nextkey.mjs publish <your-name>.nextkey.eth ${name}

  From then on nothing about sending to you differs. Opening will ask you to
  approve on the device, every time.\n`)
  } else {
    const sk = randomX25519Secret()
    const pub = x25519.getPublicKey(sk)
    writeFileSync(identityPath(name), JSON.stringify({ privateKey: b64(sk), publicKey: b64(pub) }, null, 2))
    console.log(`\n  identity    ${name}`)
    console.log(`  public key  ${b64(pub)}`)
    console.log(`  stored in   .keys/${name}.json  (gitignored — losing it loses access)\n`)
  }
}

else if (cmd === 'ledger-accounts') {
  const { ledgerAccounts, disconnect } = await import('./ledger.mjs')
  const count = Number(rest.find((a) => /^\d+$/.test(a)) ?? 5)
  console.log(`\n  Reading the first ${count} accounts from the device.\n`)
  for (const a of await ledgerAccounts(count)) {
    console.log(`  --account ${String(a.n).padEnd(3)} ${a.path.padEnd(18)} ${a.address}`)
  }
  console.log(`
  Pick the one you recognise, then:
    nextkey.mjs keygen <identity> --ledger --account <n>\n`)
  await disconnect()
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
  const name = fqdn(label)
  const contentKey = wc.getRandomValues(new Uint8Array(32))

  // ── The name's ephemeral key ────────────────────────────────────────────
  // Derived, not drawn: the same wallet over the same message returns the same
  // bytes, so this key needs no storage to survive. It is written to the name
  // once. Replacing it later would move every grant at once and strand the old
  // records, so an existing record that disagrees stops the command rather than
  // being overwritten.
  const ephSk = ephSecretFromSignature(await signAsOwner(ephMessage(name)), name)
  const ephPk = x25519.getPublicKey(ephSk)
  const published = await readRecord(name, RECORD_EPH)

  if (published && published !== b64(ephPk)) throw new Error(
    `${name} already publishes a different ${RECORD_EPH}.\n` +
    `  Overwriting it would move every grant on this name to a new address and\n` +
    `  leave the existing ones unreadable. Use a different name, or clear the\n` +
    `  name's grants deliberately first.`)

  console.log(`\n  ${name}`)
  if (published) {
    console.log(`  ${RECORD_EPH}  already set, and it matches — reusing it`)
  } else {
    console.log(`  ${RECORD_EPH}  ${b64(ephPk)}`)
    console.log(`  derived from your signature; written once and never replaced`)
    await setRecord(label, RECORD_EPH, b64(ephPk))

    // The convenience half of the recovery: the ephemeral key wrapped to the
    // owner's own identity, so opening later needs the identity key alone and
    // no wallet. The derivation above remains the independent way back.
    console.log(`  ${RECORD_EPH_SEALED}  wrapped to ${identity}, so no signature is needed to open`)
    await setRecord(label, RECORD_EPH_SEALED, await sealEphSecret(ephSk, id.pk))
  }

  console.log(`  encrypting ${secret.length} characters with a fresh AES-256-GCM key`)
  await setRecord(label, RECORD_SECRET, JSON.stringify({ v: 1, alg: 'A256GCM', ...(await seal(contentKey, secret))}))

  // The owner is a recipient like any other. No special path, no master key —
  // if we kept one, "we cannot read your secrets" would be a lie.
  const own = await grantForV2(contentKey, ephSk, id.pk)
  console.log(`  granting the owner access the same way as anyone else`)
  console.log(`  grant record  ${own.key}`)
  console.log(`  that address is derived from the shared secret, so nobody who lacks`)
  console.log(`  one of the two private keys can compute it or even test a guess`)
  await setRecord(label, own.key, own.value)
  console.log()
}

else if (cmd === 'share') {
  const [label, identity, recipient] = rest
  const id = loadIdentity(identity)
  const name = fqdn(label)
  console.log(`\n  sharing ${name} with ${recipient}`)
  console.log(`  their public key comes from their own ENS record — they never registered with us`)

  const isV2 = await readRecord(name, RECORD_EPH)
  if (!isV2) {
    // A v1 name keeps its scheme. Migrating it silently would rewrite every
    // grant on it, and the old records would stay behind pointing at a key
    // nobody uses.
    console.log(`  this name predates the ephemeral scheme — sharing the v1 way`)
    await shareSecret({ label, identity: id, recipient, log: (k) => console.log(`  grant record  ${k}`) })
    console.log()
  } else {
    const theirPub = await readRecord(recipient, RECORD_PUBKEY)
    if (!theirPub) throw new Error(`${recipient} publishes no ${RECORD_PUBKEY} — nothing to encrypt to`)

    // Two independent things are needed here and they come from different
    // places: the content key, which only a recipient of this secret can
    // recover, and the ephemeral key, which only the name's owner can. Sharing
    // therefore requires being both — which is the honest shape of the
    // operation, not an inconvenience to design around.
    const mine = await openOwnGrantV2(name, id)
    if (!mine) throw new Error(`${identity} holds no grant on ${name} — cannot re-share what you cannot open`)

    const { sk: ephSk, source } = await ephSecretFor({
      name, identity: id, sign: signAsOwner, published: isV2 })
    console.log(`  ephemeral key recovered from ${source === 'sealed' ? RECORD_EPH_SEALED : 'your signature'}`)

    const g = await grantForV2(mine.contentKey, ephSk, un64(theirPub))
    console.log(`  grant record  ${g.key}`)
    await setRecord(label, g.key, g.value)
    console.log()
  }
}

else if (cmd === 'open') {
  const [label, identity] = rest
  const id = loadIdentity(identity)
  const name = fqdn(label)
  const sealedJson = await readRecord(name, RECORD_SECRET)
  if (!sealedJson) throw new Error(`${name} holds no secret`)

  if (id.device === 'ledger') {
    console.log(`\n  ${identity} is a Ledger identity — approve on the device.`)
    console.log(`  One approval, not two: the same ECDH both finds the record and opens it.`)
  }

  /**
   * v2 first, v1 if the name has no ephemeral key.
   *
   * The order is not a preference, it is the only way to tell the two apart:
   * a v2 grant lives at an address that cannot be guessed, so "no record here"
   * is indistinguishable from "wrong scheme" unless `nextkey.eph` is consulted
   * first. Keeping the fallback is not politeness either — visa.nextkey.eth and
   * nextkeydemo.eth are v1, they are the names the evidence logs point at, and
   * a demo that cannot open its own evidence is worse than no demo.
   */
  let contentKey = (await openOwnGrantV2(name, id))?.contentKey
  let scheme = 'v2'
  if (!contentKey) {
    scheme = 'v1'
    const grantJson = await readRecord(name, grantKey(id.pk))
    if (!grantJson) throw new Error(
      `no grant at ${name} · ${grantKey(id.pk)} for "${identity}" — access was never given, or was revoked`)
    contentKey = await openGrant(grantJson, id)
  }

  const plaintext = await unseal(contentKey, JSON.parse(sealedJson))
  console.log(`\n  ${name}  opened as ${identity}${id.device ? ' (Ledger)' : ''} · ${scheme}`)
  console.log(`  ${plaintext}\n`)
  if (id.device === 'ledger') (await import('./ledger.mjs')).disconnect()
}

else if (cmd === 'revoke') {
  const [label, recipient] = rest
  // Revocation resolves the name to the key it currently publishes. If the
  // recipient has since rotated their `nextkey.pubkey`, this clears the grant
  // for the new key and leaves the old one standing — so rotation is an event
  // the owner has to see. Listing outstanding grants is the fix, and it needs
  // an index record; noted rather than pretended away.
  const name = fqdn(label)
  const theirPub = await readRecord(recipient, RECORD_PUBKEY)
  if (!theirPub) throw new Error(`${recipient} publishes no ${RECORD_PUBKEY} — cannot tell which grant is theirs`)

  console.log(`\n  revoking ${recipient}'s access to ${name}`)

  // In v2 the owner recomputes the recipient's tag from their published key.
  // That is precisely the asymmetry the scheme is built on: unfindable to
  // everyone else, trivially findable to the two parties who matter — which is
  // why v2 needs no index record to revoke, and why the missing-index caveat
  // below applies to key rotation only.
  const isV2 = await readRecord(name, RECORD_EPH)
  let key
  if (isV2) {
    // Revoking needs the ephemeral key and nothing else — not the content key,
    // not an identity. The optional third argument only adds the sealed record
    // as a second route, so that the two are compared while we are here.
    const { sk: ephSk, source } = await ephSecretFor({
      name, sign: signAsOwner, published: isV2,
      identity: rest[2] ? loadIdentity(rest[2]) : undefined,
    })
    console.log(`  ephemeral key recovered from ${source === 'sealed' ? RECORD_EPH_SEALED : 'your signature'}`)
    key = grantKeyV2(
      x25519.getSharedSecret(ephSk, un64(theirPub)), x25519.getPublicKey(ephSk), un64(theirPub))
  } else {
    key = grantKey(un64(theirPub))
  }

  console.log(`  grant record  ${key}`)
  console.log(`  the ciphertext stays; the wrapped key is cleared`)
  await setRecord(label, key, '')
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

else if (cmd === 'eph') {
  /**
   * What scheme is this name on, and can its ephemeral key still be recovered?
   *
   * Worth its own command because both answers are invisible from an explorer.
   * A v2 name shows a `nextkey.eph` and a handful of records whose names say
   * nothing — which is the design working, and indistinguishable from the
   * design broken. This says which.
   *
   * Reads only. Signs if a wallet is configured, because comparing the two
   * recovery routes is the entire point.
   */
  const [label, identity] = rest
  if (!label) { usage(); process.exit(1) }
  const name = fqdn(label)

  const ephB64 = await readRecord(name, RECORD_EPH)
  console.log(`\n  ${name}`)
  if (!ephB64) {
    console.log(`  scheme      v1 — no ${RECORD_EPH}, grants are addressed by recipient fingerprint`)
    console.log(`  Anyone holding a recipient's published key can test this name for a`)
    console.log(`  grant to them. That is what v2 fixes, and why new names are v2.\n`)
    process.exit(0)
  }

  console.log(`  scheme      v2`)
  console.log(`  ${RECORD_EPH}  ${ephB64}`)
  const sealedJson = await readRecord(name, RECORD_EPH_SEALED)
  console.log(`  ${RECORD_EPH_SEALED}  ${sealedJson ? `${sealedJson.length} characters` : 'absent'}`)

  try {
    const { source } = await ephSecretFor({
      name, published: ephB64,
      identity: identity ? loadIdentity(identity) : undefined,
      sign: process.env.REGISTRAR_PRIVATE_KEY ? signAsOwner : undefined,
    })
    console.log(`  recovery    ✓ via ${source === 'sealed' ? 'the sealed record' : 'signature derivation'}`)
    if (sealedJson && identity && process.env.REGISTRAR_PRIVATE_KEY) {
      console.log(`              both routes were available and agree`)
    }
  } catch (e) {
    console.log(`  recovery    ✗ ${e.message.split('\n')[0]}`)
    process.exitCode = 1
  }
  console.log()
}

else usage()

} catch (e) { fail(e) }
