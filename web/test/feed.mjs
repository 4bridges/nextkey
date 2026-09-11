/**
 * The live window, against a chain that says exactly what I tell it to.
 *
 * The container cannot reach Sepolia, and the feed is the one part of the page
 * that fails invisibly when it is wrong: an empty list looks like a quiet chain.
 * So the node is mocked and the answers are chosen — a grant, a withdrawal, a
 * post — and the page is asked to say what they mean.
 */
import { chromium } from 'playwright'
import { encodeAbiParameters, keccak256, toHex } from 'viem'
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
    const body = await readFile(join(ROOT, path === '/' ? '/explorer.html' : path))
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end('no') }
})
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const TEXT_UPDATED = '0x14cf4389d9a790cb32a054e033d7e3d3b78119dee4fea3c0983aac1db3f54015'
const HEAD = 11661900n

// The registrar, and the one call the mock answers for real. ENS answers
// address → name with a reverse record and almost nobody sets one; the
// registrar has to keep the mapping, because one name per address is a rule it
// enforces. So the address search asks ENS first and the registrar second, and
// the check below is that the second question is asked at all.
const NAMES_CONTRACT = '0xc3b7a8b73ed7022a594f236e60d33f5cc61b1863'
const CLAIMED_LABEL = 'claimed'
const CLAIMED_BY = '0x2222222222222222222222222222222222222222'

const log = (key, value, block, tx, index) => ({
  address: '0x04b2db6567cc68d059c061215adf9a99add1ca65',
  topics: [TEXT_UPDATED, toHex(1n, { size: 32 }), keccak256(toHex(key))],
  data: encodeAbiParameters([{ type: 'string' }, { type: 'string' }], [key, value]),
  blockNumber: toHex(block), transactionHash: tx, logIndex: toHex(index),
  transactionIndex: '0x0', blockHash: toHex(block, { size: 32 }), removed: false,
})

const FIRST = [
  log('nextkey.post', '{"v":1,"title":"Hello world!","body":"Hi Web3 Community!"}', 11661880n, '0x' + 'cd'.repeat(32), 0),
  log('nextkey.g2.251c755ded0bd0ebc999282cba38ce78', '{"v":1,"alg":"A256GCM","iv":"x","ct":"y"}', 11661869n, '0x' + '2a'.repeat(32), 0),
  log('nextkey.eph', '{"v":2,"iv":"a","ct":"b"}', 11661865n, '0x' + '6b'.repeat(32), 1),
  log('nextkey.secret', 'aQNEcatM31+Y78k7sUnBAy8QI9YL7h4gDziurOLklBg=', 11661865n, '0x' + '16'.repeat(32), 2),
  log('nextkey.g2.f762f10936e81f849447fe32cb34ea56', '', 11660735n, '0x' + '62'.repeat(32), 0),
  log('ens.something.else', 'not ours', 11660700n, '0x' + '99'.repeat(32), 0),
]
const ARRIVAL = [
  log('nextkey.post', '{"v":1,"title":"Hello world!","body":"Hi Web3 Community!"}', 11661902n, '0x' + 'ab'.repeat(32), 0),
]

