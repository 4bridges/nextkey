/**
 * The community window, against a chain that says what I tell it to.
 *
 * The thing worth testing here is not that a request went out — it is what a
 * reader ends up looking at. A post must arrive as a sentence, not as the JSON
 * it is stored in; the date must come from the block rather than from whatever
 * the post claims about itself; and a name must appear only where the page can
 * actually prove which record it belongs to.
 */
import { chromium } from 'playwright'
import { encodeAbiParameters, keccak256, toHex, namehash, numberToHex } from 'viem'
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
    const body = await readFile(join(ROOT, path === '/' ? '/blog.html' : path))
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
    res.end(body)
  } catch { res.writeHead(404); res.end('no') }
})
await new Promise((r) => server.listen(0, r))
const base = `http://127.0.0.1:${server.address().port}`

const TEXT_UPDATED = '0x14cf4389d9a790cb32a054e033d7e3d3b78119dee4fea3c0983aac1db3f54015'
const TOPIC_RECORD = '0x66fd1d4edf16fc35ee08adaecfdf6fd5f75283da903b50f642558d6e0ba630ff'
const HEAD = 11661900n

const RECORD_ANNA = numberToHex(7n, { size: 32 })
const RECORD_STRANGER = numberToHex(99n, { size: 32 })

const write = (key, value, block, tx, record, index = 0) => ({
  address: '0x04b2db6567cc68d059c061215adf9a99add1ca65',
  topics: [TEXT_UPDATED, record, keccak256(toHex(key))],
  data: encodeAbiParameters([{ type: 'string' }, { type: 'string' }], [key, value]),
  blockNumber: toHex(block), transactionHash: tx, logIndex: toHex(index),
  transactionIndex: '0x0', blockHash: toHex(block, { size: 32 }), removed: false,
})

const creation = (record, name, block) => ({
  address: '0x04b2db6567cc68d059c061215adf9a99add1ca65',
  topics: [TOPIC_RECORD, record, namehash(name)],
  data: '0x', blockNumber: toHex(block), transactionHash: '0x' + '11'.repeat(32),
  logIndex: '0x0', transactionIndex: '0x0', blockHash: toHex(block, { size: 32 }), removed: false,
})

const POSTS = [
  write('nextkey.post', '{"v":1,"title":"Hello world!","body":"Hi Web3 Community!","at":"2020-01-01T00:00:00.000Z"}',
        11661890n, '0x' + 'aa'.repeat(32), RECORD_ANNA),
  write('nextkey.post.2', '{"v":1,"title":"Second","body":"from a name nobody here knows"}',
        11661870n, '0x' + 'bb'.repeat(32), RECORD_STRANGER),
  write('nextkey.post', '', 11661860n, '0x' + 'cc'.repeat(32), RECORD_ANNA),   // taken down
]
const CREATED = [creation(RECORD_ANNA, 'anna.nextkey.eth', 11661800n)]
const ARRIVAL = [
  write('nextkey.post.3', '{"v":1,"title":"Just now","body":"live from the chain"}',
        11661902n, '0x' + 'dd'.repeat(32), RECORD_ANNA),
]

let head = HEAD
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
    if (c.method === 'eth_getBlockByNumber') {
      // Every block reports the same day, which is the point: the page must
      // print this and not the post's own "at".
      return { timestamp: '0x68bee180', number: c.params[0], hash: toHex(1n, { size: 32 }) }
    }
    if (c.method === 'eth_getLogs') {
      const p = c.params[0]
      const from = BigInt(p.fromBlock)
      const to = BigInt(p.toBlock)
      const inRange = (l) => BigInt(l.blockNumber) >= from && BigInt(l.blockNumber) <= to
      if (p.topics?.[0] === TOPIC_RECORD) {
        const forRecord = p.topics?.[1]
        return CREATED.filter(inRange).filter((l) =>
          !forRecord || l.topics[1].toLowerCase() === String(forRecord).toLowerCase())
      }
      const want = p.topics?.[2]
      const wanted = want ? (Array.isArray(want) ? want : [want]).map((h) => h.toLowerCase()) : null
      const byKey = (l) => !wanted || wanted.includes(l.topics[2].toLowerCase())
      if (from > HEAD) return ARRIVAL.filter((l) => BigInt(l.blockNumber) >= from && byKey(l))
      return POSTS.filter((l) => inRange(l) && byKey(l))
    }
    if (c.method === 'eth_call') return '0x'
    return null
  }
  const out = calls.map((c) => ({ jsonrpc: '2.0', id: c.id, result: answer(c) }))
  await route.fulfill({ status: 200, contentType: 'application/json',
                        body: JSON.stringify(Array.isArray(body) ? out : out[0]) })
})

