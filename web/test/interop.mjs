/**
 * Do the browser and the command line agree?
 *
 * try.html claims that the grant it produces is the same grant scripts/ produces
 * — same wrapping, same fingerprint, same JSON. That claim is worth exactly as
 * much as a test, because the two implementations run on different platforms
 * with different crypto APIs and there is no compiler to notice when they drift.
 * The failure mode is not a crash: it is a grant that writes cleanly, reads
 * cleanly, and refuses to open, three steps downstream of its cause. This
 * project has had that bug once already.
 *
 *   node web/test/interop.mjs
 *
 * The browser half is *imported*, not reimplemented: web/src/nk-crypto.mjs is
 * the same file try.html loads. Node 20 and later provide `btoa`, `atob` and
 * `crypto.subtle` as globals, and Web Crypto is one specification, so that file
 * runs unmodified here. No bundler, no browser, no dependency this repository
 * does not already have.
 *
 * If Playwright happens to be installed, the same checks are then repeated
 * inside a real Chromium, because "the spec says they are the same" and "they
 * are the same" are different claims. It is a bonus, not a requirement — the
 * test is complete without it and says so rather than pretending it ran.
 *
 * The Node half below is copied out of scripts/nextkey-core.mjs rather than
 * imported, on purpose. Importing would drag in viem, a deployment file and an
 * RPC endpoint to test four functions; and if somebody edits the construction
 * in core, this test failing is the point.
 */

import { webcrypto as wc } from 'node:crypto'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

const here = dirname(fileURLToPath(import.meta.url))
const SOURCE = resolve(here, '../src/nk-crypto.mjs')

/** The browser's own module, loaded as itself. */
const NK = await import(pathToFileURL(SOURCE).href)

// ─── The Node construction, as scripts/nextkey-core.mjs states it ──────────
const b64 = (u8) => Buffer.from(u8).toString('base64')
const un64 = (s) => new Uint8Array(Buffer.from(s, 'base64'))
const aes = (raw) => wc.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])

const seal = async (key, plaintext) => {
  const iv = wc.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await wc.subtle.encrypt({ name: 'AES-GCM', iv },
    await aes(key), new TextEncoder().encode(plaintext)))
  return { iv: b64(iv), ct: b64(ct) }
}
const unseal = async (key, { iv, ct }) => new TextDecoder().decode(
  await wc.subtle.decrypt({ name: 'AES-GCM', iv: un64(iv) }, await aes(key), un64(ct)))

const wrapKey = (shared, ephPub, recipientPub) =>
  hkdf(sha256, shared, new Uint8Array([...ephPub, ...recipientPub]),
    new TextEncoder().encode('nextkey/v1/wrap'), 32)

const fingerprint = (pub) => Buffer.from(sha256(pub)).toString('hex').slice(0, 16)
const grantKey = (pub) => `nextkey.grant.${fingerprint(pub)}`
const randomSecret = () => (x25519.utils.randomSecretKey ?? x25519.utils.randomPrivateKey)()

const grantFor = async (contentKey, recipientPub, forWhom) => {
  const ephSk = randomSecret()
  const ephPk = x25519.getPublicKey(ephSk)
  const kek = wrapKey(x25519.getSharedSecret(ephSk, recipientPub), ephPk, recipientPub)
  const { iv, ct } = await seal(kek, b64(contentKey))
  return { v: 1, for: forWhom, epk: b64(ephPk), iv, ct }
}
const openGrant = async (g, sk, pk) => {
  const ephPk = un64(g.epk)
  return un64(await unseal(wrapKey(x25519.getSharedSecret(sk, ephPk), ephPk, pk), g))
}

// ─── The Node construction, v2 ─────────────────────────────────────────────
// Also copied rather than imported, for the reason stated at the top: this file
// is a second opinion, and a second opinion that imports the thing it is
// checking is not one. The strings below are the load-bearing part — an info
// string or a line break that differs by one character derives a different key,
// and the resulting grant would write cleanly and never be found again.
const utf8b = (s) => new TextEncoder().encode(s)
const hexOf = (u8) => Buffer.from(u8).toString('hex')
const pairing = (a, b) => new Uint8Array([...a, ...b])

