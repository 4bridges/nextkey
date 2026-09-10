/**
 * The playground — NextKey with your hands on it.
 *
 * poc.html shows a secret that already exists. This page lets a visitor make
 * one. Everything below happens in the browser: the same X25519 + HKDF-SHA256 +
 * AES-256-GCM that scripts/nextkey-core.mjs performs on a laptop, executed here
 * so that the loop can be completed in thirty seconds by somebody who has
 * neither a wallet nor testnet ether.
 *
 * Two things are deliberately *not* simplified for the sake of the demo:
 *
 *   The cryptography is the real thing. Not a mock, not a hash of a hash — the
 *   identical construction, so a grant produced on this page can be opened by
 *   the command-line tool and the other way round. A demo that fakes the one
 *   part that matters demonstrates nothing.
 *
 *   Opening is only possible for a recipient whose private key exists here.
 *   Grant to a real ENS name and this page will encrypt to the key that name
 *   publishes and then tell you, plainly, that it cannot open the result. That
 *   is not a missing feature. It is the property the product is built on, and
 *   hiding it would be the lie.
 *
 * Steps 1 to 3 need no wallet, no account and no ether: a phrase, a recipient,
 * and the three records that would go on chain. Step 4 puts them there — either
 * with the visitor's own wallet on a name they own, or with a key this page
 * publishes, which owns nothing and may write only to a pool of names set aside
 * for it. Steps 5 and 6 then open and revoke by reading those records back off
 * the chain, not out of this tab's memory, because a refusal computed locally
 * proves less than one that survives a round trip through ENS.
 */

import { createPublicClient, createWalletClient, custom, http, toHex, namehash } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { packetToBytes } from 'viem/ens'
import { sepolia } from 'viem/chains'
import { generateMnemonic, english, mnemonicToAccount } from 'viem/accounts'
// The key this page lends to visitors, and the names it may write to. Its own
// file, with the reasoning for publishing a private key at all.
import { DEMO_KEY, POOL, POOL_RESOLVER, NAMES_CONTRACT, NAMES_PARENT } from './demo-wallet.js'
// The wrapping rule lives in its own module so that test/interop.mjs can load
// it on its own and check a grant made by the Node construction opens with this
// one. The .mjs extension is for Node's benefit: it imports this exact file, and
// without the extension it warns about guessing the module type.
import {
  b64, un64, randomSecret, publicKeyOf,
  seal, unseal,
  RECORD_EPH, ephMessage, ephSecretFromSignature, padSecret, unpadSecret,
  identityMessage, identitySecretFromSignature,
  grantForV2, locateGrantV2, openGrantV2,
  locateAckV2, ackKeyForSender,
  nextkeyId,
} from './nk-crypto.mjs'

// ─── The deployment ────────────────────────────────────────────────────────
// The hackathon ENSv2 deployment, not production. viem ships its own Sepolia
// Universal Resolver address and forgetting to override it does not raise an
// error — it silently resolves against production and returns nothing, which
// reads exactly like "that name has no record".
const UNIVERSAL_RESOLVER = '0xd26f2040d083af1cd2962ba303f4bea0c4faf142'
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com'
const RECORD_SECRET = 'nextkey.secret'
const RECORD_PUBKEY = 'nextkey.pubkey'

const hackathonSepolia = {
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: UNIVERSAL_RESOLVER } },
}

const reader = createPublicClient({
  chain: hackathonSepolia,
  transport: http(RPC, { retryCount: 1, retryDelay: 400, timeout: 10_000 }),
})

/**
 * Two resolvers, two setText signatures, and no way to tell from the address.
 *
 * The deployment's Permissioned Resolver takes the DNS-encoded name:
 *   setText(bytes name, string key, string value)
 * Its publicResolverV2 takes the namehash, as classic ENS resolvers always
 * have:
 *   setText(bytes32 node, string key, string value)
 *
 * A visitor's name may carry either. Guessing wrong does not produce a clear
 * error — a proxy delegating into a function that does not exist reverts with
 * *empty* data, which reads exactly like "you are not allowed to do that". So
 * the page does not guess: it simulates the real write in each shape and uses
 * whichever the resolver actually accepts. Both simulations are free.
 */
const SHAPES = [
  {
    id: 'name',
    abi: [{ name: 'setText', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' },
               { name: 'value', type: 'string' }], outputs: [] }],
    arg: (name) => toHex(packetToBytes(name)),
  },
  {
    id: 'node',
    abi: [{ name: 'setText', type: 'function', stateMutability: 'nonpayable',
      inputs: [{ name: 'node', type: 'bytes32' }, { name: 'key', type: 'string' },
               { name: 'value', type: 'string' }], outputs: [] }],
    arg: (name) => namehash(name),
  },
]

// ─── Language ──────────────────────────────────────────────────────────────
// Strings built after a button is pressed cannot be tagged in the HTML, so
// they look themselves up. The English written here is the fallback, which
// means a missing translation costs one sentence rather than a blank panel.
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

/**
 * A result panel, and the same result in a form a program can read.
 *
 * The fourth argument is the machine-readable half: it lands on a `data-nk`
 * attribute beside the prose. An AI-agent driving this page — or a test — reads
 * that instead of scraping sentences that exist in ten languages. Nothing
 * private goes in it; see nkState().
 */
const say = (el, kind, html, data) => {
  el.className = `out ${kind}`
  el.innerHTML = html
  if (data === undefined) el.removeAttribute('data-nk')
  else el.setAttribute('data-nk', JSON.stringify(data))
  el.hidden = false
}

/**
 * The argument, folded away.
 *
 * Each panel used to end in three or four paragraphs explaining why the result
 * matters. They are worth keeping — a judge who reads them is the judge who
 * understands the design — but with all of them open the button for the next
 * step sat two screens below the result on a phone, and people stopped there
 * believing nothing had happened. So the reasoning goes behind one line.
 */
const why = (label, html) =>
  `<details class="why"><summary>${esc(label)}</summary>${html}</details>`

/** The reveal control, used by both the passphrase and the message. */
const eye = (label) => `
  <div class="eyerow">
    <button class="eyebtn" id="reveal" type="button"
            title="${esc(label)}" aria-label="${esc(label)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M1.8 12S5.4 5.4 12 5.4 22.2 12 22.2 12 18.6 18.6 12 18.6 1.8 12 1.8 12z"/>
        <circle cx="12" cy="12" r="3.1"/>
      </svg>
    </button>
  </div>`

/**
 * Does this page match this bundle?
 *
 * send.html and send.js are deployed as two files, and they can be uploaded
 * separately, cached separately, and end up one version apart. When that
 * happened the symptom was `Cannot set properties of null (setting 'hidden')`
 * on pressing a button — technically accurate, useless to everybody, and
 * indistinguishable from a bug in the cryptography to anyone watching.
 *
 * So the bundle states what it needs and says so plainly when it is missing.
 * Checked once at load rather than at every use: a page that is half a version
 * behind is broken from the start, and finding out three steps in is worse than
 * finding out immediately.
 */

/**
 * Which page is this?
 *
 * One bundle now serves three tabs. /demo/id asks "how does anyone send
 * anything to me"; /demo/passphrase and /demo/message ask "who am I sending
 * this to". They are different questions asked by different people, which is
 * why they are different addresses — but they are the same arithmetic, the same
 * record names and the same wallet handling underneath, and this project has
 * already paid once for having one rule in two implementations. So the code
 * stays in one file and the file knows where it is.
 *
 * The pool scan, the derived identity and the claim contract are the ID tab's;
 * the five steps are the send tabs'; everything from `nk-crypto` down is
 * shared. What that costs is one bundle on a page that uses half of it, most of
 * which is viem, which the ID tab needs anyway.
 */
const PAGE = /(^|\/)id(\.html)?$/.test(location.pathname) ? 'id' : 'send'

/**
 * Mark the tab we are on, for the one page that cannot say so in its markup.
 *
 * Every other page carries `aria-current="page"` in the bar, because every
 * other page is one address. This file answers to two — /demo/passphrase and
 * /demo/message — so which tab it is, is a property of the address and not of
 * the file, and the markup that serves both can only be wrong about it. It was
 * simply absent instead, which is honest and still leaves the visitor on a page
 * the navigation does not admit to having.
 *
 * Derived from the address rather than from `S.mode`, so it is right before the
 * mode is read and cannot drift from it afterwards. It runs on the ID tab too,
 * where it sets the attribute the markup already has — writing the same value
 * to the same element, which is cheaper than a branch that has to stay true.
 */
for (const a of document.querySelectorAll('nav.barnav a[href^="./"]')) {
  const tab = a.getAttribute('href').slice(2)
  if (location.pathname.replace(/\.html$/, '').replace(/\/$/, '').endsWith('/' + tab)) {
    a.setAttribute('aria-current', 'page')
  }
}

const NEEDED_EVERYWHERE = [
  'connect', 'wallet-out',
  'be-receivable', 'be-receivable-box', 'recv-state', 'id-out',
  'own-name-box', 'own-label', 'claim-name', 'own-state', 'claim-out',
]

const NEEDED_TO_SEND = [
  't-eyebrow', 't-h1', 't-lead',
  'pane-wallet', 'pane-message',
  'phrase', 'gen', 'wallet-made', 'message-made', 'pane-message-box',
  'msg-edit', 'msg-edit-row', 'step1-state',
  's1-h', 's1-p', 's2-h', 's2-p',
  'gen-recipient', 'r-out', 'ens-name', 'lookup',
  'go-store', 'store-out',
  'step-chain', 'write-demo', 'demo-out', 'demo-state',
  'own-name', 'publish', 'publish-out',
  'step-open', 'inbox-names', 'check-inbox', 'open-other', 'open-out', 'open-remote-note',
  'receipt-row', 'send-ack', 'check-ack', 'ack-out',
  'step-more', 'more-name', 'grant-more', 'more-out',
  'step-revoke', 'revoke', 'revoke-out',
]

const REQUIRED_ELEMENTS = PAGE === 'send'
  ? [...NEEDED_EVERYWHERE, ...NEEDED_TO_SEND]
  : NEEDED_EVERYWHERE

/**
 * Wire a handler, if this page has the thing to wire it to.
 *
 * The alternative was a second bundle, and the alternative to that was letting
 * `$('go-store').addEventListener` throw on the ID tab — which is the exact
 * "Cannot set properties of null" the check above exists to prevent, except
 * this time we would have shipped it deliberately. A missing element is a
 * mismatch only when the contract above says the page should have had it, and
 * that is the one place it is judged.
 */
const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn) }

{
  const missing = REQUIRED_ELEMENTS.filter((id) => !document.getElementById(id))
  if (missing.length) {
    const banner = document.createElement('div')
    banner.style.cssText =
      'margin:1rem;padding:1rem 1.2rem;border:2px solid #b3261e;border-radius:9px;' +
      'font:15px/1.6 ui-sans-serif,system-ui,sans-serif;max-width:44rem'
    // A link with a fresh query string, because that is the only remedy a
    // visitor can actually apply. A different URL is a different cache entry,
    // which works even in the MetaMask in-app browser, where clearing the cache
    // is unreliable enough to have its own long-standing bug report. Telling
    // somebody to "clear the cache" is telling them to solve our problem.
    const fresh = new URL(location.href)
    fresh.searchParams.set('v', Date.now().toString(36))
    banner.innerHTML =
      '<strong>This page and its script are different versions.</strong>' +
      `<p style="margin:.5rem 0 0"><a href="${fresh}" style="font-weight:600">Open the current one</a>` +
      ' — that link carries a fresh address, which every browser treats as a new page.</p>' +
      `<p style="margin:.5rem 0 0;font-family:ui-monospace,monospace;font-size:.85em">missing: ${missing.join(', ')}</p>`
    document.body.prepend(banner)
    throw new Error(`send.html is out of step with send.js — missing: ${missing.join(', ')}`)
  }
}

/** Turn whatever a library threw into one line a reader can act on. */
const plain = (e) => {
  const m = e?.shortMessage ?? e?.details ?? e?.message ?? String(e)
  return m.split('\n')[0].slice(0, 220)
}

// ─── State ─────────────────────────────────────────────────────────────────
/**
 * Everything the visitor has built so far. It lives in memory and nowhere
 * else: no localStorage, no cookie, no upload. Reloading the page throws the
 * private keys away, which is the correct behaviour for private keys and is
 * said out loud in the interface rather than left as a surprise.
 */
