import type {
  AuthenticatedSession,
  KernelTransaction,
  KernelUnitOfWork,
} from "../../../application";
import type { KernelSnapshot, MutationContext } from "../../../domain";
import { ensure, identifier } from "../../../domain/shared/invariants";
import { authorize } from "../../../domain/shared/policy";
import {
  CommitOutcomeUnknownError,
  type ConnectionPool,
  type DatabaseConnection,
} from "./connection";
import { loadAttempt, saveAttempt } from "./records";

async function databaseTime(client: DatabaseConnection): Promise<string> {
  const result = await client.query("SELECT clock_timestamp() AS now");
  const now = result.rows[0]?.now;
  ensure(now instanceof Date, "INVALID_DATABASE_CLOCK");
  return now.toISOString();
}

/** READ COMMITTED; fixed lock order: session SHARE -> consent SHARE -> attempt UPDATE. */
export class PostgresKernelUnitOfWork implements KernelUnitOfWork {
  constructor(private readonly pool: ConnectionPool) {}

  async run<T>(
    identity: AuthenticatedSession,
    attemptId: string,
    online: boolean,
    operation: (transaction: KernelTransaction) => Promise<T>
  ): Promise<T> {
    identifier(identity.actorId);
    identifier(identity.sessionId);
    identifier(attemptId);
    ensure(online === true, "ONLINE_REQUIRED");
    const client = await this.pool.connect();
    let commitStarted = false;
    let destroy = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query(
        "SET LOCAL idle_in_transaction_session_timeout = '10s'"
      );
      const role =
        await client.query(`SELECT NOT r.rolsuper AND NOT r.rolbypassrls
        AND pg_has_role(current_user, 'levex_kernel_runtime', 'USAGE')
        AND NOT EXISTS (SELECT 1 FROM pg_namespace n WHERE n.nspname = 'levex_kernel' AND n.nspowner = r.oid)
        AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'levex_kernel' AND c.relowner = r.oid) AS safe
        FROM pg_roles r WHERE r.rolname = current_user`);
      ensure(role.rows[0]?.safe === true, "UNSAFE_DATABASE_ROLE");
      await client.query(
        "SELECT set_config('levex.actor_id',$1,true), set_config('levex.actor_role',$2,true), set_config('levex.session_id',$3,true)",
        [identity.actorId, identity.role, identity.sessionId]
      );
      const sessions = await client.query(
        "SELECT * FROM levex_kernel.session_policy WHERE session_id = $1 FOR SHARE",
        [identity.sessionId]
      );
      const session = sessions.rows[0];
      ensure(
        session &&
          session.actor_id === identity.actorId &&
          session.actor_role === identity.role &&
          session.active === true,
        "SESSION_INACTIVE"
      );
      // The first read discovers the immutable subject ID only. Lock/re-read the
      // attempt after the policy lock; never trust its earlier projection/assignment.
      const subject = await client.query(
        "SELECT participant_id FROM levex_kernel.attempts WHERE id = $1",
        [attemptId]
      );
      ensure(subject.rows.length === 1, "ATTEMPT_NOT_FOUND_OR_FORBIDDEN");
      const policies = await client.query(
        "SELECT * FROM levex_kernel.subject_policy WHERE participant_id = $1 FOR SHARE",
        [subject.rows[0]?.participant_id]
      );
      const policy = policies.rows[0];
      ensure(policy && policy.consent_until instanceof Date, "CONSENT_INVALID");
      const attempts = await client.query(
        "SELECT * FROM levex_kernel.attempts WHERE id = $1 FOR UPDATE",
        [attemptId]
      );
      const row = attempts.rows[0];
      ensure(row && row.assignment_active === true, "ASSIGNMENT_INACTIVE");
      ensure(session.expires_at instanceof Date, "SESSION_INACTIVE");
      const sessionExpiresAt = session.expires_at.toISOString();
      const context: MutationContext = {
        principal: { actorId: identity.actorId, role: identity.role },
        online,
        sessionActive: true,
        now: await databaseTime(client),
        consent: {
          participantId: String(policy.participant_id),
          status: policy.consent_status as "ACTIVE" | "REVOKED",
          validUntil: policy.consent_until.toISOString(),
        },
      };
      const checkPolicy = (now: string) => {
        ensure(now < sessionExpiresAt, "SESSION_EXPIRED");
        authorize(
          { ...context, now },
          String(row.participant_id),
          String(row.mentor_id),
          identity.role
        );
      };
      checkPolicy(context.now);
      let before: KernelSnapshot | undefined;
      let saved = false;
      const result = await operation({
        context,
        load: async () => {
          ensure(before === undefined, "AGGREGATE_ALREADY_LOADED");
          const aggregate = await loadAttempt(client, row);
          before = aggregate.snapshot;
          return aggregate;
        },
        save: async (change, receipt) => {
          ensure(
            before !== undefined && !saved,
            "INVALID_TRANSACTION_LIFECYCLE"
          );
          await saveAttempt(client, before, change, receipt);
          saved = true;
        },
      });
      // Locks prevent revocation races; refresh time to reject expiry during work.
      checkPolicy(await databaseTime(client));
      commitStarted = true;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      if (commitStarted) {
        destroy = true;
        throw new CommitOutcomeUnknownError();
      }
      try {
        await client.query("ROLLBACK");
      } catch {
        destroy = true;
      }
      throw error;
    } finally {
      // Transaction-local identity disappears on commit/rollback. Broken or
      // uncertain connections never return to the pool for another principal.
      client.release(destroy);
    }
  }
}
