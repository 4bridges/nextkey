import {
	cre,
	hexToBase64,
	ok,
	text,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, keccak256, parseAbiParameters, stringToHex } from 'viem'
import { z } from 'zod'

// ═══════════════════════════════════════════════════════════
// NextKey — the release decision
//
// A secret reaches someone other than its owner in one of two ways. Either the
// owner shared it deliberately — pure ENSv2, no decision to make — or the owner
// is unavailable and guardians are asking on someone's behalf. This workflow is
// the second case, and the only part of NextKey where software decides
// something about a secret with no person present.
//
// The split that makes it work:
//
//   The request is public. The release agent files it as a text record on its
//   own ENS name, where anyone can see that a release was proposed, for which
//   secret, for whom, and when.
//
//   The deliberation is confidential. Who the guardians are, how many have
//   approved, and how far the request still is from its threshold never leave
//   the enclave. A public guardian list is a target list.
//
// The two halves are tied together by a hash. The enclave hashes the public
// request verbatim and returns that hash with its verdict, so anyone can read
// the record off the chain, hash it themselves, and confirm the enclave judged
// that request and not another one. Without it, "the enclave approved this"
// would be a claim about an input nobody else can see.
//
// See docs/release-decision.md for why a guardian quorum alone is not enough,
// why the waiting period starts at quorum rather than at request time, and why
// this belongs inside an enclave at all.
// ═══════════════════════════════════════════════════════════

// ─── Config Schema ──────────────────────────────────────────
export const configSchema = z.object({
	schedule: z.string(),
	/** Where the enclave fetches pending release requests from. */
	stateUrl: z.string(),
	/** Secret ID as declared in secrets.yaml. Authenticates us to that service. */
	secretId: z.string(),
})
type Config = z.infer<typeof configSchema>

// ─── The public half: what the agent wrote on chain ─────────
const onChainRequestSchema = z.object({
	requestId: z.string(),
	v: z.number().int(),
	secret: z.string(),
	recipient: z.string(),
	filedAt: z.number().int(),
	agent: z.string(),
})

// ─── The confidential half: what only the enclave sees ──────
// Guardians appear as opaque references, never as ENS names or addresses. The
// decision only needs to count distinct approvals; not knowing who they are is
// cheaper than protecting the knowledge.
const releaseStateSchema = z.object({
	/**
	 * A verbatim copy of the text record at `agent.nextkey.eth · nextkey.request`.
	 *
	 * Carried as an opaque string rather than as parsed fields, because the hash
	 * has to cover exactly the bytes that are on chain. Reserialising a parsed
	 * object would reorder keys and yield a different, useless hash.
	 */
	onChainRequest: z.string(),
	policy: z.object({
		quorum: z.number().int().positive(),
		delaySeconds: z.number().int().nonnegative(),
	}),
	approvals: z.array(
		z.object({
			guardianRef: z.string(),
			at: z.number().int(),
		}),
	),
	cancelledAt: z.number().int().nullable(),
	/**
	 * Evaluation time, supplied by the service rather than read from the clock.
	 *
	 * The enclave result is attested and verified by DON consensus, so the
	 * decision must be a pure function of its inputs. `Date.now()` would differ
	 * per node and break that. The honest cost: trust for "what time is it"
	 * moves to the service serving this payload. Documented, not hidden.
	 */
	observedAt: z.number().int(),
})

type DecisionInput = {
	policy: { quorum: number; delaySeconds: number }
	approvals: { guardianRef: string; at: number }[]
	cancelledAt: number | null
	observedAt: number
	/** Present in fixtures and tests; the rule does not read them. */
	requestId?: string
	secret?: string
}

type Verdict = 'RELEASE' | 'DENY' | 'PENDING'
type Decision = { verdict: Verdict; reason: string }

// ─── Binding the verdict to the chain ───────────────────────
/**
 * Hash the on-chain request exactly as stored.
 *
 * Pure and exported so it can be checked against the real record in a test:
 * read `agent.nextkey.eth · nextkey.request`, hash it here, and the two must
 * agree. If they ever stop agreeing, a verdict is being issued about something
 * other than what the chain says was requested — which is precisely the failure
 * this function exists to make detectable.
 */
export const requestHashOf = (onChainRequest: string): `0x${string}` =>
	keccak256(stringToHex(onChainRequest))

// ─── The rule ───────────────────────────────────────────────
// Pure, total, and deterministic for a given input. Everything the enclave
// protects flows through here; nothing but the return value leaves.
export const decide = (req: DecisionInput): Decision => {
	if (req.cancelledAt !== null) {
		return { verdict: 'DENY', reason: 'cancelled_by_owner' }
	}

	// Count distinct guardians, not approval records — the same guardian
	// approving twice must not move the needle.
	const distinct = new Map<string, number>()
	for (const a of req.approvals) {
		const seen = distinct.get(a.guardianRef)
		if (seen === undefined || a.at < seen) distinct.set(a.guardianRef, a.at)
	}

	if (distinct.size < req.policy.quorum) {
		return { verdict: 'PENDING', reason: 'quorum_not_met' }
	}

	// The clock starts when quorum is reached, not when the request was filed.
	// Otherwise an attacker files early, lets the window elapse quietly, and
	// only then collects approvals — arriving at an instant release.
	const times = [...distinct.values()].sort((a, b) => a - b)
	const quorumReachedAt = times[req.policy.quorum - 1]!
	const releasableAt = quorumReachedAt + req.policy.delaySeconds

	if (req.observedAt < releasableAt) {
		return { verdict: 'PENDING', reason: 'waiting_period' }
	}

	return { verdict: 'RELEASE', reason: 'quorum_and_delay_satisfied' }
}

