# The release decision

How NextKey decides that a secret may be handed over, and why that decision runs inside a trusted execution environment.

## What the decision is

A secret in NextKey is released to someone other than its owner in one of two ways. Either the owner shares it deliberately — that path is pure ENSv2, a role granted on one record, and no decision logic is involved. Or the owner is *unavailable*, and the secret has to reach the people it was meant for anyway: a guardian-backed recovery, or an inheritance-style handover after prolonged inactivity.

The second path is where a decision has to be made, and it is the one that can be attacked.

## Why a quorum alone is not enough

Guardian schemes fail in a specific way: guardians are people. They can be deceived, pressured, impersonated, or simply persuaded by a plausible story — *"Simon lost his phone, can you confirm this for him"*. An attacker who reaches the quorum has the secret at the moment the last guardian approves. There is no second gate.

NextKey adds a waiting period. Guardians do not release a secret; they *start a clock*. During that window the owner is notified — through the channel they declared in their own ENS records — and can cancel. The attack now fails not because the guardians were smarter, but because the attacker would have to keep the owner away from their notifications for the whole window.

Two design details matter more than they look:

**The clock starts when quorum is reached, not when the request is filed.** Otherwise an attacker files a request quietly, lets the window elapse, and only then collects approvals — arriving at an instant release. Starting the clock at quorum guarantees the owner gets the full window *after* the dangerous event.

**The owner is notified twice**: once when a request is filed, once when quorum is reached. The first notification is the cheap early warning; the second starts the window that matters.

## Why this belongs in an enclave

The obvious answer — *"because the secret is sensitive"* — is not the interesting one. The secret material never needs to be in the decision at all; the decision only says yes or no.

The real reason is that **the guardian set is itself sensitive**. If who your guardians are, and which of them have already approved, is readable on-chain or by a node operator, then an attacker knows exactly whom to target and how many more they need. A public guardian list converts a security mechanism into a target list.

So the release request — the guardians, their approvals, the timing, the policy — is fetched into the enclave over a confidential HTTP call and evaluated there. What crosses back to the Workflow DON for consensus is a verdict and nothing else. Node operators learn that a decision was made; they do not learn who is protecting whom.

That is the property that makes the Confidential Workflow load-bearing rather than decorative: remove it, and NextKey either publishes its users' guardian graphs or asks them to trust our servers not to.

## The state the enclave evaluates

```json
{
  "requestId": "req_2026_09_05_001",
  "secret": "visa.alice.nextkey.eth",
  "policy": { "quorum": 2, "delaySeconds": 60 },
  "approvals": [
    { "guardianRef": "g1", "at": 1788560000 },
    { "guardianRef": "g2", "at": 1788560030 }
  ],
  "cancelledAt": null,
  "observedAt": 1788560100
}
```

Guardians appear as opaque references, not as ENS names or addresses. Even inside the enclave the decision does not need their identities — only how many distinct ones have approved. Not passing identity in at all is cheaper than protecting it.

## The rule

```
cancelledAt is set                          → DENY     (cancelled_by_owner)
distinct approvals < policy.quorum          → PENDING  (quorum_not_met)
observedAt < quorumReachedAt + delaySeconds → PENDING  (waiting_period)
otherwise                                   → RELEASE
```

`quorumReachedAt` is the timestamp of the approval that completed the quorum — the *k*-th earliest approval, where *k* is the quorum size.

## Determinism

The enclave result is attested and verified by DON consensus, so the decision function must be a pure function of its inputs. It therefore reads the evaluation time from the fetched payload (`observedAt`) rather than calling `Date.now()`, which would differ per node and break consensus.

This shifts trust for the current time onto the service that serves the request state — an honest limitation of this build, recorded here rather than hidden. Removing it means taking the timestamp from a source the DON agrees on, such as the trigger's own scheduled time or a block timestamp; that is the first thing to change if this ever leaves a hackathon.

## What crosses back

`requestId`, `verdict`, `reason` — ABI-encoded and signed as a CRE report.

Deliberately *not* crossed back: the guardian references, the number of approvals, the policy, and of course the secret. `reason` is coarse on purpose; `quorum_not_met` says a threshold was not reached without saying how far away it was.

The signed report is the authorization. Delivering it to a contract via `writeReport` is the next step and is out of scope for this build.
