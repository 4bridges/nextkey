/**
 * The live view.
 *
 * Every value on this page is read from Sepolia when the page loads. Nothing is
 * cached, hard-coded or replayed — which is the only reason a page like this is
 * worth more than a screenshot. If the chain is unreachable, each panel says so
 * rather than showing an empty box, because a blank field and a failed request
 * look identical to a reader and only one of them is honest.
 *
 * Read-only throughout. No wallet, no signing, no backend.
 */

import { createPublicClient, http, keccak256, stringToHex } from 'viem'
import { sepolia } from 'viem/chains'

// The hackathon deployment's Universal Resolver. viem ships its own Sepolia
// address, and forgetting to override it fails silently by resolving against
// production — so this is the first thing the page sets and the last thing it
// would ever guess at.
const UNIVERSAL_RESOLVER = '0xd26f2040d083af1cd2962ba303f4bea0c4faf142'
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com'

const PARENT = 'nextkey.eth'
const SECRET_NAME = `visa.${PARENT}`
const RECIPIENT_NAME = `anna.${PARENT}`
/** A second recipient, whose private key lives on a Ledger and nowhere else.
 *  Nothing about reading this page differs — which is the point being made. */
const DEVICE_NAME = `bob.${PARENT}`
const AGENT_NAME = `agent.${PARENT}`

/**
 * A name on the second scheme, for the panel that shows what changed.
 *
 * Everything above reads visa.nextkey.eth, which addresses its grants the way
 * the first version did: `nextkey.grant.<sha256 of the recipient's public
 * key>`. This one does not, and the panel demonstrates that by running the
 * identical code against it and coming up empty.
 */
const V2_NAME = `vault.${PARENT}`
const RECORD_EPH = 'nextkey.eph'

/** The owner's grant. Their public key is not published, so unlike Anna's this
 *  fingerprint cannot be derived in the browser and is named directly. */
const OWNER_GRANT_KEY = 'nextkey.grant.ec3732779f96c87e'

/** What the enclave returned in evidence/cre-decision.log. The page recomputes
 *  the hash from the live record and compares — that comparison is the point. */
const ENCLAVE_VERDICT = {
  verdict: 'RELEASE',
  reason: 'quorum_and_delay_satisfied',
  requestHash: '0x7b2a1ed622c22c8eebf5b591a25c5bfcf2d1896ce61d1d05efdf53f13b8ce0f3',
}

const client = createPublicClient({
  chain: {
    ...sepolia,
    contracts: { ...sepolia.contracts, ensUniversalResolver: { address: UNIVERSAL_RESOLVER } },
  },
  // Fail fast and say so. The default retry schedule spends the better part of
  // a minute before giving up, during which the page shows "reading the chain…"
  // and a reader cannot tell a slow network from a dead one.
  transport: http(RPC, { retryCount: 1, retryDelay: 400, timeout: 8_000 }),
})

// ─── Language ──────────────────────────────────────────────────────────────
// The page's chrome is translated by the same overlay the landing page uses.
// These strings are generated after the chain answers, so they cannot be
// tagged in the HTML — they look themselves up instead, falling back to the
// English written right here. One missing translation costs one sentence.
const t = (key, en) => {
  const lang = document.documentElement.dataset.i18nLang
  const dict = lang && lang !== 'en' ? window.I18N?.[lang] : null
  return dict?.[key] ?? en
}

// ─── Small DOM helpers ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const setState = (el, state, html) => {
  el.dataset.state = state
  el.innerHTML = html
}

const fail = (el, err) => setState(el, 'error',
  `<p class="err">${t('d.err', 'Could not read this from the chain.')}</p>
   <p class="err-detail mono">${esc(err.shortMessage ?? err.message ?? err)}</p>`)

/**
 * Read one text record, once.
 *
 * The panels are rebuilt whenever the language changes, and without this cache
 * every switch would fetch the same five records again — five round trips to
 * say the same thing in different words. Values are kept for the life of the
 * page; a reader who wants fresh ones reloads, which is what reloading is for.
 */
