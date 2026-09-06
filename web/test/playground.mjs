/**
 * Does the playground still do what it says?
 *
 * interop.mjs proves the arithmetic agrees across implementations. It cannot
 * see try.html at all — a renamed element, a handler that throws, a panel that
 * quietly stops being rendered, and every check there still passes while the
 * page is broken for the one judge who tries it. This drives the page instead:
 * steps 1 to 4, in a real browser, with no wallet, exactly as a visitor would.
 *
 *   npx esbuild web/src/try.js --bundle --format=esm --minify --target=es2022 --outfile=web/try.js
 *   node web/test/playground.mjs
 *
 * The bundle must be current — this loads web/try.js, the file the site ships,
 * not web/src/try.js. Running it against a stale bundle tests the last build.
 *
 * Playwright is required here, unlike in interop.mjs, because there is nothing
 * to test without a browser. If it is missing the file says so and stops rather
 * than reporting a pass it did not earn.
 *
 * Steps 4 to 6 are covered only as far as a browser with no wallet and no chain
 * can reach: that the chain step appears, that it offers both lanes, and that
 * the wallet lane behaves when there is no wallet. Writing, opening from the
 * chain and revoking need Sepolia and either a funded wallet or the lent-name
 * key, and a test that mocked those would be testing the mock. They are
 * evidenced instead by an actual run, in evidence/v2-onchain.log.
 *
 * The page is served over HTTP rather than opened as a file, because try.html
 * loads its bundle as an ES module and browsers refuse those from file:// —
 * which fails as a CORS error and looks, misleadingly, like a broken build.
 */

import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const WEB = join(here, '..')
const PORT = Number(process.env.PLAYGROUND_PORT ?? 8731)

let chromium
try { ({ chromium } = await import('playwright')) } catch { /* reported below */ }
if (!chromium) {
  console.log(`
  This test needs a browser and there is none.
    npm i -D playwright && npx playwright install chromium
`)
  process.exit(1)
}

const types = { '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml' }
const server = createServer((req, res) => {
  const path = normalize(join(WEB, decodeURIComponent(req.url.split('?')[0])))
  if (!path.startsWith(WEB)) { res.statusCode = 403; return res.end('') }
  try {
    const body = readFileSync(path)
    res.setHeader('content-type', types[path.slice(path.lastIndexOf('.'))] ?? 'application/octet-stream')
    res.end(body)
  } catch { res.statusCode = 404; res.end('') }
}).listen(PORT)

const results = []
const check = (label, ok) => {
  results.push(ok)
  console.log(`  ${ok ? '✓' : '✗'}  ${label}`)
}

/**
 * The page is translated into ten languages, so nothing here may assert on an
 * English word.
 *
 * The first version of this file did, and failed on a German Chromium against a
 * page that was working perfectly — the panels had simply been translated, which
 * is what they are for. What is asserted instead is language-independent: the
 * record names, which are protocol and never translated; the outcome class the
 * page sets on a panel (`ok` or `bad`); base64 key material; and the visitor's
 * own phrase. The run also pins `?lang=` rather than inheriting the machine's
 * locale, so that a green run means the same thing on every machine.
 */
