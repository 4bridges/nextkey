/**
 * An explorer for one question: what does this name carry, and what does that
 * mean?
 *
 * The official ENS explorer already shows every record on a name, correctly and
 * completely, and this page does not try to compete with it. It answers a
 * narrower question in words instead of hex: can this name receive a secret, is
 * it holding one, can its ephemeral key be recovered without a signature, has
 * somebody published on it — and, the part that matters most, what a stranger
 * watching the chain can work out from all that.
 *
 * The last section is the reason the page exists. NextKey's claim is that a
 * grant does not reveal who was granted it, and a claim like that is worth more
 * when a visitor can try to break it themselves. So the page offers to do
 * exactly what an attacker would: take a recipient's *published* key, compute
 * where their grant would live, and look. On a v1 name it succeeds — that was
 * the flaw v2 exists to fix, and hiding it here would be dishonest. On a v2
 * name the address cannot be computed at all without one of the two private
 * keys, and the page says so rather than pretending to search.
 *
 * Read-only throughout. No wallet, no signing, no key material.
 */

import { createPublicClient, http, namehash, decodeEventLog, keccak256, stringToHex, numberToHex } from 'viem'
import { sepolia } from 'viem/chains'
import { un64, fingerprint, nextkeyId } from './nk-crypto.mjs'
import { TOPIC_RECORD, TEXT_UPDATED_TOPIC, TEXT_UPDATED, logReader } from './nk-logs.mjs'
// The names this page can spell. Needed because a record's write is not always
// findable as an event — see readRecords below.
import { POOL } from './demo-wallet.js'

const UNIVERSAL_RESOLVER = '0xd26f2040d083af1cd2962ba303f4bea0c4faf142'

// Etherscan and the ENS explorer answer different questions, so both are here
// and each is used where it is the better answer. A transaction hash is a
// question about the chain — the ENS explorer has no page for one. A name is a
// question about ENS, and there the official explorer is plainly better than
// anything this page could show, so wherever a name is known it is offered.
const ENS_APP = 'https://hackathon-deployment-portal-app.ens-cf.workers.dev'
const ensLink = (name) => `${ENS_APP}/${encodeURIComponent(name)}`
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com'

const RECORD_PUBKEY = 'nextkey.pubkey'
const RECORD_EPH = 'nextkey.eph'
const RECORD_EPH_SEALED = 'nextkey.eph.sealed'
const RECORD_SECRET = 'nextkey.secret'
const RECORD_POST = 'nextkey.post'

const hackathonSepolia = {
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: UNIVERSAL_RESOLVER } },
}
const reader = createPublicClient({
  chain: hackathonSepolia,
  transport: http(RPC, { retryCount: 1, retryDelay: 400, timeout: 10_000 }),
})


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

const why = (label, html) =>
  `<details class="why"><summary>${esc(label)}</summary>${html}</details>`

const plain = (e) => {
  const m = e?.shortMessage ?? e?.details ?? e?.message ?? String(e)
  return m.split('\n')[0].slice(0, 220)
}

const REQUIRED_ELEMENTS = [
  // No 'name', 'look' or 'try'. The box that asked for a name is gone from the
  // page; the reading it produced is not. `lookup()` below is reached by a
  // ?name= link — which is how the README and the other pages point at a name
  // anyway — and it still writes into these two panels and opens the two
  // sections after them.
  'verdict', 'records',
  'step-check', 'who', 'check', 'check-out',
  'step-log', 'history', 'log-out',
  'step-feed', 'feed-refresh', 'feed-pause', 'feed-live', 'feed-out',
  'feed-chips', 'feed-namerow', 'feed-name', 'feed-namego',
]

// ═══ The history of a name ═════════════════════════════════════════════════
//
// Every write to a name is one event on its resolver, so the history the
// official explorer shows is reconstructible from two log queries — and doing
// it here rather than sending a visitor away is the point: they came to see
// what NextKey did, not to learn what a topic hash is.
//
// The events themselves, and the reason they are read with a hand-made request
// rather than viem's getLogs, live in nk-logs.mjs — the blog reads the same
// ones, and a constant that two pages must agree on belongs in one place.
const logsWith = logReader(reader)

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
    throw new Error(`explorer.html is out of step with explorer.js — missing: ${missing.join(', ')}`)
  }
}

// ─── Reading one name ──────────────────────────────────────────────────────

let current = null   // { name, resolver, pubkey, eph, sealed, secret, post }

const read = async (name, key) => reader.getEnsText({ name, key }).catch(() => null)

/**
 * Five records, read at once.
 *
 * Not "every record on the name" — that would need an indexer over the
 * resolver's events, which a static page does not have. What it reads are the
 * records whose names are fixed by the protocol; the grants, whose names are
 * derived, are exactly the ones it cannot enumerate. Saying which is which is
 * the point of the page.
 */
const inspect = async (name) => {
  const [pubkey, eph, sealed, secret, post] = await Promise.all([
    read(name, RECORD_PUBKEY), read(name, RECORD_EPH), read(name, RECORD_EPH_SEALED),
    read(name, RECORD_SECRET), read(name, RECORD_POST),
  ])
  return { name, pubkey, eph, sealed, secret, post }
}

const line = (label, value, note) => `
  <dt>${esc(label)}</dt>
  <dd>${value}${note ? `<br><span class="note">${note}</span>` : ''}</dd>`

const yes = (s) => `<span style="color:var(--ok);font-weight:620">${esc(s)}</span>`

/**
 * A NextKey ID from whatever the record actually contains, or nothing.
 *
 * Anybody may write any string to their own `nextkey.pubkey`, so this is fed
 * arbitrary text and has to say "no" rather than produce something. The check
 * is the length: X25519 public keys are 32 bytes, and base64 that decodes to
 * any other length is not one, whatever else it might be.
 */
const idOf = (value) => {
  try {
    const pk = un64(value)
    return pk.length === 32 ? nextkeyId(pk) : null
  } catch { return null }
}
const no = (s) => `<span class="note">${esc(s)}</span>`

/**
 * What kind of name is this?
 *
 * The page's first draft asked every name the same questions and reported the
 * answers as a list, which produced the reading that prompted this rewrite: a
 * recipient's name came back as five absences and a line saying it was "not a
 * v2 name", as though something had gone wrong. Nothing had. A recipient is not
 * a name that holds a secret, and describing one as a defective version of the
 * other is a category error the reader has to undo before they can learn
 * anything.
 *
 * So the role is decided first, and everything below is phrased for it.
 */
const roleOf = (r) => {
  const holds = !!(r.eph || r.secret)
  const receives = !!r.pubkey
  if (holds && receives) return 'both'
  if (holds) return 'vault'
  if (receives) return 'recipient'
  if (r.post) return 'author'
  return 'empty'
}

const ROLES = {
  recipient: () => ({
    line: t('x.role.recipient', 'This is a recipient. It publishes a key, so anybody can seal a secret to it — no account, no permission, no prior contact.'),
    note: t('x.role.recipientnote', 'A grant to this name does not live here. It lives on the name that holds the secret, at an address derived from this key and that name’s ephemeral one. So there is nothing to count on this page, and nothing missing either.'),
  }),
  vault: () => ({
    line: t('x.role.vault', 'This name is holding a secret. Whoever it was granted to can open it; nobody else can, and the chain does not say who they are.'),
    note: t('x.role.vaultnote', 'The grants sit on this name, under derived addresses. That is what the history below shows: each grant appearing, and each one taken back.'),
  }),
  both: () => ({
    line: t('x.role.both', 'This name does both: it holds a secret, and it publishes a key so secrets can be sealed to it.'),
    note: t('x.role.bothnote', 'Which is ordinary — the two roles are unrelated, and a name that keeps something can also be somebody others write to.'),
  }),
  author: () => ({
    line: t('x.role.author', 'This name carries a public post and nothing else NextKey uses.'),
    note: '',
  }),
  empty: () => ({
    line: t('x.role.empty', 'This name carries none of NextKey’s records. It exists, and as far as this page can tell it has never been used here.'),
    note: t('x.role.emptynote', 'That is not a failure: most names on this deployment have nothing to do with us.'),
  }),
}

