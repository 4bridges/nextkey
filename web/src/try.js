/**
 * The playground — NextKey with your hands on it.
 *
 * demo.html shows a secret that already exists. This page lets a visitor make
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
import { generateMnemonic, english } from 'viem/accounts'
// The key this page lends to visitors, and the names it may write to. Its own
// file, with the reasoning for publishing a private key at all.
import { DEMO_KEY, POOL, POOL_RESOLVER } from './demo-wallet.js'
// The wrapping rule lives in its own module so that test/interop.mjs can load
// it on its own and check a grant made by the Node construction opens with this
// one. The .mjs extension is for Node's benefit: it imports this exact file, and
// without the extension it warns about guessing the module type.
import {
  b64, un64, randomSecret, publicKeyOf,
  seal, unseal,
  RECORD_EPH, ephMessage, ephSecretFromSignature,
  grantForV2, locateGrantV2, openGrantV2,
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

const say = (el, kind, html) => {
  el.className = `out ${kind}`
  el.innerHTML = html
  el.hidden = false
}

/**
 * Does this page match this bundle?
 *
 * try.html and try.js are deployed as two files, and they can be uploaded
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
const REQUIRED_ELEMENTS = [
  'phrase', 'gen', 'step1-state', 'own-phrase-warn',
  'gen-recipient', 'r-local', 'r-local-out', 'r-ens', 'r-ens-out', 'ens-name', 'lookup',
  'go-store', 'store-out',
  'step-chain', 'confirm-fake', 'write-demo', 'demo-out', 'demo-state',
  'connect', 'wallet-out', 'own-name', 'publish', 'publish-out',
  'step-open', 'open-as', 'open-other', 'open-out', 'open-remote-note',
  'step-revoke', 'revoke', 'revoke-out',
]

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
    throw new Error(`try.html is out of step with try.js — missing: ${missing.join(', ')}`)
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
  phrase: '',
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
}

// ─── Step 1 · the secret ───────────────────────────────────────────────────

const phraseBox = $('phrase')

/**
 * A throwaway phrase, generated properly.
 *
 * It is a valid BIP-39 mnemonic, because an invalid one would let a sceptical
 * judge dismiss the demonstration as a toy. It is also worth nothing and must
 * stay that way: no address is derived from it anywhere in this page, and the
 * warning above the box says what it says for a reason.
 */
$('gen').addEventListener('click', () => {
  phraseBox.value = generateMnemonic(english)
  S.generated = true
  syncPhrase()
  phraseBox.focus()
})

phraseBox.addEventListener('input', () => { S.generated = false; syncPhrase() })

function syncPhrase() {
  S.phrase = phraseBox.value.trim()
  const words = S.phrase ? S.phrase.split(/\s+/).length : 0
  const risky = !S.generated && (words === 12 || words === 15 || words === 18 || words === 24)

  // Typing twelve words that were not generated here is the one moment on this
  // page where a person could hurt themselves. It gets a warning that does not
  // go away, rather than a checkbox they will click past.
  show($('own-phrase-warn'), risky)
  $('step1-state').textContent = S.phrase
    ? (S.generated
        ? t('t.s1.gen', 'Generated here. Worth nothing, and never funded.')
        : t('t.s1.typed', 'Your own text — this page keeps it in memory only.'))
    : ''
  $('go-store').disabled = !S.phrase
}

// ─── Step 2 · the recipient ────────────────────────────────────────────────

const mode = () => document.querySelector('input[name="rmode"]:checked').value

document.querySelectorAll('input[name="rmode"]').forEach((r) =>
  r.addEventListener('change', () => {
    show($('r-local'), mode() === 'local')
    show($('r-ens'), mode() === 'ens')
  }))

