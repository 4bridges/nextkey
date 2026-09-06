/**
 * Does the device work at all?
 *
 * Deliberately the smallest thing that can fail. Before any of NextKey touches
 * a Ledger, three unknowns have to be settled, and settling them separately is
 * cheaper than debugging them together:
 *
 *   1. Does the native HID module load? It is compiled, and a Node version
 *      without a prebuild for it fails at import — nothing to do with Ledger.
 *   2. Is a device connected, unlocked, with the Ethereum app open?
 *   3. Does that app version expose EIP-1024? This is the one that decides the
 *      architecture. `getEIP1024PublicEncryptionKey` returns an X25519 public
 *      key, and `getEIP1024SharedSecret` performs the ECDH *on the device*.
 *      If both work, a Ledger can be a NextKey recipient with no change to how
 *      anyone sends to them — the private half simply never exists off the
 *      device.
 *
 * This reads public data and computes one shared secret. It signs no
 * transaction and moves nothing.
 *
 *   node scripts/ledger-probe.mjs
 */

import { createRequire } from 'node:module'
import { x25519 } from '@noble/curves/ed25519.js'

/**
 * The Ledger packages are loaded through `createRequire`, not `import`.
 *
 * Their ESM build (`lib-es/`) writes relative imports without file extensions —
 * `from "./helpers"`, `from "./listenDevices"` — which Node's ESM resolver
 * rejects outright. The CommonJS build is fine, so an ESM project has to reach
 * for it deliberately. Recorded in FEEDBACK-LEDGER.md, because the error names
 * a missing file and gives no hint that the module format is the problem.
 */
const require = createRequire(import.meta.url)

const PATH = process.env.LEDGER_PATH ?? "44'/60'/0'/0/0"

const die = (headline, detail) => {
  console.error(`\n  ✗ ${headline}\n`)
  if (detail) console.error(detail.split('\n').map((l) => '    ' + l).join('\n') + '\n')
  process.exit(1)
}

// ── 1. The native module ───────────────────────────────────────────────────
let TransportNodeHid, Eth
try {
  TransportNodeHid = require('@ledgerhq/hw-transport-node-hid').default
  Eth = require('@ledgerhq/hw-app-eth').default
} catch (e) {
  const m = e.message ?? String(e)
  if (/node-hid|\.node|bindings|Could not locate/i.test(m)) {
    die('The native HID module is missing its binary.', `${m}

npm did not run node-hid's install script, so the compiled part was never
fetched. The warning appears at the end of npm install as
"packages have install scripts not yet covered by allowScripts".

    npm approve-scripts node-hid
    npm rebuild node-hid

If it then tries to compile and fails, the Node version is newer than the
available prebuilds. Node 22 LTS is the safe one; nvm-windows holds both.`)
  }
  die('The Ledger libraries did not load.', `${m}

Install them if you have not:

    npm i @ledgerhq/hw-transport-node-hid @ledgerhq/hw-app-eth`)
}

console.log(`\nLedger probe`)
console.log('─'.repeat(72))

// ── 2. The device ──────────────────────────────────────────────────────────
const devices = await TransportNodeHid.list()
console.log(`  HID devices found     ${devices.length}`)
if (devices.length === 0) {
  die('No Ledger found on USB.', `Check, in this order:
  · the device is plugged in directly, not through a hub
  · it is unlocked (PIN entered)
  · the Ethereum app is open on the device, not the dashboard
  · no other app is holding it — Ledger Live grabs the device exclusively,
    so quit it entirely, not just to the tray`)
}

const transport = await TransportNodeHid.open(devices[0])
const eth = new Eth(transport)

