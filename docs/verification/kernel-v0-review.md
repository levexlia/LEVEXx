# Kernel v0 engineering self-review

Date: 2026-09-30 (Asia/Jerusalem).
Reviewed source: PR #1, commit `6a981c86099248f388c362486c28f675bffc4420`.

Review type: implementation-owner engineering self-review. This is not an
independent security review, pentest or acceptance decision. The PR had no
submitted reviews when inspected. Its separate GitHub AI scanning job failed
with `400 The requested model is not supported`; no successful scan is inferred.

## Findings and disposition

| ID     | Finding                                                                                                                                                                                                         | Evidence                                                                                                                           | Disposition                                                                                                                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K0-R01 | Receipts used a bare idempotency key for the entire attempt. A participant could reserve a key that the assigned mentor independently used, causing an unrelated valid command to fail.                         | New participant/mentor namespace regression failed with `IDEMPOTENCY_CONFLICT` on the reviewed commit.                             | FIXED: namespace is attempt + authenticated actor ID + role + key. Each principal independently replays its own result; changed payload in the same scope still fails.                       |
| K0-R02 | Fingerprinting serialized the entire structurally typed principal object. Additional server session metadata changed the fingerprint, incorrectly rejecting an otherwise identical retry after session refresh. | New metadata-refresh regression failed with `IDEMPOTENCY_CONFLICT` on the reviewed commit.                                         | FIXED: only declared stable actor ID and role participate in identity/fingerprint. Fresh authorization/session/consent checks still run before every retry.                                  |
| K0-I01 | `execute` mutates memory before any future PostgreSQL commit. A cached aggregate surviving database rollback could return a receipt for an operation never durably committed, with events suppressed.           | Code review: state and receipt are replaced inside `QuestAttempt.execute`; there is no database transaction/hydration adapter yet. | Integration requirement, not an exposed database bug: one aggregate per transaction; discard on success, rollback and uncertain commit outcome; reload authoritative records on every retry. |
| K0-I02 | The kernel intentionally has no validated repository hydration or durable receipts. Building a new instance per request without these would lose version/history and replay protection.                         | Public constructor creates AVAILABLE/version 0 and an empty private receipt map.                                                   | Next-stage gate: implement validated server-only loading plus transaction-scoped durable receipts before connecting mutations to an API.                                                     |

K0-R01 and K0-R02 are correctness/availability defects. The reproductions did
not show unauthorized mastery, duplicate rewards or cross-account disclosure.
Both are fixed without changing rubric outcomes, progression rules or accepted
ADRs. Existing in-memory receipts are ephemeral; no data migration is needed.

## Verification

1. Added two regressions before editing implementation. Both failed on the
   reviewed code with the expected idempotency conflict.
2. Changed only receipt scoping and stable principal normalization in domain code.
3. All 99 unit tests pass, including the existing ownership, revocation, stale
   version, immutable-history, mandatory-rubric and atomic-finalization cases.
4. Captured follow-up format/lint/type/architecture/unit/build checks and hashes
   in `build/kernel-v0-review-verification.json` and its log. Initial evidence
   remains historical in `build/kernel-v0-verification.json`.
5. Exact-head remote CI must be checked after publication; the PR description
   records the result without treating an earlier successful head as current.

## Boundary review

- Public mutations do not accept mastery, progression or evidence state.
  Snapshots/history are deeply frozen; own/assigned-mentor checks precede retries.
- Finalization computes candidate evaluation/evidence/mastery/progression before
  replacing state. The failure-injection test covers an exception in the final
  computation. This does not establish database atomicity.
- The current API exposes only health. Identity, current mentor assignment,
  policy provenance, file authenticity, persistence/RLS and restart-safe
  deduplication are not implemented or verified by the domain tests.
- MASTERED remains terminal in v0; a post-mastery revocation/correction policy
  is not invented during this review.
- Static architecture checks and TypeScript boundaries are engineering guards,
  not a security sandbox for malicious code executing inside the server.

## Next action

Implement the isolated application/PostgreSQL slice described in
`docs/architecture/kernel-v0-persistence-plan.md`, subject to the proposed
transaction/hydration contract in `ADR-008-proposal.md`. The source review
does not authorize merge, public mutation endpoints or a pilot release.
Independent architecture/security/quality review remains outstanding.
