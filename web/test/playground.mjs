/**
 * Does the playground still do what it says?
 *
 * interop.mjs proves the arithmetic agrees across implementations. It cannot
 * see send.html at all — a renamed element, a handler that throws, a panel that
 * quietly stops being rendered, and every check there still passes while the
 * page is broken for the one judge who tries it. This drives the page instead:
 * steps 1 to 4, in a real browser, with no wallet, exactly as a visitor would.
 *
 *   npx esbuild web/src/send.js --bundle --format=esm --minify --target=es2022 --outfile=web/send.js
 *   node web/test/playground.mjs
 *
 * The bundle must be current — this loads web/send.js, the file the site ships,
 * not web/src/send.js. Running it against a stale bundle tests the last build.
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
 * The page is served over HTTP rather than opened as a file, because send.html
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

/**
 * The one server rule this page cannot be tested without.
 *
 * A tab is an address now — /demo/passphrase and /demo/message are the same
 * file, and the file reads which one it is off its own path. That mapping lives
 * in `.htaccess` on the real host, so a test server that only serves files by
 * name would exercise a page at a depth it never actually runs at, and would
 * pass while both tabs were broken.
 *
 * It is deliberately the same two rules as the rewrite, in the same order:
 * /passphrase and /message are both send.html — one implementation, two
 * addresses — and every other /demo/<tab> is <tab>.html. Nothing else about the
 * path is invented.
 *
 * The first rule is the one that was missing when this file was written, and
 * the run said so: /demo/message resolved to a message.html that does not exist
 * and the page came back a 404 with no bundle on it.
 */
const rewrite = (url) => url
  .replace(/^\/demo\/(passphrase|message)\/?$/, '/send.html')
  .replace(/^\/demo\/([A-Za-z0-9_-]+)\/?$/, '/$1.html')

