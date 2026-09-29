# Next slice: application and PostgreSQL persistence

Status: original implementation plan, now implemented as a candidate on
`feat/kernel-persistence-v0`; actual verification is recorded separately in
`docs/verification/kernel-persistence-v0.md`. The earlier Kernel v0 review patch
itself added no storage. Accepted ADR-001/002/004/005/006/007 remain binding.

## Objective

Run The First Machine using PostgreSQL as durable authority: after a process
restart the platform must show the same evidence-linked mastery/progression,
and retrying the same request must neither lose nor duplicate its outcome.

Start with a server application use case and real database tests. Keep the
public API health-only until authentication, current policy, file validation
and independent security verification are implemented. No UI, AI, Unreal,
economy, world state or Pilot progression expansion enters this slice.

## Implementation order

1. Freeze the server-only loading/receipt lifecycle contract in ADR-008 proposal.
   Define the validation rules for restoring authoritative records, schema
   versioning and command fingerprint normalization. Do not add a raw JSON
   restore method to the client-facing API.
2. Add a small application command handler and repository/transaction interfaces
   under `packages/application`. Keep domain transitions in `packages/domain`;
   SQL, connections, runtime roles and migrations live in infrastructure.
3. Add the minimum relational schema and constraints for the existing domain
   records, current aggregate version, command receipts, audit and outbox. Pin
   immutable quest/rubric/progression-rule versions. Ownership/version links
   must be enforceable, not inferred from unvalidated client IDs.
4. Implement a disposable loaded aggregate per transaction, with one transaction
   client for every read/write. Never use the shared connection pool midway
   through a command; never publish events or return success before commit.
5. Prove rollback, restart, concurrency, authorization/isolation and durable
   replay with two or more real database connections and runtime privileges.
6. Only then wire real identity/current-policy and verified-upload adapters.
   API exposure requires its own authorization and hostile-input tests.

Identity creation/authentication is not part of Domain. Canonical main has no
identity/consent implementation: database tests may use explicitly test-only
policy fixtures, but fixtures are not production authorization. Earlier local
identity branches require explicit source and compatibility review before use.

## Command transaction requirements

Authenticate → authorize → load current policy → validate → durable idempotency
→ expected version → Domain transition → append immutable rows/update projection
→ audit → outbox → committed receipt/response → COMMIT.

All writes, including receipt and response, are atomic in the same transaction.
Actual database ordering of row inserts must satisfy foreign keys without
exposing intermediate results. A matching committed receipt returns its original
result after fresh authorization and before stale-version rejection. A changed
payload in the same receipt scope fails. Participant and mentor namespaces are
separate even if their key strings match.

State/version writes and policy revocation must share a defined serialization
strategy. A lock on the quest attempt alone does not prevent consent or mentor
assignment changing between validation and commit. The implementation must
document locking order/isolation and test both commit orderings. Do not claim
that a one-time boolean check proves revocation enforcement.

No external authentication network call, object-storage download, AI call or
event publication belongs inside the transaction. Resolve external work before
it, then validate authoritative server policy and verified artifact references
inside it. Uncertain database commit results are resolved by durable receipts,
not a local memory flag or a blind new command key.

## Minimum persisted relationships

| Data                       | Required link or constraint                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Quest attempt              | Server owner, assigned mentor, immutable quest version, unique attempt identity and current version        |
| Artifact version           | Attempt/owner, stable artifact identity, immutable version, verified content hash and object version       |
| Evaluation revision        | Attempt/owner/mentor, exact artifact and rubric versions, predecessor revision, immutable finalized values |
| Evidence                   | Exact finalized evaluation revision, artifact version, rubric/quest versions and matching owner            |
| Mastery history/projection | Domain-derived state with exact evidence and evaluation/artifact/rubric provenance                         |
| Progression                | Domain-derived unlock with mastery/evidence and rule-version provenance; semantic unlock uniqueness        |
| Command receipt            | Attempt + actor + role + key, normalized fingerprint/version and original committed response               |
| Audit/outbox               | Same committed aggregate version and command identity, stable unique event identity                        |

Do not enforce global uniqueness on artifact content hashes: identical files
can have legitimate distinct owners. Cross-quest evidence reuse and the scope of
repeatable quest attempts need explicit product rules; this single-quest slice
must not silently define the full skill tree or Pilot's four-quest progression.

## Verification gates

| Gate       | Required result                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------ |
| PERSIST-01 | Full loop persists; independent reload produces the same provenance and unlock.                                    |
| PERSIST-02 | Crash/restart and identical retry return the prior result without new history/audit/outbox/reward rows.            |
| PERSIST-03 | Competing finalizations: exactly one commits; identical retry replays, conflicting payload/version fails.          |
| PERSIST-04 | Failure after each write stage rolls back every new row and version. Retrying succeeds once.                       |
| PERSIST-05 | Lost commit acknowledgment resolves to committed receipt or safe re-execution after definitive rollback.           |
| PERSIST-06 | Invalid ownership/version links and corrupt persisted projection/history fail loading.                             |
| PERSIST-07 | Runtime role + RLS deny cross-user reads/writes and forbidden finalized-history modification.                      |
| PERSIST-08 | Consent/session/mentor revocation and stale session reject fresh and duplicate commands; race ordering is tested.  |
| PERSIST-09 | Outbox is invisible before commit; rolled-back events are never delivered; duplicate delivery has no extra effect. |
| PERSIST-10 | Pooled connections do not retain another actor's context; no privileged runtime shortcut bypasses isolation.       |

Passing the current Gate 0 PostgreSQL integration test proves only the bootstrap
table/migration. It is not evidence for any gate above. Review and independent
security verification remain separate from implementation and test completion.
