/**
 * The NextKey API — a read-only window onto the chain, for people and agents
 * who have no RPC endpoint of their own.
 *
 * ─── What this is, and what it costs ──────────────────────────────────────
 *
 * Everything this returns is already public and already readable by anyone who
 * can reach an Ethereum node. That is the only reason it can exist without
 * weakening anything: it holds no key, signs nothing, writes nothing, and is
 * never shown a plaintext. Take it away and the product still works — the
 * pages read the chain directly, and `scripts/nextkey.mjs` does too. It is a
 * convenience for callers who cannot, not a component anything depends on.
 *
 * It does cost one thing, and the privacy notice now says so rather than
 * leaving it to be discovered: NextKey used to run no server at all, and every
 * lookup went from the visitor's own browser to a public node. A caller who
 * uses this endpoint is telling *us* which name they are looking up, on top of
 * telling the node. So:
 *
 *   · nothing is logged. No request log, no analytics, no storage binding, no
 *     KV, no D1 — there is nowhere for a name to be written down, which is a
 *     stronger statement than a policy saying we choose not to.
 *   · no request body is ever read. Every route is a GET.
 *   · no caller identity is asked for. There are no API keys, so there is
 *     nothing to correlate lookups with even in principle.
 *
 * The honest residue: Cloudflare sits in front of this and keeps its own edge
 * logs, which we do not control. That is in the privacy notice too.
 *
 * ─── The network is a path prefix, exactly as on the site ─────────────────
 *
 *   /demo/v1/…   the hackathon deployment on Sepolia
 *   /v1/…        mainnet, once it exists
 *
 * Same rule as nextkey.li, for the same reason: one deployment of one piece of
 * code, and the address says which chain the answer came from. Until mainnet
 * exists, `/v1/…` answers 501 and names the address that does work — rather
 * than 404, which would read as "this API does not have that route".
 *
 * ─── Deploying ────────────────────────────────────────────────────────────
 *
 *   npm run build:api        bundle src/worker.js → worker.js
 *   npx wrangler dev         run it locally, against the real chain
 *   npx wrangler deploy      publish it
 *
 * See api/README.md.
 */

import { createPublicClient, http, zeroAddress } from 'viem'
import { sepolia } from 'viem/chains'
import { un64, nextkeyId } from '../../web/src/nk-crypto.mjs'

// ─── The deployment ────────────────────────────────────────────────────────
// The same two constants the pages use. viem ships its own Sepolia Universal
// Resolver address, and without this override every lookup quietly queries the
// production deployment and returns null — no error, no warning. That failure
// has cost this project a day before; the assertion below is why it cannot
// cost another one silently.
const UNIVERSAL_RESOLVER = '0xd26f2040d083af1cd2962ba303f4bea0c4faf142'
const RPC = 'https://ethereum-sepolia-rpc.publicnode.com'

const RECORDS = {
  pubkey: 'nextkey.pubkey',
  eph: 'nextkey.eph',
  sealed: 'nextkey.eph.sealed',
  secret: 'nextkey.secret',
}

const hackathonSepolia = {
  ...sepolia,
  contracts: { ...sepolia.contracts, ensUniversalResolver: { address: UNIVERSAL_RESOLVER } },
}

if (hackathonSepolia.contracts.ensUniversalResolver.address !== UNIVERSAL_RESOLVER) {
  throw new Error('the Universal Resolver override did not take')
}

const reader = createPublicClient({
  chain: hackathonSepolia,
  transport: http(RPC, { retryCount: 1, retryDelay: 400, timeout: 10_000 }),
})

const VERSION = '1'
const SITE = 'https://nextkey.li'

// ─── Answers ───────────────────────────────────────────────────────────────
//
// Two kinds of "no" that must never be spelled the same way. "This name
// publishes no key" is a fact about the chain; "the node did not answer" is a
// fact about our luck. This project has already shipped that confusion once —
// an event scanner that reported "no events found" when all 45 of its requests
// had been refused — and the lesson is in the decision log twice.
const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // Read-only public data, so any origin may ask. There is no cookie, no
  // credential and no session for a permissive CORS policy to expose.
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-max-age': '86400',
  // Fifteen seconds is about one Sepolia block. Long enough that an agent in a
  // loop does not hammer the node, short enough that a record written in the
  // playground shows up while the visitor is still looking at the page.
  'cache-control': 'public, max-age=15',
  'x-nextkey-api': VERSION,
}

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body, null, 2) + '\n', { status, headers: { ...HEADERS, ...extra } })

const fail = (status, code, message, extra = {}) =>
  json({ error: { code, message, ...extra } }, status, { 'cache-control': 'no-store' })

/**
 * A name we are willing to put in front of a resolver.
 *
 * Deliberately narrow: lowercase, dot-separated labels, no leading or trailing
 * dot, and a length no ENS name legitimately exceeds. It is not a full UTS-46
 * implementation and does not pretend to be — an uppercase or unicode name is
 * refused with a reason rather than normalised, because normalising it here
 * would mean this endpoint and the caller disagreeing about which name was
 * asked for, and the caller would never see that they disagreed.
 */