const server = createServer((req, res) => {
  const path = normalize(join(WEB, rewrite(decodeURIComponent(req.url.split('?')[0]))))
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
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
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
    await page.goto(`http://127.0.0.1:${PORT}/send.html?lang=${lang}`)
    check(`the page renders in ${lang}`,
      (await page.getAttribute('html', 'data-i18n-lang')) === lang)

    // Step 1 makes a wallet rather than offering a box to paste one into. The
    // address has to be the one those twelve words actually control — that is
    // the claim the page makes, and a mismatch would make it a toy.
    await page.click('#gen')
    const phrase = await page.inputValue('#phrase')
    check('the generator produces a twelve-word phrase', phrase.split(/\s+/).length === 12)
    const made = JSON.parse(await page.getAttribute('#wallet-made', 'data-nk'))
    check('and an address those words control', ADDRESS.test(made.address ?? ''))
    check('and the address shown is that address',
      (await panel('wallet-made')).includes(made.address))
    // A passphrase left on screen is read by the projector, the person walking
    // past, and every screenshot taken afterwards. It is covered until asked
    // for, and it covers itself again five seconds later.
    check('the passphrase is covered until asked for',
      !(await panel('wallet-made')).includes(phrase))
    await page.click('#reveal')
    check('and one press shows it',
      (await panel('wallet-made')).includes(phrase))
    await page.waitForTimeout(5400)
    check('and it covers itself again without being asked',
      !(await panel('wallet-made')).includes(phrase))
    // The page used to carry a standing warning because it invited a visitor to
    // paste a real seed phrase. In wallet mode there is no box to paste into,
    // which is why the warning could go rather than being merely hidden.
    check('wallet mode offers no box to paste a real phrase into',
      await page.locator('#pane-message').isHidden())

    await page.click('#gen-recipient')
    check('a recipient keypair is made in the browser',
      B64_KEY.test(await panel('r-out')) && /\bok\b/.test(await outcome(page, 'r-out')))
    // v1 printed the grant address here, because it was sha256 of a public
    // value. That the page can no longer print it is the property under test —
    // and the absence of any nextkey.g2. address is how that shows, in any
    // language.
    check('and cannot yet say where their grant will live',
      !G2.test(await panel('r-out')))

    await page.click('#go-store')
    await page.waitForSelector('#store-out:not([hidden])')
    const s3 = await panel('store-out')
    const address = s3.match(G2_ALL)?.[0]
    check('the grant is addressed under nextkey.g2.', !!address)
    // The reasoning and the raw records are folded away — with all of it open,
    // the button for step 4 sat two screens below the result on a phone.
    check('and the argument is folded, not shown', s3.split('\n').length < 12)
    await page.click('#store-out details.why >> nth=0')
    const s3open = await panel('store-out')
    check('the three records are one tap away', /nextkey\.eph/.test(s3open))
    // AES-GCM does not pad, so an unpadded ciphertext is exactly as long as the
    // secret — and it is a public record. Padded to a 256-byte block, every
    // short secret produces the same 272 bytes, which is 364 characters of
    // base64 whatever was typed. A number, not an opinion.
    const ct = [...s3open.matchAll(/"ct":\s*"([A-Za-z0-9+/=]+)"/g)].map((m) => m[1])
    check('the ciphertext length says nothing about the secret',
      ct.some((v) => v.length === 364))
    check('and no v1 grant record is written', !/nextkey\.grant\./.test(s3open))

    // Sealing settles what was sealed and to whom. Leaving those controls live
    // let a visitor change the recipient while the panels went on describing
    // the first one.
    check('sealing switches off the choices it was made from',
      await page.locator('#gen').isDisabled() &&
      await page.locator('#gen-recipient').isDisabled() &&
      await page.locator('#lookup').isDisabled())

    // Step 4 appears, and offers both ways in. Opening and revoking are no
    // longer reachable here: they read the records back off the chain, so they
    // stay hidden until something has been written.
    check('the chain step opens after encrypting',
      !(await page.locator('#step-chain').isHidden()))
    check('and opening stays out of reach until something is on chain',
      await page.locator('#step-open').isHidden())
    // The lent-name lane is the one a judge with no wallet will use, so it is
    // the one that must be in front of them. The other is still there, one
    // disclosure away, rather than competing for the same attention.
    check('the lane that needs no wallet is the visible one',
      !(await page.locator('#lane-demo').isHidden()))
    check('and the wallet lane is present, folded away',
      await page.locator('#lane-own').count() === 1 &&
      !(await page.locator('#lane-own-wrap').evaluate((d) => d.open)))
    // No checkbox stands in front of it any more. The gate existed because the
    // page invited a pasted seed phrase; step 1 no longer does.
    check('nothing has to be confirmed before writing',
      await page.locator('#confirm-fake').count() === 0 &&
      !(await page.locator('#write-demo').isDisabled()))
    // Opening reads the chain, so it stays out of reach — and its button stays
    // disabled — until something has been written.
    check('the inbox waits for something to be on chain',
      await page.locator('#step-open').isHidden())
    // A second recipient is one more record on the same name — which means
    // there has to be a name first.
    check('and so does granting to a second recipient',
      await page.locator('#step-more').isHidden())

    // What an agent reads instead of the prose, which exists in ten languages.
    const seen = JSON.parse(await page.getAttribute('#store-out', 'data-nk'))
    check('the result is also published in a machine-readable form',
      G2.test(seen.grantRecord ?? '') && /nextkey\.a2\.[0-9a-f]{32}/.test(seen.ackRecord ?? ''))
    const state = await page.evaluate(() => window.NEXTKEY.state())
    check('and the page reports its state without any private key',
      state.grantRecord === seen.grantRecord && state.recipient.kind === 'local' &&
      !JSON.stringify(state).includes(phrase))
    // Feedback has to appear under the button that was pressed. The first
    // version put every message — including "this takes fifteen seconds" — in
    // one panel below both lanes, which on a phone is off screen: pressing the
    // button looked like it did nothing, and the obvious response was to press
    // it again, spending a second name.
    check('the lent-name lane has a panel of its own, under its button',
      await page.locator('#lane-demo #demo-out').count() === 1)

    // The identity lanes — being receivable, and a name of your own — used to
    // stand on this page and are checked on the ID tab now, further down.

    // Headless Chromium has no wallet, which is exactly the situation of every
    // visitor on a phone — mobile browsers carry no wallet and no extensions.
    // "No wallet found" would be true and useless; the page must offer the way
    // through instead.
    // The wallet lane is one disclosure away rather than gone. Opening it is
    // what a visitor who holds a name would do, and everything below is about
    // the visitor who does not.
    await page.click('#lane-own-wrap > summary')
    check('the wallet lane opens when asked for',
      !(await page.locator('#lane-own').isHidden()))

    await page.click('#connect')
    const w = await panel('wallet-out')
    const links = await page.locator('#wallet-out a[href]').evaluateAll(
      (as) => as.map((a) => a.href))
    check('with no wallet, the page offers to reopen itself inside one',
      links.length >= 3)
    check('and the links carry this page, in this language',
      links.every((h) => h.includes('send.html') || h.includes(encodeURIComponent('send.html'))) &&
      links.some((h) => h.includes(`lang%3D${lang}`) || h.includes(`lang=${lang}`)))
    check('and names an address to paste into any other wallet',
      w.includes('send.html'))
  }

  // ── The other half of the loop ──────────────────────────────────────────
  // The same five steps with different contents, which is the reason one file
  // answers to both tabs rather than being copied into two.
  //
  // It is reached the way a visitor reaches it: by going to /demo/message. That
  // is the check — the tab is a property of the address, so a page served at
  // that path must come up on the message side with nothing pressed.
  console.log(`\n  The message side\n`)
  {
    await page.goto(`http://127.0.0.1:${PORT}/demo/message?lang=en`)
    check('the address alone decides which tab this is',
      (await page.evaluate(() => window.NEXTKEY.state().mode)) === 'message')
    check('the message side offers a box and no generator',
      !(await page.locator('#pane-message').isHidden()) &&
      await page.locator('#pane-wallet').isHidden())
    check('and the heading says so without a button being pressed',
      (await page.textContent('#t-eyebrow')).trim() === 'Message')

    // A message is covered for the same reason a passphrase is: whoever walks
    // past, the projector, and every screenshot taken afterwards.
    const secret = 'meet me at the usual place'
    await page.fill('#phrase', secret)
    await page.locator('#phrase').blur()
    await page.waitForSelector('#message-made:not([hidden])')
    check('a typed message covers itself when the typing stops',
      !(await panel('message-made')).includes(secret))
    await page.click('#message-made #reveal')
    check('and the same eye shows it',
      (await panel('message-made')).includes(secret))
    // Two panels, one set of ids. A hidden panel that kept its markup made the
    // other one's eye act on an invisible element.
    check('only one reveal control exists at a time',
      await page.locator('#reveal').count() === 1)
  }

  // ── A prepared state, reached from a link ───────────────────────────────
  // An agent that had to press a button after following a prepared link would
  // not have been given a prepared state.
  console.log(`\n  A link that opens on the message side\n`)
  {
    await page.goto(`http://127.0.0.1:${PORT}/demo/passphrase?lang=en`)
    check('/demo/passphrase is the other tab, from the path alone',
      !(await page.locator('#pane-wallet').isHidden()) &&
      (await page.evaluate(() => window.NEXTKEY.state().mode)) === 'wallet')

    // The query string is older than the path and links to it are in the
    // README, in the decision log and in whatever somebody has already sent to
    // somebody else. A parameter that quietly stops meaning anything is worse
    // than one that keeps meaning what it meant, so it still works where the
    // path says nothing.
    await page.goto(`http://127.0.0.1:${PORT}/send.html?lang=en&mode=message`)
    check('?mode=message still starts where it says it will',
      !(await page.locator('#pane-message').isHidden()) &&
      (await page.evaluate(() => window.NEXTKEY.state().mode)) === 'message')
  }

  // ── The ID tab ──────────────────────────────────────────────────────────
  // Being receivable and claiming a name of your own are this page's subject.
  // They were checked on send.html until they moved here, and the checks moved
  // with them rather than being dropped — a lane nobody tests is a lane that
  // stops working quietly.
  //
  // Everything here is judged without a wallet, which is most of what matters:
  // a visitor decides whether to press the button from what the page says
  // before they connect anything, and this browser has no wallet at all.
  for (const lang of LANGS) {
    console.log(`\n  The ID tab · ?lang=${lang}\n`)
    await page.goto(`http://127.0.0.1:${PORT}/id.html?lang=${lang}`)

    check('the owned-name lane is a section of its own',
      await page.locator('#own-name-box').count() === 1 &&
      await page.locator('#own-name-box #claim-out').count() === 1)
    // Folded, because it is the second choice and it asks for testnet ether.
    // Asserted on the element rather than on what is visible: a <details> that
    // someone gives an `open` attribute looks identical to this test's eye
    // until the viewport is involved.
    check('and it is folded until it is asked for',
      !(await page.locator('#own-name-box').evaluate((el) => el.open)) &&
      await page.locator('#claim-name').isHidden())
    // Below, not instead of. A visitor with no testnet ether must still meet
    // the lane that asks them for nothing first.
    check('and it comes after the lent name, not before it',
      await page.evaluate(() => Boolean(
        document.getElementById('be-receivable-box').compareDocumentPosition(
          document.getElementById('own-name-box')) & Node.DOCUMENT_POSITION_FOLLOWING)))

    await page.click('#own-name-box > summary')
    const own = await page.locator('#own-name-box').innerText()
    check('it names the parent, so nobody has to guess the ending',
      (await page.locator('#own-suffix').innerText()).trim() === '.nextkey.eth')
    // An example in the box reads as a suggestion, and a suggestion in a field
    // that spends your one allowance is a trap.
    check('and offers no example to mistake for a suggestion',
      !(await page.getAttribute('#own-label', 'placeholder')))
    check('what it costs is said before anything is pressed',
      /sepolia/i.test(own))

    // Asserted by shape rather than by wording, because this runs in every
    // language: a refusal is the panel in its 'bad' state with something in it
    // and no links — links would mean the page had fallen through to the
    // "install a wallet" answer instead of judging what was typed.
    const refused = async () => {
      const cls = await page.getAttribute('#claim-out', 'class')
      const text = (await page.locator('#claim-out').innerText()).trim()
      const links = await page.locator('#claim-out a[href]').count()
      return cls.includes('bad') && text.length > 0 && links === 0
    }

    await page.fill('#own-label', 'not a name')
    await page.click('#claim-name')
    check('a name that cannot be typed is refused without opening a wallet',
      await refused())
    check('and a refusal disables nothing — it can be corrected and pressed again',
      !(await page.locator('#claim-name').isDisabled()) &&
      !(await page.locator('#own-label').isDisabled()))

    await page.fill('#own-label', '')
    await page.click('#claim-name')
    check('an empty name asks for one rather than guessing', await refused())
  }

  // ── A page one version behind its bundle ────────────────────────────────
  // send.html and send.js are two files on a static host. They can be uploaded
  // separately and cached separately, and when they drift the symptom was
  // "Cannot set properties of null (setting 'hidden')" on a button press —
  // accurate, useless, and indistinguishable from a broken cipher to whoever is
  // watching. The bundle now checks at load and says so. This serves a
  // deliberately stale page to prove it.
  console.log(`\n  A page that does not match its bundle\n`)
  {
    const stale = await browser.newPage()
    const raw = []
    stale.on('pageerror', (e) => raw.push(e.message))
    await stale.route('**/send.html*', async (route) => {
      const res = await route.fetch()
      const body = (await res.text()).replace('id="step-chain"', 'id="step4"')
      await route.fulfill({ response: res, body })
    })
    await stale.goto(`http://127.0.0.1:${PORT}/send.html?lang=en`)
    const banner = await stale.locator('body > div').first().innerText()

    check('a mismatched page says so, in words', /version/i.test(banner))
    check('and names what is missing', /step-chain/.test(banner))
    // The remedy has to be something a visitor can do. "Clear your cache" is
    // not, least of all in the MetaMask in-app browser.
    const escape = await stale.locator('body > div a').first().getAttribute('href')
    check('and offers a link with a fresh address', /[?&]v=/.test(escape ?? ''))
    // The thrown error is deliberate — it stops the script rather than letting
    // it run half-wired — but it must arrive after the banner, not instead of
    // it, and it must not be the null-property one.
    check('and does not fail with a null property',
      raw.length > 0 && !raw.some((m) => /Cannot (set|read) propert/.test(m)))
    await stale.close()
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
