/**
 * The Sandbox page, and the one thing it must never do.
 *
 * This page documents an endpoint that lives somewhere else. A documentation
 * page is making a claim about something outside itself, and it goes on making
 * it after that something stops answering — which is how a project ships a page
 * confidently describing a 502. So the page asks rather than asserts, and this
 * suite exists mostly to hold it to that.
 *
 * The strongest check here is the failing one. There is no API in this test, so
 * the probe cannot succeed; what is asserted is that the page then *says so*,
 * and that it says the rest of the page does not depend on it. A page that
 * printed "live" against nothing would pass every other check in this file.
 *
 *   node web/test/sandbox.mjs
 *
 * Needs Playwright and nothing else — no wallet, no funds, no chain. The bundle
 * must be current: this loads web/sandbox.js, the file the site ships.
 */
import { chromium } from 'playwright'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' }

// The same rewrite the host performs, so the page is exercised at the depth it
// actually runs at — /demo/sandbox, not /sandbox.html. The prefix is what the
// page reads to decide whether to ask /demo/v1 or /v1, so serving it flat would
// test a code path no visitor reaches.
const rewrite = (url) => url
  .replace(/^\/demo\/(passphrase|message)\/?$/, '/send.html')
  .replace(/^\/demo\/([A-Za-z0-9_-]+)\/?$/, '/$1.html')

const server = http.createServer(async (req, res) => {
  // Resolve the file first, then type it from the file. Typing it from the
  // *request* path served `/` as application/octet-stream, and Chromium
  // answered by downloading the landing page instead of rendering it — which
  // arrives as "Download is starting" and reads like a broken page rather than
  // a wrong header.
  const file = rewrite(decodeURIComponent(req.url.split('?')[0]))
  const resolved = file === '/' ? '/index.html' : file
  try {
    const body = await readFile(join(ROOT, resolved))
    res.writeHead(200, { 'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end('no') }
})
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
const page = await browser.newPage({ locale: 'en-US' })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

let passed = 0
let failed = 0
const check = (what, ok) => { console.log(`  ${ok ? '✓' : '✗'}  ${what}`); ok ? passed++ : failed++ }
const text = async (sel = 'body') => (await page.textContent(sel)).replace(/\s+/g, ' ')

// ── With no API to answer ───────────────────────────────────────────────────
console.log('\n  When the API is not there\n')

// Point it at a port nothing is listening on. This is the state the page will
// be in for anybody reading it before the worker is deployed, and it is the
// state the page must handle without lying.
const DEAD = 'http://127.0.0.1:1'
await page.goto(`${base}/demo/sandbox?lang=en&api=${encodeURIComponent(DEAD)}`,
                { waitUntil: 'networkidle' })

check('the page is the sandbox', (await page.textContent('h1')).trim() === 'Build with the NextKey ID')

const health = await text('#api-health')
check('it says it could not reach the API, rather than that it is live',
  /could not reach/i.test(health) && !/Answering, right now/i.test(health))
check('and says the rest of the page does not depend on it',
  /Nothing on the rest of this page depends on it/i.test(health))
check('and names the address it tried, so a wrong one is visible',
  (await page.textContent('#api-base')).includes('127.0.0.1:1'))

// ── The address it would ask ────────────────────────────────────────────────
console.log('\n  The address it would ask\n')

check('the network comes from the path, not from a build flag',
  (await page.evaluate(() => window.NEXTKEY_SANDBOX.base)).endsWith('/demo/v1'))
check('and the examples on the page carry that same address',
  (await page.textContent('#try-url')).startsWith(`${DEAD}/demo/v1/name/`))

await page.fill('#try-name', 'anna.nextkey.eth')
check('the URL is shown before anything is sent',
  (await page.textContent('#try-url')) === `${DEAD}/demo/v1/name/anna.nextkey.eth`)

await page.fill('#try-name', '')
await page.click('#try-go')
check('an empty name asks for one rather than sending a request for nothing',
  /A name first/i.test(await text('#try-out')))

// ── What the page must say, whatever else changes ───────────────────────────
console.log('\n  The claims that have to survive an edit\n')

const body = await text()
check('the API is described as read-only, holding no key',
  /holds no key, signs nothing, writes nothing/i.test(body))
check('and as something nothing here depends on',
  /Take it away and nothing stops working/i.test(body))
check('the record format is offered as the real interface',
  /nextkey\.pubkey/.test(body) && /nextkey\.eph/.test(body) && /nextkey\.secret/.test(body))
check('the two kinds of "no" are both named',
  /no_published_key/.test(body) && /upstream_unavailable/.test(body))
// The one a reader meets most: a name that exists on production ENS and not
// here. Reporting that as "carries no records" asserts the name exists, which
// is the confusion this project has now made three times.
check('and so is the difference between an empty name and an absent one',
  /not_on_this_deployment/.test(body))
// The sentence that admits what running a server costs. It is the one a reader
// who cares about privacy is here for, and the easiest to lose in a tidy-up.
check('what the API costs in privacy is stated, not implied',
  /telling us which name/i.test(body) || /telling us which name you are looking up/i.test(body))
check('and it points at the privacy notice',
  (await page.locator('a[href="/privacy"]').count()) >= 1)

// ── Elsewhere ───────────────────────────────────────────────────────────────
console.log('\n  Elsewhere on the site\n')

await page.goto(`${base}/?lang=en`, { waitUntil: 'domcontentloaded' })
check('the landing page offers the sandbox in its tab bar',
  (await page.locator('.barnav a[href="./sandbox"]').count()) === 1)
check('and no longer sends anyone to a tab called demo',
  (await page.locator('.barnav a[href="./demo"]').count()) === 0)
check('the four tabs are named on the landing page itself',
  (await page.locator('dl.tabs dt a').count()) === 4)
// Asserted against the whole page rather than one selector: which chain this
// is has to be *somewhere* a reader meets, and pinning it to a particular
// paragraph would fail the next time that paragraph moves — a check that breaks
// on a layout change teaches the next person to stop trusting it.
check('and it says which chain this is',
  /Sepolia testnet/i.test(await text()))

await page.goto(`${base}/imprint.html?lang=en`, { waitUntil: 'domcontentloaded' })
check('the imprint names the one server we do run',
  /api\.nextkey\.li/.test(await text()))

await page.goto(`${base}/privacy.html?lang=en`, { waitUntil: 'domcontentloaded' })
const priv = await text()
check('the privacy notice names it too',
  /api\.nextkey\.li/.test(priv))
check('and says what using it reveals',
  /telling us which name you are looking up/i.test(priv))
check('and that there is nowhere for it to be written down',
  /no request log/i.test(priv))
check('and does not hide the part we do not control',
  /Cloudflare/.test(priv))

check('and no page raised an error at all', errors.length === 0)

await browser.close()
server.close()
console.log(failed ? `\n  ${failed} of ${passed + failed} failed.\n` : `\n  ${passed} checks passed.\n`)
if (failed) process.exitCode = 1
