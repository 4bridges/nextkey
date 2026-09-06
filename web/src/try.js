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
 * Step 6 is the only part that touches the chain with a signature, and it is
 * optional. It writes to a name the visitor owns — not to ours — because a
 * system that only works on the author's own name has not been shown to work.
 */

import { createPublicClient, createWalletClient, custom, http, toHex } from 'viem'
import { packetToBytes } from 'viem/ens'
import { sepolia } from 'viem/chains'
import { generateMnemonic, english } from 'viem/accounts'
// The wrapping rule lives in its own module so that test/interop.mjs can load
// it on its own and check a grant made by the Node construction opens with this
// one. The .mjs extension is for Node's benefit: it imports this exact file, and
// without the extension it warns about guessing the module type.
import {
  b64, un64, grantKeyFor, randomSecret, publicKeyOf,
  seal, unseal, grantFor, openGrant,
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

const resolverAbi = [{
  name: 'setText', type: 'function', stateMutability: 'nonpayable',
  inputs: [{ name: 'name', type: 'bytes' }, { name: 'key', type: 'string' }, { name: 'value', type: 'string' }],
  outputs: [],
}]

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
  grant: null,        // the grant object, or null once revoked
  grantKey: null,
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
      <dt>${t('t.grantaddr', 'their grant will live at')}</dt><dd class="mono">${esc(grantKeyFor(pk))}</dd>
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
        <dt>${t('t.grantaddr', 'their grant will live at')}</dt><dd class="mono">${esc(grantKeyFor(pk))}</dd>
      </dl>
      <p class="note">${t('t.s2.ensnote', 'Read live from the hackathon deployment. They never registered with NextKey and were not asked for permission — publishing a key is the whole of the opt-in.')}</p>`)
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

    S.sealed = { v: 1, alg: 'A256GCM', ...(await seal(S.contentKey, S.phrase)) }
    S.grant = await grantFor(S.contentKey, S.recipient.pk, S.recipient.label)
    S.grantKey = grantKeyFor(S.recipient.pk)

    say(out, 'ok', `
      <p class="found">✓ ${t('t.s3.done', 'Encrypted, and granted to one recipient.')}</p>
      <p class="reclabel"><span class="mono">${esc(RECORD_SECRET)}</span> — ${t('t.s3.rec1', 'the ciphertext, public by design')}</p>
      <pre class="mono">${esc(JSON.stringify(S.sealed, null, 2))}</pre>
      <p class="reclabel"><span class="mono">${esc(S.grantKey)}</span> — ${t('t.s3.rec2', 'the content key, wrapped so only they can unwrap it')}</p>
      <pre class="mono">${esc(JSON.stringify(S.grant, null, 2))}</pre>
      <p class="note">${t('t.s3.note', 'Two records, both readable by anyone. The first is AES-256-GCM under a key that now exists only in this tab. The second holds that key wrapped to the recipient — an ephemeral X25519 keypair was made for this grant alone, so a second grant over the same secret would share no key material with it.')}</p>`)

    show($('step4'), true)
    show($('step5'), true)
    show($('step6'), true)
    $('open-out').hidden = true
    $('revoke-out').hidden = true
    $('open-as').disabled = !S.recipient.local
    show($('open-remote-note'), !S.recipient.local)
    $('step4').scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e) {
    say(out, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

// ─── Step 4 · open it ──────────────────────────────────────────────────────

$('open-as').addEventListener('click', async () => {
  const out = $('open-out')
  try {
    if (!S.grant) throw new Error('revoked')
    const key = await openGrant(S.grant, S.recipient.sk, S.recipient.pk)
    const text = await unseal(S.sealed, key)
    say(out, 'ok', `
      <p class="found">✓ ${t('t.s4.ok', 'Opened.')}</p>
      <pre class="mono reveal">${esc(text)}</pre>
      <p class="note">${t('t.s4.oknote', 'The ciphertext and the grant were both public the whole time. What made this work was a private key that was never published, never uploaded and never left this tab.')}</p>`)
  } catch (e) {
    say(out, 'bad', `<p>${t('t.s4.fail', 'Could not open it.')}</p>
                     <p class="note mono">${esc(plain(e))}</p>`)
  }
})

/**
 * The same attempt by somebody else.
 *
 * A fresh keypair, an honest attempt at the same grant, and a failure that is
 * produced by the arithmetic rather than by an `if` statement in this file.
 * Every demo of an access-control system should include the case where access
 * is refused, or it has shown only that the happy path was coded.
 */
$('open-other').addEventListener('click', async () => {
  const out = $('open-out')
  const sk = randomSecret()
  const pk = publicKeyOf(sk)
  try {
    if (!S.grant) throw new Error('revoked')
    const key = await openGrant(S.grant, sk, pk)
    await unseal(S.sealed, key)
    say(out, 'bad', `<p>${t('t.s4.wrong', 'Something is very wrong — a stranger opened it. Please tell us.')}</p>`)
  } catch (e) {
    say(out, 'ok', `
      <p class="found">✓ ${t('t.s4.refused', 'Refused, as it should be.')}</p>
      <p class="note mono">${esc(plain(e))}</p>
      <p class="note">${t('t.s4.refusednote', 'That failure is arithmetic, not policy. A different private key derives a different wrapping key, and AES-GCM will not decrypt under it. There is no rule anywhere in this page that could be edited to change the outcome.')}</p>`)
  }
})

// ─── Step 5 · revoke ───────────────────────────────────────────────────────

$('revoke').addEventListener('click', () => {
  S.grant = null
  say($('revoke-out'), 'ok', `
    <p class="found">✓ ${t('t.s5.done', 'The grant record is empty.')}</p>
    <p class="note">${t('t.s5.note', 'The ciphertext is untouched; the wrapped key is gone, so the recipient has nothing left to unwrap. Try opening it again above. On chain this is a write that only an address holding the setter role on that name may perform — not our opinion about who may revoke, but the registry’s.')}</p>
    <p class="note">${t('t.s5.honest', 'What this does not do: anyone who already read the secret still knows it. No system can retract knowledge, and one that claims to is selling something.')}</p>`)
})

// ─── Step 6 · on chain, on a name you own ──────────────────────────────────

let wallet = null
let account = null

const walletOut = $('wallet-out')

$('connect').addEventListener('click', async () => {
  const eth = window.ethereum
  if (!eth) return say(walletOut, 'bad', `
    <p>${t('t.s6.nowallet', 'No injected wallet found in this browser.')}</p>
    <p class="note">${t('t.s6.nowalletnote', 'Steps 1 to 5 need no wallet at all — this last step is the optional one. With a wallet, use a browser where one is installed and unlocked.')}</p>`)
  try {
    const [addr] = await eth.request({ method: 'eth_requestAccounts' })
    account = addr
    // Sepolia, or the write goes to a chain where none of this exists.
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xaa36a7' }] })
    } catch { /* the wallet may already be there, or may refuse; checked below */ }
    const chainId = await eth.request({ method: 'eth_chainId' })
    if (parseInt(chainId, 16) !== 11155111) return say(walletOut, 'bad', `
      <p>${t('t.s6.wrongchain', 'That wallet is not on Sepolia.')}</p>
      <p class="note">${t('t.s6.wrongchainnote', 'The hackathon ENS deployment lives on Sepolia. Switch the network and connect again.')}</p>`)

    wallet = createWalletClient({ account: addr, chain: sepolia, transport: custom(eth) })
    say(walletOut, 'ok', `<dl><dt>${t('t.s6.connected', 'connected')}</dt>
      <dd class="mono break">${esc(addr)}</dd></dl>`)
    $('publish').disabled = false
  } catch (e) {
    say(walletOut, 'bad', `<p>${esc(plain(e))}</p>`)
  }
})

$('confirm-fake').addEventListener('change', () => {
  $('publish').disabled = !(wallet && $('confirm-fake').checked)
})

$('publish').addEventListener('click', async () => {
  const out = $('publish-out')
  const name = $('own-name').value.trim().toLowerCase()

  // The one hard refusal on this page. A visitor who has typed their real seed
  // phrase and reached this button is one signature away from publishing it,
  // encrypted, on a public chain forever — and "encrypted" is doing more work
  // in that sentence than anybody should be comfortable with.
  if (!$('confirm-fake').checked) return say(out, 'bad', `
    <p>${t('t.s6.needconfirm', 'Confirm first that the phrase guards nothing.')}</p>`)
  if (!name) return say(out, 'bad', `<p>${t('t.s6.needname', 'Enter a name you own.')}</p>`)
  if (!S.sealed || !S.grant) return say(out, 'bad', `
    <p>${t('t.s6.needsecret', 'Do steps 1 to 3 first — there is nothing to write yet.')}</p>`)

  try {
    say(out, 'busy', `<p>${t('t.s6.finding', 'Finding the resolver for that name…')}</p>`)
    const resolver = await reader.getEnsResolver({ name })
    const dns = toHex(packetToBytes(name))

    // Simulate before signing. A revert costs nothing here and arrives with a
    // reason; the same revert after signing costs gas and arrives as a hash.
    say(out, 'busy', `<p>${t('t.s6.simulating', 'Checking the write would succeed, before asking you to sign…')}</p>`)
    for (const [key, value] of [
      [RECORD_SECRET, JSON.stringify(S.sealed)],
      [S.grantKey, JSON.stringify(S.grant)],
    ]) {
      await reader.simulateContract({
        address: resolver, abi: resolverAbi, functionName: 'setText',
        args: [dns, key, value], account,
      })
    }

    const hashes = []
    for (const [key, value] of [
      [RECORD_SECRET, JSON.stringify(S.sealed)],
      [S.grantKey, JSON.stringify(S.grant)],
    ]) {
      say(out, 'busy', `<p>${t('t.s6.signing', 'Approve in your wallet —')} <span class="mono">${esc(key)}</span></p>`)
      const hash = await wallet.writeContract({
        address: resolver, abi: resolverAbi, functionName: 'setText',
        args: [dns, key, value], chain: sepolia,
      })
      hashes.push([key, hash])
      await reader.waitForTransactionReceipt({ hash })
    }

    say(out, 'ok', `
      <p class="found">✓ ${t('t.s6.done', 'Written. Those records are now on Sepolia, under your name, owned by you.')}</p>
      <dl>${hashes.map(([k, h]) => `
        <dt class="mono">${esc(k)}</dt>
        <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(h)}" rel="noopener">${esc(clip(h, 26))}</a></dd>`).join('')}
      </dl>
      <p class="note">${t('t.s6.donenote', 'Nothing about those records mentions NextKey as a service, and no server of ours knows they exist. The recipient can open them with the command-line tool; we could not, and neither could anyone who takes this site down.')}</p>
      <p class="note"><a href="https://hackathon-deployment-portal-app.ens-cf.workers.dev/" rel="noopener">${t('t.s6.explorer', 'See them in the ENS explorer')}</a></p>`)
  } catch (e) {
    // The likely refusals are worth naming, because "execution reverted" tells
    // a visitor nothing about which of the two plausible causes it was.
    say(out, 'bad', `
      <p>${t('t.s6.fail', 'That did not go through.')}</p>
      <p class="note mono">${esc(plain(e))}</p>
      <p class="note">${t('t.s6.failnote', 'The usual causes, in order: the name is not yours, so the resolver refuses the write; the name has no resolver attached yet; or the wallet has no Sepolia ether for gas. The first is the system working.')}</p>`)
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