const LANGS = ['en', 'de']
const B64_KEY = /[A-Za-z0-9+/]{42,44}=/         // a 32-byte key, base64
// Two spellings of one pattern on purpose: a /g regex carries lastIndex between
// calls, so the same object used for both .test() and .match() gives answers
// that depend on call order. That bug is quiet and intermittent, which is the
// worst kind to have in a test.
const G2 = /nextkey\.g2\.[0-9a-f]{32}/
const G2_ALL = /nextkey\.g2\.[0-9a-f]{32}/g
const outcome = (page, id) => page.locator(`#${id}`).getAttribute('class')

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined })
try {
  const page = await browser.newPage()
  const problems = []
  page.on('pageerror', (e) => problems.push(`uncaught: ${e.message}`))
  // A failed resource load reaches the console as "Failed to load resource",
  // without the URL — so a missing favicon is indistinguishable there from a
  // missing bundle. The response event carries the URL, so the two are judged
  // separately: code and markup must load, decoration need not.
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) {
      problems.push(`console: ${m.text()}`)
    }
  })
  page.on('response', (r) => {
    if (r.status() >= 400 && /\.(js|html)(\?|$)/.test(r.url())) {
      problems.push(`${r.status()} for ${r.url()}`)
    }
  })

  const panel = (id) => page.locator(`#${id}`).innerText()

  for (const lang of LANGS) {
    console.log(`\n  A visitor, steps 1 to 4 · ?lang=${lang}\n`)
    await page.goto(`http://127.0.0.1:${PORT}/try.html?lang=${lang}`)
    check(`the page renders in ${lang}`,
      (await page.getAttribute('html', 'data-i18n-lang')) === lang)

    await page.click('#gen')
    const phrase = await page.inputValue('#phrase')
    check('the generator produces a twelve-word phrase', phrase.split(/\s+/).length === 12)

    await page.click('#gen-recipient')
    check('a recipient keypair is made in the browser',
      B64_KEY.test(await panel('r-local-out')) && /\bok\b/.test(await outcome(page, 'r-local-out')))
    // v1 printed the grant address here, because it was sha256 of a public
    // value. That the page can no longer print it is the property under test —
    // and the absence of any nextkey.g2. address is how that shows, in any
    // language.
    check('and cannot yet say where their grant will live',
      !G2.test(await panel('r-local-out')))

    await page.click('#go-store')
    await page.waitForSelector('#store-out:not([hidden])')
    const s3 = await panel('store-out')
    const address = s3.match(G2_ALL)?.[0]
    check('the secret is encrypted and an ephemeral key published', /nextkey\.eph/.test(s3))
    check('the grant is addressed under nextkey.g2.', !!address)
    check('and no v1 grant record is written', !/nextkey\.grant\./.test(s3))

    // Step 4 appears, and offers both ways in. Opening and revoking are no
    // longer reachable here: they read the records back off the chain, so they
    // stay hidden until something has been written.
    check('the chain step opens after encrypting',
      !(await page.locator('#step-chain').isHidden()))
    check('and opening stays out of reach until something is on chain',
      await page.locator('#step-open').isHidden())
    check('both lanes are offered', !(await page.locator('#lane-demo').isHidden()) &&
      !(await page.locator('#lane-own').isHidden()))
    // The one hard gate on this page. Neither lane may write until the visitor
    // has said the phrase guards nothing.
    check('neither lane can write before the confirmation',
      await page.locator('#write-demo').isDisabled() &&
      await page.locator('#publish').isDisabled())
    await page.check('#confirm-fake')
    check('confirming enables the lane that needs no wallet',
      !(await page.locator('#write-demo').isDisabled()))
    // Feedback has to appear under the button that was pressed. The first
    // version put every message — including "this takes fifteen seconds" — in
    // one panel below both lanes, which on a phone is off screen: pressing the
    // button looked like it did nothing, and the obvious response was to press
    // it again, spending a second name.
    check('the lent-name lane has a panel of its own, under its button',
      await page.locator('#lane-demo #demo-out').count() === 1)

    // Headless Chromium has no wallet, which is exactly the situation of every
    // visitor on a phone — mobile browsers carry no wallet and no extensions.
    // "No wallet found" would be true and useless; the page must offer the way
    // through instead.
    await page.click('#connect')
    const w = await panel('wallet-out')
    const links = await page.locator('#wallet-out a[href]').evaluateAll(
      (as) => as.map((a) => a.href))
    check('with no wallet, the page offers to reopen itself inside one',
      links.length >= 3)
    check('and the links carry this page, in this language',
      links.every((h) => h.includes('try.html') || h.includes(encodeURIComponent('try.html'))) &&
      links.some((h) => h.includes(`lang%3D${lang}`) || h.includes(`lang=${lang}`)))
    check('and names an address to paste into any other wallet',
      w.includes('try.html'))
  }

  console.log()
  check('the page raised no errors in any language', problems.length === 0)
  for (const p of problems) console.log(`        ${p}`)
} finally {
  await browser.close()
  server.close()
}

const failed = results.filter((r) => !r).length
console.log(failed
  ? `\n  ${failed} of ${results.length} failed.\n`
  : `\n  All ${results.length} checks passed. The playground behaves as described.\n`)
if (failed) process.exitCode = 1
