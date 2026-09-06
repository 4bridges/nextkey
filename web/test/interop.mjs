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
