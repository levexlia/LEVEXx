# LEVEX Domain Kernel v0

Server-only TypeScript domain code. No HTTP, database, AI, client, implicit clock or random source. Import the public API from `packages/domain/index.ts`.

The unit of consistency is one `QuestAttempt`. Private state, immutable snapshots and domain transitions enforce the business invariants. Records are versioned facts produced by these transitions, not writable client state.

```ts
import { FIRST_MACHINE, QuestAttempt } from "./packages/domain";

const attempt = new QuestAttempt({
  instanceId: "server-allocated-attempt-id",
  participantId: "authenticated-participant-id",
  mentorId: "server-assigned-mentor-id",
  quest: FIRST_MACHINE,
});

// Context MUST come from server authentication, current session and consent data.
// Never spread a request body into context, catalog, ownership or policy objects.
const result = attempt.execute(
  { type: "accept-quest" },
  { idempotencyKey: "request-id", expectedVersion: 0 },
  trustedServerContext
);
```

`tests/unit/kernel-fixtures.ts` and `kernel.test.ts` show the complete executable loop. Artifact submissions carry a server-verified SHA-256 and private storage object version reference; storage verification itself is not implemented here.

Commands are `accept-quest`, `submit-artifact`, `draft-evaluation`, `finalize-evaluation`. Participants accept/submit; only the assigned mentor drafts/finalizes. Finalization validates and computes all of evaluation, evidence, mastery and progression in one synchronous transition. There are no grant-mastery, client-evidence, AI-write or restore-from-JSON commands.

Each successful command increments the aggregate version. Idempotency keys are scoped to the quest attempt, authenticated actor ID and role. A participant and the assigned mentor can use the same key independently. The fingerprint binds normalized command, expected version and only that stable principal identity; unrelated server/session metadata is excluded. An identical retry is reauthorized, returns the historical snapshot, emits no new events and never rewinds current state. A reused key with different content in the same scope fails. A new key with a stale version fails. Failed commands consume neither version nor receipt. Assessment ordering is normalized for retries.

The published rubric, artifact version and finalized revision are retained. Amendments create another revision after non-mastered/partial assessments. MASTERED is terminal in this v0 aggregate; revocation/downgrade workflows require an explicit policy and implementation. Optional criteria never compensate for mandatory failures.

## Boundary before application/persistence integration

- This in-memory object is not a database transaction, durable idempotency store, authentication system or security sandbox.
- An application adapter must authenticate/authorize and load current policy before every command, including retries, with authoritative mentor assignment and consent. Role/online/session flags from a client are never authoritative.
- PostgreSQL must make attempt uniqueness, receipts, expected versions, finalized revision/evidence history, mastery, progression, structured audit and outbox atomic, with RLS and constrained runtime roles. No business-rule computation belongs in SQL.
- The mutable `QuestAttempt` must be private to a single transaction. It changes memory before database commit: after rollback or an uncertain commit outcome, discard it and its receipts, then reload authoritative state. Never reuse it from an application cache. A validated repository hydration contract is required before persistence integration; no such loader exists in v0.
- Event descriptions are returned to server code. Do not publish them before database commit; write them into a transactional outbox. The current API exposes only `/health` and cannot commit domain mutations.
- Separate processes or reconstructed attempts are not protected by this object's receipts. Prove locking/CAS, rollback, cross-user isolation and concurrent duplicate requests with database integration tests before exposing endpoints.
- Real file authenticity, malicious-file detection, identity creation, global evidence reuse, skill aggregation, four-quest Pilot progression and correction/revocation after mastery remain outside this slice.

Implemented/tested domain behavior is distinct from production verification or product acceptance. See `docs/architecture/kernel-v0-plan.md` and the evidence report.

Engineering self-review and the proposed persistence gate are in `docs/verification/kernel-v0-review.md` and `docs/architecture/kernel-v0-persistence-plan.md`.