const S = {
  mode: 'wallet',     // 'wallet' — a passphrase we generated · 'message' — typed
  phrase: '',
  address: null,      // the address the generated phrase controls, in wallet mode
  generated: false,   // did the phrase come from our generator?
  owner: null,        // { sk, pk } — the visitor
  recipient: null,    // { sk?, pk, label, local }
  contentKey: null,
  sealed: null,       // the nextkey.secret value
  /**
   * The name's ephemeral keypair — one per secret, not one per recipient.
   *
   * One pair is enough for any number of recipients, because the ECDH with each
   * of them lands somewhere different. Its public half is what a name publishes
   * at nextkey.eph; its private half is what lets the owner compute where every
   * recipient's grant lives.
   *
   * In steps 1 to 3 it is drawn at random, because those steps ask for no
   * wallet and there is nothing to derive from. Step 4 replaces it with one
   * derived from a signature — the visitor's, or this page's on the lent-name
   * lane — so that the key survives the tab. See there.
   */
  eph: null,          // { sk, pk }
  grant: null,        // the grant object, or null once revoked
  grantKey: null,     // nextkey.g2.<tag> — derived, not a function of any public value
  ackKey: null,       // nextkey.a2.<tag> — where a read receipt would go
  opened: null,       // { name, ephPk, text } once the inbox has found something
  extra: [],          // further recipients granted after the write
}

// ═══ Which of the two things is being shared ═══════════════════════════════
//
// One loop, two contents. A wallet is a phrase this page generates; a message
// is text somebody types. Everything from step 2 on is identical — which is
// the honest reason a "messenger" is not a second product here, and why one
// file answers to both tabs rather than being copied into two.
//
// What changed with the tab bar is where the choice lives. It used to be a
// segmented control on the page: a visitor arrived at "the demo" and then said
// what kind of demo it was. Now the two are addresses — /passphrase and
// /message — so the choice is made before the page loads, it can be linked to,
// bookmarked and shared, and the back button undoes it. The page reads the tab
// off its own path; nothing on it can change the tab, because changing it means
// going to the other one.
//
// The generator is the default, and in wallet mode there is no box to paste a
// real seed phrase into. That is what removed the standing warning this page
// used to carry: a warning is a poor substitute for not offering the hazard.

const phraseBox = $('phrase')

const MODE_TEXT = {
  wallet: {
    eyebrow: ['nav.passphrase', 'Passphrase'],
    hero: ['t.h1', 'Wallet recovery with a human-in-the-loop'],
    lead: ['t.lead', 'Create a wallet here with social recovery to a human-in-the-loop. Only that human can recover the wallet.'],
    h1: ['t.s1.h', 'Create wallet'],
    p1: ['t.s1.p', 'A fresh twelve-word phrase.'],
    h2: ['t.s2.h', 'Choose your grant'],
    p2: ['t.s2.p', 'A name on ENS, any public address. Your grant will receive it — no need to register with NextKey.'],
  },
  message: {
    eyebrow: ['nav.message', 'Message'],
    hero: ['t.h1.msg', 'A message only one person can open'],
    lead: ['t.lead.msg', 'Write something here, seal it to one recipient, and put it where they can reach it from any machine. Nobody else can read it — not a server, not us, not the chain it is stored on.'],
    h1: ['t.s1.h.msg', 'The message'],
    p1: ['t.s1.p.msg', 'Anything you would rather not put in an email.'],
    h2: ['t.s2.h.msg', 'Who it is addressed to'],
    p2: ['t.s2.p.msg', 'A name on ENS, any public address.'],
  },
}

/**
 * Which tab is this? The path decides.
 *
 * `?mode=message` still works, because links to it are in the README, in the
 * decision log and in whatever somebody has already sent to somebody else, and
 * a query string that quietly stops meaning anything is a worse answer than one
 * that keeps meaning what it meant. The path wins where both are present.
 */
function modeFromLocation () {
  const path = location.pathname.replace(/\.html$/, '')
  if (/(^|\/)message$/.test(path)) return 'message'
  if (/(^|\/)passphrase$/.test(path)) return 'wallet'
  return new URLSearchParams(location.search).get('mode') === 'message' ? 'message' : 'wallet'
}

function setMode(next) {
  S.mode = next === 'message' ? 'message' : 'wallet'
  show($('pane-wallet'), S.mode === 'wallet')
  show($('pane-message'), S.mode === 'message')

  const txt = MODE_TEXT[S.mode]
  $('t-eyebrow').textContent = t(...txt.eyebrow)
  $('t-h1').textContent = t(...txt.hero)
  $('t-lead').textContent = t(...txt.lead)
  $('s1-h').textContent = t(...txt.h1)
  $('s1-p').textContent = t(...txt.p1)
  $('s2-h').textContent = t(...txt.h2)
  $('s2-p').textContent = t(...txt.p2)

  // Switching throws away what the other side held. Sealing a phrase the
  // visitor can no longer see would be worse than making them press the
  // button again.
  clearTimeout(revealTimer)
  phraseBox.value = ''
  S.phrase = ''
  S.address = null
  S.generated = false
  // Emptied, not just hidden. A hidden panel keeps its markup, and both
  // panels use the same ids for the covered text and the eye — so leaving one
  // in place makes the other one's reveal act on an invisible element, which
  // looks exactly like a broken button.
  $('wallet-made').hidden = true
  $('wallet-made').innerHTML = ''
  $('message-made').hidden = true
  $('message-made').innerHTML = ''
  show($('pane-message-box'), true)
  show($('msg-edit-row'), false)
  syncPhrase()
}


// ─── Step 1 · a wallet, or a message ───────────────────────────────────────

/**
 * A throwaway wallet, generated properly.
 *
 * It is a valid BIP-39 mnemonic and the address really is the one those words
 * control — that is the whole claim being made, that the same phrase restores
 * the same wallet in any tool that speaks BIP-39, with nothing of ours
 * involved. An invalid phrase, or an address that did not match, would let a
 * sceptical judge dismiss the demonstration as a toy.
 *
 * It is also worth nothing, and this page never funds it.
 */
on('gen', 'click', () => {
  const phrase = generateMnemonic(english)
  const account = mnemonicToAccount(phrase)
  phraseBox.value = phrase
  S.generated = true
  S.address = account.address
  syncPhrase()

  say($('wallet-made'), 'ok', `
    <dl>
      <dt>${t('t.s1.addr', 'address')}</dt><dd class="mono break">${esc(account.address)}</dd>
      <dt>${t('t.s1.phrase', 'passphrase')}</dt>
      <dd class="mono break" id="phrase-shown"><span class="covered">${esc(cover(phrase))}</span></dd>
    </dl>
    ${eye(t('t.s1.reveal', 'Show for five seconds'))}`,
    { step: 1, mode: 'wallet', address: account.address })
})

/**
 * Twelve words, shown as their shape rather than themselves.
 *
 * A passphrase left on screen is read by whoever walks past, by the projector
 * in the room, and by every screenshot taken of the page afterwards. Covering
 * it costs one press and removes all three. The words are never re-fetched
 * from the DOM — the real phrase lives in the textarea and in S, and the panel
 * only ever borrows it for five seconds.
 */
const cover = (phrase) => phrase.split(/\s+/).map((w) => '•'.repeat(w.length)).join(' ')

let revealTimer = null
const wireReveal = (panel) => panel && panel.addEventListener('click', (e) => {
  if (!e.target.closest('#reveal')) return
  const dd = $('phrase-shown')
  if (!dd) return
  clearTimeout(revealTimer)
  dd.textContent = S.phrase
  // Back to covered on its own. A reveal that waits for a second press stays
  // open, because the person who pressed it has already moved on.
  revealTimer = setTimeout(() => {
    dd.innerHTML = `<span class="covered">${esc(cover(S.phrase))}</span>`
  }, 5000)
})
wireReveal($('wallet-made'))
wireReveal($('message-made'))

/**
 * A typed message is covered as soon as the typing stops.
 *
 * The reasoning is the same as for the passphrase, and so is the objection to
 * doing it while somebody types: a box that hides what you are writing is a
 * password field, and this is prose. So the box stays plain until it loses
 * focus, and then the text goes behind the same eye. "Edit" brings it back.
 */
const showMessageCovered = () => {
  if (!S.phrase) return
  show($('pane-message-box'), false)
  say($('message-made'), 'ok', `
    <dl>
      <dt>${t('t.s1.msg', 'message')}</dt>
      <dd class="mono break" id="phrase-shown"><span class="covered">${esc(cover(S.phrase))}</span></dd>
    </dl>
    ${eye(t('t.s1.reveal', 'Show for five seconds'))}`,
    { step: 1, mode: 'message', length: S.phrase.length })
  show($('msg-edit-row'), true)
}

if (phraseBox) phraseBox.addEventListener('blur', () => { if (S.mode === 'message') showMessageCovered() })

on('msg-edit', 'click', () => {
  clearTimeout(revealTimer)
  $('message-made').hidden = true
  $('message-made').innerHTML = ''
  show($('msg-edit-row'), false)
  show($('pane-message-box'), true)
  phraseBox.focus()
})

if (phraseBox) phraseBox.addEventListener('input', () => { S.generated = false; syncPhrase() })

function syncPhrase() {
  if (!phraseBox) return
  S.phrase = phraseBox.value.trim()
  $('step1-state').textContent = S.phrase && S.mode === 'message'
    ? t('t.s1.typed', 'Your own text — this page keeps it in memory only.')
    : ''
  refreshReady()
}

// ─── Step 2 · the recipient ────────────────────────────────────────────────
//
// One field and two buttons, rather than a radio pair that made a visitor
// choose between two things before either had been explained. Typing a name
// and pressing "use this name" reads a real key off the chain; pressing "make
// one here" ignores the field and produces a keypair in the browser, which is
// the only way somebody with no name on this deployment can finish the loop.

/** A recipient who exists only here, so the loop can be finished by anyone. */
on('gen-recipient', 'click', () => {
  const sk = randomSecret()
  const pk = publicKeyOf(sk)
  S.recipient = { sk, pk, label: t('t.s2.you', 'the recipient (you, in a moment)'), local: true }
  say($('r-out'), 'ok', `
    <dl>
      <dt>${t('t.id.label', 'NextKey ID')}</dt><dd class="mono break nkid">${esc(nextkeyId(pk))}</dd>
      <dt>${t('t.pubkey', 'public key')}</dt><dd class="mono break">${esc(b64(pk))}</dd>
    </dl>
    ${why(t('t.why', 'Why this matters'), `
      <p>${t('t.s2.localnote', 'This keypair was made in your browser a second ago. The private half never leaves it, and reloading the page destroys it.')}</p>`)}`,
    { step: 2, recipient: 'local', nextkeyId: nextkeyId(pk), publicKey: b64(pk) })
  refreshReady()
})

/**
 * A real recipient, read off the chain.
 *
 * This is the claim worth testing: the recipient never registered with
 * NextKey. Their key is published on their own ENS name, and anyone can
 * encrypt to it without asking us. Any name on the hackathon deployment that
 * carries a `nextkey.pubkey` record works here — including one the visitor
 * just made for themselves.
 */
/**
 * Reading a recipient's key, and telling three failures apart.
 *
 * `getEnsText` answers null for two entirely different situations: the name
 * does not exist on this deployment at all, or it exists and simply carries no
 * nextkey.pubkey. Reporting only the second sent a reader looking for a missing
 * record on a name that was never here — the page said something true-sounding
 * about a name it had not found. A third case hid behind an exception: a record
 * that is there but is not a 32-byte key.
 *
 * Returns { pk } or { error, note } — the caller decides how to show it.
 */
const readRecipientKey = async (name) => {
  let resolver = null
  try { resolver = await reader.getEnsResolver({ name }) } catch { /* reported below */ }
  if (!resolver || /^0x0+$/i.test(resolver)) return {
    error: t('t.s2.noname', 'That name does not exist on this deployment.'),
    note: t('t.s2.nonamenote', 'This is the ENSv2 hackathon deployment on Sepolia, a separate world from production ENS: a name you hold there is unknown here. Try anna.nextkey.eth or bob.nextkey.eth, or register a name on this deployment.'),
  }

  const pub = await reader.getEnsText({ name, key: RECORD_PUBKEY })
  if (!pub) return {
    error: t('t.s2.nokey', 'That name publishes no nextkey.pubkey record, so there is nothing to encrypt to.'),
    note: t('t.s2.nokeynote', 'Try anna.nextkey.eth or bob.nextkey.eth, or publish a key on a name of your own and come back.'),
  }

  let pk
  try { pk = un64(pub) } catch { pk = null }
  if (!pk || pk.length !== 32) return {
    error: t('t.s2.badkey', 'That name publishes a nextkey.pubkey record, but it is not readable as a key.'),
    note: t('t.s2.badkeynote', 'A key is 32 bytes in base64. This record is something else, so the fault is in the record and not in this page — whoever owns the name has to write it again.'),
  }
  return { pk, pub }
}

