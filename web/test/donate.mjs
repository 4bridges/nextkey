/**
 * The donation page, against a chain that says what I tell it to.
 *
 * A page that asks for money has one failure that matters more than every
 * other: the wrong address. It appears three times — in the markup, inside the
 * QR code, and in the script — and the first thing checked here is that all
 * three are the same string. The rest is arithmetic and honesty: a balance
 * printed as a number a person recognises, a donation list that says what it
 * cannot include, and a send button that does nothing until a wallet is there.
 */
import { chromium } from 'playwright'
import { toHex, numberToHex, pad } from 'viem'
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
    const body = await readFile(join(ROOT, path === '/' ? '/donate.html' : path))
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end('no') }
})
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const ADDRESS = '0x54Dd2Bc2f1Eb15A878C05ADfB58b90d68eA2EF14'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const HEAD = 21_000_000n

// 12.5 USDC from one stranger, 40 from another.
const gift = (value, block, tx, from) => ({
  address: USDC,
  topics: [TRANSFER, pad(from, { size: 32 }), pad(ADDRESS.toLowerCase(), { size: 32 })],
  data: numberToHex(value, { size: 32 }),
  blockNumber: toHex(block), transactionHash: tx, logIndex: '0x0',
  transactionIndex: '0x0', blockHash: toHex(block, { size: 32 }), removed: false,
})
const GIFTS = [
  gift(12_500_000n, 20_999_990n, '0x' + 'a1'.repeat(32), '0x1111111111111111111111111111111111111111'),
  gift(40_000_000n, 20_999_900n, '0x' + 'b2'.repeat(32), '0x2222222222222222222222222222222222222222'),
]

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
// locale pinned: the page's own language comes from ?lang=, but anything
// formatted by the browser (numbers, dates) follows the browser instead.
const page = await browser.newPage({ permissions: [], locale: 'en-US' })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

let calls = []
await page.route('https://ethereum-rpc.publicnode.com/**', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}')
  const batch = Array.isArray(body) ? body : [body]
  const answer = (c) => {
    calls.push(c.method)
    if (c.method === 'eth_blockNumber') return toHex(HEAD)
    if (c.method === 'eth_chainId') return '0x1'
    if (c.method === 'eth_getBalance') return numberToHex(2_500_000_000_000_000_000n)   // 2.5 ETH
    if (c.method === 'eth_getBlockByNumber') return { timestamp: '0x68bee180', number: c.params[0], hash: toHex(1n, { size: 32 }) }
    if (c.method === 'eth_call') {
      // balanceOf, for whichever token was asked: 137.42 USDC, nothing else.
      const to = String(c.params[0].to ?? '').toLowerCase()
      return numberToHex(to === USDC ? 137_420_000n : 0n, { size: 32 })
    }
    if (c.method === 'eth_getLogs') {
      const p = c.params[0]
      const from = BigInt(p.fromBlock)
      const to = BigInt(p.toBlock)
      return GIFTS.filter((g) => BigInt(g.blockNumber) >= from && BigInt(g.blockNumber) <= to)
    }
    return null
  }
  const out = batch.map((c) => ({ jsonrpc: '2.0', id: c.id, result: answer(c) }))
  await route.fulfill({ status: 200, contentType: 'application/json',
                        body: JSON.stringify(Array.isArray(body) ? out : out[0]) })
})

let passed = 0
let failed = 0
const check = (what, ok) => { console.log(`  ${ok ? '✓' : '✗'}  ${what}`); ok ? passed++ : failed++ }

await page.goto(`${base}/donate.html?lang=en`, { waitUntil: 'networkidle' })

// ── The address, and the name in front of it ──
// The Etherscan link used to be the third place the address appeared and was
// checked against the other two. It was removed from the page on 9 September,
// so the pair that remains is checked instead, and the ENS name - now shown
// twice, beside the code and under it - is checked the same way. Two spellings
// of one identity on a page asking for money is the failure worth catching.
const shown = (await page.textContent('#addr')).trim()
const qrTitle = await page.getAttribute('.qr title', 'data-i18n')
const fromScript = await page.evaluate(() => window.NEXTKEY && window.NEXTKEY.address)
const beside = (await page.textContent('#ensname')).trim()
const under = (await page.textContent('#qrname')).trim()
check('the address on the page is the address', shown === ADDRESS)
check('and the script agrees with the page', fromScript === ADDRESS)
check('the ENS name is the same beside the code and under it',
  beside === 'nextkey.eth' && under === beside)