const cache = new Map()
const readText = (name, key) => {
  const id = `${name}|${key}`
  if (!cache.has(id)) {
    cache.set(id, client.getEnsText({ name, key }).catch((e) => {
      // A failure must not be cached, or a page opened before the network came
      // back would stay broken until reload.
      cache.delete(id)
      throw e
    }))
  }
  return cache.get(id)
}

/** Fingerprint a public key exactly as scripts/nextkey.mjs does: SHA-256 over
 *  the raw key bytes, first 16 hex characters. Same rule on both sides, or a
 *  grant written by the CLI would not be found by this page. */
const fingerprint = async (rawKey) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', rawKey))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

const b64ToBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

const truncate = (s, n = 88) => (s.length > n ? `${s.slice(0, n)}…` : s)

const pretty = (json) => {
  try { return JSON.stringify(JSON.parse(json), null, 2) } catch { return json }
}

// ─── Panels ────────────────────────────────────────────────────────────────

/** The ciphertext. Public, readable by anyone, and useless without a key. */
async function renderSecret() {
  const el = $('p-secret')
  try {
    const raw = await readText(SECRET_NAME, 'nextkey.secret')
    if (!raw) return setState(el, 'empty', `<p class="err">No secret stored at ${SECRET_NAME}.</p>`)
    const o = JSON.parse(raw)
    setState(el, 'ok', `
      <dl>
        <dt>${t('d.algorithm', 'algorithm')}</dt><dd class="mono">${esc(o.alg ?? '—')}</dd>
        <dt>${t('d.nonce', 'nonce')}</dt><dd class="mono">${esc(o.iv)}</dd>
        <dt>${t('d.ciphertext', 'ciphertext')}</dt><dd class="mono break">${esc(truncate(o.ct, 120))}</dd>
      </dl>
      <p class="note">${t('d.secretnote', 'You are reading this, and so can anyone. That is not a leak: it is AES-256-GCM under a key that exists on no server.')}</p>`)
  } catch (e) { fail(el, e) }
}

/**
 * The recipient, and the grant addressed to her.
 *
 * The two steps are the product in miniature. Anna's public key comes from her
 * own name — she never registered with NextKey. Her grant is then found by
 * fingerprinting that key, in this browser, right now: the address of a grant is
 * derived from the recipient rather than stored in a directory somebody runs.
 */
async function renderRecipient() {
  const el = $('p-recipient')
  try {
    const pub = await readText(RECIPIENT_NAME, 'nextkey.pubkey')
    if (!pub) return setState(el, 'empty',
      `<p class="err">${RECIPIENT_NAME} publishes no key.</p>`)

    const fp = await fingerprint(b64ToBytes(pub))
    const grantKey = `nextkey.grant.${fp}`
    const grant = await readText(SECRET_NAME, grantKey)

    setState(el, 'ok', `
      <dl>
        <dt>${t('d.name', 'name')}</dt><dd class="mono">${esc(RECIPIENT_NAME)}</dd>
        <dt>${t('d.pubkey', 'published key')}</dt><dd class="mono break">${esc(pub)}</dd>
        <dt>${t('d.derived', 'derived here')}</dt><dd class="mono">${esc(grantKey)}</dd>
      </dl>
      ${grant
        ? `<p class="found">✓ ${t('d.grantfound', 'A grant exists at that address.')}</p>
           <pre class="mono">${esc(truncate(grant, 200))}</pre>`
        : `<p class="err">${t('d.grantnone', 'No grant at that address — it was never given, or revoked.')}</p>`}
      <p class="note">${t('d.recipientnote', 'Her key came from her own ENS record; the address of her grant was computed from that key in your browser. No directory, no lookup service.')}</p>`)
  } catch (e) { fail(el, e) }
}