on('lookup', 'click', async () => {
  const name = $('ens-name').value.trim().toLowerCase()
  const out = $('r-out')
  if (!name) return say(out, 'bad', `
    <p>${t('t.s2.needname', 'Type a name first, or make a recipient here instead.')}</p>`)
  say(out, 'busy', `<p>${t('t.s2.looking', 'Reading their key from the chain…')}</p>`)
  try {
    const found = await readRecipientKey(name)
    if (found.error) {
      S.recipient = null
      return say(out, 'bad', `
        <p>${found.error}</p>
        <p class="note">${found.note}</p>`,
        { step: 2, recipient: 'ens', name, publicKey: null })
    }
    const { pk, pub } = found
    S.recipient = { pk, label: name, local: false }
    say(out, 'ok', `
      <dl>
        <dt>${t('t.id.label', 'NextKey ID')}</dt><dd class="mono break nkid">${esc(nextkeyId(pk))}</dd>
        <dt>${t('t.name', 'name')}</dt><dd class="mono">${esc(name)}</dd>
        <dt>${t('t.pubkey', 'published key')}</dt><dd class="mono break">${esc(pub)}</dd>
        <dt>${t('t.grantaddr', 'their grant will live at')}</dt>
        <dd class="mono">${t('t.grantaddr.unknown', 'not computable from this key alone — see step 3')}</dd>
      </dl>
      ${why(t('t.why', 'Why this matters'), `
        <p>${t('t.s2.ensnote', 'Read live from the hackathon deployment. They never registered with NextKey and were not asked for permission — publishing a key is the whole of the opt-in.')}</p>
        <p>${t('t.s2.addrnote', 'Note what is missing: the record their grant will occupy. Everything on this line is public, and from public values alone that address cannot be worked out — not by this page, and not by anyone watching the chain. It takes one of the two private keys, which is why the next step is where it appears.')}</p>`)}`,
      { step: 2, recipient: 'ens', name, nextkeyId: nextkeyId(pk), publicKey: pub })
  } catch (e) {
    S.recipient = null
    say(out, 'bad', `<p>${t('t.chainfail', 'Could not read that from the chain.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  }
  refreshReady()
})

function refreshReady() {
  // Called from the ID tab too, by way of `receivableAt`, where there is no
  // step 3 to enable.
  const go = $('go-store')
  if (go) go.disabled = !(S.phrase && S.recipient)
}

// ─── Step 3 · encrypt and grant ────────────────────────────────────────────

on('go-store', 'click', async () => {
  const out = $('store-out')
  try {
    S.contentKey = crypto.getRandomValues(new Uint8Array(32))
    S.owner = S.owner ?? (() => { const sk = randomSecret(); return { sk, pk: publicKeyOf(sk) } })()

    // One ephemeral pair for the whole secret. Random here because these steps
    // ask for no wallet; step 6 derives one instead, and says so when it does.
    S.eph = (() => { const sk = randomSecret(); return { sk, pk: publicKeyOf(sk) } })()

    // Padded before it is sealed: AES-GCM does not pad, so an unpadded
    // ciphertext is exactly as long as the secret and a public record would
    // tell a passphrase from a message without decrypting either.
    S.sealed = { v: 1, alg: 'A256GCM', ...(await seal(S.contentKey, padSecret(S.phrase))) }
    const g = await grantForV2(S.contentKey, S.eph.sk, S.recipient.pk)
    S.grant = g.value
    S.grantKey = g.key
    S.ackKey = ackKeyForSender(S.eph.sk, S.recipient.pk)

    say(out, 'ok', `
      <p class="found">✓ ${t('t.s3.done', 'Sealed, and granted to one recipient.')}</p>
      <dl>
        <dt>${t('t.s3.at', 'the grant lives at')}</dt>
        <dd class="mono break">${esc(S.grantKey)}</dd>
      </dl>
      <p class="note">${t('t.s3.short', 'Three records: the ephemeral key, the ciphertext, and the grant above. Nothing is on chain yet — step 4 writes them.')}</p>
      ${why(t('t.s3.records', 'The three records, in full'), `
        <p class="reclabel"><span class="mono">${esc(RECORD_EPH)}</span> — ${t('t.s3.rec0', 'one ephemeral public key for this secret, written once')}</p>
        <pre class="mono">${esc(b64(S.eph.pk))}</pre>
        <p class="reclabel"><span class="mono">${esc(RECORD_SECRET)}</span> — ${t('t.s3.rec1', 'the ciphertext, public by design')}</p>
        <pre class="mono">${esc(JSON.stringify(S.sealed, null, 2))}</pre>
        <p class="reclabel"><span class="mono">${esc(S.grantKey)}</span> — ${t('t.s3.rec2', 'the content key, wrapped so only they can unwrap it')}</p>
        <pre class="mono">${esc(JSON.stringify(S.grant, null, 2))}</pre>`)}
      ${why(t('t.why', 'Why this matters'), `
        <p>${t('t.s3.addrnote', 'The interesting record is the third one — its name. It is not a hash of the recipient’s public key, which anybody could compute; it comes out of the shared secret between the ephemeral key and theirs. Only two parties can work it out: the recipient, and whoever holds the ephemeral private key. An observer holding every public value in this page cannot say whether this secret grants to anyone in particular, or even test a guess.')}</p>
        <p>${t('t.s3.ephnote', 'One ephemeral pair serves the whole secret, not one per recipient: each recipient’s ECDH lands somewhere else, so a second grant shares no key material with this one. Replacing that pair later would move every grant on the name at once, which is why a name publishes it once and never again.')}</p>`)}`,
      { step: 3, mode: S.mode, eph: b64(S.eph.pk), grantRecord: S.grantKey, ackRecord: S.ackKey })

    // Steps 1 and 2 are spent. Their controls stay visible — a judge wants to
    // see what was chosen — but nothing there can be pressed again, because
    // changing the recipient after sealing would leave the page describing a
    // grant that no longer matches what it is about to write.
    lockChoices()

    // Only the chain step opens here. Opening and revoking now run against
    // real records, so they have nothing to act on until something is written.
    show($('step-chain'), true)
    $('publish-out').hidden = true
    // To the result, not past it. Scrolling straight to step 4 put the success
    // panel above the fold line and people concluded the button had done
    // nothing — then pressed it again.
    requestAnimationFrame(() => out.scrollIntoView({ behavior: 'smooth', block: 'center' }))
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

/**
 * Everything steps 1 and 2 offered, switched off.
 *
 * The page used to leave all of it live: after sealing, a visitor could still
 * generate a second wallet or look up a different recipient, and the panels
 * below would go on describing the first one. Nothing broke — it just quietly
 * stopped being true, which on a page about cryptography is worse than
 * breaking.
 *
 * The mode switch used to be in this list and is not any more: switching is a
 * different address now, so it reloads the page and there is nothing stale left
 * to disable.
 */
function lockChoices() {
  for (const id of ['gen', 'gen-recipient',
                    'lookup', 'go-store', 'msg-edit']) $(id).disabled = true
  $('ens-name').readOnly = true
  phraseBox.readOnly = true

  // Sealed has to mean sealed on screen too. The panel said "Sealed, and
  // granted to one recipient" while the eye above it still revealed the
  // passphrase and the message box still showed what had just been encrypted —
  // a page about cryptography contradicting itself two inches apart. The
  // reveal is removed rather than disabled, the text goes back under its dots,
  // and the box the secret was typed into is put away: what was sealed is no
  // longer on display.
  document.querySelectorAll('.eyerow').forEach((el) => el.remove())
  const shown = $('phrase-shown')
  if (shown && S.phrase) shown.innerHTML = `<span class="covered">${esc(cover(S.phrase))}</span>`
  phraseBox.hidden = true
  document.querySelectorAll('.step').forEach((el, i) => { if (i < 3) el.classList.add('done') })
  $('step1-state').textContent = t('t.locked',
    'Sealed. Reload the page to start again with a different secret.')
}

// ═══ Step 4 · on the chain ═════════════════════════════════════════════════
//
// Two lanes, because the honest one and the usable one are not the same lane.
//
// The honest one is a visitor's own wallet writing to a name they own: that is
// the product, and nothing of ours is involved but the arithmetic. It also
// stops most people dead. A judge on a phone has no extension; a judge with an
// extension has no Sepolia ether; getting some means a captcha, a different
// tab, and usually not coming back.
//
// So there is a second lane. The page carries a key that owns nothing, holds a
// few cents of testnet ether, and may write records on one pool of our names
// and on nothing else. One click, no wallet, works on a phone. It is disclosed
// rather than hidden — see src/demo-wallet.js — because a demo of a security
// product that relies on nobody looking is not a demo of anything.
//
// Both lanes end in the same place: three records on Sepolia, written by the
// same construction, opened in step 5 by reading them back off the chain
// rather than out of this tab's memory.

const PARENT = 'nextkey.eth'
const hexOf = (u8) => `0x${[...u8].map((b) => b.toString(16).padStart(2, '0')).join('')}`

const chainOut = $('publish-out')

/** Everything about the write, once it has happened. */
let onchain = null   // { name, via, resolver, node, abi, send }

// ─── Which names are still free ────────────────────────────────────────────
/**
 * A name holds one secret, because `nextkey.eph` is written once and never
 * replaced — so a name someone has used is spent, and the page has to find one
 * that is not.
 *
 * Shuffled rather than in order: two visitors arriving in the same minute would
 * otherwise both take the first free name, and the second write would move the
 * first visitor's grant to an address nobody looks at. Shuffling does not make
 * that impossible, only unlikely; the write re-checks immediately before
 * signing, which closes most of what is left.
 */
const freePoolName = async () => {
  const shuffled = [...POOL].sort(() => Math.random() - 0.5)
  for (let i = 0; i < shuffled.length; i += 5) {
    const batch = shuffled.slice(i, i + 5).map((l) => `${l}.${PARENT}`)
    const taken = await Promise.all(batch.map(async (n) => {
      const [eph, pub] = await Promise.all([
        reader.getEnsText({ name: n, key: RECORD_EPH }).catch(() => 'unreadable'),
        reader.getEnsText({ name: n, key: RECORD_PUBKEY }).catch(() => 'unreadable'),
      ])
      return eph || pub
    }))
    const free = batch.find((_, k) => !taken[k])
    if (free) return free
  }
  return null
}

// ─── The three records ─────────────────────────────────────────────────────
/**
 * Built here rather than in step 3, because the ephemeral key changes when the
 * write does.
 *
 * Steps 1 to 3 asked for no wallet, so the key they used was drawn at random
 * and lives only in this tab — which would strand the name the moment the tab
 * closed, with no way to add a second recipient ever again. Whichever lane
 * writes, it derives a real one from a signature first, and the panel says the
 * grant address moved rather than quietly writing something other than what
 * step 3 displayed.
 */
const recordsFor = async (name, signMessage) => {
  const ephSk = ephSecretFromSignature(await signMessage(ephMessage(name)), name)
  const ephPk = publicKeyOf(ephSk)
  const g = await grantForV2(S.contentKey, ephSk, S.recipient.pk)

  const moved = S.grantKey
  S.eph = { sk: ephSk, pk: ephPk }
  S.grant = g.value
  S.grantKey = g.key

  return {
    moved,
    records: [
      [RECORD_EPH, b64(ephPk)],
      [RECORD_SECRET, JSON.stringify(S.sealed)],
      [g.key, JSON.stringify(g.value)],
    ],
  }
}

/**
 * The report, printed by whichever lane did the writing.
 *
 * Into that lane's own panel, not into one shared panel below both of them.
 * The shared version was tested on a desktop, where everything is on screen at
 * once; on a phone it put every message — including "this will take fifteen
 * seconds" — below the fold, so pressing the button produced no visible
 * response at all and the obvious thing to do was press it again. Which wrote
 * a second name.
 */
/**
 * A secret for somebody who publishes no key — and the trade that makes it work.
 *
 * The whole design says: encrypt to a key the recipient published, so nothing
 * in the link opens anything. That is right, and it is also a wall in front of
 * the first exchange with anyone who has never heard of NextKey. This is the
 * door through the wall, and it is deliberately a different, weaker thing.
 *
 * The recipient key here was made in this browser and belongs to nobody yet, so
 * its private half can travel — in the URL *fragment*, which browsers never put
 * in a request. The chain half is unchanged: the ciphertext and the grant sit
 * on the name exactly as always, addressed to that key.
 *
 * What it costs, said on the page as well as here: whoever holds the link can
 * open the secret, once and for anyone. It is a link-shaped secret, like a
 * password-reset mail, and it is only as private as the channel that carries
 * it. The page therefore offers it as the way to reach somebody the first
 * time — and offers them, on arrival, the way not to need it again.
 */
/**
 * Which pool name already carries this key, if any.
 *
 * Pressing the button twice with the same wallet used to lend a second name and
 * publish the same key on it — correct arithmetic, wrong product: two names for
 * one identity, no canonical one, and a finite pool spent twice as fast. The
 * derivation is deterministic, so the page can simply look for itself.
 *
 * There is no cheap way to ask a chain "which name carries this value": that is
 * an indexer's job, and this page has none — the same limit the inbox states
 * about itself. So it reads the pool, ten at a time, and remembers the answer
 * locally afterwards so that the next visit on this browser costs one read
 * instead of forty. The local note is a shortcut, never the source of truth:
 * it is verified against the chain before it is believed.
 */
const REMEMBERED = 'nextkey.receivable'

const poolNameWithKey = async (value, onProgress = () => {}) => {
  try {
    const kept = JSON.parse(localStorage.getItem(REMEMBERED) || 'null')
    if (kept?.value === value && kept?.name) {
      const still = await reader.getEnsText({ name: kept.name, key: RECORD_PUBKEY })
      if (still === value) return kept.name
    }
  } catch { /* a browser that refuses storage just does the long way */ }

  const names = POOL.map((l) => `${l}.${PARENT}`)
  for (let i = 0; i < names.length; i += 10) {
    onProgress(i, names.length)
    const batch = names.slice(i, i + 10)
    const found = await Promise.all(batch.map((n) =>
      reader.getEnsText({ name: n, key: RECORD_PUBKEY }).catch(() => null)))
    const hit = batch.find((_, k) => found[k] === value)
    if (hit) {
      try { localStorage.setItem(REMEMBERED, JSON.stringify({ name: hit, value })) } catch { /* fine */ }
      return hit
    }
  }
  return null
}

const claimLink = (name) => {
  const url = new URL(location.href)
  url.search = ''
  url.hash = `claim=${encodeURIComponent(name)}&k=${encodeURIComponent(b64(S.recipient.sk))}` +
             `&lang=${document.documentElement.dataset.i18nLang || 'en'}`
  return url.toString()
}

const claimBlock = (name) => `
  <div style="border-top:1px solid var(--line);margin-top:.9rem;padding-top:.9rem">
    <p>${t('t.claim.h', 'Send it to somebody who has no key yet:')}</p>
    <p class="mono break" style="background:var(--code);border:1px solid var(--line);border-radius:9px;padding:.6rem .75rem">${esc(claimLink(name))}</p>
    <p class="note">${t('t.claim.note', 'The key that opens this lives in the part of the address after the #, which browsers never send to a server. It does travel with the link, so whoever holds the link can open the secret once — treat it like the message itself, not like an address. The person who opens it is offered a published key of their own, and the next secret you send them needs no link at all.')}</p>
  </div>`

const wroteIt = (out, name, hashes, moved, extra = '') => {
  // One secret, one name. The lane that was not used is not an option any
  // more, and a disabled button beside a finished result only invites the
  // question of what it would have done.
  show($('lane-own-wrap'), onchain.via !== 'demo')
  show($('lane-demo'), onchain.via === 'demo')
  document.querySelectorAll('.step').forEach((el, i) => { if (i === 3) el.classList.add('done') })

  show($('step-open'), true)
  show($('step-more'), true)
  show($('step-revoke'), true)
  $('open-out').hidden = true
  $('revoke-out').hidden = true
  $('ack-out').hidden = true
  show($('receipt-row'), false)
  $('check-inbox').disabled = !S.recipient.local
  show($('open-remote-note'), !S.recipient.local)

  // The inbox has to be told which names to look at, and the one just written
  // is the only one this visitor certainly cares about. The field stays
  // editable: adding a name is how somebody checks a grant made elsewhere.
  const known = $('inbox-names').value.split(',').map((n) => n.trim()).filter(Boolean)
  if (!known.includes(name)) known.unshift(name)
  $('inbox-names').value = known.join(', ')

  say(out, 'ok', `
    <p class="found">✓ ${t('t.chain.done', 'Written. Those records are on Sepolia now.')}</p>
    <dl>
      <dt>${t('t.chain.name', 'the name')}</dt><dd class="mono break">${esc(name)}</dd>
      ${hashes.map(([k, h]) => `
      <dt class="mono">${esc(k)}</dt>
      <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(h)}" target="_blank" rel="noopener noreferrer">${esc(clip(h, 26))}</a></dd>`).join('')}
    </dl>
    <p class="note"><a href="./explorer?name=${encodeURIComponent(name)}">${t('t.s6.explorer', 'See what this name now carries')}</a></p>
    ${S.recipient.local ? claimBlock(name) : ''}
    ${why(t('t.why', 'Why this matters'), `
      ${extra}
      ${moved === S.grantKey ? '' : `
      <p>${t('t.s6.moved', 'The grant moved. Step 3 used a throwaway ephemeral key, because it asked you for no wallet; what went on chain uses one derived from the signature you just gave, so it outlives this tab. The address changed with it, because the address comes out of that key.')}</p>
      <dl>
        <dt>${t('t.s6.movedfrom', 'shown in step 3')}</dt><dd class="mono break">${esc(moved)}</dd>
        <dt>${t('t.s6.movedto', 'written on chain')}</dt><dd class="mono break">${esc(S.grantKey)}</dd>
      </dl>`}
      <p>${t('t.s6.explorernote', 'In the explorer this name now looks uninformative: an ephemeral key, a ciphertext, and one record whose name says nothing. That is the design working. To check it from the outside, open it with the command-line tool.')}</p>`)}`)

  // After a frame, so the two newly revealed sections are laid out before the
  // browser is asked to scroll to one of them.
  // Scroll to whichever of the two the visitor needs next. With a claim link
  // in the result, jumping to the inbox put the one thing they have to copy
  // off the screen before they saw it.
  const target = S.recipient.local ? out : $('step-open')
  requestAnimationFrame(() =>
    target.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

// ─── Lane one · no wallet ──────────────────────────────────────────────────

const demoAccount = () => privateKeyToAccount(hexOf(un64(DEMO_KEY)))

const demoOut = $('demo-out')

/**
 * One press, one name.
 *
 * A name is spent the moment it carries a `nextkey.eph`, so every press of this
 * button costs one out of a finite pool. It has to refuse a second press —
 * both while the first is still in flight, which two quick taps on a phone will
 * produce, and afterwards, when the work is done and the button is still
 * sitting there looking pressable.
 */
let writing = false
let receiving = false
let claiming = false

on('write-demo', 'click', async () => {
  if (writing) return
  if (!S.sealed) return say(demoOut, 'bad', `
    <p>${t('t.s6.needsecret', 'Do steps 1 to 3 first — there is nothing to write yet.')}</p>`)

  writing = true
  $('write-demo').disabled = true
  try {
    say(demoOut, 'busy', `<p>${t('t.chain.finding', 'Finding a name that is still free…')}</p>`)
    const name = await freePoolName()
    if (!name) {
      const err = new Error(t('t.chain.exhausted',
        'Every name we lend out has been used. That is a good problem and a real one — each name holds exactly one secret, and this pool is finite. Use your own wallet and your own name below, or come back once we have topped it up.'))
      err.poolEmpty = true
      throw err
    }

    // The demo wallet signs the derivation too, because on this lane the name
    // is ours. On your own name that signature would be yours, and so would
    // the ephemeral key — which is the difference between borrowing a name and
    // owning one, stated in one line of arithmetic.
    const account = demoAccount()
    say(demoOut, 'busy', `<p>${t('t.chain.preparing', 'Preparing the records for')} <span class="mono">${esc(name)}</span>…</p>`)
    const { records, moved } = await recordsFor(name, (message) => account.signMessage({ message }))

    const node = toHex(packetToBytes(name))
    const abi = SHAPES[0].abi

    // Re-check, now that we know which name and have the records in hand: a
    // second visitor may have taken it while this one was typing.
    if (await reader.getEnsText({ name, key: RECORD_EPH })) {
      throw new Error(t('t.chain.raced',
        'Somebody else took that name a moment ago. Press the button again and the page will pick another.'))
    }

    say(demoOut, 'busy', `<p>${t('t.s6.simulating', 'Checking the write would succeed, before asking you to sign…')}</p>`)
    for (const [key, value] of records) {
      await reader.simulateContract({
        address: POOL_RESOLVER, abi, functionName: 'setText',
        args: [node, key, value], account: account.address })
    }

    // Three transactions with explicit consecutive nonces, sent without waiting
    // for each other, then awaited together. Waiting for one receipt before
    // sending the next would make a visitor watch three blocks go by — about
    // forty-five seconds of nothing, which is where a demo loses people.
    say(demoOut, 'busy', `<p>${t('t.chain.writing', 'Writing three records — this takes about fifteen seconds…')}</p>`)
    const signer = createWalletClient({ account, chain: sepolia, transport: http(RPC) })
    let nonce = await reader.getTransactionCount({ address: account.address })
    const sent = await Promise.all(records.map(([key, value]) =>
      signer.writeContract({
        address: POOL_RESOLVER, abi, functionName: 'setText',
        args: [node, key, value], chain: sepolia, nonce: nonce++,
      }).then((hash) => [key, hash])))
    await Promise.all(sent.map(([, hash]) => reader.waitForTransactionReceipt({ hash })))

    onchain = { name, via: 'demo', resolver: POOL_RESOLVER, node, abi, account }
    // Spent. Say which name went, so that a second press has a reason rather
    // than a disabled button and no explanation.
    $('demo-state').textContent = t('t.chain.spent',
      'That name now holds your secret and cannot hold another. Reload the page to start again with a fresh one.')
    wroteIt(demoOut, name, sent, moved, `
      <p>${t('t.chain.borrowed', 'This name is ours and we lent it to you, along with the gas. The key that signed those three transactions is published in this page: it owns nothing, and its only power is writing records on names set aside for exactly this. You can read it, and so can anyone.')}</p>`)
  } catch (e) {
    // Only a failed run may be retried. A successful one leaves the button
    // disabled, because the name it used is gone.
    $('write-demo').disabled = false
    say(demoOut, 'bad', `
      <p>${t('t.s6.fail', 'That did not go through.')}</p>
      <p class="note mono">${esc(plain(e))}</p>
      ${e.poolEmpty ? '' : `<p class="note">${t('t.chain.failnote', 'The likeliest cause is that the wallet this page carries has run out of testnet ether — anyone can spend it, which is the accepted cost of publishing it. Your own wallet and your own name still work below.')}</p>`}`)
  } finally {
    writing = false
  }
})

// ─── Lane two · your wallet, your name ─────────────────────────────────────
//
// `window.ethereum` was the whole story only while one extension existed. Two
// installed extensions fight over that single property and the loser is
// invisible, so EIP-6963 replaced it: each wallet announces itself, the page
// listens, and the visitor picks. Providers answer synchronously, but the
// listener has to be in place before the request goes out.
//
// On a phone there is usually nothing to find at all. Mobile browsers carry no
// wallet and no extensions; wallets ship their own in-app browser and inject
// only there. Saying "no wallet found" would be true and useless — the visitor
// has a wallet, it is on the same device, and it is one link away.

let wallet = null
let account = null

const walletOut = $('wallet-out')

const announced = []
window.addEventListener('eip6963:announceProvider', (e) => {
  if (!announced.some((p) => p.info.uuid === e.detail.info.uuid)) announced.push(e.detail)
})
window.dispatchEvent(new Event('eip6963:requestProvider'))

/**
 * Deep links that reopen this page inside a wallet's own browser.
 *
 * Verified against each vendor's current documentation on 2026-09-06, because
 * these hosts do change: MetaMask now documents link.metamask.io and no longer
 * metamask.app.link, which is the sort of detail that quietly turns a button
 * into a dead end.
 */
const WALLET_LINKS = [
  { name: 'MetaMask', href: (u) => `https://link.metamask.io/dapp/${u.replace(/^https?:\/\//, '')}` },
  { name: 'Coinbase Wallet', href: (u) => `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(u)}` },
  { name: 'Trust Wallet', href: (u) => `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(u)}` },
]

const hereFor = () => {
  const url = new URL(location.href)
  url.searchParams.set('lang', document.documentElement.dataset.i18nLang || 'en')
  return url.toString()
}

/**
 * The panel a visitor with no wallet meets — and the three sentences it used to
 * get wrong, all in the same way: written for the playground, then shown
 * unchanged on the ID tab when one bundle started serving three pages.
 *
 * `t.s6.mobile` said "mobile browsers cannot", which is a claim about the
 * reader rather than about the page, and false on the desktop browser without
 * an extension — which is where it most often appears. The key changed with the
 * sentence rather than being edited under the old one: an edited English string
 * leaves nine translations in place that quietly stop matching it, and a new key
 * is reported missing loudly. Loud is the property being bought.
 *
 * It is `t.wallet.none` and not `t.s6.nowallet`, which was the obvious name and
 * is already taken — by a retired sentence from an older version of this panel,
 * still sitting in all nine languages. `i18n-merge` refused to overwrite it and
 * said so; without that refusal this page would now be showing a translation
 * written for a sentence that no longer exists, in every language except
 * English, which is the one nobody would have checked.
 *
 * The other two are not wrong, they are elsewhere. Steps 1 to 5 exist on the
 * send tabs and nowhere else, and the lane that needs no wallet is the lane at
 * step 4 — on the ID tab both ways of becoming receivable need one, so
 * "use the lane above" pointed at the button that had just refused. They are
 * gated on PAGE now instead of being reworded into something vague enough to be
 * true on both.
 */
const offerDeepLinks = () => say(walletOut, 'bad', `
  <p>${t('t.wallet.none', 'No wallet answered in this browser. Most mobile browsers carry none, and a desktop browser carries one only if an extension is installed. Open this page inside your wallet’s own browser instead:')}</p>
  <p>${WALLET_LINKS.map((w) =>
    `<a class="act" href="${esc(w.href(hereFor()))}" rel="noopener">${esc(w.name)}</a>`).join(' ')}</p>
  ${PAGE === 'send' ? `
  <p class="note">${t('t.s6.mobilenote', 'The page starts again from step 1 there, because steps 1 to 5 happen entirely inside a tab and nothing was stored to carry across. That is the same property that makes them safe.')}</p>
  <p class="note">${t('t.chain.orlend', 'Or use the lane above, which needs no wallet at all.')}</p>` : ''}
  <p class="note">${t('t.s6.otherwallets', 'Another wallet? Open its browser and paste this address:')}</p>
  <p class="note mono break">${esc(hereFor())}</p>`)

const offerChoice = () => say(walletOut, '', `
  <p>${t('t.s6.choose', 'More than one wallet is installed here. Which should sign?')}</p>
  <p>${announced.map((p, i) =>
    `<button class="act" type="button" data-wallet="${i}">${esc(p.info.name)}</button>`).join(' ')}</p>
  <p class="note">${t('t.s6.choosenote', 'Listed by the wallets themselves, through the announcement they each make to the page. Nothing here knows which wallets exist in the world — only which ones spoke up in this browser.')}</p>`)

on('connect', 'click', async () => {
  if (!announced.length && !window.ethereum) return offerDeepLinks()
  if (announced.length > 1) return offerChoice()
  await connectWith(announced[0]?.provider ?? window.ethereum)
})

walletOut.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-wallet]')
  if (pick) connectWith(announced[Number(pick.dataset.wallet)].provider)
})

