# Kernel PostgreSQL adapter v0

Implementation candidate for ADR-008; acceptance and independent security review remain separate. The public API still exposes only health. No credentials, identity provider, legal consent capture, verified-upload pipeline or delivery worker is supplied by this slice.

## Command lifecycle

`ExecuteKernelCommand` resolves identity through the server `Authenticator` port before opening a transaction. PostgreSQL then verifies the matching current session, subject consent and mentor assignment. Request bodies cannot supply policy, ownership, mastery or restoration snapshots.

The adapter uses one checked-out connection and one disposable aggregate. At READ COMMITTED it acquires locks in the order session FOR SHARE, subject consent FOR SHARE, attempt FOR UPDATE. The initial attempt read discovers its immutable subject only; the locked attempt is reread. Revocation writers update the corresponding policy row and therefore serialize with active commands. Multi-row administrative operations must use this same lock order. External authentication/storage/AI/event publication must not run inside the transaction.

The server database clock is sampled after lock acquisition and checked again before COMMIT, including session/consent expiry. Revocations remain locked through commit. Time-based validity is checked at the final policy check; this is not a promise of zero clock advance between the last statement and commit acknowledgment.

Domain executes after loading. A successful new command appends or finalizes records, advances the projection with expected-version comparison, appends its receipt, structured audit and outbox descriptions. A replay returns the original result with no events after fresh authorization. All writes commit together; no success is returned before COMMIT acknowledgment.

If the COMMIT response is lost, the connection is destroyed and the caller receives `COMMIT_OUTCOME_UNKNOWN`. Retry the original command, expected version and key after reauthentication. A committed receipt replays; a definitively rolled-back transaction executes once. No automatic retry using a new key is performed.

## Storage and reconstruction

- Catalog, artifact versions, evidence, mastery, progression, receipts, audit and outbox are append-only. Triggers also protect history from ordinary owner UPDATE/DELETE/TRUNCATE. Owners/superusers can change schema and remain trusted operators.
- Evaluation drafts may transition to FINALIZED once, preserving every field except status/finalized time. Later corrections append revisions. MASTERED remains terminal under v0 rules.
- Generated relational keys and foreign keys bind each record to the same attempt and owner, and evidence to the exact finalized evaluation/artifact/rubric. Mastery and unlock links retain provenance. SQL does not compute rubric outcomes.
- Current projection plus typed relational record tables are loaded independently. Domain re-applies deterministic transitions from ordered immutable command receipts to verify all historical responses, then compares the reconstructed state with those rows. Audit/outbox are checked against the same receipts. Invalid/missing/inconsistent history fails closed.
- This is bounded command-history validation for the first vertical slice, with no domain-event replay, event bus or event-sourcing framework. Complete historical responses are retained; storage and restoration costs grow with history. Version-1 interpretation must remain stable across software upgrades. A future bounded-history/checkpoint design requires its own compatibility/retention decision.
- Fingerprint version 1 binds normalized command, expected version, actor ID and role, with ordinal string ordering. Attempt scope is the containing aggregate. Session ID, credentials, time and tracing metadata are excluded. Keys/receipts have no silent expiry. Do not prune receipts or compact histories with ordinary application SQL.
- One attempt per participant/catalog version and one semantic unlock per participant/target are structural uniqueness guards. Repeatable quests, cross-version reassessment, cross-quest mastery aggregation and post-mastery revocation require explicit future rules. A conflicting unlock aborts the transaction; it is never paid twice.

## Runtime permissions

Migration `1790719200000_kernel-persistence` creates schema `levex_kernel` and a NOLOGIN `levex_kernel_runtime` role. Bootstrap migrations need schema/role creation privileges. Provision a separate non-superuser, non-owner, NOBYPASSRLS server login inheriting that role; never use the migration account for application commands. The adapter rejects superusers, BYPASSRLS and direct schema/table owners.

No client/participant/mentor receives database credentials. Transaction-local actor/session settings are established only from authenticated server identity. RLS is defense in depth against application query mistakes; arbitrary SQL execution with server credentials can impersonate those settings and is outside this isolation guarantee.

The runtime can read scoped data and write only transition records/projection columns. It cannot provision attempts/catalog, change assignment/consent/session policy or mutate history. Policy tables grant UPDATE only on a constant false `lock_token` column so FOR SHARE has the PostgreSQL-required locking privilege; CHECK prevents changing that token. Actual policy columns are not writable by runtime.

Identity, policy and attempts are provisioned by test-only fixtures in this PR. Those fixtures are not a production authentication/consent administration system. Deployment needs independently reviewed provisioning/revocation paths using the lock order above, verified artifact ownership/digests, request limits and a separately permissioned outbox worker. Delivery acknowledgments are not stored by mutating immutable event rows.

Migration down drops the schema and is destructive; use only in a disposable database or through a reviewed data migration. It retains the cluster-wide NOLOGIN role. No deployed data is migrated by this draft PR.

## Verification

`tests/integration/kernel-persistence.test.ts` runs with a real PostgreSQL database and creates an ephemeral constrained login. It covers a separate Node process, simultaneous connections, injected write failures, uncertain commits, revoked/expired policies, both revocation lock orderings, RLS/privileges, foreign provenance and pooled context cleanup. `DATABASE_URL` is the **test migration/admin** account; application tests use the constrained login derived from it, not that privileged pool.

Worker delivery and consumer deduplication are not implemented. The test proves outbox commit visibility and rollback, not exactly-once external delivery. See `docs/verification/kernel-persistence-v0.md` for actual run evidence and remaining gates.

Reference semantics: [PostgreSQL row locking](https://www.postgresql.org/docs/18/explicit-locking.html), [RLS and owner/BYPASSRLS limits](https://www.postgresql.org/docs/18/ddl-rowsecurity.html), and [SELECT locking privileges](https://www.postgresql.org/docs/18/sql-select.html).