/**
 * A recipient whose key is on a hardware wallet.
 *
 * Identical code to the panel above: read the public key from their own name,
 * fingerprint it here, look for a grant at that address. The page cannot tell
 * that Bob's private half sits on a Ledger, and neither could the sender —
 * which is exactly the claim being demonstrated.
 */
async function renderDevice() {
  const el = $('p-device')
  try {
    const pub = await readText(DEVICE_NAME, 'nextkey.pubkey')
    if (!pub) return setState(el, 'empty',
      `<p class="err">${DEVICE_NAME} publishes no key.</p>`)

    const fp = await fingerprint(b64ToBytes(pub))
    const grantKey = `nextkey.grant.${fp}`
    const grant = await readText(SECRET_NAME, grantKey)

    setState(el, 'ok', `
      <dl>
        <dt>${t('d.name', 'name')}</dt><dd class="mono">${esc(DEVICE_NAME)}</dd>
        <dt>${t('d.pubkey', 'published key')}</dt><dd class="mono break">${esc(pub)}</dd>
        <dt>${t('d.derived', 'derived here')}</dt><dd class="mono">${esc(grantKey)}</dd>
      </dl>
      ${grant
        ? `<p class="found">✓ ${t('d.grantfound', 'A grant exists at that address.')}</p>
           <pre class="mono">${esc(truncate(grant, 200))}</pre>`
        : `<p class="err">${t('d.grantnone', 'No grant at that address — it was never given, or revoked.')}</p>`}
      <p class="note">${t('d.devicenote', 'Bob\'s private key is on a Ledger and exists nowhere else. This panel is the same code as the one above: nothing here, and nothing in the sender, can tell the difference. Opening the secret costs Bob a button press on the device.')}</p>`)
  } catch (e) { fail(el, e) }
}

/** The owner's grant, to show there is no privileged path. */
async function renderOwner() {
  const el = $('p-owner')
  try {
    const grant = await readText(SECRET_NAME, OWNER_GRANT_KEY)
    setState(el, grant ? 'ok' : 'empty', `
      <dl><dt>${t('d.record', 'record')}</dt><dd class="mono">${esc(OWNER_GRANT_KEY)}</dd></dl>
      ${grant
        ? `<pre class="mono">${esc(truncate(grant, 200))}</pre>
           <p class="note">${t('d.ownernote', 'The owner\'s grant has the same shape as Anna\'s, because it was made the same way. There is no master key — if we kept one, "we cannot read your secrets" would be a lie.')}</p>`
        : `<p class="err">No owner grant found.</p>`}`)
  } catch (e) { fail(el, e) }
}

/**
 * The agent's proposal, hashed in the browser and compared with the verdict the
 * enclave returned. This is the check the enclave's confidentiality would
 * otherwise make impossible.
 */
async function renderAgent() {
  const el = $('p-agent')
  try {
    const raw = await readText(AGENT_NAME, 'nextkey.request')
    if (!raw) return setState(el, 'empty', `<p class="err">No open request at ${AGENT_NAME}.</p>`)

    const hash = keccak256(stringToHex(raw))
    const match = hash.toLowerCase() === ENCLAVE_VERDICT.requestHash.toLowerCase()

    setState(el, match ? 'ok' : 'error', `
      <pre class="mono">${esc(pretty(raw))}</pre>
      <dl>
        <dt>${t('d.hashedhere', 'hashed here')}</dt><dd class="mono break">${esc(hash)}</dd>
        <dt>${t('d.enclave', 'enclave returned')}</dt><dd class="mono break">${esc(ENCLAVE_VERDICT.requestHash)}</dd>
        <dt>${t('d.verdict', 'verdict')}</dt><dd class="mono">${esc(ENCLAVE_VERDICT.verdict)} — ${esc(ENCLAVE_VERDICT.reason)}</dd>
      </dl>
      ${match
        ? `<p class="found">✓ ${t('d.agree', 'The hashes agree, so the enclave judged this request.')}</p>
           <p class="note">${t('d.agreenote', 'Without this comparison, "the enclave approved it" would be a claim about an input nobody outside the enclave can see.')}</p>`
        : `<p class="err">${t('d.differ', 'The hashes differ. The request on chain has changed since the enclave ran, so the verdict shown above no longer applies to it.')}</p>`}`)
  } catch (e) { fail(el, e) }
}

