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
const AGENT_NAME = `agent.${PARENT}`

/** The owner's grant. Their public key is not published, so unlike Anna's this
 *  fingerprint cannot be derived in the browser and is named directly. */
const OWNER_GRANT_KEY = 'nextkey.grant.ec3732779f96c87e'

/** What the enclave returned in evidence/cre-decision.log. The page recomputes
 *  the hash from the live record and compares — that comparison is the point. */
const ENCLAVE_VERDICT = {
  verdict: 'RELEASE',
  reason: 'quorum_and_delay_satisfied',
  requestHash: '0xb74ac56696e0e84612546123e2ec0a495a5b071be625b10141f2af4f59ce5336',
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

// ─── Small DOM helpers ─────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const setState = (el, state, html) => {
  el.dataset.state = state
  el.innerHTML = html
}

const fail = (el, err) => setState(el, 'error',
  `<p class="err">Could not read this from the chain.</p>
   <p class="err-detail mono">${esc(err.shortMessage ?? err.message ?? err)}</p>`)

const readText = (name, key) => client.getEnsText({ name, key })

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
        <dt>algorithm</dt><dd class="mono">${esc(o.alg ?? '—')}</dd>
        <dt>nonce</dt><dd class="mono">${esc(o.iv)}</dd>
        <dt>ciphertext</dt><dd class="mono break">${esc(truncate(o.ct, 120))}</dd>
      </dl>
      <p class="note">You are reading this, and so can anyone. That is not a leak:
      it is AES-256-GCM under a key that exists on no server.</p>`)
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
        <dt>name</dt><dd class="mono">${esc(RECIPIENT_NAME)}</dd>
        <dt>published key</dt><dd class="mono break">${esc(pub)}</dd>
        <dt>derived here</dt><dd class="mono">${esc(grantKey)}</dd>
      </dl>
      ${grant
        ? `<p class="found">✓ A grant exists at that address.</p>
           <pre class="mono">${esc(truncate(grant, 200))}</pre>`
        : `<p class="err">No grant at that address — it was never given, or revoked.</p>`}
      <p class="note">Her key came from her own ENS record; the address of her grant
      was computed from that key in your browser. No directory, no lookup service.</p>`)
  } catch (e) { fail(el, e) }
}

/** The owner's grant, to show there is no privileged path. */
async function renderOwner() {
  const el = $('p-owner')
  try {
    const grant = await readText(SECRET_NAME, OWNER_GRANT_KEY)
    setState(el, grant ? 'ok' : 'empty', `
      <dl><dt>record</dt><dd class="mono">${esc(OWNER_GRANT_KEY)}</dd></dl>
      ${grant
        ? `<pre class="mono">${esc(truncate(grant, 200))}</pre>
           <p class="note">The owner's grant has the same shape as Anna's, because it was
           made the same way. There is no master key — if we kept one, "we cannot read
           your secrets" would be a lie.</p>`
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
        <dt>hashed here</dt><dd class="mono break">${esc(hash)}</dd>
        <dt>enclave returned</dt><dd class="mono break">${esc(ENCLAVE_VERDICT.requestHash)}</dd>
        <dt>verdict</dt><dd class="mono">${esc(ENCLAVE_VERDICT.verdict)} — ${esc(ENCLAVE_VERDICT.reason)}</dd>
      </dl>
      ${match
        ? `<p class="found">✓ The hashes agree, so the enclave judged this request.</p>
           <p class="note">Without this comparison, "the enclave approved it" would be a
           claim about an input nobody outside the enclave can see.</p>`
        : `<p class="err">The hashes differ. The request on chain has changed since the
           enclave ran, so the verdict shown above no longer applies to it.</p>`}`)
  } catch (e) { fail(el, e) }
}

// ─── Go ────────────────────────────────────────────────────────────────────
const started = new Date()
$('read-at').textContent = started.toLocaleString()

Promise.allSettled([renderSecret(), renderRecipient(), renderOwner(), renderAgent()])
