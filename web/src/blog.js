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

import { createPublicClient, createWalletClient, custom, http, toHex, namehash, keccak256, stringToHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { packetToBytes } from 'viem/ens'
import { sepolia } from 'viem/chains'
import { TOPIC_RECORD, TEXT_UPDATED_TOPIC, logReader, asWrite, probeWidth } from './nk-logs.mjs'
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

// The live window reads the chain's own events, so it shares the explorer's
// reader rather than keeping a second copy of two topic hashes.
const logsWith = logReader(reader)
const POST_TOPICS = POST_SLOTS.map((k) => keccak256(stringToHex(k)))

// One resolver list, same reasoning as the explorer: a name's resolver is a
// property of the name, so the address is not guessed from one anchor.
const FEED_RESOLVERS = ['0x04B2DB6567Cc68d059c061215Adf9a99adD1cA65']
const ENS_APP = 'https://hackathon-deployment-portal-app.ens-cf.workers.dev'
const READ_BATCH = 10       // how many names are read at once, see sweepPosts
const FEED_WINDOWS = 20     // the node does the selecting, so this reaches far
const FEED_SHOW = 25
const FEED_EVERY = 20_000
const FRESH_FOR = 6_000

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
  'posts', 'blog-live', 'title', 'body', 'write-state',
  'edit-connect', 'edit-wallet', 'edit-name', 'edit-load', 'edit-list',
  'edit-form', 'edit-title', 'edit-body', 'edit-save', 'edit-empty', 'edit-out',
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
 * The posts, read rather than searched.
 *
 * This page used to find posts the way the explorer finds anything: by asking
 * the resolver for its `TextUpdated` events. That is the right instinct and it
 * failed on the one post that exists. Measured against the chain on 11
 * September: `hero01.nextkey.eth` carries a post, its resolver is the pool
 * resolver, and on that resolver — over its entire life, 1.5 million blocks in
 * fifty-thousand-block windows, with not one range refused — there is no write
 * event for a post record and no creation event for that name. The same query
 * shape finds `hero72`, `hero02` and `hero150` exactly as documented, record id
 * in topic 1 and namehash in topic 2, so neither the topic hashes nor the
 * window walk are wrong. Why that one write left no trace is a question about
 * the deployment, and the answer does not change what this page owes a reader.
 *
 * So the posts are read instead of searched. One `text()` call per name and
 * slot, through the same resolver, which is the exact call that returns the
 * post that the log sweep cannot see. It cannot miss, it needs no block range,
 * and no public endpoint's log retention applies to it.
 *
 * What it costs: this page can only read names it can spell. That is the same
 * limit the first version of the window had, and it is why the pool is listed
 * in the source rather than discovered. The log sweep stays as well — it is
 * what finds a post on a name nobody here listed, and it brings the block a
 * write landed in, which is the only date that is not a claim.
 *
 * The first slot decides whether the other four are read at all, so a pool of
 * two hundred costs two hundred reads rather than a thousand.
 */
const sweepPosts = async (onProgress) => {
  const names = [...new Set([...ALLOW, ...POOL.map((l) => `${l}.${PARENT}`),
                             ...session, ...(asked() ? [asked()] : [])])]
  const found = []
  for (let i = 0; i < names.length; i += READ_BATCH) {
    const slice = names.slice(i, i + READ_BATCH)
    const heads = await Promise.all(slice.map((n) =>
      reader.getEnsText({ name: n, key: POST_SLOTS[0] }).catch(() => null)))
    for (let j = 0; j < slice.length; j++) {
      if (!heads[j]) continue
      for (const p of await readPost(slice[j])) found.push(p)
    }
    onProgress?.(Math.min(i + READ_BATCH, names.length), names.length, found.length)
  }
  return found
}

/** The one name a visitor asked for by hand, if any. */
const asked = () => {
  const from = new URLSearchParams(location.search).get('from')
  return from ? from.trim().toLowerCase() : null
}

/**
 * The window.
 *
 * The first version of this page read a short list of names and asked the
 * visitor to press a button. That was honest but small: it could only show
 * posts on names somebody had written into the source, and it showed them as
 * records — a key, a slot number, a blob of JSON. A community page whose posts
 * look like database rows is a database with a headline on it.
 *
 * So this reads the chain's own events instead, filtered at the node to the
 * five post records, newest first, and it keeps reading while the page is open.
 * What it shows is what somebody wrote, in a bubble, with the date underneath.
 *
 * The one thing it cannot do is name the author on its own. An event carries a
 * record id, not a name, so the names are recovered by matching record ids
 * against the creation events seen in the same sweep — which works for the
 * names this page knows and for anything created recently, and quietly does
 * not for the rest. A post with no name attached is still a post; inventing an
 * author would be the one unforgivable thing here.
 */
const blog = {
  read: [],           // posts read straight off the names, see sweepPosts
  addresses: null,
  width: null,
  head: null,
  items: [],
  names: new Map(),   // namehash → name, for the names we can put a face to
  found: new Map(),   // record id → name
  when: new Map(),    // block → YYYY-MM-DD
  filling: false,
  gen: 0,
}

/** Namehashes of every name this page may legitimately name. */
const knownNames = () => {
  const all = [...new Set([...ALLOW, ...POOL.map((l) => `${l}.${PARENT}`),
                           ...session, ...(asked() ? [asked()] : [])])]
  for (const n of all) {
    try { blog.names.set(namehash(n).toLowerCase(), n) } catch { /* not a name */ }
  }
}

const blogAddresses = async () => {
  const seen = new Map()
  const add = (a) => {
    if (!a || /^0x0+$/i.test(a) || !/^0x[0-9a-f]{40}$/i.test(a)) return
    if (!seen.has(a.toLowerCase())) seen.set(a.toLowerCase(), a)
  }
  for (const a of FEED_RESOLVERS) add(a)
  add(POOL_RESOLVER)
  const found = await Promise.all(ALLOW.slice(0, 3).map((name) =>
    reader.getEnsResolver({ name }).catch(() => null)))
  for (const a of found) add(a)
  return [...seen.values()]
}

/** One window: the posts in it, and any names it lets us attach to them. */
const blogWindow = async (from, to) => {
  const [writes, created] = await Promise.all([
    logsWith({ address: blog.addresses, topics: [TEXT_UPDATED_TOPIC, null, POST_TOPICS],
               fromBlock: from, toBlock: to }),
    logsWith({ address: blog.addresses, topics: [TOPIC_RECORD], fromBlock: from, toBlock: to })
      .catch(() => []),
  ])
  for (const c of created) {
    if (String(c.topics[0] ?? '').toLowerCase() !== TOPIC_RECORD) continue
    const who = blog.names.get(String(c.topics[2] ?? '').toLowerCase())
    if (who) blog.found.set(String(c.topics[1]).toLowerCase(), who)
  }
  const out = []
  for (const log of writes) {
    const w = asWrite(log)
    if (!w || !w.value) continue          // an emptied post is a post taken down
    const p = parsePost(null, w.key, w.value)
    if (!p) continue
    out.push({ ...p, record: String(w.record).toLowerCase(),
               block: w.block, tx: w.tx, index: w.index, seen: 0 })
  }
  return out
}

/**
 * The names the sweep missed.
 *
 * A record's creation event is where its name lives, and that event is as old
 * as the name — usually older than the stretch a post search walks. So after
 * the posts are in, every record still without a name gets one narrow query of
 * its own: the creation event for that record id, which the node can select on
 * its own and which therefore reaches back much further.
 *
 * It can still come back empty, and then the post stays unattributed. That is
 * the honest end of it: a namehash does not run backwards, so a name this page
 * has never been told about cannot be recovered from the chain at all.
 */
const NAME_WINDOWS = 8

const resolveNames = async () => {
  const missing = [...new Set(blog.items.map((p) => p.record))]
    .filter((r) => !blog.found.has(r)).slice(0, 8)
  if (!missing.length || !blog.width) return
  let touched = false
  for (const record of missing) {
    let to = blog.head ?? await reader.getBlockNumber({ cacheTime: 0 })
    for (let i = 0; i < NAME_WINDOWS && to > 0n; i++) {
      const from = to > blog.width ? to - blog.width + 1n : 0n
      let hit = []
      try {
        hit = await logsWith({ address: blog.addresses, topics: [TOPIC_RECORD, record],
                               fromBlock: from, toBlock: to })
      } catch { /* a refused window is one we simply do not learn from */ }
      // The filter asked for this record, but the answer is checked anyway. A
      // node that ignores a topic — or a proxy in front of one — would
      // otherwise hand this page somebody else's creation event, and it would
      // print a name under a post that is not theirs. Of all the mistakes on
      // this page, that is the one that must not happen.
      const mine = hit.find((l) => String(l.topics[1] ?? '').toLowerCase() === record)
      if (mine) {
        const who = blog.names.get(String(mine.topics[2] ?? '').toLowerCase())
        if (who) { blog.found.set(record, who); touched = true }
        break
      }
      if (from === 0n) break
      to = from - 1n
    }
  }
  if (touched) render()
}

/**
 * The two sources, in one list.
 *
 * Read first, then the events. Not a ranking of importance — a read post is a
 * fact about a name this page can spell, and an event post is a fact about a
 * name it often cannot, so the two cannot be ordered against each other by
 * date at all: one date is a claim in the post, the other is a block. Putting
 * the exact set first and saying which is which under the list beats inventing
 * a comparison between them.
 *
 * A post that appears in both — a name we can spell whose write did leave an
 * event — is shown once, with the event's block and transaction, because those
 * are the parts a reader can check.
 */
const merged = () => {
  const byName = new Map()
  for (const p of blog.items) {
    const who = blog.found.get(p.record)
    if (who) byName.set(`${who}|${p.key}`, true)
  }
  const reads = blog.read.filter((p) => !byName.has(`${p.name}|${p.key}`))
  reads.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')))
  return [...reads, ...blog.items]
}

const blogSort = () => {
  blog.items.sort((a, b) => (a.block === b.block ? b.index - a.index : (a.block > b.block ? -1 : 1)))
  const seen = new Set()
  blog.items = blog.items.filter((p) => {
    const id = `${p.tx}:${p.index}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

const blogStatus = () => {
  $('blog-live').innerHTML = `<span class="dot"></span>${esc(t('x.feed.living', 'Live'))}`
}

/**
 * A post, as a post.
 *
 * Title and body run together as one piece of text, because that is how it
 * reads aloud and because the split is an artefact of the record format, not
 * something the author meant. Underneath, small: who wrote it when we know, the
 * day it was written according to the chain rather than according to the post,
 * and one link out.
 */
const render = () => {
  const out = $('posts')
  const all = merged()
  if (!all.length) return say(out, '', `
    <p>${t('b.none', 'No posts on those names yet.')}</p>
    <p class="note">${t('b.nonenote', 'Nothing is wrong: a name carries a post only once somebody writes one. Write the first one below.')}</p>`,
    { posts: 0 })

  const now = Date.now()
  const shown = all.slice(0, FEED_SHOW)
  // A post read off its name carries no transaction, because this page never
  // saw the write — only the record it left. Saying that under the list is the
  // honest version; printing a date and a link that stand for nothing would be
  // the other kind.
  const claimed = shown.some((p) => !p.tx)
  say(out, 'ok', `
    ${shown.map((p) => {
      const who = p.name ?? blog.found.get(p.record) ?? null
      const day = blog.when.get(String(p.block)) ?? (p.at ? String(p.at).slice(0, 10) : '')
      const text = [p.title, p.body].filter(Boolean).join(' ')
      return `
      <article class="post">
        <div class="bubble${now - (p.seen ?? 0) < FRESH_FOR ? ' fresh' : ''}">
          <p class="bubbletext">${esc(text)}</p>
        </div>
        <p class="bubblemeta">
          ${who
            ? `<a class="mono" href="${esc(ENS_APP)}/${encodeURIComponent(who)}" target="_blank" rel="noopener noreferrer">${esc(who)}</a>`
            : `<span class="mono">${esc(t('b.noname', 'a name this page cannot name'))}</span>`}
          ${day ? ` · ${esc(day)}` : ''}
          ${p.tx
            ? `· <a href="https://sepolia.etherscan.io/tx/${esc(p.tx)}" target="_blank" rel="noopener noreferrer">${t('x.log.tx', 'transaction')}</a>`
            : `· <span class="note">${esc(p.key)}</span>`}
        </p>
      </article>`
    }).join('')}
    ${claimed ? `<p class="note">${t('b.claimeddate', 'A post read straight off its name is shown with the record it sits in and the date it claims for itself. A post this page saw being written carries its block and its transaction instead — that date is the chain’s, not the author’s.')}</p>` : ''}
    ${all.length > FEED_SHOW ? `<p class="note">${t('x.feed.showing', 'showing the newest')} ${FEED_SHOW} ${t('x.feed.of', 'of')} ${all.length}.</p>` : ''}`,
    { posts: all.length })
}

/** Dates come from the block, not from the post, because a post can claim anything. */
const blogDates = async () => {
  const need = [...new Set(blog.items.slice(0, FEED_SHOW).map((p) => String(p.block)))]
    .filter((b) => !blog.when.has(b)).slice(0, 25)
  if (!need.length) return
  await Promise.all(need.map(async (b) => {
    try {
      const blk = await reader.getBlock({ blockNumber: BigInt(b) })
      blog.when.set(b, new Date(Number(blk.timestamp) * 1000).toISOString().slice(0, 10))
    } catch { /* the post's own claim stands in */ }
  }))
  render()
}

const blogFill = async () => {
  const mine = ++blog.gen
  const mineStill = () => blog.gen === mine
  blog.filling = true
  const out = $('posts')
  try {
    say(out, 'busy', `<p>${t('b.loading', 'Reading those names from Sepolia…')}</p>`)
    knownNames()

    // The exact pass first: every name this page can spell, read directly. It
    // is what makes a post visible at all — see sweepPosts — so it runs before
    // the log sweep and paints as soon as it finds something.
    blog.read = await sweepPosts((done, total, hits) => {
      if (!mineStill()) return
      if (hits) render()
      else say(out, 'busy', `<p>${t('b.loading', 'Reading those names from Sepolia…')}
        <span class="mono">${done}/${total}</span></p>`)
    })
    if (!mineStill()) return
    render()

    if (!blog.addresses) blog.addresses = await blogAddresses()

    const head = await reader.getBlockNumber({ cacheTime: 0 })
    if (!blog.width) {
      const probe = await probeWidth(logsWith, {
        address: blog.addresses, topics: [TEXT_UPDATED_TOPIC, null, POST_TOPICS], head })
      blog.width = probe.width
      if (!probe.width) {
        // A refusal is only worth saying when there is nothing else on screen.
        // The read pass above does not use block ranges at all, so when it
        // found posts they are already there and the node's mood is not news.
        if (blog.read.length) return
        return say(out, 'bad', `
          <p>${t('x.log.norange', 'The node refused every block range this page asked for.')}</p>
          <p class="note mono">${esc(plain(probe.error))}</p>
          <p class="note">${t('x.feed.norangenote', 'That is a limit of the public endpoint, not a statement about NextKey. Nothing here is broken and nothing is missing — this one node will not serve log queries at the moment. Press Refresh in a minute.')}</p>`,
          { posts: null, error: 'ranges-refused' })
      }
    }

    blog.items = []
    let to = head
    for (let i = 0; i < FEED_WINDOWS && to > 0n && blog.items.length < FEED_SHOW; i++) {
      if (!mineStill()) return
      const from = to > blog.width ? to - blog.width + 1n : 0n
      try { blog.items.push(...await blogWindow(from, to)) } catch { /* reported by emptiness */ }
      blogSort()
      if (blog.items.length) render()
      if (from === 0n) break
      to = from - 1n
    }
    if (!mineStill()) return
    blog.head = head
    render()
    blogDates()
    resolveNames()
  } catch (e) {
    say(out, 'bad', `<p>${t('b.fail', 'Could not read that from the chain.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  } finally {
    if (mineStill()) { blog.filling = false; blogStatus() }
  }
}

const blogPoll = async () => {
  if (blog.filling || document.hidden || !blog.addresses || blog.head === null) return
  blog.filling = true
  try {
    const head = await reader.getBlockNumber({ cacheTime: 0 })
    if (head <= blog.head) return
    const fresh = await blogWindow(blog.head + 1n, head)
    blog.head = head
    if (!fresh.length) return
    const at = Date.now()
    for (const p of fresh) p.seen = at
    blog.items.push(...fresh)
    blogSort()
    render()
    blogDates()
  } catch { /* the next one tries again */ } finally { blog.filling = false }
}

// No refresh and no pause here. On the explorer they earn their place — that
// page is a tool, and somebody reading a long list wants it to hold still. A
// community page is not read that way: it is looked at, and it should simply be
// current. What is left is the one thing worth saying, which is that it is.

setInterval(blogPoll, FEED_EVERY)
document.addEventListener('visibilitychange', () => { if (!document.hidden) blogPoll() })

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
      <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer">${esc(clip(hash, 26))}</a></dd>
    </dl>
    <p class="note">${note}</p>
    <p class="note"><a href="https://hackathon-deployment-portal-app.ens-cf.workers.dev/${encodeURIComponent(name)}" target="_blank" rel="noopener noreferrer">${t('b.explorer', 'See it in the ENS explorer')}</a></p>`,
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
      'This name is ours and we lent it to you along with the gas. Your post is on chain and anybody can read it — it will appear in the window above within a few seconds.'))
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

const announced = []
window.addEventListener('eip6963:announceProvider', (e) => {
  if (!announced.some((p) => p.info.uuid === e.detail.info.uuid)) announced.push(e.detail)
})
window.dispatchEvent(new Event('eip6963:requestProvider'))

const connectWallet = async (walletOut) => {
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
}

$('connect').addEventListener('click', () => connectWallet($('wallet-out')))
$('edit-connect').addEventListener('click', () => connectWallet($('edit-wallet')))

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

// ─── Editing ───────────────────────────────────────────────────────────────
//
// A post is a record, and a record is changed by writing it again. So there is
// no edit mechanism to build: there is a read, a form, and the same setText the
// rest of this page uses. What makes it an edit rather than a new post is only
// that the slot is the one already occupied.
//
// Ownership is not checked here, and deliberately so. The resolver decides who
// may write to a name, and it decides correctly; a page that also guessed would
// either duplicate that answer or contradict it. What this page does is fail
// clearly when the chain says no.

let editing = null   // { name, slot, at } — the post the form is holding

const editSlots = async (name) => {
  const raw = await Promise.all(POST_SLOTS.map((key) =>
    reader.getEnsText({ name, key }).catch(() => null)))
  return POST_SLOTS.map((key, i) => ({ key, raw: raw[i] })).filter((r) => r.raw)
}

const editList = (name, found) => {
  const out = $('edit-list')
  if (!found.length) return say(out, '', `
    <p>${t('b.edit.none', 'Nothing published on that name yet.')}</p>
    <p class="note">${t('b.edit.nonenote', 'There is nothing to change until there is a post. Write one above, then come back.')}</p>`,
    { editable: 0 })

  say(out, 'ok', found.map(({ key, raw }) => {
    const p = parsePost(name, key, raw)
    const text = [p.title, p.body].filter(Boolean).join(' ')
    return `
    <div class="ev">
      <p style="margin:0 0 .35rem">${esc(clip(text, 160))}</p>
      <p class="note" style="margin:0">
        <span class="mono">${esc(key)}</span>
        <button class="act ghost" type="button" data-slot="${esc(key)}"
                style="margin-inline-start:.6rem;padding:.25rem .7rem;font-size:.88rem">${t('b.edit.choose', 'Edit this one')}</button>
      </p>
    </div>`
  }).join(''), { editable: found.length })

  for (const b of out.querySelectorAll('button[data-slot]')) {
    b.addEventListener('click', () => {
      const { key, raw } = found.find((f) => f.key === b.dataset.slot)
      const p = parsePost(name, key, raw)
      editing = { name, slot: key, at: p.at }
      $('edit-title').value = p.title
      $('edit-body').value = p.body
      show($('edit-form'), true)
      $('edit-out').hidden = true
      $('edit-title').focus()
    })
  }
}

$('edit-load').addEventListener('click', async () => {
  const out = $('edit-list')
  const name = $('edit-name').value.trim().toLowerCase()
  editing = null
  show($('edit-form'), false)
  if (!name) return say(out, 'bad', `<p>${t('b.needname', 'Enter a name you own.')}</p>`)
  try {
    say(out, 'busy', `<p>${t('b.edit.reading', 'Reading what is on that name…')}</p>`)
    editList(name, await editSlots(name))
  } catch (e) {
    say(out, 'bad', `<p>${t('b.fail', 'Could not read that from the chain.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  }
})

/**
 * One write, to a slot that already holds something.
 *
 * `at` keeps whatever the post claimed when it was first published, and an
 * `edited` stamp is added beside it. Overwriting the original date would make
 * an edit look like a new post, which is the one thing an edit is not.
 */
const editWrite = async (value, busy, done) => {
  const out = $('edit-out')
  if (!editing) return say(out, 'bad', `<p>${t('b.edit.needpick', 'Choose a post to change first.')}</p>`)
  if (!wallet) return say(out, 'bad', `<p>${t('b.edit.needwallet', 'Connect the wallet that holds the name.')}</p>`)
  if (writing) return
  writing = true
  $('edit-save').disabled = true
  $('edit-empty').disabled = true
  const { name, slot } = editing
  try {
    say(out, 'busy', `<p>${t('b.resolver', 'Finding the resolver for that name…')}</p>`)
    let resolver
    try { resolver = await reader.getEnsResolver({ name }) } catch { /* reported below */ }
    if (!resolver || /^0x0+$/i.test(resolver)) throw new Error(t('b.noresolver',
      'That name has no resolver on this deployment, so there is nowhere to write.'))

    const node = toHex(packetToBytes(name))
    say(out, 'busy', `<p>${busy}</p>`)
    await reader.simulateContract({
      address: resolver, abi: setTextAbi, functionName: 'setText',
      args: [node, slot, value], account })

    say(out, 'busy', `<p>${t('b.approve', 'Approve it in your wallet…')}</p>`)
    const hash = await wallet.writeContract({
      address: resolver, abi: setTextAbi, functionName: 'setText',
      args: [node, slot, value], chain: sepolia })
    await reader.waitForTransactionReceipt({ hash })

    say(out, 'ok', `
      <p class="found">✓ ${esc(done)}</p>
      <dl>
        <dt>${t('b.onname', 'on')}</dt><dd class="mono break">${esc(name)}</dd>
        <dt class="mono">${esc(slot)}</dt>
        <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer">${esc(clip(hash, 26))}</a></dd>
      </dl>
      <p class="note">${t('b.edit.note', 'The change is on chain, and the window above will show it within a few seconds — the old text is not gone from the chain’s history, only from the record. A record keeps what it holds now; the chain keeps what it held before.')}</p>`,
      { edited: name, slot, tx: hash })

    if (!value) { editing = null; show($('edit-form'), false) }
    $('edit-load').click()
  } catch (e) {
    say(out, 'bad', `<p>${t('b.wfail', 'That did not go through.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  } finally {
    writing = false
    $('edit-save').disabled = false
    $('edit-empty').disabled = false
  }
}

$('edit-save').addEventListener('click', () => editWrite(
  JSON.stringify({
    v: 1,
    title: $('edit-title').value.trim(),
    body: $('edit-body').value.trim(),
    at: editing?.at ?? new Date().toISOString(),
    edited: new Date().toISOString(),
  }),
  t('b.simulating', 'Checking the write would succeed, before spending anything…'),
  t('b.edit.saved', 'Changed.')))

// Emptying is the same write with nothing in it. There is no delete on a
// resolver, and pretending otherwise would be a nicer word for the same act.
$('edit-empty').addEventListener('click', () => editWrite(
  '',
  t('b.simulating', 'Checking the write would succeed, before spending anything…'),
  t('b.edit.emptied', 'Emptied. The record is still there; it holds nothing.')))

// ─── The agent-facing surface ──────────────────────────────────────────────
window.NEXTKEY = {
  record: RECORD_POST,
  names: () => [...ALLOW],
  read: readPost,
  version: 1,
}

// The overlay replaces every data-i18n string on a language change, so the
// pause button and the posts themselves are redrawn by us.
window.__nextkeyRerender = () => {
  blogStatus()
  if (blog.items.length) render()
}
ready()
blogStatus()
// The window fills itself: a community page that opens empty and waits to be
// asked is a community page nobody reads.
blogFill()