/**
 * Becoming receivable, in one signature and no gas.
 *
 * This is the answer to the question the rest of the page raises: encrypting to
 * somebody needs their public key, so a name without one can receive nothing —
 * and asking an ordinary person to generate a key, keep it for ever, own a name
 * and pay for a transaction is four walls, of which they climb none.
 *
 * So none of the four happens here. The key is *derived* from one signature
 * with the wallet they already have, so nothing is created and nothing has to
 * be kept: the same wallet gives the same key back on any machine, for ever.
 * The name is lent from the pool and the record is written by the page's own
 * account, so no gas is asked for. What is left for the visitor is: connect,
 * sign once.
 *
 * The honest limits, stated on the page as well as here: the name is borrowed
 * rather than owned, and the same signature on a name of their own would give
 * them the identical key — which is the point. Moving to their own name later
 * changes the address, not the identity.
 */
on('be-receivable', 'click', async () => {
  const out = $('id-out')
  const eth = announced[0]?.provider ?? window.ethereum
  if (!eth) return offerDeepLinks()
  if (receiving) return
  receiving = true
  $('be-receivable').disabled = true
  try {
    const [addr] = await eth.request({ method: 'eth_requestAccounts' })
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })
    } catch { /* checked next */ }
    const chainId = await eth.request({ method: 'eth_chainId' })
    if (parseInt(chainId, 16) !== 11155111) return say(out, 'bad', `
      <p>${t('t.s6.wrongchain', 'That wallet is not on Sepolia.')}</p>
      <p class="note">${t('t.s6.wrongchainnote', 'The hackathon ENS deployment lives on Sepolia. Switch the network and connect again.')}</p>`)

    say(out, 'busy', `<p>${t('t.id.signing', 'Asking your wallet for one signature — it moves nothing and costs nothing…')}</p>`)
    const signer = createWalletClient({ account: addr, chain: sepolia, transport: custom(eth) })
    const sig = await signer.signMessage({ message: identityMessage() })
    const sk = identitySecretFromSignature(sig)
    const pk = publicKeyOf(sk)
    const value0 = b64(pk)

    // Already receivable? Then say so instead of spending a second name.
    say(out, 'busy', `<p>${t('t.id.looking', 'Checking whether this wallet already has a name here…')}</p>`)
    const already = await poolNameWithKey(value0, (done, total) =>
      say(out, 'busy', `<p>${t('t.id.looking', 'Checking whether this wallet already has a name here…')}
        <span class="mono">${done}/${total}</span></p>`))
    if (already) {
      receivableAt(already)
      return say(out, 'ok', `
        <p>${t('t.id.already', 'You are already receivable — the same wallet gives the same key, so this name is still yours:')} <span class="mono">${esc(already)}</span></p>
        <dl>
          <dt>${t('t.id.label', 'NextKey ID')}</dt><dd class="mono break nkid">${esc(nextkeyId(pk))}</dd>
          <dt>${t('t.name', 'name')}</dt><dd class="mono">${esc(already)}</dd>
          <dt>${t('t.pubkey', 'published key')}</dt><dd class="mono break">${esc(value0)}</dd>
        </dl>
        <p class="note">${t('t.id.alreadynote', 'Nothing was written and no name was spent. That is the point of deriving the key rather than generating one: there is only ever one of you, however many browsers you press this in.')}</p>`,
        { step: 2, recipient: 'derived', name: already, nextkeyId: nextkeyId(pk), publicKey: value0, wrote: false })
    }

    say(out, 'busy', `<p>${t('t.chain.finding', 'Finding a name that is still free…')}</p>`)
    const name = await freePoolName()
    if (!name) throw new Error(t('t.chain.exhausted',
      'Every name we lend out has been used. That is a good problem and a real one — each name holds exactly one secret, and this pool is finite. Use your own wallet and your own name below, or come back once we have topped it up.'))

    const node = toHex(packetToBytes(name))
    const abi = SHAPES[0].abi
    const account = demoAccount()
    const value = value0

    say(out, 'busy', `<p>${t('t.s6.simulating', 'Checking the write would succeed, before asking you to sign…')}</p>`)
    await reader.simulateContract({
      address: POOL_RESOLVER, abi, functionName: 'setText',
      args: [node, RECORD_PUBKEY, value], account: account.address })

    say(out, 'busy', `<p>${t('t.id.writing', 'Publishing your key — one record, our gas…')}</p>`)
    const w = createWalletClient({ account, chain: sepolia, transport: http(RPC) })
    const hash = await w.writeContract({
      address: POOL_RESOLVER, abi, functionName: 'setText',
      args: [node, RECORD_PUBKEY, value], chain: sepolia })
    await reader.waitForTransactionReceipt({ hash })

    try { localStorage.setItem(REMEMBERED, JSON.stringify({ name, value })) } catch { /* fine */ }
    receivableAt(name)
    say(out, 'ok', `
      <p>${t('t.id.done', 'You can now be sent secrets at')} <span class="mono">${esc(name)}</span>.</p>
      <dl>
        <dt>${t('t.id.label', 'NextKey ID')}</dt><dd class="mono break nkid">${esc(nextkeyId(pk))}</dd>
        <dt>${t('t.name', 'name')}</dt><dd class="mono">${esc(name)}</dd>
        <dt>${t('t.pubkey', 'published key')}</dt><dd class="mono break">${esc(value)}</dd>
        <dt>${t('t.id.from', 'derived from')}</dt><dd class="mono break">${esc(addr)}</dd>
      </dl>
      <p class="note"><a href="https://sepolia.etherscan.io/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer">${t('t.tx', 'transaction')}</a></p>
      ${why(t('t.why', 'Why this matters'), `
        <p>${t('t.id.note1', 'Nothing was generated and nothing was stored. That key came out of your signature and comes back out of it every time, on any machine you can sign from — lose this browser, this page and this name, and the key is still yours.')}</p>
        <p>${t('t.id.note2', 'The name is lent, not owned: it is one of this project\'s names, and the record was written and paid for by this page. Publish the same key on a name you own and the address changes while the identity does not, because the key was never tied to the name.')}</p>`)}`,
      { step: 2, recipient: 'derived', name, nextkeyId: nextkeyId(pk), publicKey: value, from: addr })
    refreshReady()
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
    // Only a failure re-arms the button. A success leaves it disabled, because
    // pressing it again is meaningless: the same wallet derives the same key,
    // and the second press could only spend a name or repeat an answer.
    $('be-receivable').disabled = false
  } finally {
    receiving = false
  }
})


