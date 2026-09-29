# Kernel v0 verification evidence

Date: 2026-09-29. Base: `702a320a6981b7b2fb541de1e1e3925758541ac2`.
Branch: `feat/kernel-v0`.

**IMPLEMENTED / TESTED:** pure server domain kernel and executable architecture constraints.
**VERIFIED LOCALLY:** the in-memory business workflow and the checks below.
**ACCEPTED:** pending review. No production/pilot/end-to-end readiness claim.

## Result

The First Machine can execute Quest accepted → Artifact submitted → Evaluation
finalized → Evidence verified → Character Control Level I MASTERED → Physics
Foundations unlocked. Finalization computes all records before replacing state.
Caller-visible snapshots, finalized revisions and their provenance are immutable.
No client/mentor/AI command directly sets mastery or progression.

The existing Fastify API remains a health-only bootstrap. No persistence,
authentication system, domain mutation endpoint or database migration was added.

## Checks

| Check                         | Local result             | Scope                                                                              |
| ----------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| Format                        | PASS                     | Entire repository                                                                  |
| ESLint                        | PASS                     | Entire repository                                                                  |
| Typecheck                     | PASS                     | Build, isolated Domain (no Node/DOM types), tests                                  |
| Architecture                  | PASS                     | Accepted ADRs and domain import/global constraints                                 |
| Unit tests                    | PASS, 97 tests / 4 files | Existing health plus kernel and architecture tests                                 |
| Build                         | PASS                     | TypeScript emit                                                                    |
| Compiled smoke                | PASS                     | Built CommonJS kernel executes complete loop                                       |
| Diff whitespace               | PASS                     | `git diff --check`                                                                 |
| Database integration          | NOT RUN locally          | No PostgreSQL executable/service available; unchanged bootstrap test remains in CI |
| Clean dependency installation | NOT VERIFIED locally     | Cached packages match lockfile versions; `npm ci` is a CI gate                     |
| Remote CI                     | PENDING at publication   | Write access restored; inspect the PR checks for the exact published head          |

Local environment: Node `24.19.0`, npm `11.9.0`. Repository target:
Node `24.21.0`, npm `^11.19.0`. No lockfile or dependency versions changed.
Captured command results and source SHA-256 values are in
`build/kernel-v0-verification.json`; command output is in
`build/kernel-v0-verification.log`.

## Invariant-to-test mapping

| Rule                                                                     | Evidence                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Full loop with exact artifact/rubric/evaluation/evidence linkage         | `kernel.test.ts`: The First Machine domain loop                       |
| Evidence before reward; mandatory versus optional criteria               | Full-loop tests and rubric/catalog validation tests                   |
| Immutable history; corrections append new revisions                      | Revision and resubmission tests; nested freeze/input isolation test   |
| Owner and assigned mentor; consent subject/status/expiry; online session | Policy/actor tests                                                    |
| Other participant's artifact/evaluation/evidence/mastery rejected        | Workflow negative tests and versioned evidence/progression invariants |
| Draft evaluation cannot produce evidence/mastery                         | `kernel-invariants.test.ts`: finalization requirements                |
| Reused evidence and duplicate progression rejected                       | Provenance/progression tests; finalization replay tests               |
| Duplicate commands return historical results without new events          | Replay of all four commands, late retry, revoked-policy retry         |
| Reused key with changed payload fails                                    | Idempotency conflict test                                             |
| Stale expected version loses; errors consume no version/receipt          | Competing command, invalid version and retry tests                    |
| Finalization failure leaves all state unchanged                          | Injected failure in final progression computation; successful retry   |
| Domain independent of PostgreSQL/HTTP/AI/runtime globals                 | Executable architecture fixtures and isolated domain typecheck        |

## Material limitations and next gate

1. Idempotency, event uniqueness and optimistic concurrency are process-local,
   scoped to one aggregate. They are not restart-safe or cross-process guarantees.
2. Server-supplied principal/policy data are trusted inputs. These tests do not
   prove real authentication, session revocation, RLS or network-level client
   forgery prevention. No mutation endpoint is exposed.
3. SHA-256 and object-version references are validated structurally. Actual file
   ownership, digest authenticity and malicious-file handling need an upload adapter.
4. Post-MASTERED correction/revocation, global evidence reuse, durable catalog
   publication and Pilot's four-assessed-quest progression need their own policies
   and implementation. This sample does not redefine Pilot product scope.
5. Before connecting an API, implement ADR-005 in PostgreSQL: authorization/current
   policy, durable receipts and expected-version locking, revision/evidence/history,
   mastery/progression, audit and outbox in one transaction. Prove concurrency,
   rollback, isolation, revoked sessions/consent and duplicate requests with real
   integration tests. Domain business computation remains in TypeScript.

Next action: review this domain boundary, then implement the application and
PostgreSQL adapter with independent security/quality review. No merge or release
is performed by this change.

## Delivery history

Initial delivery attempt (2026-09-29): implementation commit `b2be634` (local feature branch). GitHub repository read access succeeded, and current main/tree were verified. Creating the new Git tree returned HTTP 403 `Resource not accessible by integration`. No source change, feature branch or PR was published. The connected account repository metadata reports push permission, but the integration write operation itself was denied. Managed installations returned none; this runtime has no configured Git credential helper or GitHub token. No access-control bypass was attempted.

Resumed delivery (2026-09-30, Asia/Jerusalem): the user reconnected GitHub and requested a retry. Source upload succeeded; GitHub returned tree `ce327a38f8e8b39ea67fc2384617a38c6ae0a239`, exactly matching the local prepared source. The access blocker is closed. These documentation updates record the recovery before publishing the feature branch and draft PR. Check the PR for exact-head remote CI results; local test evidence above is unchanged. PR text is prepared in `docs/verification/kernel-v0-pr.md`. Do not merge or release.