let head = HEAD
let polls = 0
let refuse = false
let asked = null        // the address filter of the last getLogs
let lastTopics = null   // and its topics
const topicLog = []     // every topics array the node was asked for

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
// locale pinned: the page's own language comes from ?lang=, but anything
// formatted by the browser (numbers, dates) follows the browser instead.
const page = await browser.newPage({ locale: 'en-US' })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.route('https://ethereum-sepolia-rpc.publicnode.com/**', async (route) => {
  const body = JSON.parse(route.request().postData() ?? '{}')
  const calls = Array.isArray(body) ? body : [body]
  const answer = (c) => {
    if (c.method === 'eth_blockNumber') return toHex(head)
    if (c.method === 'eth_chainId') return '0xaa36a7'
    if (c.method === 'eth_getBlockByNumber') return { timestamp: '0x68be9f00', number: c.params[0], hash: toHex(1n, { size: 32 }) }
    if (c.method === 'eth_getLogs') {
      asked = c.params[0].address
      lastTopics = c.params[0].topics
      topicLog.push(c.params[0].topics)
      const from = BigInt(c.params[0].fromBlock)
      // topic2 is the indexed key: a filter the node answers itself. The mock
      // honours it, or the test would pass on a page that ignored it.
      const want = c.params[0].topics?.[2]
      const wanted = want === undefined || want === null ? null
        : (Array.isArray(want) ? want : [want]).map((h) => h.toLowerCase())
      const bykey = (l) => !wanted || wanted.includes(l.topics[2].toLowerCase())
      if (from > HEAD) { polls++; return ARRIVAL.filter((l) => BigInt(l.blockNumber) >= from && bykey(l)) }
      return FIRST.filter((l) => BigInt(l.blockNumber) >= from
        && BigInt(l.blockNumber) <= BigInt(c.params[0].toBlock) && bykey(l))
    }
    if (c.method === 'eth_call') {
      // Everything except the registrar answers nothing, which is what a
      // resolver lookup does here → the page falls back to the address.
      if (c.params?.[0]?.to?.toLowerCase() === NAMES_CONTRACT)
        return encodeAbiParameters([{ type: 'string' }], [CLAIMED_LABEL])
      return '0x'
    }
    return null
  }
  if (refuse && calls.some((c) => c.method === 'eth_getLogs' && c.params[0].topics)) {
    const err = { code: -32005, message: 'query returned more than 10000 results' }
    const out = calls.map((c) => ({ jsonrpc: '2.0', id: c.id, error: err }))
    return route.fulfill({ status: 200, contentType: 'application/json',
                           body: JSON.stringify(Array.isArray(body) ? out : out[0]) })
  }
  const out = calls.map((c) => ({ jsonrpc: '2.0', id: c.id, result: answer(c) }))
  await route.fulfill({ status: 200, contentType: 'application/json',
                        body: JSON.stringify(Array.isArray(body) ? out : out[0]) })
})

let passed = 0
let failed = 0
const check = (what, ok) => {
  console.log(`  ${ok ? '✓' : '✗'}  ${what}`)
  ok ? passed++ : failed++
}

// ?lang=en, not bare: with no language in the address the page follows the
// browser's own, so every assertion below about a sentence would depend on the
// locale of whoever runs this. On a German machine the whole English half of
// this suite failed while the page was working perfectly.
await page.goto(`${base}/explorer.html?lang=en`, { waitUntil: 'networkidle' })
await page.waitForSelector('#feed-out .ev', { timeout: 15_000 })

const text = await page.textContent('#feed-out')
check('the window fills itself, without a name being typed', (await page.locator('#feed-out .ev').count()) >= 4)
// The window is the page now. It used to be the third thing on it, under a
// heading asking for a name and a box to type one into; the box is gone and the
// window's own heading is the page's. A page that quietly grew a lookup form
// again would put the one thing here that needs nothing typed back below the
// fold.
check('the window is what the page opens with',
  /Everything happening on NextKey/.test((await page.textContent('h1')).trim()) &&
  (await page.locator('#name, #look, #try').count()) === 0)
check('a grant is described as a grant', /gave access/.test(text))
check('an emptied record reads as a withdrawal', /took a grant back/.test(text))
check('the ephemeral key is named for what it does', /set up grants settings/.test(text))
check('a record that is not ours is left out', !/ens\.something\.else/.test(text))
check('the record name is shown in full', /nextkey\.g2\.251c755ded0bd0ebc999282cba38ce78/.test(text))
check('the block is named', /11661869/.test(text))
check('and the transaction is one click away',
  (await page.locator('#feed-out a[href^="https://sepolia.etherscan.io/tx/"]').count()) >= 4)

// ── The live part ──
// The label is waited for, not sampled. The window says "Live" once its first
// fill has finished, and on a loaded machine that is a second or two later than
// this line is reached — a green check that depends on how busy the computer is
// says nothing about the page.
check('it says it is live', await page.waitForFunction(
  () => /Live/.test(document.getElementById('feed-live')?.textContent ?? ''),
  null, { timeout: 15_000 }).then(() => true).catch(() => false))

// The watcher starts BEFORE the arrival is triggered.
//
// The mark fades after six seconds by design, so looking for it after waiting
// for the post to appear is a race against that timer: the comment here used to
// claim it was caught as it appeared, and it was not — it was searched for
// afterwards, and on a slow run the class was already gone. Started first, the
// watcher is armed when the class is added, whatever the machine is doing.
const freshMark = page.waitForSelector('#feed-out .ev.fresh', { timeout: 20_000 })
  .then(() => true).catch(() => false)