// ─── A name of your own ────────────────────────────────────────────────────
/**
 * The registrar's rules, as the page needs to speak about them.
 *
 * Every error here is one the contract can return, and each is turned into a
 * sentence rather than a selector, because a person typing a name into a box
 * has no way to look one up. The two-argument `claim` is deliberately absent:
 * this page always has a key to publish, and an ABI offering both invites
 * picking the one that leaves the name unusable.
 */
const namesAbi = [
  { name: 'claim', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'label', type: 'string' }, { name: 'to', type: 'address' },
             { name: 'pubkey', type: 'string' }], outputs: [] },
  { name: 'nameOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }], outputs: [{ type: 'string' }] },
  { name: 'remaining', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'paused', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'error', name: 'AlreadyClaimed', inputs: [{ name: 'label', type: 'string' }] },
  { type: 'error', name: 'CapReached', inputs: [{ name: 'cap', type: 'uint256' }] },
  { type: 'error', name: 'LabelTooLong', inputs: [{ name: 'length', type: 'uint256' }] },
  { type: 'error', name: 'Denied', inputs: [] },
  { type: 'error', name: 'Paused', inputs: [] },
  { type: 'error', name: 'EmptyLabel', inputs: [] },
  { type: 'error', name: 'LabelTaken', inputs: [] },
  { type: 'error', name: 'NotYoursToClaim', inputs: [] },
  { type: 'error', name: 'ZeroAddress', inputs: [] },
]

/**
 * What the contract refused, said in words.
 *
 * Falls through to the raw message rather than inventing one: a sentence that
 * confidently explains the wrong thing is worse than an ugly one that is true.
 */
const claimRefusal = (e) => {
  const named = e?.walk?.((x) => x?.data?.errorName)?.data ?? e?.cause?.data
  switch (named?.errorName) {
    case 'AlreadyClaimed': return t('t.own.e.already',
      'This wallet already has a name here:') + ` ${named.args?.[0] ?? ''}.${NAMES_PARENT}`
    case 'LabelTaken': return t('t.own.e.taken',
      'That name is taken. Nothing can take a name away from whoever holds it — including us, which is the property that makes this safe to offer.')
    case 'CapReached': return t('t.own.e.cap',
      'Every name this contract will ever hand out has been handed out. The limit is written into it and cannot be talked around.')
    case 'LabelTooLong': return t('t.own.e.long',
      'That name is too long. A name carries its length in a single byte, so 255 characters is the ceiling everywhere, not only here.')
    case 'Denied': return t('t.own.e.denied', 'This address is on the deny list.')
    case 'Paused': return t('t.own.e.paused',
      'Handing out names is paused. Names already given out are unaffected — pausing cannot reach into one.')
    case 'EmptyLabel': return t('t.own.e.empty', 'Type the name you would like first.')
    case 'NotYoursToClaim': return t('t.own.e.notyours',
      'A name can only be claimed by the address that will own it. That is what stops a passer-by spending your one allowance on a name you never wanted.')
    default: return plain(e)
  }
}