/**
 * The records, described for the role rather than in the abstract.
 *
 * An absent record means something different on each kind of name, and saying
 * "absent" five times says nothing at all.
 */
const recordLines = (r, role) => {
  const rows = []
  const P = t('x.present', 'present')
  const A = t('x.absent', 'absent')

  // The NextKey ID goes first, above the record it is computed from, because it
  // is the line a reader is here to compare. It is not a record and is not
  // presented as one: nothing on chain holds it, and the row says so by sitting
  // outside the record list's naming.
  //
  // It is shown only when the key parses. A `nextkey.pubkey` holding something
  // that is not a 32-byte X25519 key is a real state — anybody may write any
  // string to their own name — and inventing an ID for it would put a
  // confident, checkable-looking identifier under a value that identifies
  // nobody.
  if (r.pubkey) {
    const id = idOf(r.pubkey)
    if (id) {
      rows.push(line(t('t.id.label', 'NextKey ID'), `<span class="mono nkid">${esc(id)}</span>`,
        t('x.nkid', 'The published key, in the form a person can read out and compare. Derived from it and nothing else — no record holds this, and every name that publishes a key has one.')))
    }
  }

  if (role === 'recipient' || role === 'both' || r.pubkey) {
    rows.push(line(RECORD_PUBKEY, r.pubkey ? yes(P) : no(A),
      r.pubkey
        ? t('x.pubkey.yes', 'The key everything sealed to this name is wrapped to. Publishing it is the whole of the opt-in.')
        : t('x.pubkey.no', 'Nothing can be sealed to this name yet — there is no key to wrap to.')))
  }

  if (role === 'vault' || role === 'both') {
    rows.push(line(RECORD_EPH, r.eph ? yes(P) : no(A),
      r.eph
        ? t('x.eph.yes', 'Written once and never replaced. Every grant on this name is addressed from this one public key and a recipient’s — which is why the addresses cannot be guessed from anything public.')
        : t('x.eph.v1', 'This name holds a secret under v1, so its grants sit at nextkey.grant.<hash of the recipient’s key> — an address anybody can compute. That is the flaw v2 was built to fix, and you can try it below.')))
    rows.push(line(RECORD_EPH_SEALED, r.sealed ? yes(P) : no(A),
      r.sealed
        ? t('x.sealed.yes', 'The ephemeral key, wrapped to the owner, so a recipient can be added later without a signature. Useless to anybody else.')
        : t('x.sealed.no', 'No wrapped copy. Adding a recipient later means re-deriving that key from a signature — deterministic, but it needs the wallet.')))
    rows.push(line(RECORD_SECRET,
      r.secret ? yes(`${P} · ${r.secret.length} ${t('x.chars', 'characters')}`) : no(A),
      r.secret
        ? t('x.secret.yes', 'The ciphertext, public by design. Reading it teaches nothing: it is AES-256-GCM under a key that is not on the chain. Nor does its length — the secret is padded to a fixed block before sealing, so a passphrase and a short message come out the same size. A very long secret still lands in a higher block, so the length is coarse rather than absent.')
        : t('x.secret.no', 'No ciphertext here — the name carries the addressing but not the payload.')))
  }

  rows.push(line(RECORD_POST, r.post ? yes(P) : no(A),
    r.post
      ? t('x.post.yes', 'A public post, in the clear — the one record here meant to be read.')
      : t('x.post.no', 'Nothing published on this name.')))

  rows.push(line(t('x.grants', 'grants'),
    no(role === 'recipient'
      ? t('x.grants.elsewhere', 'not on this name')
      : t('x.grants.unknown', 'not countable from here')),
    role === 'recipient'
      ? t('x.grants.elsewherenote', 'Grants to this name are records on whichever names hold the secrets. Look one of those up to see them — and note that even there, nothing says they are this name’s.')
      : t('x.grants.note', 'Grant records are named after a derived tag, so this page cannot ask for them by name. An indexer over the resolver’s events could count them; nothing could say whose they are.')))

  return rows.join('')
}

const lookup = async (name) => {
  const v = $('verdict')
  try {
    say(v, 'busy', `<p>${t('x.reading', 'Reading it from Sepolia…')}</p>`)
    $('records').hidden = true
    show($('step-check'), false)
    show($('step-log'), false)

    // A failed request and an empty answer look identical to a reader, and only
    // one of them is honest. A name with no resolver is a fact about the name;
    // an unreachable node is a fact about the network, and telling somebody the
    // first when the second happened sends them hunting a problem they do not
    // have.
    let resolver = null
    let unreachable = null
    try { resolver = await reader.getEnsResolver({ name }) } catch (e) { unreachable = e }
    if (unreachable) {
      current = null
      return say(v, 'bad', `
        <p>${t('x.unreachable', 'Could not reach the chain just now.')}</p>
        <p class="note">${t('x.unreachablenote', 'This says nothing about the name — the request to the Sepolia node did not come back. Try again in a moment.')}</p>
        <p class="note mono">${esc(plain(unreachable))}</p>`,
        { name, error: 'unreachable' })
    }
    if (!resolver || /^0x0+$/i.test(resolver)) {
      current = null
      return say(v, 'bad', `
        <p>${t('x.noresolver', 'That name has no resolver on this deployment.')}</p>
        <p class="note">${t('x.noresolvernote', 'Either it is not registered here, or nothing has been attached to it yet. A name you hold on production ENS will not do — this is the hackathon deployment, and it is a separate world.')}</p>`,
        { name, resolver: null })
    }

    const r = await inspect(name)
    r.resolver = resolver
    current = r
    const role = roleOf(r)
    const said = ROLES[role]()

    say(v, role === 'empty' ? '' : 'ok', `
      <p class="found">${esc(name)}</p>
      <p>${esc(said.line)}</p>
      ${said.note ? `<p class="note">${esc(said.note)}</p>` : ''}
      <p class="note"><a href="${esc(ensLink(name))}" target="_blank" rel="noopener noreferrer">${t('b.explorer', 'See it in the ENS explorer')}</a>
        · <a href="https://sepolia.etherscan.io/address/${esc(resolver)}" target="_blank" rel="noopener noreferrer">${t('x.resolver', 'its resolver')}: ${esc(clip(resolver, 20))}</a></p>`,
      { name, resolver, role,
        has: { pubkey: !!r.pubkey, eph: !!r.eph, sealed: !!r.sealed, secret: !!r.secret, post: !!r.post } })

    say($('records'), '', `
      <dl>${recordLines(r, role)}</dl>
      ${r.post ? `<p class="reclabel">${t('x.thepost', 'the post')}</p><pre class="mono">${esc(clip(r.post, 600))}</pre>` : ''}`)

    // Only a name that holds a secret has an address worth attacking. On a
    // recipient there is nothing here to attribute: her grants live elsewhere.
    show($('step-check'), role === 'vault' || role === 'both')
    show($('step-log'), true)
    $('log-out').hidden = true
  } catch (e) {
    current = null
    say(v, 'bad', `<p>${t('x.fail', 'Could not read that from the chain.')}</p>
                   <p class="note mono">${esc(plain(e))}</p>`)
  }
}

// The three handlers that used to be here — the button, Enter in the box, and
// "try an example" — belonged to a form the page no longer has. `lookup()` is
// called from one place now, at the foot of this file, with the name a ?name=
// link asked for.

// ─── The attack, offered to the visitor ────────────────────────────────────

