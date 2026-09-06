/**
 * Acting on the enclave's verdict.
 *
 * Until now the loop stopped one step short: the agent filed a proposal, the
 * confidential workflow judged it, and a person then wrote the grant by hand.
 * That gap is where a system quietly stops being a system. This closes it.
 *
 * What the script enforces, in this order, and it refuses at the first failure:
 *
 *   1. The verdict must say RELEASE. PENDING and DENY are not "not yet" — they
 *      are answers, and answering them by doing it anyway would make the whole
 *      decision decorative.
 *   2. The verdict's `requestHash` must equal the hash of the request that is
 *      on chain *right now*. This is the important one. It means the enclave
 *      judged this request and not an earlier version of it — a proposal edited
 *      after judgement cannot be executed against a stale approval.
 *   3. The request must name a secret the acting identity can actually open.
 *
 * What it does NOT enforce, stated plainly because the difference matters:
 *
 *   Nothing stops the owner from ignoring all of this and running
 *   `nextkey.mjs share` directly. The owner holds the key and the ENS role;
 *   that is the design, and no script can revoke it. In production the DON's
 *   signed report would be delivered on chain and a contract would gate the
 *   write, so the check would be enforced by the chain rather than by this
 *   file. Here it is a client-side check on an owner-signed action. Useful,
 *   honest, and not the same thing.
 *
 *   node scripts/release.mjs           check   --from-log evidence/cre-decision.log
 *   node --env-file=.env scripts/release.mjs execute --from-log evidence/cre-decision.log --as alice
 */

import { readFileSync } from 'node:fs'
import { keccak256, stringToHex } from 'viem'
import {
  PARENT, AGENT_NAME, RECORD_REQUEST,
  readRecord, loadIdentity, grantKey, un64, RECORD_PUBKEY, shareSecret,
} from './nextkey-core.mjs'

// ─── Reading a verdict ─────────────────────────────────────────────────────
/**
 * The CRE simulator prints its result; the DON would hand over a signed report.
 * We parse the printed form, which is what a hackathon build actually has, and
 * take the full hash from the log line rather than the summary — the summary
 * truncates it, and a truncated hash verifies nothing.
 */
const fromLog = (path) => {
  const text = readFileSync(path, 'utf8')

  const result = text.match(/"(RELEASE|DENY|PENDING) — ([a-z_]+) \(request (0x[0-9a-fA-F]+)/)
  if (!result) throw new Error(`no workflow result line found in ${path}`)

  const bound = text.match(/Bound to on-chain request (0x[0-9a-fA-F]{64})/)
  if (!bound) {
    throw new Error(
      `${path} carries a verdict but no full request hash.\n` +
      `  It predates the binding, so it cannot be verified — re-run the workflow.`)
  }
  return { verdict: result[1], reason: result[2], requestId: result[3], requestHash: bound[1] }
}

const fromJson = (path) => {
  const j = JSON.parse(readFileSync(path, 'utf8'))
  for (const k of ['verdict', 'reason', 'requestId', 'requestHash']) {
    if (!j[k]) throw new Error(`${path} is missing "${k}"`)
  }
  return j
}

// ─── Verification ──────────────────────────────────────────────────────────
const verify = async (v) => {
  const onChainRaw = await readRecord(AGENT_NAME, RECORD_REQUEST)
  if (!onChainRaw) throw new Error(`${AGENT_NAME} holds no open request`)

  const liveHash = keccak256(stringToHex(onChainRaw))
  const req = JSON.parse(onChainRaw)

  const checks = [
    { name: 'verdict is RELEASE', ok: v.verdict === 'RELEASE',
      detail: `${v.verdict} — ${v.reason}` },
    { name: 'verdict is bound to the live request', ok: liveHash.toLowerCase() === v.requestHash.toLowerCase(),
      detail: liveHash === v.requestHash ? liveHash : `on chain ${liveHash}\n                       verdict  ${v.requestHash}` },
    { name: 'request ids agree', ok: req.requestId === v.requestId,
      detail: `${req.requestId}` },
    { name: 'request version is supported', ok: req.v === 1, detail: `v${req.v}` },
  ]
  return { req, liveHash, checks, ok: checks.every((c) => c.ok) }
}

// ─── Commands ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const cmd = args[0]
const flag = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

const usage = () => console.log(`
  release.mjs check   (--from-log <file> | --from-json <file>)
  release.mjs execute (--from-log <file> | --from-json <file>) --as <identity>
`)

if (cmd !== 'check' && cmd !== 'execute') { usage(); process.exit(1) }

const log = flag('--from-log')
const json = flag('--from-json')
if (!log && !json) { usage(); process.exit(1) }

const v = log ? fromLog(log) : fromJson(json)

console.log(`\nNextKey — acting on a verdict`)
console.log('─'.repeat(72))
console.log(`  source      ${log ?? json}`)
console.log(`  verdict     ${v.verdict} — ${v.reason}`)
console.log(`  request     ${v.requestId}`)
console.log('─'.repeat(72))

const { req, checks, ok } = await verify(v)

for (const c of checks) {
  console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(38)} ${c.detail}`)
}
console.log('─'.repeat(72))
console.log(`  would release  ${req.secret}  →  ${req.recipient}`)

if (!ok) {
  const failed = checks.filter((c) => !c.ok).map((c) => c.name)
  console.log(`\n  REFUSED: ${failed.join('; ')}\n`)
  if (!checks[1].ok) {
    console.log(`  A hash mismatch is the interesting failure. It means the request on
  chain is not the one the enclave judged — it was replaced after the
  decision. Re-run the workflow against the current request rather than
  executing an approval that was given for something else.\n`)
  }
  process.exit(1)
}

if (cmd === 'check') {
  console.log(`\n  All checks pass. Re-run with "execute --as <identity>" to write the grant.\n`)
  process.exit(0)
}

// ── Execute ────────────────────────────────────────────────────────────────
const who = flag('--as')
if (!who) { console.log('\n  execute needs --as <identity>\n'); process.exit(1) }
const id = loadIdentity(who)

const label = req.secret.replace(`.${PARENT}`, '')

// Already done is not a failure, but it should not be reported as an action
// either — re-running this must not look like a second release.
const theirPub = await readRecord(req.recipient, RECORD_PUBKEY)
if (!theirPub) throw new Error(`${req.recipient} publishes no ${RECORD_PUBKEY}`)
const existing = await readRecord(req.secret, grantKey(un64(theirPub)))
if (existing) {
  console.log(`\n  ${req.recipient} already holds a grant at ${grantKey(un64(theirPub))}.`)
  console.log(`  Nothing to do — this release has already been carried out.\n`)
  process.exit(0)
}

console.log(`\n  executing as ${who}`)
await shareSecret({
  label, identity: id, recipient: req.recipient,
  log: (key) => console.log(`  grant record  ${key}`),
})

console.log(`
  Released. The chain now holds a proposal filed by an agent, and a grant
  written because a confidential decision said so — and the verdict carries
  the hash of the very request it judged, so the two can be tied together by
  anyone, without seeing what the enclave saw.
`)
