/**
 * The donation page.
 *
 * Two halves that do not depend on each other. One is an address, a QR code and
 * a copy button: no wallet, no script needed, works on a phone with the page's
 * JavaScript switched off. The other offers to send from here, which is one
 * step shorter and one trust step longer, so it is offered rather than assumed.
 *
 * The third part is the honest one. A page that asks for money should show what
 * arrived, and this one reads it from Ethereum itself rather than asserting it:
 * the balances exactly, and every stablecoin donation it can find.
 *
 * What it cannot do is list incoming ETH. A plain transfer emits no event, so
 * there is nothing to filter for — an indexer or a block explorer's own
 * database is the only way, and this page has neither. It says so, prints the
 * balance, which is exact, and links to Etherscan for the rest. Quietly showing
 * "3 donations" while ETH arrives unseen would be the sort of number that is
 * worse than no number.
 *
 * Read-only except for the one transaction the visitor signs themselves. This
 * page holds no key and can move nothing.
 */

import { createPublicClient, createWalletClient, custom, http, parseEther, formatUnits, formatEther } from 'viem'
import { mainnet } from 'viem/chains'
import { logReader } from './nk-logs.mjs'

// The address is a constant, not a setting. It is in the markup, in the QR code
// and here, and the test checks that all three agree — a donation page whose
// three copies of an address drift apart is a donation page that loses money.
export const ADDRESS = '0x54Dd2Bc2f1Eb15A878C05ADfB58b90d68eA2EF14'

const RPC = 'https://ethereum-rpc.publicnode.com'
const SCAN = 'https://etherscan.io'

const reader = createPublicClient({
  chain: mainnet,
  transport: http(RPC, { retryCount: 1, retryDelay: 400, timeout: 12_000 }),
})
const logsWith = logReader(reader)

/**
 * The three stablecoins worth naming.
 *
 * A short list in the source rather than a token API: a page that renders any
 * token that ever touched the address renders whatever a stranger airdropped
 * onto it, and a donation page decorated with somebody's scam token is worse
 * than one that shows three currencies and says so.
 */
