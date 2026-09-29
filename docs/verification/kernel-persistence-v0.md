# Kernel persistence v0 evidence

Base: `313b2b711e64ccf19e45d057f915e99b5994ef9d` (PR #1).
Branch: `feat/kernel-persistence-v0`. Stacked on `feat/kernel-v0`; no merge/release.

IMPLEMENTED: server application command handler, validated domain reconstruction,
PostgreSQL records/constraints/RLS, policy/attempt locking, durable receipts,
atomic audit/outbox and explicit uncertain-commit handling.

TESTED LOCALLY: 123 unit tests; build/domain/application/test typechecks, lint
and architecture guard pass. Real PostgreSQL integration is pending remote CI
at initial publication. Local PostgreSQL could not be started: build dependency
installation was denied by the execution environment's user/group restrictions.
No fake database substitute or local integration pass is claimed.

ACCEPTED: pending independent architecture/security/quality review. ADR-008
remains proposed; this is its concrete implementation candidate.

## Required integration evidence

- Separate Node process reloads a completed workflow and replays its receipt.
- Two PostgreSQL connections finalize once; a stale competing key fails.
- Failures after evaluation/evidence/mastery/progression/projection/receipt/audit/outbox writes roll back all changes.
- Lost COMMIT acknowledgment is tested for both actual commit and rollback.
- Current session/consent/assignment and expiry are enforced before every retry.
- Session, consent and assignment revocations are tested in both lock orderings.
- Runtime role RLS/privileges, immutable finalized records, foreign provenance,
  owner-pool rejection and pooled identity cleanup are checked.
- Outbox records are invisible before commit and absent after rollback.

Exact-head CI links and results will be recorded in the draft PR after the run.
An older green Kernel v0 head is not evidence for this implementation.

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
