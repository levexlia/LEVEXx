# LEVEX Kernel v0 — implementation plan

Status: implementation plan; acceptance pending review.

## Current-state review (2026-09-29)

- GitHub `main`: `702a320a6981b7b2fb541de1e1e3925758541ac2`.
- Remote tree `730d8d931bf6d5c86fff1e7b266f579824a04b61` matches the local checkout exactly.
- TypeScript modular monolith, Fastify health endpoint, PostgreSQL bootstrap migration, one health unit test and one database integration test.
- ADR-001/002/003A/004/005/006/007 are accepted and were read in full.
- No domain, application authorization, identity, consent enforcement, artifact storage adapter, worker or outbox implementation exists in main. Other local branches are not the canonical baseline and are not imported implicitly.
- Architecture verification currently checks accepted ADR files only. Build typechecking excludes tests.
- Baseline format, lint, typecheck, architecture check and one unit test pass locally. Local Node 24.19.0/npm 11.9.0 differ from repository targets 24.21.0/11.19.0. Cached dependencies match lockfile versions; clean network installation is not yet verified.

## Objective and minimal boundary

Implement an isolated, synchronous TypeScript domain kernel for The First Machine. No database, HTTP, AI, UI or Unreal dependency. Existing identity is referenced by actor ID; user creation belongs to the future identity/application adapter.

Use one in-memory quest-attempt aggregate with private state. It owns acceptance, immutable artifact versions, draft/finalized evaluation revisions, evidence, mastery history, progression history and command receipts. Smaller modules own rubric, evidence, mastery and progression rules. There is no public state hydration, direct mastery setter or client evidence ingestion.

The application must supply authenticated principal, current online/session state and a freshly loaded consent policy. The aggregate also checks owner/assigned mentor, policy subject/expiry, expected version and idempotency. These are domain preconditions, not an authentication implementation. No mutation endpoint is exposed by this change.

Finalization computes revision, evidence, mastery, progression and events before replacing aggregate state once. A failure leaves state and receipts unchanged. This is in-memory atomicity only. ADR-005 durable transaction, RLS, audit and outbox remain mandatory before any API integration.

## Implementation sequence

1. Add `shared`, `quests`, `artifacts`, `rubrics`, `evaluations`, `evidence`, `mastery`, `progression` modules under `packages/domain`.
2. Implement accept → submit → draft evaluation → atomic finalization/evidence/mastery/progression. Emit event descriptions for later transactional outbox use.
3. Add a server catalog fixture for The First Machine and a versioned rubric; no global skill tree or narrative model.
4. Test happy path, invalid state, ownership/scope, policy expiry/revocation, revisions, input immutability, mandatory criteria, duplicate payload conflicts, stale versions and repeated progression.
5. Enforce domain dependency purity, typecheck tests, run existing verification and record exact evidence and limitations.
6. Publish an isolated feature branch and draft PR; do not merge or release.

## Explicit scope decisions

- Rubric semantics: mandatory criteria all MET → MASTERED; any mandatory evidence of capability (MET/PARTIAL) → PARTIAL; otherwise NOT_MASTERED. No finalized evaluation → UNASSESSED. Optional criteria cannot compensate for mandatory ones.
- The First Machine grants Character Control Level I and unlocks Physics Foundations once. This is a demonstrator quest, not a replacement for Pilot's four-assessed-quest product contract.
- Failed/partial assessments can be corrected with a new revision or new artifact version. Published revisions remain immutable. Revocation/downgrade after MASTERED is rejected in v0 pending an explicit policy; it is not silently ignored.
- One aggregate instance is one attempt. Replay and optimistic version checks are process-local. A future repository must enforce actor/quest uniqueness, durable receipts, evidence uniqueness and compare-and-swap/locking across processes in PostgreSQL.
- Consent/session/mentor assignment are supplied by trusted server code. Never construct context or catalog from a request body. Artifact bytes, digest authenticity, malware checks and ownership in object storage need the future upload adapter.
- Existing accepted ADRs remain unchanged. No claim of production, pilot or persistence readiness.

## Acceptance evidence

Domain-level acceptance requires a traceable successful loop, rejected negative cases, immutable histories, no duplicate rewards, passing lint/typecheck/unit/architecture/build checks and reviewable evidence. End-to-end client forgery, database races, RLS, audit/outbox delivery and real authentication remain NOT VERIFIED until application/persistence integration.