/**
 * One transaction: the name and the key on it.
 *
 * The lent name above costs a signature and no gas because our key writes the
 * record. This costs a transaction the visitor signs and pays for, and what
 * they get back is different in kind — the registry names *their* address as
 * the owner, and nothing here can take it back or move it.
 *
 * The key is the same key. It comes out of the same signature over the same
 * message, so somebody who was receivable at a lent name and then claims one of
 * their own keeps their identity and changes only their address. That is the
 * whole reason the key was never tied to the name.
 */
on('claim-name', 'click', async () => {
  const out = $('claim-out')
  if (claiming) return

  /**
   * The typed name is judged before any wallet is asked for.
   *
   * Checking it here as well as on chain is not duplication: the contract's
   * rules are the ones that bind, but somebody who typed a space deserves to
   * hear about it without a wallet opening first — and a visitor with no wallet
   * at all should still be told their name would not have worked.
   */
  const label = $('own-label').value.trim().toLowerCase()
  if (!label) return say(out, 'bad', `<p>${t('t.own.e.empty', 'Type the name you would like first.')}</p>`)
  if (!/^[a-z0-9-]+$/.test(label)) return say(out, 'bad', `
    <p>${t('t.own.e.chars', 'Letters a to z, digits and hyphens. Nothing else — a name with anything else in it cannot be typed reliably by the person you give it to.')}</p>`)

  const eth = announced[0]?.provider ?? window.ethereum
  if (!eth) return offerDeepLinks()

  claiming = true
  $('claim-name').disabled = true
  try {
    const [addr] = await eth.request({ method: 'eth_requestAccounts' })
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })
    } catch { /* checked next */ }
    const chainId = await eth.request({ method: 'eth_chainId' })
    if (parseInt(chainId, 16) !== 11155111) return say(out, 'bad', `
      <p>${t('t.s6.wrongchain', 'That wallet is not on Sepolia.')}</p>
      <p class="note">${t('t.s6.wrongchainnote', 'The hackathon ENS deployment lives on Sepolia. Switch the network and connect again.')}</p>`)

    // Asked before a signature is requested. Being told "you already have one"
    // after signing is a worse experience than being told before, and the
    // answer costs one call.
    const had = await reader.readContract({
      address: NAMES_CONTRACT, abi: namesAbi, functionName: 'nameOf', args: [addr] })
    if (had) {
      const full = `${had}.${NAMES_PARENT}`
      ownedAt(full)
      return say(out, 'ok', `
        <p>${t('t.own.e.already', 'This wallet already has a name here:')} <span class="mono">${esc(full)}</span></p>
        <p class="note">${t('t.own.alreadynote', 'One name per address, for ever. Nothing was signed and nothing was spent.')}</p>`,
        { step: 2, recipient: 'owned', name: full, wrote: false })
    }

    say(out, 'busy', `<p>${t('t.id.signing', 'Asking your wallet for one signature — it moves nothing and costs nothing…')}</p>`)
    const signer = createWalletClient({ account: addr, chain: sepolia, transport: custom(eth) })
    const sig = await signer.signMessage({ message: identityMessage() })
    const value = b64(publicKeyOf(identitySecretFromSignature(sig)))

    /**
     * Simulated before the wallet is asked for anything expensive.
     *
     * This is where a taken name, a cap that has been reached or a paused
     * contract shows up — as a named error that can be turned into a sentence,
     * instead of as a failed transaction the visitor has already paid for.
     */
    say(out, 'busy', `<p>${t('t.s6.simulating', 'Checking the write would succeed, before asking you to sign…')}</p>`)
    await reader.simulateContract({
      address: NAMES_CONTRACT, abi: namesAbi, functionName: 'claim',
      args: [label, addr, value], account: addr })

    say(out, 'busy', `<p>${t('t.own.sending', 'One transaction: the name and your key on it. Your wallet will ask you to pay for it…')}</p>`)
    const hash = await signer.writeContract({
      address: NAMES_CONTRACT, abi: namesAbi, functionName: 'claim',
      args: [label, addr, value], chain: sepolia })
    await reader.waitForTransactionReceipt({ hash })

    const full = `${label}.${NAMES_PARENT}`
    try { localStorage.setItem(REMEMBERED, JSON.stringify({ name: full, value })) } catch { /* fine */ }
    ownedAt(full)
    say(out, 'ok', `
      <p>${t('t.own.done', 'It is yours. Secrets can be sent to')} <span class="mono">${esc(full)}</span>.</p>
      <dl>
        <dt>${t('t.id.label', 'NextKey ID')}</dt><dd class="mono break nkid">${esc(nextkeyId(un64(value)))}</dd>
        <dt>${t('t.name', 'name')}</dt><dd class="mono">${esc(full)}</dd>
        <dt>${t('t.own.owner', 'owner')}</dt><dd class="mono break">${esc(addr)}</dd>
        <dt>${t('t.pubkey', 'published key')}</dt><dd class="mono break">${esc(value)}</dd>
      </dl>
      <p class="note"><a href="https://sepolia.etherscan.io/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer">${t('t.tx', 'transaction')}</a></p>
      ${why(t('t.why', 'Why this matters'), `
        <p>${t('t.own.note1', 'The registry names your address as the owner. Nothing on this page can move it, change it or take it back, and neither can the contract that made it — that is what "yours" has to mean before it is worth saying.')}</p>
        <p>${t('t.own.note2', 'What is still ours: this project holds the permission to write text records on this resolver, so the key on your name could be overwritten by us. Point the name at a resolver you control and even that stops being true.')}</p>`)}`,
      { step: 2, recipient: 'owned', name: full, nextkeyId: nextkeyId(un64(value)), publicKey: value, owner: addr })
    refreshReady()
  } catch (e) {
    say(out, 'bad', `<p>${esc(claimRefusal(e))}</p>`)
    $('claim-name').disabled = false
  } finally {
    claiming = false
  }
})

/** The same "once, and visibly once" as the lent name, for the owned one. */
function ownedAt(full) {
  $('claim-name').disabled = true
  $('own-label').disabled = true
  $('own-state').textContent = `${t('t.own.at', 'yours:')} ${full}`
  $('own-name-box').classList.add('done')
  // Being receivable is now true by a different route, so the section above
  // should not still be inviting a press that would spend a lent name.
  $('be-receivable').disabled = true
  $('recv-state').textContent = `${t('t.recv.at', 'receivable at')} ${full}`
  $('be-receivable-box').classList.add('done')
  const to = $('ens-name')
  if (to && !to.value.trim()) to.value = full
}

/**
 * Once, and visibly once.
 *
 * The button stays pressed-out and the section says which name answers for this
 * wallet. The recipient field is filled in but not confirmed: being receivable
 * is about you, choosing a grant is about somebody else, and having the page
 * quietly decide you are sending to yourself was the confusion that put this
 * button in step 2 in the first place.
 */
function receivableAt(name) {
  $('be-receivable').disabled = true
  $('recv-state').textContent = `${t('t.recv.at', 'receivable at')} ${name}`
  $('be-receivable-box').classList.add('done')
  // Only the send tabs have a recipient field to fill in.
  const to = $('ens-name')
  if (to && !to.value.trim()) to.value = name
}

async function connectWith(eth) {
  if (!eth) return offerDeepLinks()
  try {
    const [addr] = await eth.request({ method: 'eth_requestAccounts' })
    account = addr
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })
    } catch { /* the wallet may already be there, or may refuse; checked below */ }
    const chainId = await eth.request({ method: 'eth_chainId' })
    if (parseInt(chainId, 16) !== 11155111) return say(walletOut, 'bad', `
      <p>${t('t.s6.wrongchain', 'That wallet is not on Sepolia.')}</p>
      <p class="note">${t('t.s6.wrongchainnote', 'The hackathon ENS deployment lives on Sepolia. Switch the network and connect again.')}</p>`)

    wallet = createWalletClient({ account: addr, chain: sepolia, transport: custom(eth) })

    /**
     * What actually matters is the name, not the address.
     *
     * The address is only evidence that you may write to a name — so the page
     * asks the chain which name this account answers to and fills the field in
     * rather than making somebody type it from memory. That is reverse
     * resolution, and it only works if a primary name has been set, which most
     * people have not done on a test deployment. So it is an offer, not a
     * requirement.
     *
     * There is no cheap way to list every name an address owns: that needs an
     * indexer, and the honest answer for a static page is to say so.
     */
    let primary = null
    try { primary = await reader.getEnsName({ address: addr }) } catch { /* none */ }
    if (primary && !$('own-name').value.trim()) $('own-name').value = primary

    // Gas, before it becomes a problem. An empty account cannot write, and
    // finding that out from a failed transaction is a worse way to learn it
    // than a sentence and two links.
    const balance = await reader.getBalance({ address: addr })
    say(walletOut, balance === 0n ? 'bad' : 'ok', `
      <dl><dt>${t('t.s6.connected', 'connected')}</dt><dd class="mono break">${esc(addr)}</dd>
      ${primary
        ? `<dt>${t('t.chain.primary', 'its primary name')}</dt><dd class="mono break">${esc(primary)}</dd>`
        : ''}</dl>
      ${primary
        ? `<p class="note">${t('t.chain.prefilled', 'Filled in below. It is the name this account answers to on this deployment — change it if you meant another one.')}</p>`
        : `<p class="note">${t('t.chain.noprimary', 'This account has no primary name set here, so the field below cannot be filled in for you. Type a name you hold on this deployment. Listing every name an address owns needs an indexer, which a page served from static files does not have.')}</p>`}
      ${balance === 0n ? `
      <p>${t('t.chain.nogas', 'That account holds no Sepolia ether, so it cannot pay for a write.')}</p>
      <p class="note">${t('t.chain.nogasnote', 'A faucet will give you some — you need only a fraction of one. Or use the lane above, which pays for itself.')}</p>
      <p class="note">
        <a href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia" target="_blank" rel="noopener noreferrer">Google Cloud</a> ·
        <a href="https://faucet.quicknode.com/ethereum/sepolia" target="_blank" rel="noopener noreferrer">QuickNode</a>
      </p>` : ''}`)
    $('publish').disabled = !!onchain
  } catch (e) {
    say(walletOut, 'bad', `<p>${esc(plain(e))}</p>`)
  }
}

