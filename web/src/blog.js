/**
 * The community page — the public half of the same mechanism.
 *
 * Everything else NextKey does is about a record whose *address* nobody can
 * work out and whose contents nobody can read. A post is the exact mirror:
 * a plain text record, at a name anybody can look up, in the clear. The point
 * of putting both on one site is that they are the same machinery — an ENS
 * name, a text record, a role that says who may write it — pointed in opposite
 * directions. Nothing here is a second product.
 *
 * Two properties are worth stating before the code, because they are the
 * reasons this page is shaped the way it is.
 *
 *   The list of names is in the source, not in a database. A page that
 *   rendered whatever a stranger wrote to a lent name would be a spam board
 *   with our domain on it, on a weekend when nobody is watching. So the page
 *   shows the names it was built with, and reads anything else only when a
 *   visitor asks for it by name — labelled as unchecked, every time.
 *
 *   Posts are rendered as text. No markup, no automatic links, no images.
 *   A record is written by a stranger and read by a browser; treating it as
 *   markup would hand that stranger the page.
 */

import { createPublicClient, createWalletClient, custom, http, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { packetToBytes } from 'viem/ens'
import { sepolia } from 'viem/chains'
import { DEMO_KEY, POOL, POOL_RESOLVER } from './demo-wallet.js'

// ─── The deployment ────────────────────────────────────────────────────────
// The hackathon Universal Resolver, overridden as everywhere else: viem ships
// its own and forgetting to replace it resolves silently against production,
// which reads exactly like "that name has no record".
const UNIVERSAL_RESOLVER = '0xd26f2040d083af1cd2962ba303f4bea0c4faf142'
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const RECORD_POST = 'nextkey.post'
const PARENT = 'nextkey.eth'

/**
 * A name can carry several posts.
 *
 * The first version wrote one record and called it done, which made the page a
 * pinboard of names rather than anything anyone would come back to: writing
 * again replaced what was there. So a post is one of a small numbered set —
 * nextkey.post, nextkey.post.2, and so on — and publishing takes the first slot
 * that is free.
 *
 * The set is small and fixed on purpose. Records are addressed by name, and a
 * page with no indexer can only ask for names it can spell; an open-ended
 * series would mean guessing where to stop. Five is what a reader will sit
 * through anyway, and the limit is stated where somebody hits it rather than
 * discovered as a silent failure.
 */
const POST_SLOTS = [RECORD_POST, `${RECORD_POST}.2`, `${RECORD_POST}.3`,
                    `${RECORD_POST}.4`, `${RECORD_POST}.5`]

const hackathonSepolia = {
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: UNIVERSAL_RESOLVER } },
}

const reader = createPublicClient({
  chain: hackathonSepolia,
  transport: http(RPC, { retryCount: 1, retryDelay: 400, timeout: 10_000 }),
})

/**
 * The names this page reads without being asked.
 *
 * Deliberately short and deliberately in the source: what appears on
 * nextkey.li should be a decision somebody made, not whatever the last visitor
 * typed. Adding a name here is a commit, which is the right amount of friction.
 */
const ALLOW = [
  `nextkey.eth`,
  `nextkeyv2.eth`,
  `anna.${PARENT}`,
  `bob.${PARENT}`,
  `agent.${PARENT}`,
]

const setTextAbi = [{
  name: 'setText', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' },
           { name: 'value', type: 'string' }], outputs: [],
}]

// ─── Language ──────────────────────────────────────────────────────────────
const t = (key, en) => {
  const lang = document.documentElement.dataset.i18nLang
  const dict = lang && lang !== 'en' ? window.I18N?.[lang] : null
  return dict?.[key] ?? en
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
  'load', 'posts', 'title', 'body', 'write-state',
  'lane-lent', 'post-lent', 'lent-out',
  'lane-own-wrap', 'lane-own', 'connect', 'wallet-out', 'own-name', 'post-own', 'own-out',
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
    throw new Error(`blog.html is out of step with blog.js — missing: ${missing.join(', ')}`)
  }
}

// ─── Reading ───────────────────────────────────────────────────────────────

