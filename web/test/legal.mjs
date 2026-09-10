/**
 * The imprint and the privacy notice, checked like everything else.
 *
 * These two pages carry no chain code and no bundle, so nothing here mocks a
 * node. What they do carry is the only text on this site that has to be true in
 * a legal sense, and two claims the rest of the project keeps making about
 * itself: that the pages contact nobody, and that they say plainly what a
 * public chain does with what you write. Both are checkable, so they are
 * checked.
 *
 *   node web/test/legal.mjs
 *
 * Needs Playwright and nothing else — no wallet, no funds, no network.
 */
import { chromium } from 'playwright'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolved from this file, not from the working directory and not from an
// absolute path: this suite has to run in a fresh clone on any machine.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png' }

const server = http.createServer(async (req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0])
  try {
    const body = await readFile(join(ROOT, path === '/' ? '/imprint.html' : path))
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end('no') }
})
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
// locale pinned: the page's own language comes from ?lang=, but anything
// formatted by the browser follows the browser instead.
const page = await browser.newPage({ locale: 'en-US' })
const errors = []
const offsite = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('request', (r) => { if (!r.url().startsWith(base)) offsite.push(r.url()) })

let passed = 0
let failed = 0
const check = (what, ok) => { console.log(`  ${ok ? '✓' : '✗'}  ${what}`); ok ? passed++ : failed++ }
const text = async (sel = 'body') => (await page.textContent(sel)).replace(/\s+/g, ' ')

// ── The imprint ─────────────────────────────────────────────────────────────
console.log('\n  The imprint\n')
await page.goto(`${base}/imprint.html?lang=en`, { waitUntil: 'networkidle' })
let body = await text()

check('the page is the imprint', (await page.textContent('h1')).trim() === 'Imprint')
check('the operator is named with a postal address',
  /4bridges by Fundel/.test(body) && /Goethestrasse 33/.test(body) && /9008 St\. Gallen/.test(body))
check('and the responsible address is a mailto link, not a picture of one',
  (await page.locator('a[href="mailto:hello@nextkey.li"]').count()) >= 1)
// The old contact address was 4bridges.ch. One responsible address, or none is
// authoritative.
check('and it is the only contact address on the page', !/4bridges\.ch/.test(body))

check('it says what this is not', /not a bank|not a custodian/i.test(body))
check('and that the network carries no money', /no monetary value/i.test(body))
check('the licence is named, and named correctly',
  /AGPL-3\.0-or-later/.test(body) && /without any warranty/i.test(body))
check('the marks of others are marked as theirs',
  /ENS/.test(body) && /Chainlink/.test(body) && /Ledger/.test(body)
  && /trademarks of\s+their respective owners|respective owners/i.test(body))
check('and no partnership is implied', /no partnership, sponsorship or endorsement|imply no/i.test(body))
check('a donation is described as irreversible', /cannot be reversed or refunded/i.test(body))
check('the forum is named', /St\. Gallen, Switzerland/.test(body))
check('and the English version is declared binding', /English version is the binding/i.test(body))

check('the footer leads home first',
  (await page.locator('footer a').first().getAttribute('href')) === '/')
check('and the house is named for anyone not looking at pixels',
  (await page.locator('footer .foothome .vh').textContent()).trim() === 'Home')
check('it offers the privacy notice', (await page.locator('footer a[href="/privacy"]').count()) === 1)
check('and does not link to the page you are on',
  (await page.locator('footer a[href="/imprint"]').count()) === 0)

// ── The privacy notice ──────────────────────────────────────────────────────
console.log('\n  The privacy notice\n')
await page.goto(`${base}/privacy.html?lang=en`, { waitUntil: 'networkidle' })
body = await text()

check('the page is the privacy notice', (await page.textContent('h1')).trim() === 'Privacy')
check('the controller is named with a postal address',
  /4bridges by Fundel/.test(body) && /Goethestrasse 33/.test(body))
check('the promise about tracking is made in words that can be checked',
  /No tracking cookies, no analytics/i.test(body))
check('the nodes your browser talks to are named',
  /ethereum-sepolia-rpc\.publicnode\.com/.test(body) && /ethereum-rpc\.publicnode\.com/.test(body))
// The sentence that matters more than the rest of the notice: reading a name is
// not private, and the page says so rather than letting it be discovered.
check('and it says what they learn', /which names you look up/i.test(body))
check('the chain is described as permanent', /public, permanent/i.test(body))
check('and the limit of the right to erasure is stated, not buried',
  /cannot be fulfilled for data that is already on chain/i.test(body))
check('a lent name is called what it is', /attributable to that name/i.test(body))
check('the supervisory authorities are named', /FDPIC/.test(body))

check('the footer leads home first',
  (await page.locator('footer a').first().getAttribute('href')) === '/')
check('it offers the imprint', (await page.locator('footer a[href="/imprint"]').count()) === 1)
check('and does not link to the page you are on',
  (await page.locator('footer a[href="/privacy"]').count()) === 0)

// ── What these two pages must not do ────────────────────────────────────────
console.log('\n  What these pages do not do\n')
check('neither page loads a bundle, so neither can fall out of step with one',
  (await page.locator('script[type="module"]').count()) === 0)
check('and nothing on them is fetched from anywhere but this server',
  offsite.length === 0)
if (offsite.length) console.log(`      (it asked for: ${offsite.slice(0, 3).join(', ')})`)

// ── The overlay ─────────────────────────────────────────────────────────────
console.log('\n  In another language\n')
await page.goto(`${base}/imprint.html?lang=de`, { waitUntil: 'networkidle' })
body = await text()
check('the imprint speaks German too', /Impressum/.test(await page.textContent('h1')) && /Betreiber/.test(body))
// A translated legal text is a reading aid, and says so in the language it is
// read in. That sentence is the reason the translations are safe to ship.
check('and says there which version binds', /englische\s+Fassung/i.test(body))
check('the postal address is not translated', /Goethestrasse 33/.test(body) && /Switzerland/.test(body))

await page.goto(`${base}/privacy.html?lang=fa`, { waitUntil: 'networkidle' })
check('the privacy notice reads right to left in Persian',
  (await page.getAttribute('html', 'dir')) === 'rtl')
check('and the endpoints stay in Latin script there',
  /publicnode\.com/.test(await text()))

check('and no page raised an error at all', errors.length === 0)
if (errors.length) console.log(errors)

await browser.close()
server.close()
console.log(`\n  ${failed ? `${failed} failed, ` : ''}${passed} checks passed.\n`)
if (failed) process.exitCode = 1