on('publish', 'click', async () => {
  if (writing) return
  const name = $('own-name').value.trim().toLowerCase()

  if (!name) return say(chainOut, 'bad', `<p>${t('t.s6.needname', 'Enter a name you own.')}</p>`)
  if (!S.sealed) return say(chainOut, 'bad', `
    <p>${t('t.s6.needsecret', 'Do steps 1 to 3 first — there is nothing to write yet.')}</p>`)

  writing = true
  $('publish').disabled = true
  try {
    /**
     * Does this name have a resolver at all — and is it a contract?
     *
     * Both halves are load-bearing, and the second one is the reason this check
     * exists rather than being left to the simulation below.
     *
     * A name with no resolver on this deployment resolves to the zero address.
     * Left unchecked, everything downstream carried on: the write was aimed at
     * 0x000…000 and the visitor's wallet was asked to sign it. MetaMask's own
     * burn-address warning was the only thing standing between a judge and a
     * transaction that could never have done anything.
     *
     * And the simulation does not catch it. `setText` returns nothing, so an
     * eth_call against an address with no code comes back empty — which, for a
     * function with no outputs, is a perfectly valid answer. The guard that
     * ought to protect us cheerfully says yes. Hence the explicit code check.
     */
    say(chainOut, 'busy', `<p>${t('t.s6.finding', 'Finding the resolver for that name…')}</p>`)
    let resolver
    try {
      resolver = await reader.getEnsResolver({ name })
    } catch { /* reported as "none" below, with the same message */ }

    if (!resolver || /^0x0+$/i.test(resolver)) {
      const err = new Error(t('t.chain.noresolver',
        'That name has no resolver on this deployment, so there is nowhere to write. Either it is not registered here, or it has no resolver attached yet.'))
      err.noResolver = true
      throw err
    }

    const code = await reader.getBytecode({ address: resolver })
    if (!code || code === '0x') {
      const err = new Error(t('t.chain.notcontract',
        'The resolver this name points at holds no contract. Writing there would consume gas and change nothing.'))
      err.noResolver = true
      throw err
    }

    say(chainOut, 'busy', `<p>${t('t.s6.deriving', 'Sign the derivation message — it is not a transaction and moves nothing…')}</p>`)
    const { records, moved } = await recordsFor(name,
      (message) => wallet.signMessage({ account, message }))

    // A name publishes its ephemeral key once. Overwriting a different one
    // would move every grant already on the name to a new address and leave
    // the old records unreadable and unfindable — so this stops instead.
    const already = await reader.getEnsText({ name, key: RECORD_EPH })
    if (already && already !== records[0][1]) {
      const err = new Error(t('t.s6.ephclash',
        'This name already publishes a different nextkey.eph. Overwriting it would move every grant on the name to a new address and leave the existing ones unreadable, so nothing was written. Use another name.'))
      err.ephClash = true
      throw err
    }
    const toWrite = already ? records.slice(1) : records

    /**
     * Which dialect does this resolver speak? Ask it, by simulating the first
     * real write in each shape. A refusal for lack of permission and a refusal
     * for a missing function look alike — a proxy delegating into a function
     * that does not exist reverts with *empty* data — so both failures are
     * kept and shown rather than only the last.
     */
    say(chainOut, 'busy', `<p>${t('t.s6.simulating', 'Checking the write would succeed, before asking you to sign…')}</p>`)
    let shape = null
    const refusals = []
    for (const candidate of SHAPES) {
      try {
        await reader.simulateContract({
          address: resolver, abi: candidate.abi, functionName: 'setText',
          args: [candidate.arg(name), ...toWrite[0]], account,
        })
        shape = candidate
        break
      } catch (e) { refusals.push(`setText(${candidate.id}): ${plain(e)}`) }
    }
    if (!shape) {
      const err = new Error(refusals.join('  ·  '))
      err.bothShapesRefused = true
      throw err
    }
    const node = shape.arg(name)

    // Every remaining record too, before any signature is asked for. Writing
    // the ciphertext and then failing on the grant would leave a secret on
    // chain that nobody can open; writing the grant without the ephemeral key
    // would leave one nobody can find.
    for (const record of toWrite.slice(1)) {
      await reader.simulateContract({
        address: resolver, abi: shape.abi, functionName: 'setText',
        args: [node, ...record], account,
      })
    }

    const hashes = []
    for (const [key, value] of toWrite) {
      say(chainOut, 'busy', `<p>${t('t.s6.signing', 'Approve in your wallet —')} <span class="mono">${esc(key)}</span></p>`)
      const hash = await wallet.writeContract({
        address: resolver, abi: shape.abi, functionName: 'setText',
        args: [node, key, value], chain: sepolia,
      })
      hashes.push([key, hash])
      await reader.waitForTransactionReceipt({ hash })
    }

    onchain = { name, via: 'wallet', resolver, node, abi: shape.abi }
    $('publish').disabled = true
    wroteIt(chainOut, name, hashes, moved, `
      <p>${t('t.s6.donenote', 'Nothing about those records mentions NextKey as a service, and no server of ours knows they exist. The recipient can open them with the command-line tool; we could not, and neither could anyone who takes this site down.')}</p>`)
  } catch (e) {
    say(chainOut, 'bad', `
      <p>${t('t.s6.fail', 'That did not go through.')}</p>
      <p class="note mono">${esc(plain(e))}</p>
      <p class="note">${e.noResolver
        ? t('t.chain.noresolvernote', 'Nothing was signed and no gas was spent. A name you hold elsewhere — on production ENS, say — will not do: this is the hackathon deployment, and a name has to exist here and carry a resolver. The lane above lends you one that does.')
        : e.ephClash
        ? t('t.s6.ephclashnote', 'Nothing was written, and nothing was lost. A name carries one ephemeral key for its whole life precisely so that this cannot happen by accident.')
        : e.bothShapesRefused
        ? t('t.s6.failboth', 'Both setText signatures were refused, and the two reasons are above. If the name is not yours, that is the system working. If it is yours, its resolver may be one this page does not know how to write to — tell us which resolver, and it can be added.')
        : t('t.s6.failnote', 'The usual causes, in order: the name is not yours, so the resolver refuses the write; the name has no resolver attached yet; or the wallet has no Sepolia ether for gas. The first is the system working.')}</p>`)
    $('publish').disabled = !wallet
  } finally {
    writing = false
  }
})

// ═══ Step 5 · the inbox ════════════════════════════════════════════════════
//
// Nobody sends the recipient an address. This is the part that surprises
// people and it is worth being exact about what it costs.
//
// The recipient reads one public value off a name — its ephemeral key — does a
// single scalar multiplication with their own private key, and arrives at a
// record name. If something is there, it is theirs. If nothing is there they
// learn nothing at all: not that a grant was withdrawn, not that one ever
// existed. That is the inbox, and it needs no server, no account and no
// notification.
//
// What it does need is a list of names to try. This page scans the names it
// knows about, which is enough to demonstrate the mechanism and is not a
// delivery system: finding every name in the world that carries something for
// you means indexing the registry's events, and a page served from static
// files has no indexer. Saying so is better than implying a mailbox that does
// not exist.

const fromChain = async (key, name) => reader.getEnsText({ name: name ?? onchain.name, key })

const inboxNames = () => [...new Set(
  $('inbox-names').value.split(',').map((n) => n.trim().toLowerCase()).filter(Boolean))]

/** One name, from the recipient's side: is anything here addressed to me? */
const scanName = async (name, sk, pk) => {
  const ephB64 = await fromChain(RECORD_EPH, name).catch(() => null)
  if (!ephB64) return { name, eph: false }
  const ephPk = un64(ephB64)
  const found = locateGrantV2(ephPk, sk, pk)
  const grantJson = await fromChain(found.key, name).catch(() => null)
  return { name, eph: true, ephPk, record: found.key, grantJson }
}