/** A recipient who exists only here, so the loop can be finished by anyone. */
$('gen-recipient').addEventListener('click', () => {
  const sk = randomSecret()
  const pk = publicKeyOf(sk)
  S.recipient = { sk, pk, label: t('t.s2.you', 'the recipient (you, in a moment)'), local: true }
  say($('r-local-out'), 'ok', `
    <dl>
      <dt>${t('t.pubkey', 'public key')}</dt><dd class="mono break">${esc(b64(pk))}</dd>
      <dt>${t('t.grantaddr', 'their grant will live at')}</dt>
      <dd class="mono">${t('t.grantaddr.unknown', 'not computable from this key alone — see step 3')}</dd>
    </dl>
    <p class="note">${t('t.s2.localnote', 'This keypair was made in your browser a second ago. The private half never leaves it, and reloading the page destroys it — which is exactly what happens to a real recipient who loses their key.')}</p>`)
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
$('lookup').addEventListener('click', async () => {
  const name = $('ens-name').value.trim().toLowerCase()
  const out = $('r-ens-out')
  if (!name) return
  say(out, 'busy', `<p>${t('t.s2.looking', 'Reading their key from the chain…')}</p>`)
  try {
    const pub = await reader.getEnsText({ name, key: RECORD_PUBKEY })
    if (!pub) {
      S.recipient = null
      return say(out, 'bad', `
        <p>${t('t.s2.nokey', 'That name publishes no nextkey.pubkey record, so there is nothing to encrypt to.')}</p>
        <p class="note">${t('t.s2.nokeynote', 'Try anna.nextkey.eth or bob.nextkey.eth, or publish a key on a name of your own and come back.')}</p>`)
    }
    const pk = un64(pub)
    if (pk.length !== 32) throw new Error(`expected a 32-byte key, got ${pk.length}`)
    S.recipient = { pk, label: name, local: false }
    say(out, 'ok', `
      <dl>
        <dt>${t('t.name', 'name')}</dt><dd class="mono">${esc(name)}</dd>
        <dt>${t('t.pubkey', 'published key')}</dt><dd class="mono break">${esc(pub)}</dd>
        <dt>${t('t.grantaddr', 'their grant will live at')}</dt>
        <dd class="mono">${t('t.grantaddr.unknown', 'not computable from this key alone — see step 3')}</dd>
      </dl>
      <p class="note">${t('t.s2.ensnote', 'Read live from the hackathon deployment. They never registered with NextKey and were not asked for permission — publishing a key is the whole of the opt-in.')}</p>
      <p class="note">${t('t.s2.addrnote', 'Note what is missing: the record their grant will occupy. Everything on this line is public, and from public values alone that address cannot be worked out — not by this page, and not by anyone watching the chain. It takes one of the two private keys, which is why the next step is where it appears.')}</p>`)
  } catch (e) {
    S.recipient = null
    say(out, 'bad', `<p>${t('t.chainfail', 'Could not read that from the chain.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  }
  refreshReady()
})

function refreshReady() {
  $('go-store').disabled = !(S.phrase && S.recipient)
}

// ─── Step 3 · encrypt and grant ────────────────────────────────────────────

$('go-store').addEventListener('click', async () => {
  const out = $('store-out')
  try {
    S.contentKey = crypto.getRandomValues(new Uint8Array(32))
    S.owner = S.owner ?? (() => { const sk = randomSecret(); return { sk, pk: publicKeyOf(sk) } })()

    // One ephemeral pair for the whole secret. Random here because these steps
    // ask for no wallet; step 6 derives one instead, and says so when it does.
    S.eph = (() => { const sk = randomSecret(); return { sk, pk: publicKeyOf(sk) } })()

    S.sealed = { v: 1, alg: 'A256GCM', ...(await seal(S.contentKey, S.phrase)) }
    const g = await grantForV2(S.contentKey, S.eph.sk, S.recipient.pk)
    S.grant = g.value
    S.grantKey = g.key

    say(out, 'ok', `
      <p class="found">✓ ${t('t.s3.done', 'Encrypted, and granted to one recipient.')}</p>
      <p class="reclabel"><span class="mono">${esc(RECORD_EPH)}</span> — ${t('t.s3.rec0', 'one ephemeral public key for this secret, written once')}</p>
      <pre class="mono">${esc(b64(S.eph.pk))}</pre>
      <p class="reclabel"><span class="mono">${esc(RECORD_SECRET)}</span> — ${t('t.s3.rec1', 'the ciphertext, public by design')}</p>
      <pre class="mono">${esc(JSON.stringify(S.sealed, null, 2))}</pre>
      <p class="reclabel"><span class="mono">${esc(S.grantKey)}</span> — ${t('t.s3.rec2', 'the content key, wrapped so only they can unwrap it')}</p>
      <pre class="mono">${esc(JSON.stringify(S.grant, null, 2))}</pre>
      <p class="note">${t('t.s3.note', 'Three records, all readable by anyone. The ciphertext is AES-256-GCM under a key that now exists only in this tab. The grant holds that key, wrapped so that only the recipient can unwrap it.')}</p>
      <p class="note">${t('t.s3.addrnote', 'The interesting one is the middle line — the name of that third record. It is not a hash of the recipient’s public key, which anybody could compute; it comes out of the shared secret between the ephemeral key and theirs. Only two parties can work it out: the recipient, and whoever holds the ephemeral private key. An observer holding every public value in this page cannot say whether this secret grants to anyone in particular, or even test a guess.')}</p>
      <p class="note">${t('t.s3.ephnote', 'One ephemeral pair serves the whole secret, not one per recipient: each recipient’s ECDH lands somewhere else, so a second grant shares no key material with this one. Replacing that pair later would move every grant on the name at once, which is why a name publishes it once and never again.')}</p>`)

    // Only the chain step opens here. Opening and revoking now run against
    // real records, so they have nothing to act on until something is written.
    show($('step-chain'), true)
    $('publish-out').hidden = true
    $('step-chain').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

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
    const taken = await Promise.all(batch.map((n) =>
      reader.getEnsText({ name: n, key: RECORD_EPH }).catch(() => 'unreadable')))
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
const wroteIt = (out, name, hashes, moved, extra = '') => {
  show($('step-open'), true)
  show($('step-revoke'), true)
  $('open-out').hidden = true
  $('revoke-out').hidden = true
  $('open-as').disabled = !S.recipient.local
  show($('open-remote-note'), !S.recipient.local)

  say(out, 'ok', `
    <p class="found">✓ ${t('t.chain.done', 'Written. Those records are on Sepolia now.')}</p>
    <dl>
      <dt>${t('t.chain.name', 'the name')}</dt><dd class="mono break">${esc(name)}</dd>
      ${hashes.map(([k, h]) => `
      <dt class="mono">${esc(k)}</dt>
      <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(h)}" rel="noopener">${esc(clip(h, 26))}</a></dd>`).join('')}
    </dl>
    ${extra}
    ${moved === S.grantKey ? '' : `
    <p class="note">${t('t.s6.moved', 'The grant moved. Step 3 used a throwaway ephemeral key, because it asked you for no wallet; what went on chain uses one derived from the signature you just gave, so it outlives this tab. The address changed with it, because the address comes out of that key.')}</p>
    <dl>
      <dt>${t('t.s6.movedfrom', 'shown in step 3')}</dt><dd class="mono break">${esc(moved)}</dd>
      <dt>${t('t.s6.movedto', 'written on chain')}</dt><dd class="mono break">${esc(S.grantKey)}</dd>
    </dl>`}
    <p class="note">${t('t.s6.explorernote', 'In the explorer this name now looks uninformative: an ephemeral key, a ciphertext, and one record whose name says nothing. That is the design working. To check it from the outside, open it with the command-line tool.')}</p>
    <p class="note"><a href="https://hackathon-deployment-portal-app.ens-cf.workers.dev/" rel="noopener">${t('t.s6.explorer', 'See them in the ENS explorer')}</a></p>`)

  // After a frame, so the two newly revealed sections are laid out before the
  // browser is asked to scroll to one of them.
  requestAnimationFrame(() =>
    $('step-open').scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

// ─── Lane one · no wallet ──────────────────────────────────────────────────

const demoAccount = () => privateKeyToAccount(hexOf(un64(DEMO_KEY)))

$('confirm-fake').addEventListener('change', () => {
  const ready = $('confirm-fake').checked
  // `onchain` means something has already been written. Unticking and reticking
  // the box must not hand back a button that would spend a second name.
  $('write-demo').disabled = !ready || !!onchain
  $('publish').disabled = !(wallet && ready) || !!onchain
})

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

$('write-demo').addEventListener('click', async () => {
  if (writing) return
  if (!$('confirm-fake').checked) return say(demoOut, 'bad', `
    <p>${t('t.s6.needconfirm', 'Confirm first that the phrase guards nothing.')}</p>`)
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
      <p class="note">${t('t.chain.borrowed', 'This name is ours and we lent it to you, along with the gas. The key that signed those three transactions is published in this page: it owns nothing, and its only power is writing records on names set aside for exactly this. You can read it, and so can anyone.')}</p>`)
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

const offerDeepLinks = () => say(walletOut, 'bad', `
  <p>${t('t.s6.mobile', 'This browser carries no wallet — mobile browsers cannot. Open this page inside your wallet’s own browser instead:')}</p>
  <p>${WALLET_LINKS.map((w) =>
    `<a class="act" href="${esc(w.href(hereFor()))}" rel="noopener">${esc(w.name)}</a>`).join(' ')}</p>
  <p class="note">${t('t.s6.mobilenote', 'The page starts again from step 1 there, because steps 1 to 5 happen entirely inside a tab and nothing was stored to carry across. That is the same property that makes them safe.')}</p>
  <p class="note">${t('t.chain.orlend', 'Or use the lane above, which needs no wallet at all.')}</p>
  <p class="note">${t('t.s6.otherwallets', 'Another wallet? Open its browser and paste this address:')}</p>
  <p class="note mono break">${esc(hereFor())}</p>`)

const offerChoice = () => say(walletOut, '', `
  <p>${t('t.s6.choose', 'More than one wallet is installed here. Which should sign?')}</p>
  <p>${announced.map((p, i) =>
    `<button class="act" type="button" data-wallet="${i}">${esc(p.info.name)}</button>`).join(' ')}</p>
  <p class="note">${t('t.s6.choosenote', 'Listed by the wallets themselves, through the announcement they each make to the page. Nothing here knows which wallets exist in the world — only which ones spoke up in this browser.')}</p>`)

$('connect').addEventListener('click', async () => {
  if (!announced.length && !window.ethereum) return offerDeepLinks()
  if (announced.length > 1) return offerChoice()
  await connectWith(announced[0]?.provider ?? window.ethereum)
})

walletOut.addEventListener('click', (e) => {
  const pick = e.target.closest('[data-wallet]')
  if (pick) connectWith(announced[Number(pick.dataset.wallet)].provider)
})

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
        <a href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia" rel="noopener">Google Cloud</a> ·
        <a href="https://faucet.quicknode.com/ethereum/sepolia" rel="noopener">QuickNode</a>
      </p>` : ''}`)
    $('publish').disabled = !$('confirm-fake').checked
  } catch (e) {
    say(walletOut, 'bad', `<p>${esc(plain(e))}</p>`)
  }
}

$('publish').addEventListener('click', async () => {
  if (writing) return
  const name = $('own-name').value.trim().toLowerCase()

  if (!$('confirm-fake').checked) return say(chainOut, 'bad', `
    <p>${t('t.s6.needconfirm', 'Confirm first that the phrase guards nothing.')}</p>`)
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
      <p class="note">${t('t.s6.donenote', 'Nothing about those records mentions NextKey as a service, and no server of ours knows they exist. The recipient can open them with the command-line tool; we could not, and neither could anyone who takes this site down.')}</p>`)
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
    $('publish').disabled = !$('confirm-fake').checked
  } finally {
    writing = false
  }
})

// ═══ Step 5 · open it, from the chain ══════════════════════════════════════
//
// The difference from a page that stops at step 3: nothing below reads this
// tab's memory. The ephemeral key, the ciphertext and the grant are fetched
// from ENS, and the recipient works out *which record to fetch* herself, from
// one public value and her own private key. Nobody sends her an address.

const fromChain = async (key) => reader.getEnsText({ name: onchain.name, key })

$('open-as').addEventListener('click', async () => {
  const out = $('open-out')
  try {
    say(out, 'busy', `<p>${t('t.chain.reading', 'Reading it back off the chain…')}</p>`)
    const ephB64 = await fromChain(RECORD_EPH)
    if (!ephB64) throw new Error(`${onchain.name} publishes no ${RECORD_EPH}`)
    const ephPk = un64(ephB64)

    const found = locateGrantV2(ephPk, S.recipient.sk, S.recipient.pk)
    const [grantJson, sealedJson] = await Promise.all([
      fromChain(found.key), fromChain(RECORD_SECRET)])

    if (!grantJson) return say(out, 'bad', `
      <p>${t('t.chain.norecord', 'That record is empty on chain — access was never given, or it was revoked.')}</p>
      <dl><dt>${t('t.s4.derived', 'she worked out the record herself')}</dt>
        <dd class="mono break">${esc(found.key)}</dd></dl>
      <p class="note">${t('t.chain.norecordnote', 'Note what she learns from an empty record: nothing. Not that a grant was withdrawn, not that one ever existed. The ciphertext is still there and still unreadable.')}</p>`)

    const contentKey = await openGrantV2(JSON.parse(grantJson), ephPk, S.recipient.sk, S.recipient.pk)
    const text = await unseal(JSON.parse(sealedJson), contentKey)

    say(out, 'ok', `
      <p class="found">✓ ${t('t.s4.ok', 'Opened.')}</p>
      <dl>
        <dt>${t('t.s4.derived', 'she worked out the record herself')}</dt>
        <dd class="mono break">${esc(found.key)}</dd>
      </dl>
      <pre class="mono reveal">${esc(text)}</pre>
      <p class="note">${t('t.chain.oknote', 'All three records came off the chain, where they are public and were public the whole time. What made this work is a private key that was never published, never uploaded, and never left this tab.')}</p>
      <p class="note">${t('t.s4.locnote', 'Nobody told her where to look. She read one public value off the name and derived that address from it with her own key — the same arithmetic that unwraps the content key, done once. A hardware wallet is therefore asked to approve once, not twice.')}</p>`)
  } catch (e) {
    say(out, 'bad', `<p>${t('t.s4.fail', 'Could not open it.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
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
$('open-other').addEventListener('click', async () => {
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
      <p class="note">${t('t.chain.strangernote', 'She read the same public ephemeral key the recipient did, ran the same derivation, and arrived somewhere else — an address that holds nothing. She cannot tell whether this secret is shared with anybody at all, and there is no query that would tell her.')}</p>
      <p class="note">${t('t.s4.refusednote', 'That failure is arithmetic, not policy. A different private key derives a different wrapping key, and AES-GCM will not decrypt under it. There is no rule anywhere in this page that could be edited to change the outcome.')}</p>`)
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

// ═══ Step 6 · take it back, on the chain ═══════════════════════════════════

$('revoke').addEventListener('click', async () => {
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
        <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(hash)}" rel="noopener">${esc(clip(hash, 26))}</a></dd>
      </dl>
      <p class="note">${t('t.s5.note', 'The ciphertext is untouched; the wrapped key is gone, so the recipient has nothing left to unwrap. Try opening it again above. On chain this is a write that only an address holding the setter role on that name may perform — not our opinion about who may revoke, but the registry’s.')}</p>
      <p class="note">${t('t.s5.honest', 'What this does not do: anyone who already read the secret still knows it. No system can retract knowledge, and one that claims to is selling something.')}</p>`)
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
window.__nextkeyRerender = () => { syncPhrase() }

syncPhrase()
show($('r-local'), true)