const parsePost = (name, key, raw) => {
  if (!raw) return null
  try {
    const p = JSON.parse(raw)
    return { name, key, title: String(p.title ?? ''), body: String(p.body ?? ''), at: p.at ?? null }
  } catch {
    // Not our shape. Show it anyway, as the text it is — a record written by
    // somebody who did not read our documentation is still a record.
    return { name, key, title: '', body: raw, at: null }
  }
}

/** Every slot on one name. Most come back empty, which is the common case. */
const readPost = async (name) => {
  const raw = await Promise.all(POST_SLOTS.map((key) =>
    reader.getEnsText({ name, key }).catch(() => null)))
  return POST_SLOTS.map((key, i) => parsePost(name, key, raw[i])).filter(Boolean)
}

/**
 * Newest first, and honest about the date.
 *
 * `at` is written by whoever published, so it is a claim rather than a fact —
 * a record can say any time it likes. The chain knows better, but reading the
 * block a record was written in costs a log query per post, and this page has
 * no indexer to make that cheap. So the claimed time orders the list, posts
 * without one fall to the end, and the page does not pretend the order is
 * cryptographic.
 */
const newestFirst = (posts) => [...posts].sort((a, b) => {
  if (!a.at && !b.at) return 0
  if (!a.at) return 1
  if (!b.at) return -1
  return String(b.at).localeCompare(String(a.at))
})

/** The one name a visitor asked for by hand, if any. */
const asked = () => {
  const from = new URLSearchParams(location.search).get('from')
  return from ? from.trim().toLowerCase() : null
}

const render = (posts, extra) => {
  if (!posts.length) return say($('posts'), '', `
    <p>${t('b.none', 'No posts on those names yet.')}</p>
    <p class="note">${t('b.nonenote', 'Nothing is wrong: a name carries a post only once somebody writes one. Write the first one below.')}</p>`,
    { posts: 0 })

  say($('posts'), 'ok', posts.map((p) => `
    <article style="margin:0 0 1.6rem">
      ${p.title ? `<h3 style="margin:0 0 .2rem;font-size:1.05rem;font-weight:640">${esc(p.title)}</h3>` : ''}
      <p class="note" style="margin:0 0 .5rem">
        <span class="mono">${esc(p.name)}</span>${p.at ? ` · ${esc(String(p.at).slice(0, 10))}` : ''}${p.key !== RECORD_POST ? ` · <span class="mono">${esc(p.key.slice(RECORD_POST.length + 1))}</span>` : ''}
        ${p.unchecked ? ` · <strong>${esc(t('b.unchecked', 'not on this page’s list — read because you asked for it'))}</strong>` : ''}
      </p>
      <div class="postbody">${esc(p.body)}</div>
    </article>`).join('') + (extra ?? ''),
    { posts: posts.length, names: posts.map((p) => p.name) })
}