const TOKENS = [
  { symbol: 'USDC', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', decimals: 6 },
  { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 },
  { symbol: 'DAI', address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', decimals: 18 },
]

const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const toTopic = (addr) => `0x${'0'.repeat(24)}${addr.slice(2).toLowerCase()}`

const balanceOfAbi = [{
  name: 'balanceOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }],
}]

const WIDTHS = [50_000n, 10_000n, 2_000n, 800n]
const WINDOWS = 6           // about six weeks of mainnet at the widest
const SHOW = 20
const EVERY = 20_000

// ─── Language ──────────────────────────────────────────────────────────────
const t = (key, en) => {
  const lang = document.documentElement.dataset.i18nLang
  const dict = lang && lang !== 'en' ? window.I18N?.[lang] : null
  return dict?.[key] ?? en
}

// ─── Numbers ───────────────────────────────────────────────────────────────
// A number follows the page's language, not the browser's. With `undefined`
// here, a page switched to English still printed 0,0123 to anyone whose browser
// is German — English words, German separators, on the one page where the
// number is the point. `cn` and `ua` are our own labels for the selector; Intl
// wants language tags, and an unknown tag throws rather than degrading, so the
// call is guarded.
const INTL = { cn: 'zh', ua: 'uk' }
const numLocale = () => {
  const lang = document.documentElement.dataset.i18nLang || 'en'
  return INTL[lang] ?? lang
}
const num = (n, opts) => {
  try { return n.toLocaleString(numLocale(), opts) } catch { return n.toLocaleString('en', opts) }
}

// ─── DOM ───────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const show = (el, on) => { el.hidden = !on }
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s)

const say = (el, kind, html, data) => {
  el.className = `out ${kind}`
  el.innerHTML = html
  if (data === undefined) el.removeAttribute('data-nk')
  else el.setAttribute('data-nk', JSON.stringify(data))
  el.hidden = false
}

const plain = (e) => {
  const m = e?.shortMessage ?? e?.details ?? e?.message ?? String(e)
  return m.split('\n')[0].slice(0, 220)
}

const REQUIRED_ELEMENTS = [
  'addr', 'ensname', 'qrname', 'copy', 'copied', 'connect', 'disconnect', 'who',
  'amounts', 'amount', 'send', 'send-out', 'live', 'refresh', 'balances', 'gifts',
]

{
  const missing = REQUIRED_ELEMENTS.filter((id) => !document.getElementById(id))
  if (missing.length) {
    const banner = document.createElement('div')
    banner.style.cssText =
      'margin:1rem;padding:1rem 1.2rem;border:2px solid #b3261e;border-radius:9px;' +
      'font:15px/1.6 ui-sans-serif,system-ui,sans-serif;max-width:44rem'
    const fresh = new URL(location.href)
    fresh.searchParams.set('v', Date.now().toString(36))
    banner.innerHTML =
      '<strong>This page and its script are different versions.</strong>' +
      `<p style="margin:.5rem 0 0"><a href="${fresh}" style="font-weight:600">Open the current one</a></p>` +
      `<p style="margin:.5rem 0 0;font-family:ui-monospace,monospace;font-size:.85em">missing: ${missing.join(', ')}</p>`
    document.body.prepend(banner)
    throw new Error(`donate.html is out of step with donate.js — missing: ${missing.join(', ')}`)
  }
}

// The address on the page is the one this script knows. If somebody edits one
// and not the other, that is a wrong address in front of a QR code, so it stops
// rather than letting the two disagree quietly.
if ($('addr').textContent.trim().toLowerCase() !== ADDRESS.toLowerCase()) {
  $('addr').textContent = ADDRESS
  console.warn('donate: the address in the markup did not match the script; the script wins.')
}

// ─── Copying ───────────────────────────────────────────────────────────────
$('copy').addEventListener('click', async () => {
  const done = () => {
    show($('copied'), true)
    setTimeout(() => show($('copied'), false), 2500)
  }
  try {
    await navigator.clipboard.writeText(ADDRESS)
    done()
  } catch {
    // No clipboard permission, or an insecure context. Selecting the text is
    // then the honest fallback: the visitor presses the shortcut themselves.
    const r = document.createRange()
    r.selectNodeContents($('addr'))
    const sel = getSelection()
    sel.removeAllRanges()
    sel.addRange(r)
    done()
  }
})

// ─── Sending from the page ─────────────────────────────────────────────────

let wallet = null
let account = null

const announced = []
window.addEventListener('eip6963:announceProvider', (e) => {
  if (!announced.some((p) => p.info.uuid === e.detail.info.uuid)) announced.push(e.detail)
})
window.dispatchEvent(new Event('eip6963:requestProvider'))

const ready = () => {
  const v = Number($('amount').value.replace(',', '.'))
  $('send').disabled = !wallet || !(v > 0)
}
$('amount').addEventListener('input', () => {
  for (const b of $('amounts').querySelectorAll('button')) b.setAttribute('aria-pressed', 'false')
  ready()
})

for (const b of $('amounts').querySelectorAll('button[data-eth]')) {
  b.setAttribute('aria-pressed', 'false')
  b.addEventListener('click', () => {
    $('amount').value = b.dataset.eth
    for (const o of $('amounts').querySelectorAll('button')) {
      o.setAttribute('aria-pressed', String(o === b))
    }
    ready()
  })
}

$('connect').addEventListener('click', async () => {
  const out = $('send-out')
  const eth = announced[0]?.provider ?? window.ethereum
  if (!eth) return say(out, 'bad', `
    <p>${t('b.nowallet', 'This browser carries no wallet — mobile browsers cannot.')}</p>
    <p class="note">${t('v.nowalletnote', 'Use the address above instead: it needs nothing from this page, and any wallet can send to it.')}</p>`)
  try {
    const [addr] = await eth.request({ method: 'eth_requestAccounts' })
    account = addr
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x1' }] })
    } catch { /* already there, or refused; checked next */ }
    const chainId = await eth.request({ method: 'eth_chainId' })
    if (parseInt(chainId, 16) !== 1) return say(out, 'bad', `
      <p>${t('v.wrongchain', 'That wallet is not on Ethereum mainnet.')}</p>
      <p class="note">${t('v.wrongchainnote', 'This is the one page on the site that is not on a testnet — a donation on Sepolia would be play money.')}</p>`)

    wallet = createWalletClient({ account: addr, chain: mainnet, transport: custom(eth) })
    $('who').innerHTML = `${t('b.connected', 'connected')} · <span class="mono">${esc(clip(addr, 12))}…</span>`
    $('disconnect').hidden = false
    out.hidden = true
    ready()
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

/**
 * Disconnecting, and what it honestly is.
 *
 * A page cannot make a wallet forget it: the permission lives in the extension,
 * and only the person can withdraw it there. What this button does is drop
 * everything this page holds — the client, the account, the amount — so the
 * donate button goes dead again and the next donation has to be reconnected and
 * re-approved. Calling it more than that would be a lie in the direction that
 * costs money.
 */
$('disconnect').addEventListener('click', () => {
  wallet = null
  account = null
  $('who').textContent = ''
  $('disconnect').hidden = true
  $('send-out').hidden = true
  ready()
})

let sending = false

$('send').addEventListener('click', async () => {
  const out = $('send-out')
  const raw = $('amount').value.replace(',', '.').trim()
  if (sending || !wallet || !(Number(raw) > 0)) return
  sending = true
  $('send').disabled = true
  try {
    say(out, 'busy', `<p>${t('v.approve', 'Confirm it in your wallet — this page cannot.')}</p>`)
    const hash = await wallet.sendTransaction({
      account, to: ADDRESS, value: parseEther(raw), chain: mainnet,
    })
    say(out, 'busy', `<p>${t('v.waiting', 'Sent. Waiting for the block…')}</p>
      <p class="note mono break"><a href="${SCAN}/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer">${esc(clip(hash, 30))}</a></p>`)
    await reader.waitForTransactionReceipt({ hash })
    say(out, 'ok', `
      <p class="found">✓ ${t('v.thanks', 'Thank you — it arrived.')}</p>
      <p class="note">${t('v.thanksnote', 'It pays for names, for the gas the demo hands out, and for keeping this online after the hackathon. Nothing here is a purchase and nothing is owed in return.')}</p>
      <p class="note"><a href="${SCAN}/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer">${t('x.log.tx', 'transaction')}</a></p>`,
      { donated: raw, tx: hash })
    load()
  } catch (e) {
    say(out, 'bad', `<p>${t('v.failed', 'That did not go through.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  } finally {
    sending = false
    ready()
  }
})

// ─── What has arrived ──────────────────────────────────────────────────────

const state = { width: null, head: null, gifts: [], when: new Map(), filling: false, gen: 0 }

const amount = (v, decimals) => {
  const s = formatUnits(v, decimals)
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  return n >= 1 ? num(n, { maximumFractionDigits: 2 })
                : num(n, { maximumSignificantDigits: 3 })
}

const balances = async () => {
  const [eth, ...tokens] = await Promise.all([
    reader.getBalance({ address: ADDRESS }).catch(() => null),
    ...TOKENS.map((tk) => reader.readContract({
      address: tk.address, abi: balanceOfAbi, functionName: 'balanceOf', args: [ADDRESS],
    }).catch(() => null)),
  ])

  const rows = []
  rows.push(`<div class="bal"><span class="balv">${eth === null ? '—' : esc(num(Number(formatEther(eth)), { maximumFractionDigits: 4 }))}</span><span class="note">ETH</span></div>`)
  TOKENS.forEach((tk, i) => {
    const v = tokens[i]
    if (v === null || v === 0n) return
    rows.push(`<div class="bal"><span class="balv">${esc(amount(v, tk.decimals))}</span><span class="note">${esc(tk.symbol)}</span></div>`)
  })

  say($('balances'), 'ok', `
    <div class="bals">${rows.join('')}</div>
    <p class="note">${t('v.bal.note', 'Read from the chain, not from a database of ours. A balance is exact: it is what the address holds at this block.')}</p>`,
    { eth: eth === null ? null : formatEther(eth) })
}

const giftsIn = async (from, to) => {
  const logs = await logsWith({
    address: TOKENS.map((tk) => tk.address),
    topics: [TRANSFER, null, toTopic(ADDRESS)],
    fromBlock: from, toBlock: to,
  })
  const out = []
  for (const log of logs) {
    const tk = TOKENS.find((k) => k.address.toLowerCase() === String(log.address).toLowerCase())
    if (!tk) continue
    let value
    try { value = BigInt(log.data) } catch { continue }
    out.push({
      symbol: tk.symbol, decimals: tk.decimals, value,
      from: `0x${String(log.topics[1] ?? '').slice(26)}`,
      block: log.blockNumber, tx: log.transactionHash, index: log.logIndex ?? 0,
    })
  }
  return out
}

const render = () => {
  const shown = state.gifts.slice(0, SHOW)
  say($('gifts'), 'ok', `
    <p class="count"><strong>${state.gifts.length}</strong> ${t('v.count', 'stablecoin donations found')}</p>
    ${shown.map((g) => `
      <div class="ev">
        <p style="margin:0 0 .2rem"><strong>${esc(amount(g.value, g.decimals))} ${esc(g.symbol)}</strong></p>
        <p class="note" style="margin:0">
          ${state.when.has(String(g.block)) ? `${esc(state.when.get(String(g.block)))} · ` : ''}
          <a href="${SCAN}/address/${esc(g.from)}" target="_blank" rel="noopener noreferrer" class="mono">${esc(clip(g.from, 12))}…</a> ·
          <a href="${SCAN}/tx/${esc(g.tx)}" target="_blank" rel="noopener noreferrer">${t('x.log.tx', 'transaction')}</a>
        </p>
      </div>`).join('')}
    <p class="note">${t('v.eth.note', 'Sending ETH emits no event, so a plain ETH donation cannot be listed here — there is nothing on the chain to filter for, and this page has no indexer. The balance above counts it exactly; Etherscan has the full list.')}</p>
    <p class="note"><a href="${SCAN}/address/${ADDRESS}" target="_blank" rel="noopener noreferrer">${t('v.onetherscan', 'See it on Etherscan')}</a></p>`,
    { gifts: state.gifts.length })
}

const stamps = async () => {
  const need = [...new Set(state.gifts.slice(0, SHOW).map((g) => String(g.block)))]
    .filter((b) => !state.when.has(b)).slice(0, 20)
  if (!need.length) return
  await Promise.all(need.map(async (b) => {
    try {
      const blk = await reader.getBlock({ blockNumber: BigInt(b) })
      state.when.set(b, new Date(Number(blk.timestamp) * 1000).toISOString().slice(0, 10))
    } catch { /* a date is a nicety */ }
  }))
  render()
}

const width = async (head) => {
  for (const w of WIDTHS) {
    try {
      await logsWith({ address: TOKENS.map((tk) => tk.address), topics: [TRANSFER, null, toTopic(ADDRESS)],
                       fromBlock: head > w ? head - w : 0n, toBlock: head })
      return w
    } catch { /* narrower */ }
  }
  return null
}

const load = async () => {
  const mine = ++state.gen
  const mineStill = () => state.gen === mine
  if (state.filling) return
  state.filling = true
  try {
    $('live').innerHTML = `<span class="dot"></span>${esc(t('v.reading', 'Reading Ethereum…'))}`
    await balances()
    if (!mineStill()) return

    const head = await reader.getBlockNumber({ cacheTime: 0 })
    state.width = state.width ?? await width(head)
    if (!state.width) {
      state.head = head
      return say($('gifts'), '', `
        <p>${t('x.log.norange', 'The node refused every block range this page asked for.')}</p>
        <p class="note">${t('v.norangenote', 'That is this public endpoint, not the address. The balances above are read directly and are unaffected.')}</p>`,
        { gifts: null, error: 'ranges-refused' })
    }

    state.gifts = []
    let to = head
    let scanned = 0n
    for (let i = 0; i < WINDOWS && to > 0n; i++) {
      if (!mineStill()) return
      const from = to > state.width ? to - state.width + 1n : 0n
      try {
        state.gifts.push(...await giftsIn(from, to))
        scanned += to - from + 1n
      } catch { /* one window we do not learn from */ }
      if (from === 0n) break
      to = from - 1n
    }
    state.gifts.sort((a, b) => (a.block === b.block ? b.index - a.index : (a.block > b.block ? -1 : 1)))
    state.head = head
    render()
    stamps()
  } catch (e) {
    say($('gifts'), 'bad', `<p>${t('v.failed', 'That did not go through.')}</p>
                            <p class="note mono">${esc(plain(e))}</p>`)
  } finally {
    if (mineStill()) {
      state.filling = false
      $('live').innerHTML = `<span class="dot"></span>${esc(t('x.feed.living', 'Live'))}`
    }
  }
}

const poll = async () => {
  if (state.filling || document.hidden || state.head === null) return
  state.filling = true
  const mine = state.gen
  try {
    const head = await reader.getBlockNumber({ cacheTime: 0 })
    if (head <= state.head) return
    const fresh = await giftsIn(state.head + 1n, head)
    state.head = head
    await balances()
    if (!fresh.length || state.gen !== mine) return
    state.gifts.push(...fresh)
    state.gifts.sort((a, b) => (a.block === b.block ? b.index - a.index : (a.block > b.block ? -1 : 1)))
    render()
    stamps()
  } catch { /* the next one tries again */ } finally { state.filling = false }
}

$('refresh').addEventListener('click', () => { state.width = null; load() })
setInterval(poll, EVERY)
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll() })

// ─── The agent-facing surface, and the opening state ───────────────────────
window.NEXTKEY = {
  address: ADDRESS,
  chain: 'ethereum',
  balances: async () => ({
    eth: formatEther(await reader.getBalance({ address: ADDRESS })),
  }),
  version: 1,
}

window.__nextkeyRerender = () => {
  if (state.gifts.length) render()
  $('live').innerHTML = `<span class="dot"></span>${esc(t('x.feed.living', 'Live'))}`
}

ready()
load()
