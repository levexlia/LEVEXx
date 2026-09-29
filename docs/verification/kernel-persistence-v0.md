# Kernel persistence v0 evidence

Base: `313b2b711e64ccf19e45d057f915e99b5994ef9d` (PR #1).
Branch: `feat/kernel-persistence-v0`. Stacked on `feat/kernel-v0`; no merge/release.

IMPLEMENTED: server application command handler, validated domain reconstruction,
PostgreSQL records/constraints/RLS, policy/attempt locking, durable receipts,
atomic audit/outbox and explicit uncertain-commit handling.

TESTED LOCALLY: 123 unit tests; format, build/domain/application/test typechecks,
lint, architecture guard and build pass. Local PostgreSQL could not be started:
build dependency installation was denied by the execution environment's
user/group restrictions. No local database pass is claimed.

VERIFIED IN CI: both Gate 0 runs passed on code head
`5fac4d95f4d9eee29ace27a03ae6f6ae54c7bb73`: Node 24.21.0, npm 11.19.0,
PostgreSQL 18.6, 123 unit tests and 35 integration tests (34 kernel + 1 bootstrap).
Clean install, formatting, lint, all typechecks, architecture, migrations,
build, secret scan and dependency audit also passed.

- [PR CI](https://github.com/levexlia/LEVEXx/actions/runs/36639684368)
- [Push CI](https://github.com/levexlia/LEVEXx/actions/runs/36639678691)
- [Draft PR #2](https://github.com/levexlia/LEVEXx/pull/2)

Recorded outputs and 47 source hashes: `build/kernel-persistence-v0-verification.json`,
`build/kernel-persistence-v0-verification.log` and `build/kernel-persistence-v0-ci.log`.
The evidence-only follow-up retains identical implementation/test hashes; its
own current-head CI is checked and recorded in PR #2 before delivery.

ACCEPTED: pending independent architecture/security/quality review. ADR-008
remains proposed; this is its concrete implementation candidate.

## Verified integration behavior

- Separate Node process reloads a completed workflow and replays its receipt.
- Two PostgreSQL connections finalize once; a stale competing key fails.
- Failures after evaluation/evidence/mastery/progression/projection/receipt/audit/outbox writes roll back all changes.
- Lost COMMIT acknowledgment is tested for both actual commit and rollback.
- Current session/consent/assignment and expiry are enforced before every retry.
- Session, consent and assignment revocations are tested in both lock orderings.
- Runtime role RLS/privileges, immutable finalized records, foreign provenance,
  owner-pool rejection and pooled identity cleanup are checked.
- Outbox records are invisible before commit and absent after rollback.

Lost-acknowledgment tests inject failure at the pg-client boundary after a real
COMMIT or ROLLBACK; they are not physical network/power-failure chaos tests.
Revocation tests inspect `pg_blocking_pids` to establish real contention.
The expiry test waits for actual database time after evidence was inserted,
then verifies that the pre-commit policy check rolls all writes back.

The separate [GitHub AI scan](https://github.com/levexlia/LEVEXx/actions/runs/36639685400)
failed with `CAPIError: 400 The requested model is not supported`
(job 109648765365). It did not complete an independent/security review. No
security control was disabled, and that failure is not counted as a pass.

Initial remote run on `632f8dc463cbd6620d002c6ed9951e03c6614219`:
PostgreSQL migration passed; 33 of 34 integration tests passed (including the
existing bootstrap test). One foreign-provenance fixture reused an evaluation
already protected by UNIQUE, so PostgreSQL rejected it with `23505` before the
expected FK `23503`. The corrected fixture directly references an existing
foreign artifact from a new evaluation; the assertion remains a strict FK
failure. This is a test-fixture correction, not a relaxation of constraints.
Revocation tests also now observe actual lock waits through `pg_blocking_pids`,
and an additional real-time expiry test checks rollback before commit.

## Persistence gate disposition

| Gate          | Status                       | Evidence scope                                                                                                        |
| ------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| PERSIST-01/02 | PASS                         | Full loop; new Node process and connections replay the saved result                                                   |
| PERSIST-03    | PASS                         | Two backend PIDs, one commit/reward; identical replay and stale competing key                                         |
| PERSIST-04    | PASS                         | Failure after each of eight finalization write stages leaves original state/counts                                    |
| PERSIST-05    | PASS                         | Injected lost acknowledgment with real committed and rolled-back outcomes                                             |
| PERSIST-06    | PASS in tested scope         | Unit corruption cases; relational projection mismatch, foreign artifacts and composite FK isolation                   |
| PERSIST-07    | PASS in adapter scope        | Constrained runtime login, RLS, denied policy/history writes, finalized-history triggers, owner-pool rejection        |
| PERSIST-08    | PASS in fixture policy model | Session/consent/assignment revocation; stale/expired retries; actual lock waits in both orderings; expiry during work |
| PERSIST-09    | PARTIAL                      | Atomic outbox visibility/rollback passes; delivery worker and consumer deduplication not implemented                  |
| PERSIST-10    | PASS                         | Single pooled connection loses identity context after success and rollback                                            |

These results establish the application/database slice, not production identity,
complete consent semantics, an independently reviewed release or a public API.

## Remaining limits

Production identity/consent provisioning, verified uploads, mutation endpoints,
worker delivery/consumer deduplication, history-volume bounds and independent
security/quality acceptance remain outside this slice. PERSIST-09 delivery
deduplication is not implemented; commit visibility is the covered part.

The authenticator and policy provisioning used by integration tests are clearly
test-only fixtures. No public API can invoke these mutations yet. RLS trusts
authenticated server context; it is not a sandbox for compromised server SQL.

See `packages/infrastructure/database/kernel/README.md` for the contract,
permissions, lock order, receipt interpretation/retention and operational limits.