$('load').addEventListener('click', async () => {
  const out = $('posts')
  const extra = asked()
  const names = [...new Set([...ALLOW, ...session, ...(extra ? [extra] : [])])]
  try {
    say(out, 'busy', `<p>${t('b.loading', 'Reading those names from Sepolia…')}</p>`)
    // Five at a time: a phone on a hotel network cannot open twenty sockets,
    // and a public RPC rate-limits long before this gets interesting.
    const found = []
    for (let i = 0; i < names.length; i += 3) {
      const batch = await Promise.all(names.slice(i, i + 3).map(readPost))
      for (const posts of batch) found.push(...posts)
    }
    for (const p of found) if (!ALLOW.includes(p.name)) p.unchecked = true
    render(newestFirst(found), `<p class="note">${t('b.readnote', 'Read live from the hackathon deployment:')} <span class="mono break">${esc(names.join(', '))}</span></p>`)
  } catch (e) {
    say(out, 'bad', `<p>${t('b.fail', 'Could not read that from the chain.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  }
})

// ─── Writing ───────────────────────────────────────────────────────────────
// Names published in this session, so an author sees their own post on the
// next load without it being on the page's list for everybody else.
const session = []

const post = () => ({
  v: 1,
  title: $('title').value.trim(),
  body: $('body').value.trim(),
  at: new Date().toISOString(),
})

const ready = () => {
  const p = post()
  const ok = !!(p.title || p.body)
  $('post-lent').disabled = !ok
  $('post-own').disabled = !ok || !wallet
  return ok
}
$('title').addEventListener('input', ready)
$('body').addEventListener('input', ready)

const wrote = (out, name, hash, note, slot = RECORD_POST) => {
  if (!session.includes(name)) session.push(name)
  say(out, 'ok', `
    <p class="found">✓ ${t('b.done', 'Published.')}</p>
    <dl>
      <dt>${t('b.onname', 'on')}</dt><dd class="mono break">${esc(name)}</dd>
      <dt class="mono">${esc(slot)}</dt>
      <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(hash)}" rel="noopener">${esc(clip(hash, 26))}</a></dd>
    </dl>
    <p class="note">${note}</p>
    <p class="note"><a href="https://hackathon-deployment-portal-app.ens-cf.workers.dev/" rel="noopener">${t('b.explorer', 'See it in the ENS explorer')}</a></p>`,
    { published: name, tx: hash })
}

// ─── Lane one · a lent name ────────────────────────────────────────────────

const demoAccount = () =>
  privateKeyToAccount(`0x${[...Uint8Array.from(atob(DEMO_KEY), (c) => c.charCodeAt(0))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')}`)

/**
 * The first slot on a name that is still empty.
 *
 * Publishing has to add rather than replace, and the only way to know which
 * record is free is to ask for each one. Five reads, in parallel, before a
 * transaction that costs gas — cheap enough, and the alternative is quietly
 * writing over somebody's last post.
 */
const freeSlot = async (name) => {
  const taken = await Promise.all(POST_SLOTS.map((key) =>
    reader.getEnsText({ name, key }).catch(() => 'unreadable')))
  const i = taken.findIndex((v) => !v)
  return i === -1 ? null : POST_SLOTS[i]
}

/** A pool name that carries no post yet, so publishing does not overwrite one. */
const freeName = async () => {
  const shuffled = [...POOL].sort(() => Math.random() - 0.5)
  for (let i = 0; i < shuffled.length; i += 5) {
    const batch = shuffled.slice(i, i + 5).map((l) => `${l}.${PARENT}`)
    const taken = await Promise.all(batch.map((n) =>
      reader.getEnsText({ name: n, key: RECORD_POST }).catch(() => 'unreadable')))
    const free = batch.find((_, k) => !taken[k])
    if (free) return free
  }
  return null
}

let writing = false

$('post-lent').addEventListener('click', async () => {
  const out = $('lent-out')
  if (writing || !ready()) return
  writing = true
  $('post-lent').disabled = true
  try {
    say(out, 'busy', `<p>${t('b.finding', 'Finding a name that carries no post yet…')}</p>`)
    const name = await freeName()
    if (!name) throw new Error(t('b.exhausted',
      'Every name we lend already carries a post. Use your own name below, or come back once the pool is topped up.'))

    const account = demoAccount()
    const node = toHex(packetToBytes(name))
    const value = JSON.stringify(post())

    say(out, 'busy', `<p>${t('b.simulating', 'Checking the write would succeed, before spending anything…')}</p>`)
    await reader.simulateContract({
      address: POOL_RESOLVER, abi: setTextAbi, functionName: 'setText',
      args: [node, RECORD_POST, value], account: account.address })

    say(out, 'busy', `<p>${t('b.writing', 'Writing one record — about fifteen seconds…')}</p>`)
    const signer = createWalletClient({ account, chain: sepolia, transport: http(RPC) })
    const hash = await signer.writeContract({
      address: POOL_RESOLVER, abi: setTextAbi, functionName: 'setText',
      args: [node, RECORD_POST, value], chain: sepolia })
    await reader.waitForTransactionReceipt({ hash })

    wrote(out, name, hash, t('b.lentnote',
      'This name is ours and we lent it to you along with the gas. Your post is on chain and anybody can read it — but it is not on this page’s list, so it appears here for you and not for a stranger arriving later. Press “Load the posts” to see it.'))
    $('write-state').textContent = t('b.spent',
      'Published. Reload the page to write another one.')
  } catch (e) {
    $('post-lent').disabled = false
    say(out, 'bad', `<p>${t('b.wfail', 'That did not go through.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  } finally {
    writing = false
  }
})

// ─── Lane two · your wallet, your name ─────────────────────────────────────

let wallet = null
let account = null
const walletOut = $('wallet-out')

const announced = []
window.addEventListener('eip6963:announceProvider', (e) => {
  if (!announced.some((p) => p.info.uuid === e.detail.info.uuid)) announced.push(e.detail)
})
window.dispatchEvent(new Event('eip6963:requestProvider'))

$('connect').addEventListener('click', async () => {
  const eth = announced[0]?.provider ?? window.ethereum
  if (!eth) return say(walletOut, 'bad', `
    <p>${t('b.nowallet', 'This browser carries no wallet — mobile browsers cannot.')}</p>
    <p class="note">${t('b.nowalletnote', 'Use the lane above, which needs nothing from you, or open this page inside your wallet’s own browser.')}</p>`)
  try {
    const [addr] = await eth.request({ method: 'eth_requestAccounts' })
    account = addr
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })
    } catch { /* may already be there, or refused; checked next */ }
    const chainId = await eth.request({ method: 'eth_chainId' })
    if (parseInt(chainId, 16) !== 11155111) return say(walletOut, 'bad', `
      <p>${t('b.wrongchain', 'That wallet is not on Sepolia.')}</p>`)

    wallet = createWalletClient({ account: addr, chain: sepolia, transport: custom(eth) })
    let primary = null
    try { primary = await reader.getEnsName({ address: addr }) } catch { /* none set */ }
    if (primary && !$('own-name').value.trim()) $('own-name').value = primary

    say(walletOut, 'ok', `
      <dl><dt>${t('b.connected', 'connected')}</dt><dd class="mono break">${esc(addr)}</dd></dl>`)
    ready()
  } catch (e) {
    say(walletOut, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

$('post-own').addEventListener('click', async () => {
  const out = $('own-out')
  const name = $('own-name').value.trim().toLowerCase()
  if (writing || !ready()) return
  if (!name) return say(out, 'bad', `<p>${t('b.needname', 'Enter a name you own.')}</p>`)

  writing = true
  $('post-own').disabled = true
  try {
    say(out, 'busy', `<p>${t('b.resolver', 'Finding the resolver for that name…')}</p>`)
    let resolver
    try { resolver = await reader.getEnsResolver({ name }) } catch { /* reported below */ }
    if (!resolver || /^0x0+$/i.test(resolver)) throw new Error(t('b.noresolver',
      'That name has no resolver on this deployment, so there is nowhere to write.'))
    const code = await reader.getBytecode({ address: resolver })
    if (!code || code === '0x') throw new Error(t('b.notcontract',
      'The resolver this name points at holds no contract. Writing there would spend gas and change nothing.'))

    const node = toHex(packetToBytes(name))
    const value = JSON.stringify(post())

    say(out, 'busy', `<p>${t('b.slotlooking', 'Looking for a slot that is still free on that name…')}</p>`)
    const slot = await freeSlot(name)
    if (!slot) throw new Error(t('b.full',
      'That name already carries five posts, which is as many as this page can address. Empty one of them, or publish under another name.'))

    say(out, 'busy', `<p>${t('b.simulating', 'Checking the write would succeed, before spending anything…')}</p>`)
    await reader.simulateContract({
      address: resolver, abi: setTextAbi, functionName: 'setText',
      args: [node, slot, value], account })

    say(out, 'busy', `<p>${t('b.approve', 'Approve it in your wallet…')}</p>`)
    const hash = await wallet.writeContract({
      address: resolver, abi: setTextAbi, functionName: 'setText',
      args: [node, slot, value], chain: sepolia })
    await reader.waitForTransactionReceipt({ hash })

    wrote(out, name, hash, t('b.ownnote',
      'Your name, your gas, your record. Nothing of ours is involved, and the post outlives this site: emptying that record is a write only you can make.'), slot)
  } catch (e) {
    $('post-own').disabled = false
    say(out, 'bad', `<p>${t('b.wfail', 'That did not go through.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  } finally {
    writing = false
  }
})

// ─── The agent-facing surface ──────────────────────────────────────────────
window.NEXTKEY = {
  record: RECORD_POST,
  names: () => [...ALLOW],
  read: readPost,
  version: 1,
}

window.__nextkeyRerender = () => {}
ready()
if (asked()) $('load').click()