head = 11661903n
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await page.waitForFunction(() => /Hello world/.test(document.getElementById('feed-out').textContent), null, { timeout: 10_000 })
const after = await page.textContent('#feed-out')
check('a new write arrives on its own', /published a Community post/.test(after))
check('and lands at the top', (await page.locator('#feed-out .ev').first().textContent()).includes('published a Community post'))
check('marked as an arrival', await freshMark)
check('and nothing that was already there is lost', /gave access/.test(after))

// ── Pause ──
await page.click('#feed-pause')
check('pausing says so', /Paused/.test(await page.textContent('#feed-live')))
check('and the button offers the way back', /Resume|Weiter/.test(await page.textContent('#feed-pause')))
const before = polls
head = 11661910n
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await page.waitForTimeout(1200)
check('a paused window does not poll', polls === before)

// ── Language ──
await page.click('#feed-pause')                      // resume, so the label is checked in German
await page.evaluate(() => localStorage.setItem('nextkey.lang', 'de'))
await page.goto(`${base}/explorer.html?lang=de`, { waitUntil: 'networkidle' })
await page.waitForSelector('#feed-out .ev', { timeout: 15_000 })
const de = await page.textContent('#feed-out')
check('the window speaks German too', /gab Zugriff/.test(de))
// The heading is the page's h1 now, not the section's h2 — the window is what
// this page opens with. Asserted through h1 so a heading that quietly moved
// back into the section is a failure rather than a silent pass.
check('including the heading', /Alles, was gerade auf NextKey passiert/.test(await page.textContent('h1')))

// ── More than one resolver, and it says which ──
check('every candidate resolver is watched in one query', Array.isArray(asked) && asked.length >= 1)
check('including the one written into the page',
  (asked ?? []).some((a) => a.toLowerCase() === '0x04b2db6567cc68d059c061215adf9a99add1ca65'))