let passed = 0
let failed = 0
const check = (what, ok) => { console.log(`  ${ok ? '✓' : '✗'}  ${what}`); ok ? passed++ : failed++ }

await page.goto(`${base}/blog.html?lang=en`, { waitUntil: 'networkidle' })
// If the window never fills, every check below fails for the same reason and
// none of them says why. So the wait reports instead of throwing: what the page
// put there, and whatever it threw while doing it.
const filled = await page.waitForSelector('.bubble', { timeout: 15_000 })
  .then(() => true).catch(() => false)
if (!filled) {
  // Asked of the document rather than of a locator: waiting for an element is
  // how this went blind in the first place, and the interesting case is exactly
  // the one where the element is not there.
  const seen = await page.evaluate(() => ({
    url: location.href,
    title: document.title,
    hasPosts: !!document.getElementById('posts'),
    ids: [...document.querySelectorAll('[id]')].map((e) => e.id).slice(0, 25),
    body: (document.body?.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 400),
  }))
  console.log(`\n  The window never filled.`)
  console.log(`  url:        ${seen.url}`)
  console.log(`  title:      ${seen.title}`)
  console.log(`  #posts:     ${seen.hasPosts ? 'present' : 'MISSING'}`)
  console.log(`  ids seen:   ${seen.ids.join(', ') || '(none)'}`)
  console.log(`  body:       ${seen.body || '(empty)'}`)
  console.log(`  errors:     ${errors.length ? errors.join(' | ').slice(0, 500) : '(none)'}\n`)
  process.exit(1)
}