/**
 * The same public key, the same arithmetic, and nothing at the end of it.
 *
 * The recipient panel above is a small feat: it takes Anna's key from her own
 * name, hashes it here in the browser, and finds her grant at that address. No
 * directory, no lookup service. It also has a property nobody asked for — it
 * works for *anyone*. Give it a public key and a name and it answers whether
 * that key has access, which means the first version of this scheme published
 * the guest list of every secret it stored.
 *
 * So this panel runs exactly that procedure against a name on the second
 * scheme, and arrives nowhere. Not because the grant is missing — Anna has one
 * here — but because its address is no longer a function of anything public.
 *
 * The precise claim, since the imprecise one would be easy to make and wrong:
 * the record itself is not hidden. Text records are enumerable from their
 * events, so an indexer can list every `nextkey.g2.…` on this name and count
 * them. What it cannot do is say which one is Anna's, or whether any of them
 * is. Under v1 that took one SHA-256.
 */
async function renderV2() {
  const el = $('p-v2')
  try {
    const [eph, annaKey] = await Promise.all([
      readText(V2_NAME, RECORD_EPH),
      readText(RECIPIENT_NAME, 'nextkey.pubkey'),
    ])
    if (!eph) throw new Error(`${V2_NAME} publishes no ${RECORD_EPH}`)
    if (!annaKey) throw new Error(`${RECIPIENT_NAME} publishes no key`)

    // The v1 address, computed here exactly as the panel above computes it.
    const fp = await fingerprint(b64ToBytes(annaKey))
    const v1Address = `nextkey.grant.${fp}`
    const whatIsThere = await readText(V2_NAME, v1Address)

    setState(el, whatIsThere ? 'error' : 'ok', `
      <dl>
        <dt>${t('d.v2.eph', 'the name publishes')}</dt>
        <dd class="mono break">${esc(RECORD_EPH)} · ${esc(truncate(eph, 44))}</dd>
        <dt>${t('d.v2.same', 'her key, same as above')}</dt>
        <dd class="mono break">${esc(truncate(annaKey, 44))}</dd>
        <dt>${t('d.v2.tried', 'so this browser looked at')}</dt>
        <dd class="mono break">${esc(v1Address)}</dd>
      </dl>
      ${whatIsThere
        ? `<p class="err">${t('d.v2.unexpected', 'Something is there. That should not happen on a v2 name — please tell us.')}</p>`
        : `<p class="found">✓ ${t('d.v2.nothing', 'Nothing. The address that works one panel up leads nowhere here.')}</p>`}
      <p class="note">${t('d.v2.note1', 'Anna does have a grant on this name. Its address comes out of an ECDH between the ephemeral key above and her private one — so she can compute it, the owner can compute it, and this page cannot, because it holds neither private half.')}</p>
      <p class="note">${t('d.v2.note2', 'To be exact about what is hidden: the record is not. Text records can be listed from their events, so an indexer can count how many grants this name carries. What nobody can do is say which one is hers, or whether any of them is. One panel up, that took a single SHA-256.')}</p>`)
  } catch (e) { fail(el, e) }
}

// ─── Go ────────────────────────────────────────────────────────────────────
const started = new Date()
$('read-at').textContent = started.toLocaleString()

const renderAll = () =>
  Promise.allSettled([renderSecret(), renderRecipient(), renderV2(),
                      renderDevice(), renderOwner(), renderAgent()])

// The picker calls this after switching. Reads are cached, so this re-labels
// values already in hand rather than asking the chain again.
window.__nextkeyRerender = renderAll

renderAll()