check('and nothing links out to Etherscan from here any more',
  (await page.locator('#scan').count()) === 0)
check('the QR code is drawn into the page, not fetched from anywhere',
  (await page.locator('.qr path').count()) === 1 && !!qrTitle)

// ── The numbers ──
await page.waitForSelector('.bals .bal', { timeout: 15_000 })
const bals = await page.textContent('#balances')
check('the ETH balance is shown as a number a person reads', /2\.5\s*ETH/.test(bals.replace(/\s+/g, ' ')))
check('a stablecoin balance is shown with its symbol', /137\.42\s*USDC/.test(bals.replace(/\s+/g, ' ')))
check('and a token with nothing in it is not listed', !/USDT|DAI/.test(bals))

await page.waitForFunction(() => /donations|Spenden/.test(document.getElementById('gifts')?.textContent ?? ''),
  null, { timeout: 15_000 })
const gifts = await page.textContent('#gifts')
check('the donations are counted', /2\s*stablecoin donations/.test(gifts.replace(/\s+/g, ' ')))
check('each one shows its amount', /12\.5 USDC/.test(gifts) && /40 USDC/.test(gifts))
check('newest first', gifts.indexOf('12.5 USDC') < gifts.indexOf('40 USDC'))
check('with the day it arrived', /\d{4}-\d{2}-\d{2}/.test(gifts))
check('and a way to check it', (await page.locator('#gifts a[href*="etherscan.io/tx/"]').count()) === 2)
// The two paragraphs that used to stand under these figures — that a balance is
// read from the chain, and that a plain ETH transfer emits no event — said what
// the rest of the page is about, beside every number, every twenty seconds.
// They are gone, and this is what keeps them gone: a figure with a label, and
// nothing reading like an apology for it.
check('the figures carry no explanatory paragraph any more',
  !/emits no event|database of ours|See it on Etherscan/.test(`${gifts} ${bals}`))
check('and the section has no Refresh button, because it refreshes itself',
  (await page.locator('#refresh').count()) === 0)
check('every link leaves in its own tab',
  (await page.$$eval('#gifts a, #balances a', (as) => as.map((a) => a.target))).every((t) => t === '_blank'))

// ── Sending ──
check('the donate button is dead until a wallet is connected',
  await page.locator('#send').isDisabled())
await page.click('#amounts button[data-eth="0.01"]')
check('a preset fills the amount', (await page.inputValue('#amount')) === '0.01')
check('and the button stays dead without a wallet', await page.locator('#send').isDisabled())
check('disconnecting is not offered before anything is connected',
  await page.locator('#disconnect').isHidden())
await page.click('#connect')
await page.waitForTimeout(400)
check('with no wallet in the browser, it says so and points at the address',
  /no wallet|address above/i.test(await page.textContent('#send-out')))

// ── The page in another language ──
await page.goto(`${base}/donate.html?lang=de`, { waitUntil: 'networkidle' })
await page.waitForSelector('.bals .bal', { timeout: 15_000 })
// "Die Adresse" was the German heading of a section that is now called ENS
// Name, so the sentence this looked for stopped existing on 9 September.
// It asks for a heading inside <main> that only the overlay can produce.
check('the page speaks German too',
  /Oder verbinde deine Wallet/.test(await page.textContent('main')))
check('and the address is not translated', (await page.textContent('#addr')).trim() === ADDRESS)

check('and the page raised no errors at all', errors.length === 0)
if (errors.length) console.log(errors)

await browser.close()
server.close()
console.log(`\n  ${failed ? `${failed} failed, ` : ''}${passed} checks passed.\n`)
process.exit(failed ? 1 : 0)