const text = await page.textContent('#posts')
check('the window fills itself, with no button pressed', (await page.locator('.bubble').count()) >= 2)
check('a post reads as a sentence', /Hello world! Hi Web3 Community!/.test(text))
check('and not as the JSON it is stored in', !/"body"|\{"v":1/.test(text))
check('a post that was taken down is not shown', (await page.locator('.bubble').count()) === 2)
check('the newest is at the top',
  (await page.locator('.bubble').first().textContent()).includes('Hello world!'))
check('a name is shown where the page can prove it', /anna\.nextkey\.eth/.test(text))
check('and left off where it cannot', /from a name nobody here knows/.test(text))
check('the unnamed post is not given a borrowed author',
  !(await page.locator('.bubble').nth(1).textContent()).includes('anna.nextkey.eth'))

const meta = await page.locator('.bubblemeta').first().textContent()
check('the date is the day, and only the day', /\d{4}-\d{2}-\d{2}/.test(meta) && !/\d{2}:\d{2}/.test(meta))
check('and it comes from the block, not from the post’s own claim', !/2020-01-01/.test(meta))
check('there is a small way out to the ENS explorer',
  (await page.locator('.bubblemeta a[href*="ens-cf.workers.dev/anna.nextkey.eth"]').count()) === 1)
check('and a post with no name still links to its transaction',
  (await page.locator('.bubblemeta a[href*="etherscan.io/tx/"]').count()) >= 1)
check('every way out opens in its own tab',
  (await page.$$eval('.bubblemeta a', (as) => as.map((a) => a.target))).every((t) => t === '_blank'))

check('the page says it is live', /Live/.test(await page.textContent('#blog-live')))
head = 11661903n
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
await page.waitForFunction(() => /live from the chain/.test(document.getElementById('posts').textContent),
  null, { timeout: 10_000 })
check('a post written while you watch arrives on its own', true)
check('and lands at the top',
  (await page.locator('.bubble').first().textContent()).includes('Just now'))

check('the window has no controls to fiddle with',
  (await page.locator('#load, #blog-pause').count()) === 0)

// The search used to stand open above the posts, asking a question nobody
// arrived with. It is a symbol now, and what it opens belongs to the same
// frame as the posts — not a second box stacked on top of them.
check('the search is a symbol until it is asked for',
  (await page.locator('#filter-toggle').count()) === 1 &&
  await page.locator('#filter-row').isHidden())
await page.click('#filter-toggle')
check('and one press makes it the first line of the frame',
  await page.locator('#filter-row').isVisible() &&
  (await page.evaluate(() => document.querySelector('#posts-frame').firstElementChild?.id)) === 'filter-row')
check('and it says so for a screen reader too',
  (await page.getAttribute('#filter-toggle', 'aria-expanded')) === 'true')
await page.click('#filter-toggle')

// ── The page's own shape ──
check('the heading is the one asked for', /Community Posts/.test(await page.textContent('h1')))
check('the window is not a numbered step any more',
  (await page.locator('.step .n').count()) === 2)
check('writing is step one, and it is called writing a post',
  (await page.textContent('.step:has(#post-lent) h2')).includes('Write a post'))
check('and editing is step two',
  (await page.textContent('.step:has(#edit-save) h2')).includes('Edit a post'))
check('both steps start closed', (await page.locator('.fold[open]').count()) === 0)
check('and the posts are what is visible without opening anything',
  await page.locator('.bubble').first().isVisible() && !(await page.locator('#post-lent').isVisible()))
await page.locator('.step:has(#post-lent) .fold > summary').click()
check('opening one shows its form', await page.locator('#post-lent').isVisible())
check('and leaves the other closed', !(await page.locator('#edit-load').isVisible()))
check('the box about what the page will not show is gone',
  (await page.locator('.fallback').count()) === 0)

// ── The name under the bubble ──
check('the name sits under the bubble, not inside it',
  (await page.locator('.post > .bubble + .bubblemeta').count()) >= 2)
check('and it links to that name in the ENS explorer',
  (await page.locator('.bubblemeta a.mono[href*="ens-cf.workers.dev/anna.nextkey.eth"]').count()) >= 1)
check('a post whose name cannot be proved says so rather than borrowing one',
  /cannot name/.test(await page.textContent('#posts')))

// ── Editing ──
await page.locator('.step:has(#edit-save) .fold > summary').click()
await page.fill('#edit-name', 'anna.nextkey.eth')
await page.click('#edit-load')
await page.waitForTimeout(600)
const list = await page.textContent('#edit-list')
check('editing offers what is actually on the name',
  /Edit this one|nothing published|Nothing published/i.test(list))
check('and asks for a wallet before it writes anything', await (async () => {
  const btn = await page.locator('#edit-list button[data-slot]').count()
  if (!btn) return true                       // nothing to edit on a mocked read
  await page.locator('#edit-list button[data-slot]').first().click()
  await page.click('#edit-save')
  await page.waitForTimeout(300)
  return /wallet/i.test(await page.textContent('#edit-out'))
})())
check('and the navigation calls it the blog', /Blog/.test(await page.textContent('nav')))
check('a house leads home, before the rest',
  (await page.locator('.barnav > a').first().getAttribute('href')) === '/'
  && (await page.locator('.barnav .navhome svg').count()) === 1)
check('and it is named for anyone not looking at pixels',
  /Home/.test(await page.locator('.barnav .navhome').getAttribute('title'))
  && (await page.locator('.barnav .navhome .vh').textContent()).trim() === 'Home')
check('the icon has a translated tooltip too', await (async () => {
  await page.goto(`${base}/blog.html?lang=de`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.documentElement.dataset.i18nLang === 'de', null, { timeout: 5000 }).catch(() => {})
  return (await page.locator('.barnav .navhome').getAttribute('title')) === 'Startseite'
})())
check('the crossed-out provenance line is gone', (await page.locator('.provenance').count()) === 0)

// ── The house, on every page ──
//
// It broke on exactly the two pages nobody thought to look at. An element with
// only a title to translate had a null key, and the older overlay on index and
// poc wrote base[null] — the element's own text — over its contents, replacing
// the icon with the word it had just collected from it. So this walks all five.
for (const p of ['index.html', 'poc.html', 'send.html', 'blog.html', 'explorer.html']) {
  await page.goto(`${base}/${p}?lang=en`, { waitUntil: 'domcontentloaded' })
  const seen = await page.evaluate(() => {
    const a = document.querySelector('.barnav .navhome')
    if (!a) return null
    const svg = a.querySelector('svg')
    const label = a.querySelector('.vh')
    return {
      icon: svg ? svg.getBoundingClientRect().width : 0,
      label: label ? label.getBoundingClientRect().width : -1,
      href: a.getAttribute('href'),
    }
  })
  check(`the house survives the overlay on ${p}`,
    !!seen && seen.icon > 8 && seen.label <= 2 && seen.href === '/')
}

// ── The bar, at the width a phone actually has ──
//
// This is the part of the page 318 checks could not see. The bar was eight
// words in a flex row that never wrapped: 462px of them in a 375px window, so
// explorer, blog and donate were cut off the right edge — and because the page
// does not scroll sideways, there was no gesture that reached them. Three
// destinations simply did not exist on a phone, and every existing check passed
// while that was true, because every one of them asks whether an element is
// *there* and none asks whether it is *reachable*.
//
// So: all eight, inside the window, at the narrowest width worth supporting.
await page.setViewportSize({ width: 320, height: 720 })
await page.goto(`${base}/blog.html?lang=en`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(200)

const bar = await page.evaluate(() => {
  const d = document.documentElement
  const links = [...document.querySelectorAll('.barnav > a')]
  const lang = document.getElementById('langbtn')
  return {
    count: links.length,
    named: links.every((a) => {
      const svg = a.querySelector('svg')
      const vh = a.querySelector('.vh')
      return svg && svg.getBoundingClientRect().width > 8
        && vh && vh.textContent.trim().length > 0
        && (a.getAttribute('title') || '').trim().length > 0
    }),
    clipped: links.filter((a) => a.getBoundingClientRect().right > d.clientWidth + 1).length,
    sideways: d.scrollWidth > d.clientWidth + 1,
    lastRight: links.length ? Math.round(links[links.length - 1].getBoundingClientRect().right) : 0,
    langRight: lang ? Math.round(lang.getBoundingClientRect().right) : -1,
  }
})

check('every destination in the bar is a symbol with a name behind it',
  bar.count === 8 && bar.named)
check('and none of them is cut off at 320px',
  bar.clipped === 0 && !bar.sideways)
// The row above ends at the language button. The bar is spread to the same
// edge, so a drift here is the layout quietly going back to hugging one side.
check('and the bar reaches the same edge as the controls above it',
  Math.abs(bar.lastRight - bar.langRight) <= 2)

// A row of destinations that includes the page already open offers a journey
// to where the reader is standing. The link is removed, not dimmed, so it is
// gone for a screen reader too.
check('the footer does not offer the page you are on',
  (await page.locator('footer .footnav a[href="./blog"]').count()) === 0 &&
  (await page.locator('footer .footnav a[href="./explorer"]').count()) === 1)
// Every tab that writes to a chain says which chain, and that nobody audited
// it — on the tab itself, where somebody about to press a button is looking.
check('and the tab says what it is running on, and what it is not',
  /Sepolia testnet/i.test(await page.textContent('footer')) &&
  /not audited/i.test(await page.textContent('footer')))

check('and the page raised no errors at all', errors.length === 0)
if (errors.length) console.log(errors)

await browser.close()
server.close()
console.log(`\n  ${failed ? `${failed} failed, ` : ''}${passed} checks passed.\n`)
process.exit(failed ? 1 : 0)