const NAME = /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,4}$/

/** A NextKey ID from whatever the record actually holds, or nothing. */
const idOf = (value) => {
  if (!value) return null
  try {
    const pk = un64(value)
    return pk.length === 32 ? nextkeyId(pk) : null
  } catch { return null }
}

/**
 * What kind of name is this? The same four roles the explorer uses, and the
 * same reason for having them: answering every name with the same five
 * absences describes a recipient as a defective vault, which a reader then has
 * to undo before learning anything.
 *
 * The fifth role is the one this endpoint shipped without and should not have.
 * A text lookup answers `null` for a name that carries no such record *and* for
 * a name that does not exist on this deployment at all, and the first version
 * called both of them `empty` — "this name carries none of NextKey's records",
 * which quietly asserts that the name exists. Asked about `vitalik.eth`, which
 * is registered on production ENS and not here, it produced a confident
 * description of a name it had never found.
 *
 * That is the same fault as the event scanner that reported "no events found"
 * when all forty-five of its requests had been refused, and as the simulation
 * that approved a write to the zero address: absence and failure-to-find are
 * different statements, and this project has now conflated them three times.
 */
const roleOf = (r, resolver) => {
  if (resolver === null) return 'unregistered'
  const holds = !!(r[RECORDS.eph] || r[RECORDS.secret])
  const receives = !!r[RECORDS.pubkey]
  if (holds && receives) return 'both'
  if (holds) return 'vault'
  if (receives) return 'recipient'
  return 'empty'
}

/**
 * Which resolver answers for this name, if any.
 *
 * Three outcomes, and they are deliberately not two. An address means the name
 * exists here and something is answering for it. `null` means the deployment
 * has no resolver for it — it is not registered here, or its resolver was never
 * attached. `undefined` means we could not find out, because the lookup itself
 * failed, and that is not the same as "no".
 *
 * The temptation is a try/catch returning null, which is one line shorter and
 * turns every RPC hiccup into a confident "this name does not exist". The whole
 * point of this function is to stop making that claim.
 */
const resolverFor = async (name) => {
  try {
    const address = await reader.getEnsResolver({ name })
    return !address || address === zeroAddress ? null : address
  } catch (e) {
    // viem raises this for a name nothing resolves — an answer, not a failure.
    const m = String(e?.name ?? '') + String(e?.shortMessage ?? e?.message ?? '')
    if (/ResolverNotFound|resolver.*not.*found|reverse|Ens.*NotFound/i.test(m)) return null
    return undefined
  }
}

async function readName (name) {
  const keys = Object.values(RECORDS)
  const [resolver, ...values] = await Promise.all([
    resolverFor(name),
    ...keys.map((key) => reader.getEnsText({ name, key })),
  ])
  return { resolver, records: Object.fromEntries(keys.map((k, i) => [k, values[i] ?? null])) }
}

// ─── Routes ────────────────────────────────────────────────────────────────

async function nameRoute (name, { idOnly }) {
  if (!NAME.test(name)) {
    return fail(400, 'malformed_name',
      'Not a name this endpoint will resolve. Lowercase labels of letters, digits and hyphens, separated by dots. Uppercase and unicode names are refused rather than normalised, so that you and this endpoint cannot end up meaning different names.',
      { name })
  }

  let read
  try {
    read = await readName(name)
  } catch (e) {
    // The node refused, timed out, or answered something viem could not read.
    // This says nothing about the name, and the status code says so: 502 is
    // "the thing behind me failed", never "your name is empty".
    return fail(502, 'upstream_unavailable',
      'The Sepolia node did not answer, so this says nothing about the name. Try again in a moment.',
      { name, node: new URL(RPC).host, detail: String(e?.shortMessage ?? e?.message ?? e).slice(0, 200) })
  }

  const { resolver, records } = read
  const pubkey = records[RECORDS.pubkey]
  const id = idOf(pubkey)

  if (idOnly) {
    // "Nothing resolves for this name here" comes first, because it is the
    // answer to a different question than "this name published no key", and a
    // caller who has typed a production ENS name will meet it constantly.
    if (!pubkey && resolver === null) {
      return fail(404, 'not_on_this_deployment',
        'Nothing resolves for this name on the hackathon deployment — it is not registered here, or has no resolver attached. This is not the same as a name that exists and publishes no key.',
        { name })
    }
    if (!pubkey) {
      return fail(404, 'no_published_key',
        'This name publishes no key, so nothing can be sealed to it and it has no NextKey ID. Publishing a key is the whole of the opt-in — see ' + SITE + '/demo/id',
        { name })
    }
    if (!id) {
      // A real state, not a bug: anyone may write any string to their own
      // record. Inventing an ID for it would put a confident, checkable-looking
      // identifier under a value that identifies nobody.
      return fail(422, 'key_not_x25519',
        'This name publishes something under nextkey.pubkey, but it does not decode to a 32-byte X25519 key, so it has no NextKey ID.',
        { name, published: pubkey.slice(0, 120) })
    }
    return json({ network: 'sepolia', name, nextkeyId: id, pubkey })
  }

  const role = roleOf(records, resolver)

  // Said in the answer rather than only in the documentation, because an agent
  // reads the answer and a person reads the documentation. Each of these is a
  // different statement about the world and none of them stands in for another.
  const note =
    role === 'unregistered'
      ? 'Nothing resolves for this name on the hackathon deployment. The empty records below are what the resolver was not there to answer, not what it answered.'
    : resolver === undefined
      ? 'A resolver could not be looked up for this name, so the empty records below may mean the name is not here at all rather than that it carries nothing.'
    : id
      ? 'The NextKey ID is derived from nextkey.pubkey and is held by no record. Compare the key, not the ID, when verifying.'
      : 'No NextKey ID: this name publishes no X25519 key under nextkey.pubkey.'

  return json({
    network: 'sepolia',
    name,
    role,
    // The address that answered, so a reader can tell an absent record from an
    // absent name without having to trust the word above.
    resolver: resolver ?? null,
    resolverKnown: resolver !== undefined,
    receivable: !!pubkey,
    nextkeyId: id,
    records,
    note,
  })
}