check('and a ?resolver= is taken as another one', await (async () => {
  const extra = '0x1111111111111111111111111111111111111111'
  await page.goto(`${base}/explorer.html?lang=en&resolver=${extra}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('#feed-out .ev', { timeout: 15_000 })
  return (asked ?? []).some((a) => a.toLowerCase() === extra)
})())

// ── A node that will not answer must not read as a quiet chain ──
refuse = true
await page.goto(`${base}/explorer.html?lang=en`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => {
  const el = document.getElementById('feed-out')
  return el && !el.hidden && !/…$/.test(el.textContent.trim())
}, null, { timeout: 20_000 })
const denied = await page.textContent('#feed-out')
check('a refused query is reported as a refusal', /stopped answering|Der Knoten|refused/i.test(denied))
check('and not as an empty chain', !/Nothing yet</.test(denied) && !/Nothing yet\./.test(denied))
// Whatever the node said, in its own words rather than ours — viem normalises
// the wording, so the test asserts that a reason is shown, not which one.
const reason = (await page.locator('#feed-out .mono').first().textContent()).trim()
check('the node’s own reason is shown', reason.length > 5)
console.log(`      (it said: ${reason})`)
refuse = false

// ── The filters ──
// Back to English: the language test above left German in localStorage, and an
// assertion that passes only in one language is not an assertion.
await page.evaluate(() => localStorage.removeItem('nextkey.lang'))
await page.goto(`${base}/explorer.html?lang=en`, { waitUntil: 'networkidle' })
await page.waitForSelector('#feed-out .ev', { timeout: 15_000 })
check('there is a filter for each kind', (await page.locator('#feed-chips button').count()) === 6)
check('and everything is the one that starts pressed',
  (await page.getAttribute('#feed-chips button[data-f="all"]', 'aria-pressed')) === 'true')

topicLog.length = 0
await page.click('#feed-chips button[data-f="post"]')
await page.waitForFunction(() => {
  const el = document.getElementById('feed-out')
  return el && el.querySelectorAll('.ev').length > 0 && !/…$/.test(el.textContent.trim())
}, null, { timeout: 15_000 })
const posts = await page.textContent('#feed-out')
check('a post filter shows the post', /published a Community post/.test(posts))
check('and nothing else', !/gave access/.test(posts))
check('it was the node that selected them, and the page says so',
  /asked of the node directly/.test(posts))
check('the request really carried the key topic — the node did the selecting',
  topicLog.some((t) => Array.isArray(t?.[2]) && t[2].length === 5))

await page.click('#feed-chips button[data-f="granted"]')
await page.waitForFunction(() => /gave access/.test(document.getElementById('feed-out').textContent),
  null, { timeout: 15_000 })
const grants = await page.textContent('#feed-out')
check('a grant filter keeps only grants that were given', !/published a Community post/.test(grants))
check('and a withdrawal is not one of them', !/took a grant back/.test(grants))
check('and it admits it could not ask the node', /cannot select these|by hand/.test(grants))

await page.click('#feed-chips button[data-f="name"]')
// Caught as it appears rather than read afterwards, like the arrival mark
// above: the previous filter's fill can still be in flight and land on top of
// this message a moment later. Reading the element after the wait therefore
// failed on some runs and passed on others, which is worse than either.
const askedForName = await page.waitForFunction(
  () => /Type a name to see only its events/.test(document.getElementById('feed-out').textContent),
  null, { timeout: 15_000 }).then(() => true).catch(() => false)
check('the name filter asks for a name first', askedForName)
// A failed check that will not say what it saw instead is the error class this
// project keeps rediscovering, so it says.
if (!askedForName) {
  const saw = (await page.textContent('#feed-out')).trim().replace(/\s+/g, ' ')
  console.log(`      (the window said instead: ${saw.slice(0, 200)}${saw.length > 200 ? '…' : ''})`)
}
check('and offers a field to type it in', !(await page.locator('#feed-namerow').isHidden()))

// ── An address in the name box ──
// What a person has is a wallet, and what a wallet shows is an address. ENS
// alone would answer "no name" for almost every address on a testnet, so the
// registrar is asked too — and a name claimed on this site is then findable
// from its address in one call, with no sweep and no guessing.
await page.fill('#feed-name', CLAIMED_BY)
await page.click('#feed-namego')
const gotName = await page.waitForFunction(
  (want) => document.getElementById('feed-name').value === want,
  `${CLAIMED_LABEL}.nextkey.eth`, { timeout: 15_000 }).then(() => true).catch(() => false)
check('an address is answered by the registrar when ENS has no reverse record', gotName)
if (!gotName) console.log(`      (the box holds: ${await page.inputValue('#feed-name')})`)
check('and the address is not reported as nameless',
  !/knows a name for that address|kennt einen Namen/i.test(await page.textContent('#feed-out')))

await page.goto(`${base}/explorer.html?show=post`, { waitUntil: 'networkidle' })
await page.waitForSelector('#feed-out .ev', { timeout: 15_000 })
check('a filtered view is a link somebody can send',
  (await page.getAttribute('#feed-chips button[data-f="post"]', 'aria-pressed')) === 'true')

// ── Links ──
await page.goto(`${base}/explorer.html?lang=en`, { waitUntil: 'networkidle' })
await page.waitForSelector('#feed-out .ev', { timeout: 15_000 })
const targets = await page.$$eval('#feed-out a[href^="http"]',
  (as) => as.map((a) => a.target))
check('every outward link opens in its own tab', targets.length > 0 && targets.every((t) => t === '_blank'))
check('and none of them hands the new tab a handle back',
  (await page.$$eval('#feed-out a[target="_blank"]', (as) => as.map((a) => a.rel)))
    .every((r) => r.includes('noopener')))

await page.fill('#feed-name', 'vault.nextkey.eth')
await page.click('#feed-chips button[data-f="name"]')
await page.waitForTimeout(1500)
check('a filtered name offers the official ENS explorer, not only Etherscan',
  (await page.content()).includes('hackathon-deployment-portal-app.ens-cf.workers.dev/vault.nextkey.eth')
  || /no resolver|kein Resolver/i.test(await page.textContent('#feed-out')))

check('and the page raised no errors at all', errors.length === 0)
if (errors.length) console.log(errors)

await browser.close()
server.close()
console.log(`\n  ${failed ? `${failed} failed, ` : ''}${passed} checks passed.\n`)
process.exit(failed ? 1 : 0)
