# Prepared draft PR

Target repository: `levexlia/LEVEXx`

Base: `main`

Head: `feat/kernel-v0`

Title: `feat(domain): implement evidence-driven LEVEX Kernel v0`

Draft: true

## PR body

The canonical main branch contains only Gate 0 bootstrap code. It cannot yet
validate evidence or derive mastery and progression. This change adds a pure,
server-only TypeScript domain kernel for The First Machine.

The quest-attempt aggregate accepts a quest, versions submitted artifacts, and
lets the assigned mentor draft/finalize an evaluation. Finalization atomically
computes version-linked evidence, mastery history and a one-time Physics
Foundations unlock. Mandatory rubric criteria govern mastery. Immutable
snapshots and append-only finalized revisions retain the explanation for every
assessment.

Commands check participant/mentor scope, supplied server consent/session/online
policy, idempotency and expected version. The public API has no direct mastery,
progression or evidence setter. Replay returns a historical result with no new
events. Partial/failed assessments support new revisions; post-mastery correction
is explicitly deferred.

The architecture check now rejects domain dependencies on infrastructure, HTTP,
AI and ambient I/O/clock/random sources. Typechecking also covers tests and an
isolated domain build without Node/DOM types. No dependencies or accepted ADRs
change.

Validation: 97 unit tests pass in 4 files; format, lint, all typechecks,
architecture, build and a compiled workflow smoke test pass locally. Tests
cover ownership/version mismatches, invalid states, evidence reuse, mandatory
criteria, duplicate requests, stale writes, immutable history and finalization
rollback. Evidence: `docs/verification/kernel-v0.md` and
`build/kernel-v0-verification.json`.

Limits: no application/persistence adapter or mutation endpoint is introduced.
Process-local receipts do not prove durable concurrency, RLS or network-level
authorization. Real file validation, current policy loading, PostgreSQL
transaction/audit/outbox and integration/security verification are the next
gate. Local Node/npm are 24.19.0/11.9.0 versus repository targets
24.21.0/^11.19.0. Existing database regression, clean install and exact-head CI
must run remotely after publication. This is not a production or pilot release.

Review the aggregate boundary, rubric/provenance rules, policy contract and
deferred persistence obligations. No merge or release is requested.
