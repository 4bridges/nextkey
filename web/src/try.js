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

import { createPublicClient, createWalletClient, custom, http, toHex, namehash } from 'viem'
import { packetToBytes } from 'viem/ens'
import { sepolia } from 'viem/chains'
import { generateMnemonic, english } from 'viem/accounts'
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
   * In steps 1 to 5 it is drawn at random, because those steps ask for no
   * wallet and there is nothing to derive from. Step 6 replaces it with one
   * derived from a signature, so that the key survives this tab. See there.
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

    // The recipient's side in full. She is told nothing except the name; the
    // ephemeral key is public on it, and one scalar multiplication gives her
    // both the record to read and the key to open it. Showing the address she
    // arrives at, next to the one the owner wrote, is the point of this panel:
    // nobody sent it to her.
    const found = locateGrantV2(S.eph.pk, S.recipient.sk, S.recipient.pk)
    const key = await openGrantV2(S.grant, S.eph.pk, S.recipient.sk, S.recipient.pk)
    const text = await unseal(S.sealed, key)
    say(out, 'ok', `
      <p class="found">✓ ${t('t.s4.ok', 'Opened.')}</p>
      <dl>
        <dt>${t('t.s4.derived', 'she worked out the record herself')}</dt>
        <dd class="mono break">${esc(found.key)}</dd>
      </dl>
      <pre class="mono reveal">${esc(text)}</pre>
      <p class="note">${t('t.s4.oknote', 'The ciphertext and the grant were both public the whole time. What made this work was a private key that was never published, never uploaded and never left this tab.')}</p>
      <p class="note">${t('t.s4.locnote', 'Nobody told her where to look. She read one public value off the name and derived that address from it with her own key — the same arithmetic that unwraps the content key, done once. A hardware wallet is therefore asked to approve once, not twice.')}</p>`)
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

    // The stranger fails twice over, and the first failure is the new one: with
    // the name's ephemeral key in hand — it is public, she can just read it —
    // she still arrives at a record that does not exist. She never gets as far
    // as being refused a decryption.
    const key = await openGrantV2(S.grant, S.eph.pk, sk, pk)
    await unseal(S.sealed, key)
    say(out, 'bad', `<p>${t('t.s4.wrong', 'Something is very wrong — a stranger opened it. Please tell us.')}</p>`)
  } catch (e) {
    const looked = locateGrantV2(S.eph.pk, sk, pk)
    say(out, 'ok', `
      <p class="found">✓ ${t('t.s4.refused', 'Refused, as it should be.')}</p>
      <dl>
        <dt>${t('t.s4.wherelooked', 'the record she computed')}</dt>
        <dd class="mono break">${esc(looked.key)}</dd>
        <dt>${t('t.s4.whereis', 'where the grant actually is')}</dt>
        <dd class="mono break">${esc(S.grantKey)}</dd>
      </dl>
      <p class="note">${t('t.s4.notfoundnote', 'She read the same public ephemeral key the recipient did, ran the same derivation, and arrived somewhere else. On chain that record is empty, so she learns nothing at all — not even that a grant exists. This page hands her the grant anyway, so that the second failure can be shown too:')}</p>
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
  // Two different situations that a single check would report as one. Revoking
  // in step 5 clears the grant, and telling somebody who has just done that to
  // "do steps 1 to 3 first" is both wrong and confusing — they did.
  if (!S.sealed) return say(out, 'bad', `
    <p>${t('t.s6.needsecret', 'Do steps 1 to 3 first — there is nothing to write yet.')}</p>`)
  if (!S.grant) return say(out, 'bad', `
    <p>${t('t.s6.revoked', 'You revoked the grant in step 5, so there is nothing left to write but a ciphertext nobody can open.')}</p>
    <p class="note">${t('t.s6.revokednote', 'Press "Encrypt and grant" in step 3 again to make a fresh one. Writing the ciphertext alone would be a working demonstration of losing a secret.')}</p>`)

  try {
    say(out, 'busy', `<p>${t('t.s6.finding', 'Finding the resolver for that name…')}</p>`)
    const resolver = await reader.getEnsResolver({ name })

    /**
     * The throwaway ephemeral key becomes a real one.
     *
     * Steps 1 to 5 drew it at random, because they asked for no wallet — and a
     * random key that exists only in this tab would strand the name the moment
     * the tab closed: no second recipient could ever be added, because nobody
     * could compute where their grant belongs.
     *
     * So it is derived instead, from a signature over a fixed message. Ethereum
     * signing is deterministic (RFC 6979), so the same wallet over the same
     * message returns the same bytes on any machine, next week or next year.
     * Nothing is stored anywhere. The command-line tool additionally writes the
     * key wrapped to an identity file (nextkey.eph.sealed), so that opening
     * needs no signature; a browser has no such file, and pretending otherwise
     * would mean inventing a key nobody could reproduce.
     *
     * This changes the grant's address, because the address comes out of the
     * ECDH. The panel says so rather than quietly writing something other than
     * what step 3 displayed.
     */
    say(out, 'busy', `<p>${t('t.s6.deriving', 'Sign the derivation message — it is not a transaction and moves nothing…')}</p>`)
    const signature = await wallet.signMessage({ account, message: ephMessage(name) })
    const ephSk = ephSecretFromSignature(signature, name)
    const ephPk = publicKeyOf(ephSk)

    // A name publishes its ephemeral key once. Overwriting a different one
    // would move every grant already on the name to a new address at once and
    // leave the old records unreadable and unfindable — so this stops instead.
    say(out, 'busy', `<p>${t('t.s6.checkingeph', 'Checking whether this name already has an ephemeral key…')}</p>`)
    const already = await reader.getEnsText({ name, key: RECORD_EPH })
    if (already && already !== b64(ephPk)) {
      const err = new Error(t('t.s6.ephclash',
        'This name already publishes a different nextkey.eph. Overwriting it would move every grant on the name to a new address and leave the existing ones unreadable, so nothing was written. Use another name.'))
      err.ephClash = true
      throw err
    }

    const changed = S.grantKey
    const regrant = await grantForV2(S.contentKey, ephSk, S.recipient.pk)
    S.eph = { sk: ephSk, pk: ephPk }
    S.grant = regrant.value
    S.grantKey = regrant.key

    const records = [
      ...(already ? [] : [[RECORD_EPH, b64(ephPk)]]),
      [RECORD_SECRET, JSON.stringify(S.sealed)],
      [S.grantKey, JSON.stringify(S.grant)],
    ]

    // Which dialect does this resolver speak? Ask it, by simulating the first
    // real write in each shape. A refusal for lack of permission and a refusal
    // for a missing function look alike, so both failures are kept: if neither
    // shape works, the visitor sees both reasons rather than the last one.
    say(out, 'busy', `<p>${t('t.s6.simulating', 'Checking the write would succeed, before asking you to sign…')}</p>`)
    let shape = null
    const refusals = []
    for (const candidate of SHAPES) {
      try {
        await reader.simulateContract({
          address: resolver, abi: candidate.abi, functionName: 'setText',
          args: [candidate.arg(name), ...records[0]], account,
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
    for (const record of records.slice(1)) {
      await reader.simulateContract({
        address: resolver, abi: shape.abi, functionName: 'setText',
        args: [node, ...record], account,
      })
    }

    const hashes = []
    for (const [key, value] of records) {
      say(out, 'busy', `<p>${t('t.s6.signing', 'Approve in your wallet —')} <span class="mono">${esc(key)}</span></p>`)
      const hash = await wallet.writeContract({
        address: resolver, abi: shape.abi, functionName: 'setText',
        args: [node, key, value], chain: sepolia,
      })
      hashes.push([key, hash])
      await reader.waitForTransactionReceipt({ hash })
    }

    say(out, 'ok', `
      <p class="found">✓ ${t('t.s6.done', 'Written. Those records are now on Sepolia, under your name, owned by you.')}</p>
      <dl>
        <dt>${t('t.s6.resolver', 'resolver')}</dt><dd class="mono break">${esc(resolver)}</dd>
        ${hashes.map(([k, h]) => `
        <dt class="mono">${esc(k)}</dt>
        <dd class="mono break"><a href="https://sepolia.etherscan.io/tx/${esc(h)}" rel="noopener">${esc(clip(h, 26))}</a></dd>`).join('')}
      </dl>
      <p class="note">${t('t.s6.donenote', 'Nothing about those records mentions NextKey as a service, and no server of ours knows they exist. The recipient can open them with the command-line tool; we could not, and neither could anyone who takes this site down.')}</p>
      ${changed === S.grantKey ? '' : `
      <p class="note">${t('t.s6.moved', 'The grant moved. Step 3 used a throwaway ephemeral key, because it asked you for no wallet; what went on chain uses one derived from the signature you just gave, so it outlives this tab. The address changed with it, because the address comes out of that key.')}</p>
      <dl>
        <dt>${t('t.s6.movedfrom', 'shown in step 3')}</dt><dd class="mono break">${esc(changed)}</dd>
        <dt>${t('t.s6.movedto', 'written on chain')}</dt><dd class="mono break">${esc(S.grantKey)}</dd>
      </dl>
      <p class="note">${t('t.s6.recovernote', 'To add a second recipient later, sign that same message again — the same wallet returns the same signature and therefore the same key. Nothing was stored to make that work, and nothing needs to be backed up.')}</p>`}
      <p class="note">${t('t.s6.explorernote', 'In the explorer this name now looks uninformative: an ephemeral key, a ciphertext, and one record whose name says nothing. That is the design working. To check it from the outside, open it with the command-line tool.')}</p>
      <p class="note"><a href="https://hackathon-deployment-portal-app.ens-cf.workers.dev/" rel="noopener">${t('t.s6.explorer', 'See them in the ENS explorer')}</a></p>`)
  } catch (e) {
    // The likely refusals are worth naming, because "execution reverted" tells
    // a visitor nothing about which of the two plausible causes it was.
    say(out, 'bad', `
      <p>${t('t.s6.fail', 'That did not go through.')}</p>
      <p class="note mono">${esc(plain(e))}</p>
      <p class="note">${e.ephClash
        ? t('t.s6.ephclashnote', 'Nothing was written, and nothing was lost. A name carries one ephemeral key for its whole life precisely so that this cannot happen by accident.')
        : e.bothShapesRefused
        ? t('t.s6.failboth', 'Both setText signatures were refused, and the two reasons are above. If the name is not yours, that is the system working. If it is yours, its resolver may be one this page does not know how to write to — tell us which resolver, and it can be added.')
        : t('t.s6.failnote', 'The usual causes, in order: the name is not yours, so the resolver refuses the write; the name has no resolver attached yet; or the wallet has no Sepolia ether for gas. The first is the system working.')}</p>`)
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