$('check').addEventListener('click', async () => {
  const out = $('check-out')
  const who = $('who').value.trim().toLowerCase()
  if (!current) return
  if (!who) return say(out, 'bad', `<p>${t('x.check.needname', 'Name somebody to look for.')}</p>`)

  try {
    say(out, 'busy', `<p>${t('x.check.reading', 'Reading their published key…')}</p>`)
    const pub = await read(who, RECORD_PUBKEY)
    if (!pub) return say(out, 'bad', `
      <p>${t('x.check.nokey', 'That name publishes no key, so there is nothing an observer could compute from it.')}</p>`)

    // ── v2: the address is not a function of anything public ──────────────
    if (current.eph) {
      return say(out, 'ok', `
        <p class="found">✓ ${t('x.check.v2', 'Nothing to look at.')}</p>
        <p>${t('x.check.v2p', 'This name is v2. A grant to that person would live at an address derived from the shared secret between this name’s ephemeral key and their private key — and the private half is theirs. With every public value on this page in hand, an observer cannot compute the address, cannot test a guess, and cannot tell whether this name grants to them at all.')}</p>
        ${why(t('x.check.what', 'What was tried'), `
          <p>${t('x.check.v2note', 'The published key was read and the v1 address was deliberately not computed, because on a v2 name it would point nowhere. There is no query that closes this gap: the missing input is a private key, not a lookup.')}</p>
          <dl>
            <dt>${esc(who)}</dt><dd class="mono break">${esc(pub)}</dd>
          </dl>`)}`,
        { name: current.name, scheme: 'v2', attributable: false })
    }

    // ── v1: the address is sha256 of a public value, and anybody can try ──
    const key = `nextkey.grant.${fingerprint(un64(pub))}`
    const there = await read(current.name, key)

    say(out, there ? 'bad' : '', `
      <p class="found" style="${there ? 'color:var(--bad)' : ''}">${there
        ? `✗ ${t('x.check.found', 'Found it — and that is the problem.')}`
        : t('x.check.empty', 'That address is empty on this name.')}</p>
      <dl>
        <dt>${t('x.check.computed', 'the address an observer computes')}</dt>
        <dd class="mono break">${esc(key)}</dd>
        <dt>${t('x.check.andthere', 'and what is there')}</dt>
        <dd class="mono">${there ? esc(clip(there, 60)) : t('x.check.nothing', 'nothing')}</dd>
      </dl>
      <p class="note">${there
        ? t('x.check.foundnote', 'This is a v1 name, and its grant address is a hash of the recipient’s published key — a public value. So anybody who knows that key can prove this person has access, without any private key at all. The ciphertext was never the leak; the record name was. That is the whole reason v2 exists.')
        : t('x.check.emptynote', 'This is a v1 name and the address was computable, but nothing is there: this person was never granted access, or it was withdrawn. Note that an observer learns which of the two it is — nothing.')}</p>`,
      { name: current.name, scheme: 'v1', computed: key, attributable: !!there })
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

// ─── The history ───────────────────────────────────────────────────────────

/**
 * What each write actually did, in words.
 *
 * The key tells you, and the value tells you whether it was a grant or a
 * withdrawal — an empty value is how a record is emptied on chain, since there
 * is no delete. Everything not recognised is shown as itself rather than
 * guessed at: a record this page has never heard of is still a fact about the
 * name, and inventing a description for it would be the one thing an explorer
 * must not do.
 */
const meaning = (key, value) => {
  const gone = !value
  if (key === RECORD_EPH) return t('x.m.eph', 'set up where grants on this name are addressed')
  if (key === RECORD_EPH_SEALED) return t('x.m.sealed', 'wrapped that key to the owner, so a recipient can be added later without a signature')
  if (key === RECORD_SECRET) return gone
    ? t('x.m.secretgone', 'removed the ciphertext')
    : t('x.m.secret', 'sealed a text')
  if (key === RECORD_PUBKEY) return t('x.m.pubkey', 'created a NextKey ID')
  if (key === RECORD_POST) return gone
    ? t('x.m.postgone', 'took its post down')
    : t('x.m.post', 'published a post, in the clear')
  if (key.startsWith('nextkey.g2.')) return gone
    ? t('x.m.revoked', 'took a grant back — the wrapped key is gone, the ciphertext is not')
    : t('x.m.granted', 'gave access')
  if (key.startsWith('nextkey.a2.')) return t('x.m.ack', 'a recipient acknowledged reading it')
  if (key.startsWith('nextkey.grant.')) return gone
    ? t('x.m.v1revoked', 'took back a v1 grant')
    : t('x.m.v1granted', 'granted access under v1 — this address is a hash of the recipient’s public key, so it names them')
  return t('x.m.other', 'wrote a record')
}

/**
 * How far back a public RPC will let you look.
 *
 * The first version asked for fifty thousand blocks and treated a refusal as
 * an empty answer, which produced the reading that sent me back here: a name
 * whose records the page had just printed was reported as having no history at
 * all. The node had simply declined the range.
 *
 * So the width is discovered instead of assumed — one probe, largest first —
 * and then the chain is walked backwards in that width until something is
 * found or the budget runs out. What the budget bought is printed, because
 * "nothing in the last four days" and "nothing ever" are different statements
 * and only one of them is true.
 */
const WIDTHS = [50_000n, 10_000n, 2_000n, 800n]
const BUDGET = 45          // requests, so a phone is not left spinning

const widthFor = async (address, head) => {
  for (const w of WIDTHS) {
    try {
      await logsWith({ address, topics: [], fromBlock: head > w ? head - w : 0n, toBlock: head })
      return w
    } catch { /* refused — try a narrower one */ }
  }
  return null
}

/** Walk back until the filter matches, or the budget is spent. */
const walkBack = async (address, topics, head, width) => {
  let to = head
  let scanned = 0n
  let refused = null
  for (let i = 0; i < BUDGET && to > 0n; i++) {
    const from = to > width ? to - width + 1n : 0n
    try {
      const found = await logsWith({ address, topics, fromBlock: from, toBlock: to })
      scanned += to - from + 1n
      if (found.length) return { found, scanned, refused: null }
    } catch (e) { refused = e }
    if (from === 0n) break
    to = from - 1n
  }
  return { found: [], scanned, refused }
}

$('history').addEventListener('click', async () => {
  const out = $('log-out')
  if (!current?.resolver) return
  try {
    say(out, 'busy', `<p>${t('x.log.reading', 'Reading the resolver’s events…')}</p>`)
    const head = await reader.getBlockNumber()
    const width = await widthFor(current.resolver, head)
    if (!width) return say(out, 'bad', `
      <p>${t('x.log.norange', 'The node refused every block range this page asked for.')}</p>
      <p class="note">${t('x.log.norangenote', 'That is a limit of the public endpoint, not of the name. The records above came back fine; only the history needs log queries, and this one will not serve them right now.')}</p>`,
      { name: current.name, error: 'ranges-refused' })

    // One narrow filter finds the record id: topic2 of the creation event is
    // the namehash, which is computable here without asking anybody.
    const node = namehash(current.name)
    const created = await walkBack(current.resolver, [TOPIC_RECORD, null, node], head, width)
    if (!created.found.length) {
      return say(out, created.refused ? 'bad' : '', `
        <p>${created.refused
          ? t('x.log.refused', 'The node stopped answering partway through.')
          : t('x.log.notinrange', 'No record-creation event in the stretch this page could search.')}</p>
        <p class="note">${t('x.log.scanned', 'Searched back')} ${esc(String(created.scanned))} ${t('x.log.blocksfrom', 'blocks from the current head, in steps of')} ${esc(String(width))}.</p>
        <p class="note">${created.refused
          ? t('x.log.refusednote', 'This says nothing about the name. The records above are read directly and are unaffected.')
          : t('x.log.notinrangenote', 'The name resolves, so it was created — just further back than a public endpoint will let a browser walk. The records above are read directly and are unaffected.')}</p>`,
        { name: current.name, history: null, scanned: String(created.scanned) })
    }

    const recordId = created.found[0].topics[1]
    const writes = []
    let to = head
    let scanned = 0n
    for (let i = 0; i < BUDGET && to >= created.found[0].blockNumber; i++) {
      const from = to > width ? to - width + 1n : 0n
      let logs = []
      try { logs = await logsWith({ address: current.resolver, topics: [TEXT_UPDATED_TOPIC, recordId], fromBlock: from, toBlock: to }) } catch { /* keep walking */ }
      scanned += to - from + 1n
      for (const log of logs) {
        if (log.topics[0] !== TEXT_UPDATED_TOPIC) continue
        try {
          const { args } = decodeEventLog({ abi: [TEXT_UPDATED], data: log.data, topics: log.topics })
          writes.push({ key: args.key, value: args.value, block: log.blockNumber, tx: log.transactionHash })
        } catch { /* a shape we do not know is skipped rather than guessed at */ }
      }
      if (from === 0n) break
      to = from - 1n
    }

    if (!writes.length) return say(out, '', `
      <p>${t('x.log.empty', 'The name exists on that resolver, but nothing has been written to it.')}</p>`,
      { name: current.name, writes: 0 })

    // Newest first. The walk already went backwards, but a single query can
    // return several writes from one transaction in ascending order.
    writes.sort((a, b) => (a.block === b.block ? 0 : a.block > b.block ? -1 : 1))

    const shown = writes.slice(0, 20)
    const when = new Map()
    for (const b of [...new Set(shown.map((w) => w.block))]) {
      try {
        const blk = await reader.getBlock({ blockNumber: b })
        when.set(b, new Date(Number(blk.timestamp) * 1000).toISOString().replace('T', ' ').slice(0, 16))
      } catch { /* a timestamp is a nicety, not the point */ }
    }

    say(out, 'ok', `
      ${shown.map((w) => `
      <div style="border-top:1px solid var(--line);padding:.7rem 0">
        <p style="margin:0 0 .2rem">${esc(meaning(w.key, w.value))}</p>
        <p class="note" style="margin:0">
          <span class="mono break">${esc(w.key)}</span> ·
          ${t('x.log.block', 'block')} ${esc(String(w.block))}${when.has(w.block) ? ` · ${esc(when.get(w.block))} UTC` : ''} ·
          <a href="https://sepolia.etherscan.io/tx/${esc(w.tx)}" target="_blank" rel="noopener noreferrer">${t('x.log.tx', 'transaction')}</a>
        </p>
        ${w.value ? `<pre class="mono" style="margin-top:.4rem">${esc(clip(w.value, 220))}</pre>` : ''}
      </div>`).join('')}
      <p class="note">${t('x.log.window', 'Searched')} ${esc(String(scanned))} ${t('x.log.blocks', 'blocks on')} <span class="mono break">${esc(current.resolver)}</span>${writes.length > 20 ? ` · ${t('x.log.more', 'showing the twenty most recent of')} ${writes.length}` : ''}.</p>
          ${why(t('x.log.how', 'How this is read'), `
        <p>${t('x.log.hownote', 'Two log filters and no server: one finds the record id by the name’s namehash, the other reads every text write against that id. The key sits unindexed in the event, so it can be shown in full — which is the only reason a line like “granted access to somebody” can name the record it happened on.')}</p>`)}`,
      { name: current.name, writes: writes.length, scanned: String(scanned) })
  } catch (e) {
    say(out, 'bad', `<p>${t('x.log.fail', 'Could not read the events.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  }
})

// ═══ The live window ═══════════════════════════════════════════════════════
//
// Everything above starts from a name. This does not: it is every NextKey
// record on the resolver, newest first, and it keeps arriving while the page is
// open. Same two log filters, one address, no name.
//
// Which is also the honest part. A TextUpdated event carries a record id, not a
// name, and the creation event that ties the two together carries the namehash
// — one-way by construction. So the feed can say what happened and when, and
// cannot say to whom. That is not a gap in the page; it is the property the
// rest of the site claims, visible in the raw.
//
// Which address to watch turned out to be the whole question, and the first
// version got it wrong in the way that is hardest to see: it guessed one
// resolver from one anchor name, found nothing, and reported an empty chain.
// Nothing was empty. It was looking at the wrong contract, and — worse — it did
// not print which one, so the panel said "nothing happened" when it meant "I
// asked somewhere else".
//
// On ENSv2 a name's resolver is a property of the name, not of the deployment,
// so there is no single right answer to guess. Every candidate is watched at
// once instead: eth_getLogs takes a list of addresses, so this costs the same
// one request. And whatever the result, the addresses are printed — an empty
// list that cannot say where it looked is not a finding, it is a shrug.
const FEED_ANCHORS = ['vault.nextkey.eth', 'nextkeyv2.eth', 'anna.nextkey.eth']
const FEED_RESOLVERS = ['0x04B2DB6567Cc68d059c061215Adf9a99adD1cA65']
const FEED_SHOW = 30          // entries on screen
const FEED_KEEP = 90          // entries in memory, so a poll has somewhere to go
const FEED_WINDOWS = 8        // log queries for a filter we sort ourselves
const FEED_WINDOWS_DEEP = 24  // and for one the node can answer on its own
const FEED_STAMPS = 24        // block timestamps fetched per render
const FEED_EVERY = 20_000     // how often a poll asks for new blocks
const FRESH_FOR = 6_000       // how long an arrival stays marked

const feed = {
  read: [],           // records read off their names, see readRecords
  names: new Map(),   // record id → name, where a creation event says so
  addresses: null,   // every resolver this page watches, discovered and given
  width: null,
  head: null,        // the newest block this page has already read
  items: [],
  scanned: 0n,
  when: new Map(),   // block → "YYYY-MM-DD HH:MM"
  paused: false,
  timer: null,
  filling: false,
  refused: null,     // the last window the node would not serve
  filter: 'all',
  name: '',          // the name behind the ENS-name filter
  recordId: null,    // and its record id, once found
  cache: new Map(),  // filter → what was found for it, so a second click is free
  gen: 0,            // which read is the current one
}

const isNextkey = (key) => typeof key === 'string' && key.startsWith('nextkey.')
const isGrant = (key) => key.startsWith('nextkey.g2.') || key.startsWith('nextkey.grant.')

/**
 * The filters, and why they are not all the same shape.
 *
 * TextUpdated indexes the key as well as carrying it in the data, so a record
 * with a fixed name can be asked for directly: topic2 is keccak256 of the key,
 * the node does the selecting, and the search reaches much further back for the
 * same one request. That covers posts and ciphertexts.
 *
 * A grant cannot work that way. Its record is named nextkey.g2.<derived tag>,
 * so every grant hashes to a different topic and there is no value to ask for —
 * the same property that keeps a grant unattributable also keeps it
 * unindexable. Those filters read the window and sort afterwards, and the page
 * says so rather than letting a short list pass for a complete one.
 *
 * The name filter is the exception that proves it: a name's record id is not
 * public knowledge either, but it is discoverable — the creation event carries
 * the namehash, which we can compute. One lookup, then an exact filter.
 */
const POST_KEYS = [RECORD_POST, `${RECORD_POST}.2`, `${RECORD_POST}.3`,
                   `${RECORD_POST}.4`, `${RECORD_POST}.5`]
const topicOf = (key) => keccak256(stringToHex(key))

const FILTERS = {
  all:     { deep: false, topics: () => [TEXT_UPDATED_TOPIC],
             keep: (w) => isNextkey(w.key) },
  post:    { deep: true,  topics: () => [TEXT_UPDATED_TOPIC, null, POST_KEYS.map(topicOf)],
             keep: (w) => w.key.startsWith(RECORD_POST) },
  secret:  { deep: true,  topics: () => [TEXT_UPDATED_TOPIC, null, [topicOf(RECORD_SECRET)]],
             keep: (w) => w.key === RECORD_SECRET },
  granted: { deep: false, topics: () => [TEXT_UPDATED_TOPIC],
             keep: (w) => isGrant(w.key) && !!w.value },
  revoked: { deep: false, topics: () => [TEXT_UPDATED_TOPIC],
             keep: (w) => isGrant(w.key) && !w.value },
  name:    { deep: true,  topics: () => [TEXT_UPDATED_TOPIC, feed.recordId],
             keep: (w) => isNextkey(w.key) },
}
const active = () => FILTERS[feed.filter] ?? FILTERS.all

/**
 * Records read off their names, for the two questions the events cannot answer.
 *
 * Measured against the chain on 11 September: `hero01.nextkey.eth` carries a
 * post, its resolver is the pool resolver, and that resolver has no write event
 * for a post record and no creation event for that name — over its whole life,
 * 1.5 million blocks, no range refused. The same queries find `hero72`,
 * `hero02` and `hero150` exactly as documented. So a record can exist without a
 * findable event, and two things here were built on the assumption that it
 * cannot: the post filter, which asked the node for post writes, and the name
 * filter, which needs a record id and gets it only from a creation event.
 *
 * Both are answered by reading instead. One `text()` call per name and key —
 * the same call that returns the post the sweep cannot see. What it cannot do
 * is find a name nobody here listed, which is exactly what the log sweep is
 * still for. The two are shown together and the list says which is which: a
 * read record has no block and no transaction, because this page never saw the
 * write, only what it left behind.
 */
const PARENT = 'nextkey.eth'
const READ_BATCH = 10
const READ_NAMES = [PARENT, 'nextkeyv2.eth', `anna.${PARENT}`, `bob.${PARENT}`, `agent.${PARENT}`,
                    `vault.${PARENT}`, ...POOL.map((l) => `${l}.${PARENT}`)]

const readRecords = async (names, keys, onProgress) => {
  const out = []
  for (let i = 0; i < names.length; i += READ_BATCH) {
    const slice = names.slice(i, i + READ_BATCH)
    const rows = await Promise.all(slice.map(async (name) => {
      const first = await read(name, keys[0])
      if (!first && keys.length > 1 && keys[0] === RECORD_POST) return [[name, keys[0], first]]
      const rest = await Promise.all(keys.slice(1).map((k) => read(name, k)))
      return [[name, keys[0], first], ...keys.slice(1).map((k, j) => [name, k, rest[j]])]
    }))
    for (const row of rows.flat()) {
      const [name, key, value] = row
      if (value) out.push({ name, key, value, record: null, block: null, tx: null, index: 0, seen: 0 })
    }
    onProgress?.(Math.min(i + READ_BATCH, names.length), names.length, out.length)
  }
  return out
}

/**
 * Every resolver worth watching.
 *
 * Three sources, none of them trusted alone: the anchors, resolved live, so a
 * redeployed chain is followed; the constant, so the page still works when the
 * anchors are gone; and whatever the visitor is looking at right now, which is
 * the one address we know for certain carries NextKey records. A ?resolver=
 * parameter is appended for a chain we have never met.
 */
const feedAddresses = async () => {
  const seen = new Map()   // lowercase → the address as first written
  const add = (a) => {
    if (!a || /^0x0+$/i.test(a) || !/^0x[0-9a-f]{40}$/i.test(a)) return
    if (!seen.has(a.toLowerCase())) seen.set(a.toLowerCase(), a)
  }
  for (const a of FEED_RESOLVERS) add(a)
  add(new URLSearchParams(location.search).get('resolver'))
  add(current?.resolver)
  const found = await Promise.all(
    FEED_ANCHORS.map((name) => reader.getEnsResolver({ name }).catch(() => null)))
  for (const a of found) add(a)
  return [...seen.values()]
}

/**
 * The widest window this node will serve — and, when it serves none, why.
 *
 * widthFor above throws its refusals away, which is right for the history: the
 * name's records are on screen either way. Here there is nothing else on
 * screen, so the reason is the whole message.
 */
const feedWidth = async (head) => {
  let last = null
  for (const w of WIDTHS) {
    try {
      await logsWith({ address: feed.addresses, topics: active().topics(),
                       fromBlock: head > w ? head - w : 0n, toBlock: head })
      return { width: w, error: null }
    } catch (e) { last = e }
  }
  return { width: null, error: last }
}

/** Decode one window of resolver logs into feed entries. */
/**
 * Which name a record belongs to, where that can be established.
 *
 * The window used to say "a grant was given" and nothing about whose name it
 * happened on, because a write event carries a record id and not a name. That
 * is true and it was too pessimistic: the *creation* event of a record carries
 * both the record id and the namehash, and a namehash can be recognised — not
 * reversed, recognised — by hashing the names this page can spell and comparing.
 * So every window asks for creation events as well and keeps the pairs it can
 * name. A record whose creation event is not in the window, or whose name is
 * not one of ours, still shows without a name; that is the honest remainder,
 * and it is now the exception rather than every single row.
 */
const KNOWN_BY_HASH = new Map(READ_NAMES.map((n) => [namehash(n).toLowerCase(), n]))

/**
 * The name behind a NextKey ID, if it is one this page can recognise.
 *
 * An ID is seventy bits of a hash over a published key. It does not run
 * backwards, so there is no lookup — only recognition: read the key each name
 * publishes, derive its ID, compare. That works for the names this page can
 * spell and for no others, and the difference is said out loud rather than
 * reported as "not found".
 */
const nameForId = async (id, onProgress) => {
  const want = id.toUpperCase()
  for (let i = 0; i < READ_NAMES.length; i += READ_BATCH) {
    const slice = READ_NAMES.slice(i, i + READ_BATCH)
    const keys = await Promise.all(slice.map((n) => read(n, RECORD_PUBKEY)))
    for (let j = 0; j < slice.length; j++) {
      if (keys[j] && idOf(keys[j]) === want) return slice[j]
    }
    onProgress?.(Math.min(i + READ_BATCH, READ_NAMES.length), READ_NAMES.length)
  }
  return null
}

const NEXTKEY_ID = /^NK-[0-9A-HJ-KMNP-TV-Z]{5}-[0-9A-HJ-KMNP-TV-Z]{5}-[0-9A-HJ-KMNP-TV-Z]{5}$/i

const nameRecords = async (from, to) => {
  try {
    const created = await logsWith({
      address: feed.addresses, topics: [TOPIC_RECORD], fromBlock: from, toBlock: to,
    })
    for (const c of created) {
      const who = KNOWN_BY_HASH.get(String(c.topics[2] ?? '').toLowerCase())
      if (who) feed.names.set(String(c.topics[1] ?? '').toLowerCase(), who)
    }
  } catch { /* one window without names is a row without a name, not a failure */ }
}

const feedLogs = async (from, to) => {
  const [logs] = await Promise.all([
    logsWith({ address: feed.addresses, topics: active().topics(), fromBlock: from, toBlock: to }),
    nameRecords(from, to),
  ])
  const out = []
  for (const log of logs) {
    try {
      const { args } = decodeEventLog({ abi: [TEXT_UPDATED], data: log.data, topics: log.topics })
      if (!active().keep({ key: args.key, value: args.value })) continue
      out.push({
        key: args.key, value: args.value,
        record: String(log.topics[1] ?? '').toLowerCase(),
        block: log.blockNumber, tx: log.transactionHash,
        index: log.logIndex ?? 0,
        seen: 0,
      })
    } catch { /* an event shape we do not know is skipped, not guessed at */ }
  }
  return out
}

/** Newest first, and stable when two writes share a block. */
const feedSort = () => {
  feed.items.sort((a, b) =>
    a.block === b.block ? b.index - a.index : (a.block > b.block ? -1 : 1))
  const seen = new Set()
  feed.items = feed.items.filter((w) => {
    const id = `${w.tx}:${w.index}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  }).slice(0, FEED_KEEP)
}

/** Where it looked — printed whether or not it found anything. */
const feedWhere = () => (feed.addresses ?? [])
  .map((a) => `<a class="mono break" href="https://sepolia.etherscan.io/address/${esc(a)}" target="_blank" rel="noopener noreferrer">${esc(a)}</a>`)
  .join(', ')

const feedStatus = () => {
  const el = $('feed-live')
  if (!feed.addresses) { el.textContent = ''; return }
  el.innerHTML = feed.paused
    ? `<span class="dot off"></span>${esc(t('x.feed.paused', 'Paused'))}`
    : `<span class="dot"></span>${esc(t('x.feed.living', 'Live'))}`
}

const feedRender = () => {
  const out = $('feed-out')
  // Read records first, then the events. They answer different questions —
  // what a name carries now, and what somebody did to it — and only the second
  // has a date this page can stand behind. Mixing them by time would invent a
  // comparison that does not exist; saying which is which does not.
  const all = [...feed.read, ...feed.items]
  const shown = all.slice(0, FEED_SHOW)
  const now = Date.now()
  const anyRead = shown.some((w) => !w.tx)

  say(out, 'ok', `
    ${feed.filter === 'name' && feed.name ? `<p class="note" style="margin:0 0 .4rem">
      <span class="mono break">${esc(feed.name)}</span> ·
      <a href="${esc(ensLink(feed.name))}" target="_blank" rel="noopener noreferrer">${t('b.explorer', 'See it in the ENS explorer')}</a></p>` : ''}
    ${shown.map((w) => `
    <div class="ev${now - w.seen < FRESH_FOR ? ' fresh' : ''}">
      ${(() => { const who = w.name ?? feed.names.get(w.record) ?? null
        // The name first: it is who this line is about, and a list of lines that
        // all begin with the same four verbs is read by its subject.
        // No dash between them: with the name first the line is a sentence —
        // "anna.nextkey.eth created a NextKey ID" — and a dash would turn a
        // subject and its verb back into two labels stuck together.
        return `<p style="margin:0 0 .2rem">${who
          ? `<a class="mono" href="${esc(ensLink(who))}" target="_blank" rel="noopener noreferrer">${esc(who)}</a> `
          : ''}${esc(meaning(w.key, w.value))}</p>` })()}
      ${w.key === RECORD_PUBKEY && idOf(w.value)
        ? `<p class="note" style="margin:0 0 .2rem">${t('t.id.label', 'NextKey ID')}
             <span class="mono nkid">${esc(idOf(w.value))}</span></p>`
        : ''}
      <p class="note" style="margin:0">
        <span class="mono break">${esc(w.key)}</span>${w.tx
          ? ` · ${t('x.log.block', 'block')} ${esc(String(w.block))}${feed.when.has(String(w.block)) ? ` · ${esc(feed.when.get(String(w.block)))} UTC` : ''} ·
        <a href="https://sepolia.etherscan.io/tx/${esc(w.tx)}" target="_blank" rel="noopener noreferrer">${t('x.log.tx', 'transaction')}</a>`
          : ` · ${esc(t('x.feed.readnow', 'read off the name just now'))}`}
      </p>
      ${w.value ? `<pre class="mono">${esc(clip(w.value, 220))}</pre>` : ''}
    </div>`).join('')}
    ${feed.filter === 'name' && !feed.recordId ? `<p class="note">${t('x.f.readonly', 'This name has no creation event a public node will serve, so there is no record id and no exact question to ask about its writes. What stands above is what the name carries now, read one record at a time.')}</p>` : ''}
    ${anyRead ? `<p class="note">${t('x.feed.readnote', 'The entries without a transaction were read off their names rather than found as events: a record can exist on this deployment without a write event a public node will serve, and a list that only asked for events would leave those out and look complete.')}</p>` : ''}
    <p class="note">${t('x.log.window', 'Searched')} ${esc(String(feed.scanned))} ${t('x.log.blocks', 'blocks on')} ${feedWhere()}${all.length > FEED_SHOW ? ` · ${t('x.feed.showing', 'showing the newest')} ${FEED_SHOW} ${t('x.feed.of', 'of')} ${all.length}` : ''}.</p>
    ${feed.filter === 'granted' || feed.filter === 'revoked' ? `<p class="note">${t('x.feed.partial', 'A grant’s record name is derived, so the node cannot select these — they were picked out of the range above by hand. This is therefore what is in that range, not what exists.')}</p>` : ''}
    ${active().deep && feed.filter !== 'all' ? `<p class="note">${t('x.feed.exact', 'This filter is asked of the node directly, so it reaches back as far as the search went and misses nothing inside it.')}</p>` : ''}
    ${why(t('x.log.how', 'How this is read'), `
      <p>${t('x.feed.hownote', 'One log filter on one resolver, and no server: every text write it has made, kept if the record name begins with nextkey. The value is shown as it stands on the chain, because it is public either way.')}</p>
      <p>${t('x.feed.noname', 'What is missing here is deliberate. The event carries a record id, not a name, and the event that ties the two together carries a namehash, which does not run backwards. So this list can say a grant was given and cannot say to whom — which is the claim the rest of this page makes, seen from outside.')}</p>`)}`,
    { feed: all.length, read: feed.read.length, resolvers: feed.addresses, scanned: String(feed.scanned) })
}

/** Timestamps are a nicety, so they are fetched after the list is already up. */
const feedStamps = async () => {
  const need = [...new Set(feed.items.slice(0, FEED_SHOW).map((w) => String(w.block)))]
    .filter((b) => !feed.when.has(b))
    .slice(0, FEED_STAMPS)
  if (!need.length) return
  await Promise.all(need.map(async (b) => {
    try {
      const blk = await reader.getBlock({ blockNumber: BigInt(b) })
      feed.when.set(b, new Date(Number(blk.timestamp) * 1000).toISOString().replace('T', ' ').slice(0, 16))
    } catch { /* leave it blank rather than invent one */ }
  }))
  feedRender()
}

/**
 * Read the active filter from the chain.
 *
 * A fill takes several seconds and several requests, and a visitor will press
 * another chip in the middle of it — the first version answered that by doing
 * nothing at all, because a fill was already running. Silently ignoring a
 * button is worse than being slow.
 *
 * So a fill is cancellable: each one takes a number, and the moment a newer one
 * starts, the older stops writing to the page. Its requests may still be in
 * flight, and their answers are simply dropped.
 */
const feedFill = async () => {
  const mine = ++feed.gen
  const mineStill = () => feed.gen === mine
  feed.filling = true
  const out = $('feed-out')
  try {
    say(out, 'busy', `<p>${t('x.feed.reading', 'Reading everything NextKey has written…')}</p>`)

    // The exact pass, where the events cannot answer: the post filter reads the
    // names it can spell, and the name filter reads the one name it was given.
    // It runs first and paints as soon as it has something, so the slow log
    // walk never decides whether a reader sees anything at all.
    feed.read = []
    if (feed.filter === 'post') {
      feed.read = await readRecords(READ_NAMES, POST_KEYS, (done, total, hits) => {
        if (!mineStill()) return
        if (hits) feedRender()
        else say(out, 'busy', `<p>${t('x.feed.reading', 'Reading everything NextKey has written…')}
          <span class="mono">${done}/${total}</span></p>`)
      })
    } else if (feed.filter === 'name' && feed.name) {
      feed.read = await readRecords([feed.name],
        [RECORD_PUBKEY, RECORD_EPH, RECORD_EPH_SEALED, RECORD_SECRET, RECORD_POST])
    }
    if (!mineStill()) return
    if (feed.read.length) feedRender()

    if (!feed.addresses) feed.addresses = await feedAddresses()

    const head = await reader.getBlockNumber()
    if (!feed.width) {
      const probe = await feedWidth(head)
      feed.width = probe.width
      if (!probe.width) return say(out, 'bad', `
        <p>${t('x.log.norange', 'The node refused every block range this page asked for.')}</p>
        <p class="note mono">${esc(plain(probe.error))}</p>
        <p class="note">${t('x.feed.norangenote', 'That is a limit of the public endpoint, not a statement about NextKey. Nothing here is broken and nothing is missing — this one node will not serve log queries at the moment. Press Refresh in a minute.')}</p>
        <p class="note">${t('x.feed.where', 'On')} ${feedWhere()}.</p>`,
        { feed: null, error: 'ranges-refused', resolvers: feed.addresses })
    }

    // Held locally, not read from feed.* inside the loop. Choosing another
    // filter sets feed.width back to null, and a fill still in flight would
    // then compute `to > null` — BigInt against null, which throws, and the
    // visitor reads "Could not read the events" on a page where nothing is
    // wrong. The generation guard already drops a stale fill's output; this
    // stops it from tripping over the next one's state on the way there.
    const width = feed.width
    let to = head
    feed.scanned = 0n
    feed.refused = null
    // A filter the node can answer costs almost nothing per window, so it is
    // allowed to reach much further back. A filter we have to sort ourselves
    // reads every write in the range, so it stays modest — and says how far it
    // got, which is the difference between a short list and a complete one.
    // Without a record id the name filter has nothing exact to ask the node, and
    // asking without it would put another name's writes under this one. The read
    // pass above has already answered; the log walk sits this one out.
    const budget = (feed.filter === 'name' && !feed.recordId)
      ? 0
      : (active().deep ? FEED_WINDOWS_DEEP : FEED_WINDOWS)
    for (let i = 0; i < budget && to > 0n && feed.items.length < FEED_SHOW; i++) {
      if (!mineStill()) return
      const from = to > width ? to - width + 1n : 0n
      try {
        feed.items.push(...await feedLogs(from, to))
        feed.scanned += to - from + 1n
      } catch (e) {
        // Kept, not swallowed. A window the node would not serve and a window
        // with nothing in it produce the same empty list, and only one of them
        // means the chain was quiet. This page has already made that mistake
        // once, in the per-name history, and it read as a lie.
        feed.refused = e
      }
      feedSort()
      // Drawn as it arrives. The newest window almost always holds something,
      // and a visitor should not watch a spinner for eleven more queries that
      // only reach further back than they were going to read anyway.
      if (feed.items.length) feedRender()
      if (from === 0n) break
      to = from - 1n
    }
    if (!mineStill()) return
    feed.head = head

    // Nothing found as an event is only an empty answer when nothing was read
    // either. With read records on screen, the log sweep adding none of its own
    // is not news — and overwriting them with "nothing here" was the bug.
    if (!feed.items.length && !feed.read.length) return say(out, feed.refused ? 'bad' : '', `
      <p>${feed.refused
        ? t('x.log.refused', 'The node stopped answering partway through.')
        : (feed.filter === 'all'
            ? t('x.feed.none', 'Nothing yet in the stretch this page could search.')
            : t('x.feed.nonehere', 'Nothing of this kind in the stretch this page could search.'))}</p>
      ${feed.refused ? `<p class="note mono">${esc(plain(feed.refused))}</p>
      <p class="note">${t('x.feed.refusednote', 'So this is not a quiet chain — it is a request that came back empty-handed. A public endpoint will refuse a range that matches too much, and the fix is to press Refresh, which starts again from the current head.')}</p>` : ''}
      <p class="note">${t('x.log.scanned', 'Searched back')} ${esc(String(feed.scanned))} ${t('x.log.blocksfrom', 'blocks from the current head, in steps of')} ${esc(String(width))}.</p>
      <p class="note">${t('x.feed.where', 'On')} ${feedWhere()}.</p>
      <p class="note">${t('x.feed.nonenote', 'If NextKey has written somewhere else on this deployment, this is where to say so: look a name up above, then press Refresh, and the resolver that name actually uses is watched too.')}</p>`,
      { feed: 0, scanned: String(feed.scanned), resolvers: feed.addresses })

    feed.cache.set(feedKey(), { items: feed.items, head: feed.head, addresses: feed.addresses })
    feedRender()
    feedStamps()
  } catch (e) {
    // A fill the visitor has already moved on from does not get to paint, and
    // that includes painting a failure: its error belongs to a question nobody
    // is asking any more, and on screen it would overwrite the answer to the
    // one they did ask.
    if (!mineStill()) return
    say(out, 'bad', `<p>${t('x.log.fail', 'Could not read the events.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  } finally {
    if (mineStill()) { feed.filling = false; feedStatus() }
  }
}

/**
 * One poll: only the blocks that appeared since the last one.
 *
 * A failure here is silent on purpose. The list on screen is still true — it
 * was read from the chain — and replacing it with an error because a single
 * twenty-second poll timed out would throw away something correct to report
 * something temporary.
 */
const feedPoll = async () => {
  if (feed.paused || feed.filling || document.hidden || !feed.addresses || feed.head === null) return
  feed.filling = true
  const mine = feed.gen
  try {
    // cacheTime 0, or this asks a cache how new the chain is. viem holds the
    // last height for as long as its polling interval, which is shorter than
    // the poll below and long enough to make a poll answer "nothing new" from
    // memory — a live window that goes quiet because it stopped asking.
    const head = await reader.getBlockNumber({ cacheTime: 0 })
    if (head <= feed.head) return
    const fresh = await feedLogs(feed.head + 1n, head)
    feed.scanned += head - feed.head
    feed.head = head
    if (!fresh.length || feed.gen !== mine) return
    const at = Date.now()
    for (const w of fresh) w.seen = at
    feed.items.push(...fresh)
    feedSort()
    feed.cache.set(feedKey(), { items: feed.items, head: feed.head, addresses: feed.addresses })
    feedRender()
    feedStamps()
  } catch { /* the next poll tries again */ } finally { feed.filling = false }
}

// ─── Filters ───────────────────────────────────────────────────────────────

/** A filter and its subject, which is what a cached answer belongs to. */
const feedKey = () => (feed.filter === 'name' ? `name:${feed.name}` : feed.filter)

const feedChips = () => {
  for (const b of $('feed-chips').querySelectorAll('button'))
    b.setAttribute('aria-pressed', String(b.dataset.f === feed.filter))
  show($('feed-namerow'), feed.filter === 'name')
}

/**
 * The record id behind a name.
 *
 * A TextUpdated event says which record changed, not which name owns it, so a
 * name filter needs the missing half — and it is discoverable rather than
 * secret: the creation event carries the namehash, and a namehash is something
 * this page can compute from a name it was given. One walk to find it, then an
 * exact filter for everything after.
 *
 * While this filter is on, the page watches that name's own resolver and no
 * other. A record id is only unique to the contract that issued it.
 */
const feedFindName = async (name) => {
  const out = $('feed-out')
  feed.name = name
  feed.recordId = null
  say(out, 'busy', `<p>${t('x.feed.finding', 'Finding that name’s record…')}</p>`)

  let resolver = null
  try { resolver = await reader.getEnsResolver({ name }) } catch { /* reported below */ }
  if (!resolver || /^0x0+$/i.test(resolver)) return say(out, 'bad', `
    <p>${t('x.noresolver', 'That name has no resolver on this deployment.')}</p>
    <p class="note">${t('x.noresolvernote', 'Either it is not registered here, or nothing has been attached to it yet. A name you hold on production ENS will not do — this is the hackathon deployment, and it is a separate world.')}</p>`,
    { filter: 'name', name, resolver: null })

  const head = await reader.getBlockNumber({ cacheTime: 0 })
  const width = await widthFor(resolver, head)
  if (!width) return say(out, 'bad', `
    <p>${t('x.log.norange', 'The node refused every block range this page asked for.')}</p>
    <p class="note">${t('x.feed.norangenote', 'That is a limit of the public endpoint, not a statement about NextKey. Nothing here is broken and nothing is missing — this one node will not serve log queries at the moment. Press Refresh in a minute.')}</p>`,
    { filter: 'name', name, error: 'ranges-refused' })

  const created = await walkBack(resolver, [TOPIC_RECORD, null, namehash(name)], head, width)
  // No creation event is no longer the end of the answer. It used to be: the
  // record id comes from that event, the exact log filter needs the record id,
  // and so a name whose creation event cannot be found — `anna.nextkey.eth`,
  // `hero01.nextkey.eth`, both of which plainly carry records — reported
  // nothing at all. What the name carries can be read without any of that, so
  // that is what is shown, and the list says it was read rather than found.
  feed.recordId = created.found.length ? created.found[0].topics[1] : null
  feed.addresses = [resolver]
  feed.width = width
  feed.items = []
  feed.head = null
  await feedFill()
}

/** Switch filters. Each one is its own question, so each gets its own answer. */
const feedSelect = async (which, name) => {
  // Choosing a view retires whatever is still in flight, before anything else.
  // feedFill's own guard only retires a fill when a *new fill* starts, and the
  // branches below that answer without reading — an empty name, a cached
  // answer — never start one. Without this, the previous filter's read came
  // back a moment later and wrote its result over the message the visitor was
  // actually looking at.
  feed.gen++
  feed.filter = FILTERS[which] ? which : 'all'
  feedChips()
  feed.width = null
  feed.refused = null

  if (feed.filter === 'name') {
    const wanted = (name ?? $('feed-name').value).trim().toLowerCase()
    $('feed-name').value = wanted
    if (!wanted) {
      feed.items = []
      return say($('feed-out'), '', `<p>${t('x.feed.needname', 'Type a name to see only its writes.')}</p>`)
    }
    // An address is a fair thing to paste into a box that asks about a name:
    // it is what a wallet shows, what an explorer link carries, and what a
    // person copies. ENS answers the question in one step — the reverse record
    // — so the filter takes either and says which one it followed. An address
    // with no name published on this deployment is a fact about the address,
    // not a mistake by the visitor, and it is said as one.
    let asName = wanted
    if (NEXTKEY_ID.test(wanted)) {
      say($('feed-out'), 'busy', `<p>${t('x.f.byid', 'A NextKey ID does not run backwards, so this compares it against the key every name here publishes…')}</p>`)
      const match = await nameForId(wanted, (done, total) =>
        say($('feed-out'), 'busy', `<p>${t('x.f.byid', 'A NextKey ID does not run backwards, so this compares it against the key every name here publishes…')}
          <span class="mono">${done}/${total}</span></p>`))
      if (!match) {
        feed.items = []
        feed.read = []
        return say($('feed-out'), '', `
          <p>${t('x.f.noid', 'No name this page knows publishes that NextKey ID.')}</p>
          <p class="note">${t('x.f.noidnote', 'An ID is a hash over a published key, so it cannot be turned back into one. What this page can do is recognise it — derive the ID of every name it can spell and compare — and the names it can spell are the ones written into its source. An ID on a name from anywhere else is not wrong, it is simply not recognisable from here.')}</p>`,
          { filter: 'name', nextkeyId: wanted, name: null })
      }
      asName = match
      $('feed-name').value = asName
    } else if (/^0x[0-9a-f]{40}$/.test(wanted)) {
      say($('feed-out'), 'busy', `<p>${t('x.f.reversing', 'Asking ENS which name that address publishes…')}</p>`)
      const primary = await reader.getEnsName({ address: wanted }).catch(() => null)
      if (!primary) {
        feed.items = []
        feed.read = []
        return say($('feed-out'), '', `
          <p>${t('x.f.noreverse', 'That address publishes no name on this deployment.')}</p>
          <p class="note">${t('x.f.noreversenote', 'A name points at an address, and an address points back only when its holder has set a primary name. A lent name has neither: no reverse record and no address record either — measured, not assumed — because it carries one thing only, the key your signature derives. So an address cannot find it and your wallet can, in one signature.')}</p>
      <p class="note"><a href="./id">${t('x.f.toid', 'Find your name with your wallet, on the ID tab')}</a></p>`,
          { filter: 'name', address: wanted, name: null })
      }
      asName = primary.toLowerCase()
      $('feed-name').value = asName
    }

    if (feed.cache.has(`name:${asName}`)) {
      const kept = feed.cache.get(`name:${asName}`)
      Object.assign(feed, { name: asName, ...kept })
      feedChips(); feedRender(); return feedStamps()
    }
    return feedFindName(asName)
  }

  // Leaving the name filter gives the resolvers back: a record id belongs to
  // one contract, the rest of the feed belongs to all of them.
  feed.recordId = null
  feed.addresses = null

  const kept = feed.cache.get(feedKey())
  if (kept) {
    feed.items = kept.items
    feed.head = kept.head
    feed.addresses = kept.addresses
    feedRender()
    return feedStamps()
  }
  feed.items = []
  feed.head = null
  await feedFill()
}

for (const b of $('feed-chips').querySelectorAll('button'))
  b.addEventListener('click', () => feedSelect(b.dataset.f))

$('feed-namego').addEventListener('click', () => feedSelect('name'))
$('feed-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') feedSelect('name') })

$('feed-refresh').addEventListener('click', () => {
  feed.width = null
  feed.cache.delete(feedKey())
  feed.items = []
  feed.head = null
  if (feed.filter !== 'name') feed.addresses = null
  if (feed.filter === 'name') return feedFindName(feed.name)
  feedFill()
})

$('feed-pause').addEventListener('click', () => {
  feed.paused = !feed.paused
  $('feed-pause').textContent = feed.paused
    ? t('x.feed.resume', 'Resume')
    : t('x.feed.pause', 'Pause')
  feedStatus()
})

feed.timer = setInterval(feedPoll, FEED_EVERY)
// A tab in the background is not a tab anybody is watching, and a page that
// keeps polling in one spends a phone's battery to show nobody anything.
document.addEventListener('visibilitychange', () => { if (!document.hidden) feedPoll() })

// ─── The agent-facing surface, and the opening state ───────────────────────
window.NEXTKEY = {
  records: { pubkey: RECORD_PUBKEY, eph: RECORD_EPH, sealed: RECORD_EPH_SEALED,
             secret: RECORD_SECRET, post: RECORD_POST },
  inspect,
  feed: () => feed.items.map((w) => ({
    key: w.key, value: w.value, block: String(w.block), tx: w.tx,
  })),
  version: 2,
}

// The overlay swaps every data-i18n string when the language changes, which
// would put "Pause" back on a button that is paused. The list and the live line
// are ours to redraw.
window.__nextkeyRerender = () => {
  if (feed.paused) $('feed-pause').textContent = t('x.feed.resume', 'Resume')
  feedStatus()
  if (feed.items.length) feedRender()
}

{
  const asked = new URLSearchParams(location.search).get('name')
  if (asked) lookup(asked.trim().toLowerCase())
  // The live window fills itself. It is the one thing on this page that needs
  // no question asked first, and a visitor who arrives with nothing to type
  // should still see the chain moving.
  feedStatus()
  // ?show=post, ?show=granted, ?show=name:vault.nextkey.eth — so a filtered
  // view is a link somebody can send, which is the whole reason the state is in
  // the address rather than only in the page.
  const show0 = (new URLSearchParams(location.search).get('show') ?? 'all').split(':')
  if (show0[0] === 'name' && show0[1]) {
    $('feed-name').value = show0[1].trim().toLowerCase()
    feedSelect('name')
  } else {
    feedSelect(FILTERS[show0[0]] ? show0[0] : 'all')
  }
}