on('check-inbox', 'click', async () => {
  const out = $('open-out')
  const names = inboxNames()
  if (!names.length) return say(out, 'bad', `
    <p>${t('t.s4.noname', 'Name at least one name to look at.')}</p>`)

  try {
    say(out, 'busy', `<p>${t('t.s4.scanning', 'Working out, for each name, where a grant to this key would live…')}</p>`)

    // Five at a time. A phone on a hotel network cannot open twenty sockets at
    // once, and a public RPC will rate-limit long before the scan is
    // interesting.
    const results = []
    for (let i = 0; i < names.length; i += 5) {
      results.push(...await Promise.all(names.slice(i, i + 5)
        .map((n) => scanName(n, S.recipient.sk, S.recipient.pk))))
    }
    const hit = results.find((r) => r.grantJson)
    const scanned = why(t('t.s4.scanned', 'What was scanned, and what this is not'), `
      <p>${t('t.s4.scannednote', 'Scanned, one scalar multiplication each:')} <span class="mono break">${esc(names.join(', '))}</span></p>
      <p>${t('t.s4.indexnote', 'A real inbox would walk the registry\'s events instead of a list somebody typed. That needs an indexer, which a page served from static files does not have — so this scans what it knows about, and that limit is the honest part of the demonstration.')}</p>`)

    if (!hit) {
      return say(out, 'bad', `
        <p>${t('t.s4.empty', 'Nothing on those names is addressed to this key.')}</p>
        <dl><dt>${t('t.s4.derived', 'the record it worked out')}</dt>
          <dd class="mono break">${esc(results.find((r) => r.eph)?.record ?? '—')}</dd></dl>
        ${why(t('t.why', 'Why this matters'), `
          <p>${t('t.chain.norecordnote', 'Note what an empty record teaches: nothing. Not that a grant was withdrawn, not that one ever existed. The ciphertext is still there and still unreadable.')}</p>`)}
        ${scanned}`,
        { step: 5, found: false, scanned: names })
    }

    const sealedJson = await fromChain(RECORD_SECRET, hit.name)
    const contentKey = await openGrantV2(
      JSON.parse(hit.grantJson), hit.ephPk, S.recipient.sk, S.recipient.pk)
    const text = unpadSecret(await unseal(JSON.parse(sealedJson), contentKey))

    // The receipt is only offered once something has actually been read. An
    // acknowledgement of an unopened message would be a lie with a button.
    S.opened = { name: hit.name, ephPk: hit.ephPk, text }
    show($('receipt-row'), true)

    let restored = ''
    if (S.mode === 'wallet') {
      try {
        const back = mnemonicToAccount(text.trim())
        restored = `
          <dl><dt>${t('t.s4.restored', 'restores the wallet')}</dt>
            <dd class="mono break">${esc(back.address)}</dd></dl>
          ${why(t('t.s4.restoredwhy', 'Why that address matters'), `
            <p>${t('t.s4.restorednote', 'Derived from those words just now, in this tab, by the standard BIP-39 path. It is the same address step 1 made — which is the claim: the phrase is the wallet, and any tool that speaks BIP-39 restores it without NextKey being involved at all.')}</p>`)}`
      } catch { /* a message that merely looks like a phrase — say nothing */ }
    }

    say(out, 'ok', `
      <p class="found">✓ ${t('t.s4.ok', 'Opened.')}</p>
      <dl>
        <dt>${t('t.s4.onname', 'found on')}</dt><dd class="mono break">${esc(hit.name)}</dd>
        <dt>${t('t.s4.derived', 'the record it worked out')}</dt>
        <dd class="mono break">${esc(hit.record)}</dd>
      </dl>
      <pre class="mono reveal">${esc(text)}</pre>
      ${restored}
      ${why(t('t.why', 'Why this matters'), `
        <p>${t('t.s4.locnote', 'Nobody said where to look. One public value off the name, one scalar multiplication with a private key that never left this tab, and the same arithmetic yields both the address and the key that opens what is there — which is why a hardware wallet is asked to approve once rather than twice.')}</p>`)}
      ${scanned}`,
      { step: 5, found: true, name: hit.name, record: hit.record,
        restoredAddress: restored ? mnemonicToAccount(text.trim()).address : null })
  } catch (e) {
    say(out, 'bad', `<p>${t('t.s4.fail', 'Could not open it.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  }
})

// ─── The receipt ───────────────────────────────────────────────────────────
//
// A second record, at an address derived from the same shared secret under a
// different HKDF info string. Either party can compute it alone; nobody else
// can compute it at all.
//
// Two things about it are said on the page rather than glossed over. It does
// not prove who wrote it — on the lent-name lane the page's own key does the
// writing, because a recipient made in a browser has no wallet and no ether.
// And it publishes when the secret was read, which is a metadata leak on a
// page whose whole argument is that the chain should not show who talks to
// whom. It is therefore a button, not a default.

on('send-ack', 'click', async () => {
  const out = $('ack-out')
  try {
    if (!S.opened) throw new Error(t('t.ack.needopen', 'Open it first — there is nothing to acknowledge.'))
    if (!onchain) throw new Error(t('t.ack.needchain', 'Nothing has been written to the chain yet.'))
    if (onchain.via !== 'demo') throw new Error(t('t.ack.needlent',
      'On your own name, the receipt is a write the recipient makes from their own wallet. This page only does it on the names it lends, where it holds the setter role.'))

    const key = locateAckV2(S.opened.ephPk, S.recipient.sk, S.recipient.pk)
    const value = JSON.stringify({ v: 2, at: new Date().toISOString() })

    say(out, 'busy', `<p>${t('t.ack.writing', 'Writing the receipt — one transaction…')}</p>`)
    const signer = createWalletClient({
      account: onchain.account, chain: sepolia, transport: http(RPC) })
    const hash = await signer.writeContract({
      address: onchain.resolver, abi: onchain.abi, functionName: 'setText',
      args: [onchain.node, key, value], chain: sepolia })
    await reader.waitForTransactionReceipt({ hash })

    say(out, 'ok', `
      <p class="found">✓ ${t('t.ack.sent', 'Receipt written.')}</p>
      <dl>
        <dt class="mono">${esc(key)}</dt>
        <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer">${esc(clip(hash, 26))}</a></dd>
      </dl>
      ${why(t('t.why', 'Why this matters, and what it costs'), `
        <p>${t('t.ack.note', 'That address comes out of the same shared secret as the grant, under a different derivation. The sender can compute it without being told, and nobody else can compute it at all — so the receipt is delivered by being findable rather than by being sent.')}</p>
        <p>${t('t.ack.honest', 'Two limits, stated rather than buried. It shows a receipt exists at an address only two parties could name — not who wrote it, and on this lane the page\'s own lent key did the writing, because a recipient made in a browser has no wallet. And it makes the moment of reading public, which is the price of a delivery confirmation with no server involved.')}</p>`)}`,
      { step: 5, receipt: 'written', record: key, tx: hash })
    $('send-ack').disabled = true
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

on('check-ack', 'click', async () => {
  const out = $('ack-out')
  try {
    if (!onchain || !S.ackKey) throw new Error(t('t.ack.needchain', 'Nothing has been written to the chain yet.'))
    say(out, 'busy', `<p>${t('t.ack.checking', 'Looking where a receipt would be…')}</p>`)
    const there = await fromChain(S.ackKey)

    if (!there) return say(out, 'bad', `
      <p>${t('t.ack.none', 'No receipt yet.')}</p>
      <dl><dt>${t('t.ack.where', 'where the sender looked')}</dt>
        <dd class="mono break">${esc(S.ackKey)}</dd></dl>
      <p class="note">${t('t.ack.nonenote', 'The sender derived that address from their own ephemeral key without asking anybody. An empty record means unread — or read by someone who chose not to say so, which is a choice the recipient gets to make.')}</p>`,
      { step: 5, receipt: 'none', record: S.ackKey })

    let when = null
    try { when = JSON.parse(there).at } catch { /* not ours, or not JSON */ }
    say(out, 'ok', `
      <p class="found">✓ ${t('t.ack.found', 'Read.')}</p>
      <dl>
        <dt>${t('t.ack.where', 'where the sender looked')}</dt><dd class="mono break">${esc(S.ackKey)}</dd>
        ${when ? `<dt>${t('t.ack.at', 'acknowledged at')}</dt><dd class="mono">${esc(when)}</dd>` : ''}
      </dl>
      <p class="note">${t('t.ack.foundnote', 'The sender was told nothing and asked nobody. They derived the address from the ephemeral key they already held, read it off the chain, and found a receipt that only the recipient could have addressed.')}</p>`,
      { step: 5, receipt: 'found', record: S.ackKey, at: when })
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

/**
 * The same attempt by somebody else.
 *
 * She fails twice over, and the first failure is the interesting one: with the
 * name's ephemeral key in hand — it is public, she can just read it — she still
 * arrives at a record that does not exist on chain. She never gets as far as
 * being refused a decryption.
 */
on('open-other', 'click', async () => {
  const out = $('open-out')
  const sk = randomSecret()
  const pk = publicKeyOf(sk)
  try {
    say(out, 'busy', `<p>${t('t.chain.reading', 'Reading it back off the chain…')}</p>`)
    const ephPk = un64(await fromChain(RECORD_EPH))
    const looked = locateGrantV2(ephPk, sk, pk)
    const there = await fromChain(looked.key)

    say(out, 'ok', `
      <p class="found">✓ ${t('t.s4.refused', 'Refused, as it should be.')}</p>
      <dl>
        <dt>${t('t.s4.wherelooked', 'the record she computed')}</dt>
        <dd class="mono break">${esc(looked.key)}</dd>
        <dt>${t('t.chain.andfound', 'and what is there')}</dt>
        <dd class="mono">${there ? esc(clip(there, 40)) : t('t.chain.nothing', 'nothing — the record is empty')}</dd>
        <dt>${t('t.s4.whereis', 'where the grant actually is')}</dt>
        <dd class="mono break">${esc(S.grantKey)}</dd>
      </dl>
      ${why(t('t.why', 'Why this matters'), `
        <p>${t('t.chain.strangernote', 'She read the same public ephemeral key the recipient did, ran the same derivation, and arrived somewhere else — an address that holds nothing. She cannot tell whether this secret is shared with anybody at all, and there is no query that would tell her.')}</p>
        <p>${t('t.s4.refusednote', 'That failure is arithmetic, not policy. A different private key derives a different wrapping key, and AES-GCM will not decrypt under it. There is no rule anywhere in this page that could be edited to change the outcome.')}</p>`)}`)
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

// ═══ Step 6 · a second recipient ═══════════════════════════════════════════
//
// The construction was always plural; this is the button that says so.
//
// A name publishes one ephemeral key and one ciphertext. Each recipient's ECDH
// with that one key lands somewhere else, so a second grant is one more record
// and shares no key material with the first. Nothing is re-encrypted, nothing
// is replaced, and revoking one leaves the other untouched — which is the
// difference between granting access and handing over a copy.
//
// What it costs is one setText. On the lent-name lane the page's own key signs
// it; on your own name your wallet does. Neither needs a fresh derivation
// signature, because the ephemeral private key is still in this tab from step
// 4 — a reloaded page would have to re-derive it, which is what
// `nextkey.mjs share` does on the command line.

on('grant-more', 'click', async () => {
  const out = $('more-out')
  const name = $('more-name').value.trim().toLowerCase()
  if (writing) return
  if (!name) return say(out, 'bad', `
    <p>${t('t.s7.needname', 'Name somebody to grant it to.')}</p>`)
  if (!onchain || !S.eph) return say(out, 'bad', `
    <p>${t('t.s7.needchain', 'Write it to the chain first — there is nothing to grant a share of yet.')}</p>`)

  writing = true
  $('grant-more').disabled = true
  try {
    say(out, 'busy', `<p>${t('t.s2.looking', 'Reading their key from the chain…')}</p>`)
    const found = await readRecipientKey(name)
    if (found.error) throw new Error(found.error)
    const { pk } = found
    if (b64(pk) === b64(S.recipient.pk)) throw new Error(t('t.s7.same',
      'That is the recipient who already holds it. A second grant to the same key would land at the same address.'))

    const g = await grantForV2(S.contentKey, S.eph.sk, pk)

    say(out, 'busy', `<p>${t('t.s7.writing', 'Writing one more record — one transaction…')}</p>`)
    let hash
    if (onchain.via === 'demo') {
      const signer = createWalletClient({
        account: onchain.account, chain: sepolia, transport: http(RPC) })
      hash = await signer.writeContract({
        address: onchain.resolver, abi: onchain.abi, functionName: 'setText',
        args: [onchain.node, g.key, JSON.stringify(g.value)], chain: sepolia })
    } else {
      hash = await wallet.writeContract({
        address: onchain.resolver, abi: onchain.abi, functionName: 'setText',
        args: [onchain.node, g.key, JSON.stringify(g.value)], chain: sepolia })
    }
    await reader.waitForTransactionReceipt({ hash })
    S.extra.push({ name, record: g.key, tx: hash })

    say(out, 'ok', `
      <p class="found">✓ ${t('t.s7.done', 'Granted. The same secret, a second address.')}</p>
      <dl>
        ${S.extra.map((e) => `
        <dt class="mono break">${esc(e.record)}</dt>
        <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(e.tx)}" target="_blank" rel="noopener noreferrer">${esc(clip(e.tx, 26))}</a></dd>`).join('')}
      </dl>
      <p class="note">${t('t.s7.short', 'One more record on the same name. The ciphertext and the ephemeral key were not touched.')}</p>
      ${why(t('t.why', 'Why this matters'), `
        <p>${t('t.s7.note', 'Nothing was re-encrypted and no record was replaced. One ephemeral key serves the whole secret, and each recipient’s ECDH with it lands at a different address — so the two grants share no key material, and emptying one leaves the other working. That is what separates granting access from handing over a copy.')}</p>
        <p>${t('t.s7.honest', 'What an observer gains: a count. Text records can be listed from their events, so anyone can see that this name now carries two grants. What stays hidden is whose they are, and whether either belongs to anybody in particular.')}</p>`)}`,
      { step: 6, grants: S.extra.map((e) => ({ name: e.name, record: e.record })) })
    $('more-name').value = ''
  } catch (e) {
    say(out, 'bad', `<p>${t('t.s7.fail', 'That did not go through.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  } finally {
    writing = false
    $('grant-more').disabled = false
  }
})

// ═══ Step 7 · take it back, on the chain ═══════════════════════════════════

on('revoke', 'click', async () => {
  const out = $('revoke-out')
  try {
    if (!onchain) throw new Error('nothing has been written yet')
    const args = [onchain.node, S.grantKey, '']

    say(out, 'busy', `<p>${t('t.chain.revoking', 'Emptying the grant record — one transaction…')}</p>`)
    let hash
    if (onchain.via === 'demo') {
      const signer = createWalletClient({
        account: onchain.account, chain: sepolia, transport: http(RPC) })
      hash = await signer.writeContract({
        address: onchain.resolver, abi: onchain.abi, functionName: 'setText', args, chain: sepolia })
    } else {
      hash = await wallet.writeContract({
        address: onchain.resolver, abi: onchain.abi, functionName: 'setText', args, chain: sepolia })
    }
    await reader.waitForTransactionReceipt({ hash })

    say(out, 'ok', `
      <p class="found">✓ ${t('t.s5.done', 'The grant record is empty.')}</p>
      <dl>
        <dt class="mono">${esc(S.grantKey)}</dt>
        <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(hash)}" target="_blank" rel="noopener noreferrer">${esc(clip(hash, 26))}</a></dd>
      </dl>
      <p class="note">${t('t.s5.short', 'The ciphertext is untouched; the wrapped key is gone. Check the inbox again.')}</p>
      ${S.extra.length ? `<p class="note">${t('t.s5.others', 'The other grants on this name are untouched and still open. Only the record above was emptied.')}</p>` : ''}
      ${why(t('t.why', 'Why this matters'), `
        <p>${t('t.s5.note', 'On chain this is a write that only an address holding the setter role on that name may perform — not our opinion about who may revoke, but the registry’s.')}</p>
        <p>${t('t.s5.honest', 'What this does not do: anyone who already read the secret still knows it. No system can retract knowledge, and one that claims to is selling something.')}</p>`)}`)
    $('revoke').disabled = true
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})


// ─── Re-render on a language switch ────────────────────────────────────────
// The panels on this page are the visitor's own work, so they are not rebuilt
// from scratch — that would throw away what they did. Only the chrome is
// re-translated, by the overlay in the page itself. Text already produced
// keeps the language it was produced in, which is honest and beats blanking
// somebody's decrypted phrase because they wanted to read a heading in French.
window.__nextkeyRerender = () => { if (PAGE === 'send') setMode(S.mode) }

// ═══ The agent-facing surface ══════════════════════════════════════════════
//
// A page an AI-agent can drive is not the same as a page with fewer buttons. Two
// things make the difference, and both are cheap: a prepared state reachable
// from a link, and a result that does not have to be read as prose.
//
// What is deliberately absent is a way to pass the secret itself in the URL.
// A URL is written down in more places than anybody expects — history, server
// logs, referrer headers, the chat message it was pasted into — and a page
// about not leaking secrets should not offer the leak as a convenience.

/** What has happened so far, minus everything private. */
const nkState = () => ({
  mode: S.mode,
  hasSecret: !!S.phrase,
  address: S.address,
  recipient: S.recipient
    ? { kind: S.recipient.local ? 'local' : 'ens', name: S.recipient.local ? null : S.recipient.label,
        publicKey: b64(S.recipient.pk) }
    : null,
  eph: S.eph ? b64(S.eph.pk) : null,
  grantRecord: S.grantKey,
  ackRecord: S.ackKey,
  onchain: onchain ? { name: onchain.name, via: onchain.via, resolver: onchain.resolver } : null,
  opened: S.opened ? { name: S.opened.name } : null,
})

window.NEXTKEY = {
  state: nkState,
  records: { eph: RECORD_EPH, secret: RECORD_SECRET, pubkey: RECORD_PUBKEY },
  version: 2,
}

// ─── Opening state, from the link ──────────────────────────────────────────
// The ID tab has no steps to prepare and no inbox to open into, so none of this
// applies there. It is guarded rather than made tolerant element by element:
// half a prepared state is worse than none, and would be much harder to notice.
if (PAGE === 'send') {
  const q = new URLSearchParams(location.search)
  setMode(modeFromLocation())

  // A claim link: the name to look at, and the key to look with. Both come out
  // of the fragment, which never left the sender's browser for a server and
  // does not leave this one either.
  const frag = new URLSearchParams(location.hash.replace(/^#/, ''))
  const claim = frag.get('claim')
  const claimKey = frag.get('k')
  if (claim && claimKey) {
    try {
      const sk = un64(claimKey)
      if (sk.length !== 32) throw new Error('not a 32-byte key')
      S.recipient = { sk, pk: publicKeyOf(sk), label: null, local: true }
      $('inbox-names').value = claim
      show($('step-open'), true)
      $('check-inbox').disabled = false
      show($('open-remote-note'), false)
      say($('open-out'), '', `<p>${t('t.claim.arrived', 'This link carries a secret and the key that opens it. Press the button to read it — nothing has been sent anywhere.')}</p>`)
      requestAnimationFrame(() => $('step-open').scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } catch {
      say($('open-out'), 'bad', `<p>${t('t.claim.bad', 'That link carries something that is not a key, so there is nothing to open with. Ask whoever sent it for a fresh one.')}</p>`)
    }
  }

  const to = q.get('to')
  if (to) {
    $('ens-name').value = to.trim().toLowerCase()
    // Read their key straight away. An AI-agent that had to press a button after
    // following a prepared link would not have been given a prepared state.
    $('lookup').click()
  }
}
