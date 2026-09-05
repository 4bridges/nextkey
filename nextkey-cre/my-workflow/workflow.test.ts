import { describe, expect, it } from 'bun:test'
import { decide, requestHashOf } from './workflow'
import fixture from '../../fixtures/release-request.json'

/**
 * The release decision, as executable assertions.
 *
 * `decide()` is deliberately a pure function so that the security properties of
 * the release rule can be stated as tests rather than as prose. Everything the
 * enclave protects flows through it; nothing but its return value leaves.
 *
 * The template's original handler-level test is gone. It exercised the shipped
 * example (score over an echoed response) and no longer type-checks against our
 * config. It also had to hand-build a fake `TeeRuntime`, because — as the
 * template itself notes — the public test surface does not yet ship a TEE
 * runtime factory. Testing the extracted decision instead is both honest and
 * more useful: the plumbing is proven by `cre workflow simulate`, the logic is
 * proven here.
 */

const req = (over: Partial<Parameters<typeof decide>[0]> = {}) => ({
	requestId: 'req_test',
	secret: 'visa.alice.nextkey.eth',
	policy: { quorum: 2, delaySeconds: 60 },
	approvals: [
		{ guardianRef: 'g1', at: 1_000 },
		{ guardianRef: 'g2', at: 1_030 },
	],
	cancelledAt: null,
	observedAt: 1_200,
	...over,
})

describe('release decision', () => {
	it('releases once the quorum is met and the waiting period has elapsed', () => {
		expect(decide(req())).toEqual({
			verdict: 'RELEASE',
			reason: 'quorum_and_delay_satisfied',
		})
	})

	it('holds while the waiting period is still running', () => {
		// quorum reached at 1030, delay 60 → releasable at 1090
		expect(decide(req({ observedAt: 1_089 }))).toEqual({
			verdict: 'PENDING',
			reason: 'waiting_period',
		})
	})

	it('releases exactly at the boundary, not one second later', () => {
		expect(decide(req({ observedAt: 1_090 })).verdict).toBe('RELEASE')
	})

	it('holds while too few guardians have approved', () => {
		expect(decide(req({ approvals: [{ guardianRef: 'g1', at: 1_000 }] }))).toEqual({
			verdict: 'PENDING',
			reason: 'quorum_not_met',
		})
	})

	it('counts a guardian once, however often they approve', () => {
		// Without de-duplication a single compromised guardian could reach any
		// quorum on their own.
		const spammed = req({
			approvals: [
				{ guardianRef: 'g1', at: 1_000 },
				{ guardianRef: 'g1', at: 1_001 },
				{ guardianRef: 'g1', at: 1_002 },
			],
		})
		expect(decide(spammed).reason).toBe('quorum_not_met')
	})

	it('starts the clock when the quorum is reached, not when the request was filed', () => {
		// The security property this rule exists for. An attacker files early,
		// lets the window elapse quietly, and only then collects approvals — if
		// the clock ran from the first approval, that would release instantly.
		//
		// First approval at 1000, quorum completed at 5000, delay 60.
		// Releasable at 5060, not at 1060.
		const late = req({
			approvals: [
				{ guardianRef: 'g1', at: 1_000 },
				{ guardianRef: 'g2', at: 5_000 },
			],
			observedAt: 5_059,
		})
		expect(decide(late).reason).toBe('waiting_period')
		expect(decide({ ...late, observedAt: 5_060 }).verdict).toBe('RELEASE')
	})

	it("denies a cancelled request even when everything else is satisfied", () => {
		// The owner's veto beats quorum and elapsed time. This ordering is the
		// whole point of the waiting period.
		expect(decide(req({ cancelledAt: 1_100 }))).toEqual({
			verdict: 'DENY',
			reason: 'cancelled_by_owner',
		})
	})

	it('releases immediately when the policy sets no delay', () => {
		expect(
			decide(req({ policy: { quorum: 2, delaySeconds: 0 }, observedAt: 1_030 })).verdict,
		).toBe('RELEASE')
	})

	it('requires the full quorum even when it is one', () => {
		expect(
			decide(req({ policy: { quorum: 1, delaySeconds: 0 }, approvals: [], observedAt: 9_999 }))
				.reason,
		).toBe('quorum_not_met')
	})
})

/**
 * Binding a verdict to the request it judged.
 *
 * The enclave's inputs are invisible by design, and that creates a gap: "the
 * enclave approved this" cannot be checked unless the verdict says *what* it
 * approved. It does, by carrying the hash of the public request record.
 *
 * The string under test is not invented here. `agent.mjs fixture` reads it
 * verbatim from `agent.nextkey.eth \u00b7 nextkey.request` on Sepolia, and the
 * expected hash is the one `agent.mjs propose` printed when the agent filed
 * it \u2014 computed at write time, from the other end of the chain. So this
 * asserts that the enclave and the chain agree about what was asked.
 *
 * It also means the fixture cannot be quietly edited: any change to the
 * request, including one that only reorders its keys, fails here.
 */
describe('binding to the on-chain request', () => {
	const onChainRequest = fixture.onChainRequest

	it('reproduces the hash the agent published on chain', () => {
		expect(requestHashOf(onChainRequest)).toBe(
			'0xb74ac56696e0e84612546123e2ec0a495a5b071be625b10141f2af4f59ce5336',
		)
	})

	it('changes if a single field of the request changes', () => {
		const tampered = onChainRequest.replace('anna.nextkey.eth', 'mallory.nextkey.eth')
		expect(tampered).not.toBe(onChainRequest)
		expect(requestHashOf(tampered)).not.toBe(requestHashOf(onChainRequest))
	})

	it('parses into a request naming the secret and the recipient', () => {
		const parsed = JSON.parse(onChainRequest)
		expect(parsed.v).toBe(1)
		expect(parsed.secret).toBe('visa.nextkey.eth')
		expect(parsed.recipient).toBe('anna.nextkey.eth')
	})
})
