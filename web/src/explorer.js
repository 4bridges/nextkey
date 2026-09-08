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

import { createPublicClient, http, namehash, decodeEventLog } from 'viem'
import { sepolia } from 'viem/chains'
import { un64, fingerprint } from './nk-crypto.mjs'

const UNIVERSAL_RESOLVER = '0xd26f2040d083af1cd2962ba303f4bea0c4faf142'
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

const EXAMPLES = ['vault.nextkey.eth', 'nextkeyv2.eth', 'anna.nextkey.eth', 'bob.nextkey.eth']

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
  'name', 'look', 'try', 'verdict', 'records',
  'step-check', 'who', 'check', 'check-out',
  'step-log', 'history', 'log-out',
]

// ═══ The history of a name ═════════════════════════════════════════════════
//
// Every write to a name is one event on its resolver, so the history the
// official explorer shows is reconstructible from two log queries — and doing
// it here rather than sending a visitor away is the point: they came to see
// what NextKey did, not to learn what a topic hash is.
//
// The two events were read off the deployment rather than guessed, because a
// wrong topic hash matches nothing and an empty panel looks exactly like a name
// that was never written to. scripts/probe-events.mjs is what produced them.
//
//   0x66fd1d4e…  a record being created. Its signature is not published
//                anywhere we could find, and we do not need it: topic1 is the
//                record id and topic2 is the namehash, which is the whole
//                lookup. Decoding its data would only tell us the name we
//                already typed.
//
//   0x14cf4389…  TextUpdated(uint256 recordId, string indexed key,
//                            string key, string value)
//                Confirmed by hashing the signature, and by topic2 matching
//                keccak256("nextkey.eph") on the eph writes.
//
// The second one settles the question the feature hung on: `key` also sits in
// the data, unindexed. Had it only been indexed, the chain would carry its hash
// and no page could ever show `nextkey.g2.…` — it could only confirm a name it
// had already guessed. It is there in full, so the history reads as prose.
const TOPIC_RECORD = '0x66fd1d4edf16fc35ee08adaecfdf6fd5f75283da903b50f642558d6e0ba630ff'
const TEXT_UPDATED_TOPIC = '0x14cf4389d9a790cb32a054e033d7e3d3b78119dee4fea3c0983aac1db3f54015'
const TEXT_UPDATED = {
  type: 'event',
  name: 'TextUpdated',
  inputs: [
    { name: 'recordId', type: 'uint256', indexed: true },
    { name: 'indexedKey', type: 'string', indexed: true },
    { name: 'key', type: 'string' },
    { name: 'value', type: 'string' },
  ],
}

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
      <p class="note"><a href="https://sepolia.etherscan.io/address/${esc(resolver)}" rel="noopener">${t('x.resolver', 'its resolver')}: ${esc(clip(resolver, 20))}</a></p>`,
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

$('look').addEventListener('click', () => {
  const name = $('name').value.trim().toLowerCase()
  if (!name) return say($('verdict'), 'bad', `<p>${t('x.needname', 'Type a name first.')}</p>`)
  lookup(name)
})

$('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('look').click() })

$('try').addEventListener('click', () => {
  $('name').value = EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]
  $('look').click()
})

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
  if (key === RECORD_EPH) return t('x.m.eph', 'published the key that every grant on this name is addressed from')
  if (key === RECORD_EPH_SEALED) return t('x.m.sealed', 'wrapped that key to the owner, so a recipient can be added later without a signature')
  if (key === RECORD_SECRET) return gone
    ? t('x.m.secretgone', 'removed the ciphertext')
    : t('x.m.secret', 'wrote the ciphertext')
  if (key === RECORD_PUBKEY) return t('x.m.pubkey', 'published a key, so anybody can seal something to this name')
  if (key === RECORD_POST) return gone
    ? t('x.m.postgone', 'took its post down')
    : t('x.m.post', 'published a post, in the clear')
  if (key.startsWith('nextkey.g2.')) return gone
    ? t('x.m.revoked', 'took a grant back — the wrapped key is gone, the ciphertext is not')
    : t('x.m.granted', 'granted access to somebody. Which somebody is not on the chain')
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
      await reader.getLogs({ address, fromBlock: head > w ? head - w : 0n, toBlock: head })
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
      const found = await reader.getLogs({ address, topics, fromBlock: from, toBlock: to })
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
      try { logs = await reader.getLogs({ address: current.resolver, topics: [null, recordId], fromBlock: from, toBlock: to }) } catch { /* keep walking */ }
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
          <a href="https://sepolia.etherscan.io/tx/${esc(w.tx)}" rel="noopener">${t('x.log.tx', 'transaction')}</a>
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

// ─── The agent-facing surface, and the opening state ───────────────────────
window.NEXTKEY = {
  records: { pubkey: RECORD_PUBKEY, eph: RECORD_EPH, sealed: RECORD_EPH_SEALED,
             secret: RECORD_SECRET, post: RECORD_POST },
  inspect,
  version: 1,
}
window.__nextkeyRerender = () => {}

{
  const asked = new URLSearchParams(location.search).get('name')
  if (asked) {
    $('name').value = asked.trim().toLowerCase()
    $('look').click()
  }
}
