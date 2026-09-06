/**
 * The device, wrapped thinly.
 *
 * NextKey needs exactly two things from a Ledger, and this file is careful not
 * to acquire an appetite for more:
 *
 *   · the X25519 public key the device will publish as its ENS record
 *   · the ECDH shared secret for one grant, computed on the device
 *
 * It never signs a transaction and never asks for a private key, because there
 * is none to ask for. That is the point: a Ledger-backed NextKey identity has
 * no private half anywhere but the device, and no code path in this project
 * could exfiltrate one if it wanted to.
 *
 * Everything here is discovered behaviour, and the surprises are recorded in
 * FEEDBACK-LEDGER.md rather than only in comments.
 */

import { createRequire } from 'node:module'

// The published ESM build (`lib-es/`) writes relative imports without file
// extensions, which Node's ESM resolver rejects. The CommonJS build is fine,
// so an ESM project has to reach for it deliberately. FEEDBACK-LEDGER.md §1.
const require = createRequire(import.meta.url)

export const DEFAULT_PATH = process.env.LEDGER_PATH ?? "44'/60'/0'/0/0"

/**
 * The BIP-44 path for one Ledger Live account, counting from 1 as the app does.
 *
 * Ledger Live's "Account 1" is 44'/60'/0'/0/0, "Account 2" is 44'/60'/1'/0/0,
 * and so on — the account index is the third component, not the last. Getting
 * that wrong silently derives a different, perfectly valid key, so this is the
 * one place the arithmetic lives.
 */
export const accountPath = (n) => `44'/60'/${Math.max(1, Number(n)) - 1}'/0/0`

const hex = (u8) => Buffer.from(u8).toString('hex')
const unhex = (s) => new Uint8Array(Buffer.from(s, 'hex'))

let cached // one transport per process; the device allows only one holder

const friendly = (e) => {
  const m = e?.message ?? String(e)
  if (/node-hid|\.node|bindings|Could not locate/i.test(m)) {
    return new Error(
      `The native HID module is missing its binary — npm skipped node-hid's\n` +
      `  install script. Run:  npm approve-scripts node-hid && npm rebuild node-hid\n` +
      `  (original: ${m})`)
  }
  if (m.includes('0x6985')) {
    return new Error(
      `The device declined. If you pressed reject, that is the system working.\n` +
      `  Opening a secret held by a Ledger requires approval on the device, every time.`)
  }
  if (m.includes('0x6511') || /app.*not.*open/i.test(m)) {
    return new Error(`Open the Ethereum app on the device — it is on the dashboard.`)
  }
  return new Error(m)
}

const connect = async () => {
  if (cached) return cached
  let Transport, Eth
  try {
    Transport = require('@ledgerhq/hw-transport-node-hid').default
    Eth = require('@ledgerhq/hw-app-eth').default
  } catch (e) { throw friendly(e) }

  const devices = await Transport.list()
  if (devices.length === 0) {
    throw new Error(
      `No Ledger on USB. Check in this order: plugged in directly, unlocked,\n` +
      `  Ethereum app open, and Ledger Live fully quit — it holds the device\n` +
      `  exclusively, and minimising it to the tray is not enough.`)
  }
  const transport = await Transport.open(devices[0])
  cached = { transport, eth: new Eth(transport) }
  return cached
}

export const disconnect = async () => {
  if (!cached) return
  await cached.transport.close().catch(() => {})
  cached = undefined
}

/** The device's X25519 public key. Public data; no confirmation required. */
export const ledgerPublicKey = async (path = DEFAULT_PATH) => {
  const { eth } = await connect()
  try {
    // Returned as hex, not base64 — reading it as base64 yields 48 plausible
    // bytes and no error at all. FEEDBACK-LEDGER.md §3.
    const { publicKey } = await eth.getEIP1024PublicEncryptionKey(path, false)
    const pk = unhex(publicKey)
    if (pk.length !== 32) throw new Error(`expected 32 bytes, got ${pk.length}`)
    return pk
  } catch (e) { throw friendly(e) }
}

/**
 * The ECDH shared secret for one grant.
 *
 * `boolDisplay` is `true` and cannot usefully be anything else: the device
 * refuses key agreement without a confirmation, answering 0x6985 — which the
 * library then renders as "denied by the user?" although nothing was shown.
 * FEEDBACK-LEDGER.md §4.
 *
 * So every `open` of a Ledger-held secret costs a button press. Malware on the
 * laptop cannot spend it.
 */
export const ledgerSharedSecret = async (ephPub, path = DEFAULT_PATH) => {
  const { eth } = await connect()
  try {
    const { sharedSecret } = await eth.getEIP1024SharedSecret(path, hex(ephPub), true)
    return unhex(sharedSecret)
  } catch (e) { throw friendly(e) }
}

/**
 * The first `count` accounts with their addresses, so a person with several
 * wallets on one device can recognise the right one instead of counting
 * derivation paths.
 */
export const ledgerAccounts = async (count = 5) => {
  const { eth } = await connect()
  const out = []
  for (let n = 1; n <= count; n++) {
    const path = accountPath(n)
    try {
      const { address } = await eth.getAddress(path, false)
      out.push({ n, path, address })
    } catch (e) { throw friendly(e) }
  }
  return out
}

/** The Ethereum address at that path — used only to label the identity. */
export const ledgerAddress = async (path = DEFAULT_PATH) => {
  const { eth } = await connect()
  try {
    const { address } = await eth.getAddress(path, false)
    return address
  } catch (e) { throw friendly(e) }
}