// ─── TEE Cron Callback ──────────────────────────────────────
// Receives a `TeeRuntime`, not a `Runtime`. Everything here runs inside the
// enclave until we explicitly cross back with `usingTheDons()`.
export const onCronTrigger = (runtime: TeeRuntime<Config>): string => {
	const config = runtime.config

	// ── Fetch the credential inside the enclave ──
	// Released by the Vault DON only into an attested enclave, decrypted at the
	// moment getSecret() runs.
	const apiToken = runtime.getSecret({ id: config.secretId }).result().value

	// ── Fetch the release state from inside the enclave ──
	// A note on the header name. In production this is `Authorization` against
	// NextKey's own API. During the hackathon the state is served from a GitHub
	// raw URL, and GitHub answers an unrecognised bearer token with 404 rather
	// than 401 — deliberately, so that auth failures do not reveal whether a
	// resource exists. That looks exactly like a missing file and costs an hour
	// to diagnose. Using a header the host ignores keeps the secret in the
	// request without tripping over someone else's auth handling.
	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, {
			url: config.stateUrl,
			method: 'GET',
			multiHeaders: {
				'X-NextKey-Auth': { values: [`Bearer ${apiToken}`] },
			},
		})
		.result()

	if (!ok(response)) {
		throw new Error(`Release state fetch failed with status: ${response.statusCode}`)
	}

	const state = releaseStateSchema.safeParse(JSON.parse(text(response)))
	if (!state.success) {
		throw new Error(`Release state did not match the expected shape: ${state.error.message}`)
	}

	// Hash first, parse second. The hash must cover the bytes as stored on
	// chain, so it is taken before the string becomes an object.
	const requestHash = requestHashOf(state.data.onChainRequest)

	const onChain = onChainRequestSchema.safeParse(JSON.parse(state.data.onChainRequest))
	if (!onChain.success) {
		throw new Error(`On-chain request did not match the expected shape: ${onChain.error.message}`)
	}
	const request = onChain.data

	if (request.v !== 1) {
		throw new Error(`Unsupported request version: ${request.v}`)
	}

	const { verdict, reason } = decide({
		policy: state.data.policy,
		approvals: state.data.approvals,
		cancelledAt: state.data.cancelledAt,
		observedAt: state.data.observedAt,
	})

	// Evidence that a secret really was released into the enclave and used in
	// the outbound call — as a boolean, never by logging the token itself.
	const secretPresent = apiToken.length > 0

	// ⚠️ Simulation only. Logs must be removed before deploying, or the enclave's
	// confidentiality is undone by the debugging. Note what is safe to log even
	// here: a verdict, a reason, and a hash of data that is already public.
	// Never a guardian, a count, or the token.
	runtime.log(`Decision for ${request.requestId}: ${verdict} (${reason})`)
	runtime.log(`Bound to on-chain request ${requestHash}`)

	// ── Cross back to the DON ──
	// Anything passed to a capability call on the DON runtime executes on
	// Workflow DON nodes and is NO LONGER confidential. So: the verdict, the
	// request id, a deliberately coarse reason, and the hash of a record that is
	// already public. Not the guardian refs, not the approval count, not the
	// policy — the distance to a threshold is itself useful to an attacker,
	// which is why `quorum_not_met` says a threshold was missed without saying
	// by how much.
	const donRuntime = runtime.usingTheDons()

	const encodedPayload = encodeAbiParameters(
		parseAbiParameters('string requestId, string verdict, string reason, bytes32 requestHash'),
		[request.requestId, verdict, reason, requestHash],
	)

	donRuntime
		.report({
			encodedPayload: hexToBase64(encodedPayload),
			encoderName: 'evm',
			signingAlgo: 'ecdsa',
			hashingAlgo: 'keccak256',
		})
		.result()

	// The signed report is the authorization. Delivering it to a contract via
	// evmClient.writeReport(donRuntime, report) is the next step and out of
	// scope for this build.
	return `${verdict} — ${reason} (request ${request.requestId}, bound to ${requestHash.slice(0, 10)}…, secret in enclave: ${secretPresent})`
}

// ─── Workflow Init ──────────────────────────────────────────
export function initWorkflow(config: Config) {
	const cronTrigger = new cre.capabilities.CronCapability()

	return [
		cre.handlerInTee(cronTrigger.trigger({ schedule: config.schedule }), onCronTrigger, [
			{ tee: 'nitro', regions: ['us-west-2'] },
		]),
	]
}
