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

  // The newest run in the file, not the first one in it.
  //
  // This log accumulates: every time the request on chain is replaced, the
  // workflow is run again and its output is appended here, so the file holds
  // several verdicts and only the last one describes the request that is
  // actually out there. `String.match` without /g returns the *first* match,
  // which meant a second run was written to the file and silently ignored —
  // the check then compared the live request against a verdict from days
  // earlier and refused, correctly by its own arithmetic and for entirely the
  // wrong reason. A stale answer that looks like a working check is worse than
  // no check.
  const results = [...text.matchAll(/"(RELEASE|DENY|PENDING) — ([a-z_]+) \(request (0x[0-9a-fA-F]+)/g)]
  if (results.length === 0) throw new Error(`no workflow result line found in ${path}`)
  const result = results[results.length - 1]

  // Paired with that run rather than taken independently: the hash belonging to
  // a verdict is the last one printed *before* it. Reading the last hash in the
  // file would pick up a half-pasted run underneath and verify one run's
  // verdict against another run's request.
  const bounds = [...text.matchAll(/Bound to on-chain request (0x[0-9a-fA-F]{64})/g)]
    .filter((m) => m.index < result.index)
  if (bounds.length === 0) {
    throw new Error(
      `${path} carries a verdict but no full request hash before it.\n` +
      `  It predates the binding, or the run was pasted in incomplete — re-run the workflow.`)
  }
  const bound = bounds[bounds.length - 1]

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

// A file this tool cannot read is the likeliest mistake on a busy day: a run
// pasted in half, or the wrong log named. Node's default for a throw during
// module evaluation is forty lines of stack trace through its own internals,
// which reads as a broken program rather than as "that file carries no
// verdict" — and half of what this project demonstrates is a refusal, so a
// refusal must not look like a crash. Same treatment nextkey.mjs gives a
// refused open. `process.exit` is safe at this point and only at this point:
// nothing has opened an RPC socket yet.
let v
try {
  v = log ? fromLog(log) : fromJson(json)
} catch (e) {
  console.error(`\n  \u2717  ${(e?.message ?? String(e)).split('\n').join('\n     ')}\n`)
  if (process.env.NEXTKEY_DEBUG) console.error(e)
  process.exit(1)
}

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

// From here on, nothing calls `process.exit`.
//
// On Windows that tears the process down while libuv is still closing the RPC
// socket, and Node aborts with an assertion in `src\win\async.c` — *after* the
// command has printed its answer. A run that did exactly what it should looks
// like a crash, and the exit code stops meaning anything. `clear` and `eph` in
// nextkey.mjs cost us this once already; the fix there was the same one as
// here: set the code, let the process end when its handles are closed.
if (!ok) {
  const failed = checks.filter((c) => !c.ok).map((c) => c.name)
  console.log(`\n  REFUSED: ${failed.join('; ')}\n`)
  if (!checks[1].ok) {
    console.log(`  A hash mismatch is the interesting failure. It means the request on
  chain is not the one the enclave judged — it was replaced after the
  decision. Re-run the workflow against the current request rather than
  executing an approval that was given for something else.\n`)
  }
  process.exitCode = 1
}

else if (cmd === 'check') {
  console.log(`\n  All checks pass. Re-run with "execute --as <identity>" to write the grant.\n`)
}

// ── Execute ────────────────────────────────────────────────────────────────
else {
  const who = flag('--as')
  if (!who) {
    console.log('\n  execute needs --as <identity>\n')
    process.exitCode = 1
  } else {
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
    } else {
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
    }
  }
}