try {
  const cfg = await eth.getAppConfiguration()
  console.log(`  Ethereum app version  ${cfg.version}`)
  console.log(`  data allowed          ${cfg.arbitraryDataEnabled ? 'yes' : 'no (blind signing off — fine for this)'}`)

  const { address } = await eth.getAddress(PATH, false)
  console.log(`  derivation path       ${PATH}`)
  console.log(`  address               ${address}`)
  console.log('─'.repeat(72))

  // ── 3. EIP-1024 — the question that decides the design ───────────────────
  console.log(`\n  Asking the device for an X25519 public key (EIP-1024).`)
  console.log(`  Confirm on the device if it asks.\n`)

  // hw-app-eth returns and accepts these as *hex* strings, not base64. The
  // published examples show a hex argument; the return encoding is not stated,
  // and reading a 64-character hex string as base64 yields 48 plausible-looking
  // bytes instead of an error. Confirmed against the library source.
  let pubHex
  try {
    const r = await eth.getEIP1024PublicEncryptionKey(PATH, false)
    pubHex = r.publicKey ?? r
  } catch (e) {
    die('This app version does not expose EIP-1024 public encryption keys.',
`${e.message ?? e}

Update the Ethereum app in Ledger Live and try again. If it still refuses,
NextKey falls back to plan B: the device signs an approval over the request
hash instead of holding the recipient key. That still satisfies Ledger's
"clear autonomous/approval boundaries" criterion — it is a smaller claim,
not a broken one.`)
  }

  const pub = new Uint8Array(Buffer.from(pubHex, 'hex'))
  console.log(`  encryption public key ${pubHex}`)
  console.log(`  length                ${pub.length} bytes ${pub.length === 32 ? '✓ X25519' : '✗ expected 32'}`)
  if (pub.length !== 32) {
    die(`The device returned a ${pub.length}-byte key where X25519 needs 32.`,
`Almost certainly an encoding mismatch rather than a device fault: 64 hex
characters read as base64 decode to 48 bytes without complaining.`)
  }

  // The real test. We act as a sender: make an ephemeral keypair, compute the
  // shared secret here, and ask the device to compute the same one. If the two
  // agree, a Ledger holder is an ordinary NextKey recipient and not a single
  // line of the sending path has to know.
  console.log(`\n  Computing an ECDH shared secret on both sides.`)
  const ephSk = (x25519.utils.randomSecretKey ?? x25519.utils.randomPrivateKey)()
  const ephPk = x25519.getPublicKey(ephSk)
  const here = x25519.getSharedSecret(ephSk, pub)

  // `boolDisplay` must be true. With false the device answers 0x6985 — and the
  // library renders that as "denied by the user?", although nothing was ever
  // shown to deny. The device simply will not perform key agreement without a
  // physical confirmation, which is exactly the property we want: opening a
  // secret held by a Ledger costs a button press, every time.
  console.log(`\n  >>> Look at the device and approve the request. <<<\n`)

  let there
  try {
    const r = await eth.getEIP1024SharedSecret(PATH, Buffer.from(ephPk).toString('hex'), true)
    there = new Uint8Array(Buffer.from(r.sharedSecret ?? r, 'hex'))
  } catch (e) {
    const m = e.message ?? String(e)
    if (m.includes('0x6985')) {
      die('The device declined the request.', `${m}

If you pressed the reject button, that is the correct outcome and the check
works — run it again and approve.

If nothing appeared on the screen at all, the app is too old to prompt for
this operation. Update the Ethereum app in Ledger Live.`)
    }
    die('The device would not compute a shared secret.', `${m}

The public key worked, so the app is close but not complete. NextKey then
falls back to plan B: the device signs an approval over the request hash
instead of holding the recipient key.`)
  }

  const hex = (u) => Buffer.from(u).toString('hex')
  const agree = hex(here) === hex(there)
  console.log(`  computed here         ${hex(here)}`)
  console.log(`  computed on device    ${hex(there)}`)
  console.log('─'.repeat(72))

  if (agree) {
    console.log(`
  ✓ They agree.

  That settles the design. A Ledger can hold a NextKey identity outright: the
  device publishes an X25519 public key, senders wrap to it exactly as they do
  for a software identity, and the private half never exists anywhere else.
  Nothing on the sending side changes — the ENS record is the whole interface,
  and what lies behind it is the recipient's business.

  And note what you just had to do to get here: press a button. The device
  refuses key agreement without it, so opening a secret is an act a person
  performs, not a thing software can do while nobody is looking.
`)
  } else {
    console.log(`
  ✗ They disagree, which means the two sides are not doing the same ECDH.

  Do not paper over this. A mismatch here would surface later as a grant that
  cannot be opened, three steps from its cause. Report the two values before
  building anything on top.
`)
    process.exit(1)
  }
} finally {
  await transport.close()
}
