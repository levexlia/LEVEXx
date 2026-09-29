# ADR-008 proposal: Transaction-scoped kernel loading and durable command receipts

Status: proposed

Date: 2026-09-30 (Asia/Jerusalem).
Extends ADR-002/004/005/006; does not supersede them.

## Context

Kernel v0 has a private in-memory aggregate and immutable output records. It
does not load persisted state. `execute` updates memory immediately, so wrapping
a long-lived cached object in a database transaction would violate ADR-005 if
the transaction rolls back or the commit response is lost.

## Proposed decision

1. Treat each loaded aggregate as disposable, private to one server transaction.
   Do not reuse it from caches after a commit, failure or uncertain outcome.
2. Add a server repository loader that reconstructs and validates the complete
   required immutable history plus current projection from authoritative rows.
   No request-body snapshot, client actor/role or client mastery state may be
   used for reconstruction. Corrupt/inconsistent provenance fails closed.
3. Use durable command receipts scoped by aggregate, authenticated actor ID,
   role and idempotency key. Bind the normalized command, expected version,
   stable principal identity and normalization/schema version. Exclude session
   tokens, request tracing fields, current time and mutable policy metadata.
4. Reauthenticate/reauthorize and load current policy on every command and retry.
   Resolve a matching committed receipt before rejecting its original expected
   version. A mismatched fingerprint is a conflict. A retry publishes no events.
5. Persist new version/history, receipt/response, audit and outbox in the same
   PostgreSQL transaction. Only return success after COMMIT is acknowledged.
   If COMMIT's outcome is unknown, discard memory and resolve the key against
   authoritative PostgreSQL state on the next authenticated retry.
6. Domain TypeScript computes mastery/progression. PostgreSQL enforces structural
   uniqueness, ownership relationships, immutable-history protection, RLS and
   atomic writes. Database SQL must not decide rubric/mastery outcomes.

This proposes validated relational reconstruction, not event sourcing. Returned
domain events remain outbox descriptions; no event bus or external calls are
introduced into the critical transaction.

## Required proof before acceptance

- A restart preserves progression/evidence and replay identity.
- Two database connections cannot finalize/reward the same attempt twice.
- Rollback after any write leaves no partial history, receipt, audit or outbox.
- A lost commit response is safely resolved through the durable receipt.
- Retry after consent/session/mentor revocation is denied even with an existing
  successful receipt; policy changes and mutation commit are correctly serialized.
- Foreign or inconsistent artifact/evaluation/evidence/owner/version links fail
  repository loading and cannot be converted into a trusted aggregate.
- Runtime-role RLS and privileges reject cross-account access and forbidden
  history mutations, including pooled-connection context leakage.
- Accepted implementation documents fingerprint normalization stability and
  receipt retention. Silent receipt expiry must not enable duplicate progression.

## Alternatives considered

- Long-lived mutable aggregates: rejected because database rollback cannot undo
  in-memory receipts/state safely.
- Rebuilding AVAILABLE state per request: rejected because versions and history
  disappear, and rewards can be repeated.
- Event sourcing: deferred; immutable relational history and a transactional
  outbox meet the current scope without that additional architecture.

Acceptance requires architecture/security review of the concrete implementation
and integration evidence. This proposal alone does not mark those gates passed.

## Concrete v0 candidate

`feat/kernel-persistence-v0` implements the candidate without changing this
proposal to accepted. Relational records and current projection are stored
alongside version-1 immutable command receipts with historical responses.
Repository loading re-applies deterministic commands for integrity verification
and compares all historical results, current record tables, audit and outbox.
Events are not the restoration source. This bounded full-history validation
has explicit storage/loading costs; receipt interpretation and retention cannot
change silently. See the adapter README and persistence verification report.

The candidate uses READ COMMITTED with session FOR SHARE, subject consent
FOR SHARE, then attempt FOR UPDATE. Administrative revocation paths must follow
the same order when locking multiple rows. Catalog/attempt/policy provisioning
is test-only at this stage; production authorization and API exposure remain a
separate gate.
