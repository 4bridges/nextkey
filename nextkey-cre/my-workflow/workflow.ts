import {
	cre,
	hexToBase64,
	ok,
	text,
	type TeeRuntime,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import { z } from 'zod'

// ═══════════════════════════════════════════════════════════
// NextKey — the release decision
//
// A secret is released to someone other than its owner either because the
// owner shared it deliberately (pure ENSv2, no decision needed), or because
// the owner is unavailable and guardians are asking on someone's behalf.
// This workflow is the second case.
//
// See docs/release-decision.md for why a guardian quorum alone is not enough,
// why the waiting period starts at quorum rather than at request time, and
// why this belongs inside an enclave at all.
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

// ─── Shape of the state the enclave evaluates ───────────────
// Guardians appear as opaque references, never as ENS names or addresses.
// The decision only needs to count distinct approvals — not knowing who they
// are is cheaper than protecting the knowledge.
const releaseRequestSchema = z.object({
	requestId: z.string(),
	secret: z.string(),
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
type ReleaseRequest = z.infer<typeof releaseRequestSchema>

type Verdict = 'RELEASE' | 'DENY' | 'PENDING'
type Decision = { verdict: Verdict; reason: string }

// ─── The rule ───────────────────────────────────────────────
// Pure, total, and deterministic for a given input. Everything the enclave
// protects flows through here; nothing but the return value leaves.
export const decide = (req: ReleaseRequest): Decision => {
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

	// ── Fetch the release request from inside the enclave ──
	// The request state — guardians, their approvals, the policy — is the
	// sensitive part. A public guardian list is a target list: it tells an
	// attacker exactly whom to approach and how many more they still need.
	// Fetching it from inside the enclave keeps request and response payloads
	// confidential from node operators.
	const response = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, {
			url: config.stateUrl,
			method: 'GET',
			multiHeaders: {
				Authorization: { values: [`Bearer ${apiToken}`] },
			},
		})
		.result()

	if (!ok(response)) {
		throw new Error(`Release state fetch failed with status: ${response.statusCode}`)
	}

	const parsed = releaseRequestSchema.safeParse(JSON.parse(text(response)))
	if (!parsed.success) {
		throw new Error(`Release state did not match the expected shape: ${parsed.error.message}`)
	}
	const request = parsed.data

	const { verdict, reason } = decide(request)

	// ⚠️ Simulation only. Logs must be removed before deploying, or the enclave's
	// confidentiality is undone by the debugging. Note what is safe to log even
	// here: a verdict and a reason, never a guardian, a count, or the token.
	runtime.log(`Decision for ${request.requestId}: ${verdict} (${reason})`)

	// ── Cross back to the DON ──
	// Anything passed to a capability call on the DON runtime executes on
	// Workflow DON nodes and is NO LONGER confidential. So: the verdict, the
	// request id, and a deliberately coarse reason. Not the guardian refs, not
	// the approval count, not the policy. `quorum_not_met` says a threshold was
	// missed without saying by how much.
	const donRuntime = runtime.usingTheDons()

	const encodedPayload = encodeAbiParameters(
		parseAbiParameters('string requestId, string verdict, string reason'),
		[request.requestId, verdict, reason],
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
	return `${verdict} — ${reason} (request ${request.requestId})`
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