const wrapKeyV2 = (shared, ephPub, recipientPub) =>
  hkdf(sha256, shared, pairing(ephPub, recipientPub), utf8b('nextkey/v2/wrap'), 32)
const tagFor = (shared, ephPub, recipientPub) =>
  hexOf(hkdf(sha256, shared, pairing(ephPub, recipientPub), utf8b('nextkey/v2/tag'), 16))
const grantKeyV2 = (shared, ephPub, recipientPub) =>
  `nextkey.g2.${tagFor(shared, ephPub, recipientPub)}`

const ephMessage = (name) => [
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

const ephSecretFromSignature = (sig, name) =>
  hkdf(sha256, new Uint8Array(Buffer.from(sig.replace(/^0x/, ''), 'hex')),
    utf8b('nextkey/v2/eph'), utf8b(name), 32)

const sealEphSecret = async (ephSk, ownerPub) => {
  const wSk = randomSecret()
  const wPk = x25519.getPublicKey(wSk)
  const kek = hkdf(sha256, x25519.getSharedSecret(wSk, ownerPub),
    pairing(wPk, ownerPub), utf8b('nextkey/v2/eph-seal'), 32)
  return { v: 2, epk: b64(wPk), ...(await seal(kek, b64(ephSk))) }
}
const openEphSecret = async (rec, sk, pk) => {
  const wPk = un64(rec.epk)
  const kek = hkdf(sha256, x25519.getSharedSecret(sk, wPk),
    pairing(wPk, pk), utf8b('nextkey/v2/eph-seal'), 32)
  return un64(await unseal(kek, rec))
}

const grantForV2 = async (contentKey, ephSk, recipientPub) => {
  const ephPk = x25519.getPublicKey(ephSk)
  const shared = x25519.getSharedSecret(ephSk, recipientPub)
  return {
    key: grantKeyV2(shared, ephPk, recipientPub),
    value: { v: 2, ...(await seal(wrapKeyV2(shared, ephPk, recipientPub), b64(contentKey))) },
  }
}
const openGrantV2 = async (grant, ephPub, sk, pk) =>
  un64(await unseal(wrapKeyV2(x25519.getSharedSecret(sk, ephPub), ephPub, pk), grant))

// ─── The checks ────────────────────────────────────────────────────────────
// `nk` is whichever implementation of the browser half is under test: the
// module imported directly, or the same source bundled into a real Chromium.
// The checks are written once and run against both.

const results = []
const check = (where, name, ok) => {
  results.push([where, name, ok])
  console.log(`  ${ok ? '\u2713' : '\u2717'}  ${name}`)
}

async function checks(where, nk) {
  console.log(`\n  ${where}`)

  // 1 · Node writes, the browser half opens.
  {
    const sk = randomSecret()
    const pk = x25519.getPublicKey(sk)
    const contentKey = wc.getRandomValues(new Uint8Array(32))
    const secret = 'ridge harvest solemn amber tundra oyster'
    const sealed = { v: 1, alg: 'A256GCM', ...(await seal(contentKey, secret)) }
    const grant = await grantFor(contentKey, pk, 'anna.nextkey.eth')

    const opened = await nk.open(grant, sealed, b64(sk))
    check(where, 'a grant made in Node opens in the browser code', opened === secret)

    const addressed = await nk.grantKeyFor(b64(pk))
    check(where, 'both sides address it identically', addressed === grantKey(pk))
  }

  // 2 · The browser half writes, Node opens.
  {
    const sk = randomSecret()
    const pk = x25519.getPublicKey(sk)
    const secret = 'the same sentence, travelling the other way'

    const made = await nk.make(b64(pk), secret)
    const key = await openGrant(made.grant, sk, pk)
    check(where, 'a grant made in the browser code opens in Node',
      (await unseal(key, made.sealed)) === secret)
  }

  // 3 · And both refuse the wrong key.
  // A test suite that only proves things open has proved half of an access
  // control system, and the less interesting half.
  {
    const sk = randomSecret()
    const pk = x25519.getPublicKey(sk)
    const contentKey = wc.getRandomValues(new Uint8Array(32))
    const sealed = { v: 1, alg: 'A256GCM', ...(await seal(contentKey, 'nobody else may read this')) }
    const grant = await grantFor(contentKey, pk, 'anna.nextkey.eth')
    const wrong = randomSecret()

    let refused = false
    try { await openGrant(grant, wrong, x25519.getPublicKey(wrong)) } catch { refused = true }
    check(where, 'Node refuses a stranger', refused)
    check(where, 'the browser code refuses a stranger',
      await nk.refuses(grant, sealed, b64(wrong)))
  }

  // 4 · v2 · the signing message.
  // It is an input to a key derivation, so it is not prose: one different
  // character on one side derives a different ephemeral key, and every grant
  // written under it lands at an address the other side will never look at.
  // Comparing the two strings is the cheapest test in this file and guards the
  // most expensive failure.
  {
    const name = 'interop.nextkey.eth'
    check(where, 'both sides compose the same signing message, character for character',
      (await nk.ephMessage(name)) === ephMessage(name))

    // A fixed signature rather than two signers, so that what is compared is
    // the derivation and not the wallet.
    const sig = `0x${'7b'.repeat(65)}`
    check(where, 'and derive the same ephemeral key from one signature',
      (await nk.deriveEph(sig, name)) === b64(ephSecretFromSignature(sig, name)))
  }

  // 5 · v2 · grants in both directions, address included.
  // In v1 only the value had to agree. In v2 the *record name* is derived too,
  // so a disagreement there is a grant written to a record the other side never
  // reads — which looks exactly like revoked access.
  {
    const ephSk = ephSecretFromSignature(`0x${'a3'.repeat(65)}`, 'v2.nextkey.eth')
    const ephPk = x25519.getPublicKey(ephSk)
    const sk = randomSecret()
    const pk = x25519.getPublicKey(sk)
    const contentKey = wc.getRandomValues(new Uint8Array(32))
    const secret = 'lantern quarry sequence molten drift'
    const sealed = { v: 1, alg: 'A256GCM', ...(await seal(contentKey, secret)) }
    const made = await grantForV2(contentKey, ephSk, pk)

    check(where, 'both sides address a v2 grant identically',
      (await nk.locateV2(b64(ephPk), b64(sk))) === made.key)
    check(where, 'a v2 grant made in Node opens in the browser code',
      (await nk.openV2(made.value, sealed, b64(ephPk), b64(sk))) === secret)
  }

  {
    const ephSk = randomSecret()
    const ephPk = x25519.getPublicKey(ephSk)
    const sk = randomSecret()
    const pk = x25519.getPublicKey(sk)
    const secret = 'the same sentence, travelling the other way'
    const made = await nk.makeV2(b64(ephSk), b64(pk), secret)

    check(where, 'a v2 grant made in the browser code opens in Node',
      (await unseal(await openGrantV2(made.grant.value, ephPk, sk, pk), made.sealed)) === secret)
    check(where, 'and Node computes the same address for it',
      made.grant.key === grantKeyV2(x25519.getSharedSecret(ephSk, pk), ephPk, pk))
  }

  // 6 · v2 · the sealed ephemeral record.
  // The playground writes this one and the command line is what has to open it
  // later — the whole reason the record exists is that a name outlives the tab
  // that created it.
  {
    const ephSk = randomSecret()
    const sk = randomSecret()
    const pk = x25519.getPublicKey(sk)

    check(where, 'the browser seals the ephemeral key so Node can open it',
      b64(await openEphSecret(await nk.sealEph(b64(ephSk), b64(pk)), sk, pk)) === b64(ephSk))
    check(where, 'and opens one Node sealed',
      (await nk.openEph(await sealEphSecret(ephSk, pk), b64(sk))) === b64(ephSk))
  }
}

// ─── The browser half, in this process ─────────────────────────────────────
// The module imported at the top, driven through the same three operations the
// page performs. Node provides btoa, atob and crypto.subtle, so the file needs
// no adaptation — which is itself worth knowing.
await checks('web/src/nk-crypto.mjs, in Node', {
  open: async (grant, sealed, skB64) => {
    const sk = NK.un64(skB64)
    const key = await NK.openGrant(grant, sk, NK.publicKeyOf(sk))
    return NK.unseal(sealed, key)
  },
  make: async (pkB64, text) => {
    const contentKey = crypto.getRandomValues(new Uint8Array(32))
    return {
      sealed: { v: 1, alg: 'A256GCM', ...(await NK.seal(contentKey, text)) },
      grant: await NK.grantFor(contentKey, NK.un64(pkB64), 'someone.eth'),
    }
  },
  grantKeyFor: async (pkB64) => NK.grantKeyFor(NK.un64(pkB64)),
  refuses: async (grant, sealed, skB64) => {
    try {
      const sk = NK.un64(skB64)
      await NK.unseal(sealed, await NK.openGrant(grant, sk, NK.publicKeyOf(sk)))
      return false
    } catch { return true }
  },

  ephMessage: async (name) => NK.ephMessage(name),
  deriveEph: async (sig, name) => NK.b64(NK.ephSecretFromSignature(sig, name)),
  locateV2: async (ephB64, skB64) => {
    const sk = NK.un64(skB64)
    return NK.locateGrantV2(NK.un64(ephB64), sk, NK.publicKeyOf(sk)).key
  },
  openV2: async (grant, sealed, ephB64, skB64) => {
    const sk = NK.un64(skB64)
    const key = await NK.openGrantV2(grant, NK.un64(ephB64), sk, NK.publicKeyOf(sk))
    return NK.unseal(sealed, key)
  },
  makeV2: async (ephSkB64, pkB64, text) => {
    const contentKey = crypto.getRandomValues(new Uint8Array(32))
    return {
      sealed: { v: 1, alg: 'A256GCM', ...(await NK.seal(contentKey, text)) },
      grant: await NK.grantForV2(contentKey, NK.un64(ephSkB64), NK.un64(pkB64)),
    }
  },
  sealEph: async (ephSkB64, pkB64) => NK.sealEphSecret(NK.un64(ephSkB64), NK.un64(pkB64)),
  openEph: async (record, skB64) => {
    const sk = NK.un64(skB64)
    return NK.b64(await NK.openEphSecret(record, sk, NK.publicKeyOf(sk)))
  },
})

// ─── The browser half, in an actual browser ────────────────────────────────
// Optional. "The specification says these are the same" and "these are the
// same" are different claims, and a real engine settles the second one. But
// requiring a 130 MB download to run the test would mean the test does not get
// run, so its absence is reported rather than treated as a failure.
let chromium
try { ({ chromium } = await import('playwright')) } catch { /* not installed */ }

if (!chromium) {
  console.log(`
  Skipped: the same checks inside a real Chromium.
  Playwright is not installed, and the checks above do not need it. To add the
  browser pass:  npm i -D playwright && npx playwright install chromium`)
} else {
  const dir = mkdtempSync(join(tmpdir(), 'nk-interop-'))
  let browser
  try {
    // Bundled as an IIFE onto a global — the only reason nk-crypto.js is its
    // own module rather than lines inside try.js.
    // `shell: true` because on Windows npx is a .cmd batch file, which
    // execFileSync cannot start on its own. Nothing here comes from outside
    // this file, so a shell costs nothing.
    execFileSync('npx', ['esbuild', SOURCE, '--bundle', '--format=iife',
      '--global-name=NK', '--target=es2022', '--log-level=error',
      `--outfile=${join(dir, 'nk.js')}`],
      { stdio: ['ignore', 'ignore', 'inherit'], shell: true })
    writeFileSync(join(dir, 'p.html'),
      '<!doctype html><meta charset=utf-8><script src="nk.js"></script>')

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
    const page = await browser.newPage()
    await page.goto(`file://${join(dir, 'p.html')}`)

    await checks('the same file, inside Chromium', {
      open: (grant, sealed, skB64) => page.evaluate(async ([g, s, k]) => {
        const sk = NK.un64(k)
        return NK.unseal(s, await NK.openGrant(g, sk, NK.publicKeyOf(sk)))
      }, [grant, sealed, skB64]),
      make: (pkB64, text) => page.evaluate(async ([p, t]) => {
        const contentKey = crypto.getRandomValues(new Uint8Array(32))
        return {
          sealed: { v: 1, alg: 'A256GCM', ...(await NK.seal(contentKey, t)) },
          grant: await NK.grantFor(contentKey, NK.un64(p), 'someone.eth'),
        }
      }, [pkB64, text]),
      grantKeyFor: (pkB64) => page.evaluate((p) => NK.grantKeyFor(NK.un64(p)), pkB64),
      refuses: (grant, sealed, skB64) => page.evaluate(async ([g, s, k]) => {
        try {
          const sk = NK.un64(k)
          await NK.unseal(s, await NK.openGrant(g, sk, NK.publicKeyOf(sk)))
          return false
        } catch { return true }
      }, [grant, sealed, skB64]),

      ephMessage: (name) => page.evaluate((n) => NK.ephMessage(n), name),
      deriveEph: (sig, name) => page.evaluate(([s, n]) =>
        NK.b64(NK.ephSecretFromSignature(s, n)), [sig, name]),
      locateV2: (ephB64, skB64) => page.evaluate(([e, k]) => {
        const sk = NK.un64(k)
        return NK.locateGrantV2(NK.un64(e), sk, NK.publicKeyOf(sk)).key
      }, [ephB64, skB64]),
      openV2: (grant, sealed, ephB64, skB64) => page.evaluate(async ([g, s, e, k]) => {
        const sk = NK.un64(k)
        return NK.unseal(s, await NK.openGrantV2(g, NK.un64(e), sk, NK.publicKeyOf(sk)))
      }, [grant, sealed, ephB64, skB64]),
      makeV2: (ephSkB64, pkB64, text) => page.evaluate(async ([e, p, t]) => {
        const contentKey = crypto.getRandomValues(new Uint8Array(32))
        return {
          sealed: { v: 1, alg: 'A256GCM', ...(await NK.seal(contentKey, t)) },
          grant: await NK.grantForV2(contentKey, NK.un64(e), NK.un64(p)),
        }
      }, [ephSkB64, pkB64, text]),
      sealEph: (ephSkB64, pkB64) => page.evaluate(([e, p]) =>
        NK.sealEphSecret(NK.un64(e), NK.un64(p)), [ephSkB64, pkB64]),
      openEph: (record, skB64) => page.evaluate(async ([r, k]) => {
        const sk = NK.un64(k)
        return NK.b64(await NK.openEphSecret(r, sk, NK.publicKeyOf(sk)))
      }, [record, skB64]),
    })
  } catch (e) {
    console.error(`
  The browser pass could not run: ${(e.message ?? e).split('\n')[0]}
  If Playwright is installed but has no browser:  npx playwright install chromium`)
    process.exitCode = 1
  } finally {
    if (browser) await browser.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

// ─── Verdict ───────────────────────────────────────────────────────────────
const failed = results.filter(([, , ok]) => !ok)
console.log(failed.length
  ? `\n  ${failed.length} of ${results.length} failed — the two implementations have drifted.\n`
  : `\n  All ${results.length} checks passed. The browser and the command line agree.\n`)
if (failed.length) process.exitCode = 1