function openapi (origin) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'NextKey API',
      version: VERSION,
      summary: 'Read the NextKey records on an ENS name, and the NextKey ID derived from its published key.',
      description:
        'Read-only. Holds no key, signs nothing, writes nothing, is never shown a plaintext, and logs nothing. ' +
        'Everything it returns is public on chain and readable without it — the pages and the CLI read the chain directly. ' +
        'The network is a path prefix: /demo/v1 is the hackathon deployment on Sepolia; /v1 is reserved for mainnet.',
      license: { name: 'AGPL-3.0-or-later', identifier: 'AGPL-3.0-or-later' },
      contact: { url: SITE + '/demo/sandbox' },
    },
    servers: [{ url: origin + '/demo/v1', description: 'Sepolia — the hackathon deployment' }],
    paths: {
      '/name/{name}': {
        get: {
          summary: 'Every NextKey record on a name, with its role and NextKey ID.',
          parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' },
                         example: 'anna.nextkey.eth' }],
          responses: {
            200: { description: 'The records as they stand on chain.' },
            400: { description: 'Not a name this endpoint will resolve.' },
            502: { description: 'The node did not answer. Says nothing about the name.' },
          },
        },
      },
      '/id/{name}': {
        get: {
          summary: 'Just the NextKey ID, for checking that a name is reachable.',
          parameters: [{ name: 'name', in: 'path', required: true, schema: { type: 'string' },
                         example: 'anna.nextkey.eth' }],
          responses: {
            200: { description: 'The name publishes an X25519 key, and this is its ID.' },
            404: { description: 'The name publishes no key, so it can receive nothing.' },
            422: { description: 'The record holds something that is not a 32-byte X25519 key.' },
            502: { description: 'The node did not answer. Says nothing about the name.' },
          },
        },
      },
      '/health': { get: { summary: 'Is this reachable, and which chain does it read?' } },
    },
  }
}

export default {
  async fetch (request) {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: HEADERS })
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail(405, 'method_not_allowed',
        'This endpoint only reads. Every route is a GET, and no request body is ever read.')
    }

    // Mainnet is reserved, not missing. A 404 here would read as "no such
    // route" and send an agent looking for a spelling mistake it will not find.
    if (/^\/v1(\/|$)/.test(path)) {
      return fail(501, 'network_not_live',
        'Mainnet is not live. The hackathon deployment answers the same routes under /demo/v1.',
        { try: url.origin + '/demo' + path })
    }

    if (path === '/demo/v1/health') {
      return json({
        ok: true,
        network: 'sepolia',
        api: VERSION,
        universalResolver: UNIVERSAL_RESOLVER,
        records: RECORDS,
        // What it cannot do, in the answer that says it is up. A health check
        // that only ever says "ok" teaches a caller nothing about the shape of
        // what it is talking to.
        writes: false,
        logs: false,
      })
    }

    if (path === '/demo/v1/openapi.json') return json(openapi(url.origin))

    let m
    if ((m = path.match(/^\/demo\/v1\/name\/(.+)$/))) {
      return nameRoute(decodeURIComponent(m[1]).toLowerCase().trim(), { idOnly: false })
    }
    if ((m = path.match(/^\/demo\/v1\/id\/(.+)$/))) {
      return nameRoute(decodeURIComponent(m[1]).toLowerCase().trim(), { idOnly: true })
    }

    if (path === '/' || path === '/demo' || path === '/demo/v1') {
      return json({
        name: 'NextKey API',
        documentation: SITE + '/demo/sandbox',
        openapi: url.origin + '/demo/v1/openapi.json',
        routes: [
          url.origin + '/demo/v1/health',
          url.origin + '/demo/v1/name/anna.nextkey.eth',
          url.origin + '/demo/v1/id/anna.nextkey.eth',
        ],
      })
    }

    return fail(404, 'no_such_route',
      'No route here. The routes this endpoint has are listed at its root.',
      { root: url.origin + '/' })
  },
}
