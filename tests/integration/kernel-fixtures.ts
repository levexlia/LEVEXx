import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import {
  ExecuteKernelCommand,
  type AuthenticatedSession,
} from "../../packages/application";
import { FIRST_MACHINE, type KernelCommand } from "../../packages/domain";
import {
  PostgresKernelUnitOfWork,
  type ConnectionPool,
  type DatabaseConnection,
} from "../../packages/infrastructure/database/kernel";
import { scores } from "../unit/kernel-fixtures";

export interface Fixture {
  id: string;
  participant: AuthenticatedSession;
  mentor: AuthenticatedSession;
}

export function handler(
  pool: ConnectionPool,
  fixture: Fixture
): ExecuteKernelCommand {
  return new ExecuteKernelCommand(
    {
      // Deliberate test-only authenticator; never installed in the API.
      authenticate: async (credential) => {
        if (credential === "participant") return fixture.participant;
        if (credential === "mentor") return fixture.mentor;
        throw new Error("AUTHENTICATION_FAILED");
      },
    },
    new PostgresKernelUnitOfWork(pool)
  );
}

export function input(
  f: Fixture,
  command: KernelCommand,
  expectedVersion: number,
  key = `request-${expectedVersion}`
) {
  return {
    credential: ["accept-quest", "submit-artifact"].includes(command.type)
      ? "participant"
      : "mentor",
    online: true,
    attemptId: f.id,
    command,
    metadata: { idempotencyKey: key, expectedVersion },
  };
}

export function finalInput(f: Fixture, key = "finalize") {
  return input(
    f,
    {
      type: "finalize-evaluation",
      evaluationRevisionId: `${f.id}:evaluation:1`,
    },
    3,
    key
  );
}

export async function fixture(
  admin: Pool,
  runtime: ConnectionPool,
  stage = 0
): Promise<Fixture> {
  const prefix = `kp-${randomBytes(8).toString("hex")}`;
  const f: Fixture = {
    id: `${prefix}-attempt`,
    participant: {
      actorId: `${prefix}-participant`,
      role: "participant",
      sessionId: `${prefix}-participant-session`,
    },
    mentor: {
      actorId: `${prefix}-mentor`,
      role: "mentor",
      sessionId: `${prefix}-mentor-session`,
    },
  };
  await admin.query(
    "INSERT INTO levex_kernel.catalog(body) VALUES ($1) ON CONFLICT DO NOTHING",
    [JSON.stringify(FIRST_MACHINE)]
  );
  await admin.query(
    "INSERT INTO levex_kernel.subject_policy(participant_id, consent_status, consent_until) VALUES ($1,'ACTIVE',clock_timestamp() + interval '1 hour')",
    [f.participant.actorId]
  );
  for (const identity of [f.participant, f.mentor]) {
    await admin.query(
      "INSERT INTO levex_kernel.session_policy(session_id,actor_id,actor_role,active,expires_at) VALUES ($1,$2,$3,true,clock_timestamp() + interval '1 hour')",
      [identity.sessionId, identity.actorId, identity.role]
    );
  }
  await admin.query(
    "INSERT INTO levex_kernel.attempts(id,participant_id,mentor_id,quest_id,quest_version_id) VALUES ($1,$2,$3,$4,$5)",
    [
      f.id,
      f.participant.actorId,
      f.mentor.actorId,
      FIRST_MACHINE.id,
      FIRST_MACHINE.versionId,
    ]
  );
  const application = handler(runtime, f);
  if (stage >= 1)
    await application.execute(input(f, { type: "accept-quest" }, 0));
  if (stage >= 2)
    await application.execute(
      input(
        f,
        {
          type: "submit-artifact",
          contentHash: "a".repeat(64),
          objectVersion: `${f.id}-object.v1`,
        },
        1
      )
    );
  if (stage >= 3)
    await application.execute(
      input(
        f,
        {
          type: "draft-evaluation",
          artifactVersionId: `${f.id}:artifact:1`,
          assessments: scores(),
        },
        2
      )
    );
  if (stage >= 4) await application.execute(finalInput(f));
  return f;
}

export async function counts(admin: Pool, id: string) {
  const names = [
    "artifacts",
    "evaluations",
    "evidence",
    "mastery",
    "progression",
    "receipts",
    "audit",
    "outbox",
  ];
  const result = await admin.query(
    names
      .map(
        (name) =>
          `SELECT '${name}' AS name, count(*)::integer AS count FROM levex_kernel.${name} WHERE attempt_id = $1`
      )
      .join(" UNION ALL "),
    [id]
  );
  const attempt = await admin.query(
    "SELECT version, phase, mastery_status FROM levex_kernel.attempts WHERE id = $1",
    [id]
  );
  const evaluation = await admin.query(
    "SELECT status FROM levex_kernel.evaluations WHERE attempt_id = $1 ORDER BY position",
    [id]
  );
  return {
    ...Object.fromEntries(result.rows.map((r) => [r.name, r.count])),
    ...attempt.rows[0],
    evaluationsStatus: evaluation.rows.map((r) => r.status),
  };
}

export function intercept(
  pool: ConnectionPool,
  hook: (
    sql: string,
    next: () => ReturnType<DatabaseConnection["query"]>
  ) => ReturnType<DatabaseConnection["query"]>
): ConnectionPool {
  return {
    connect: async () => {
      const client = await pool.connect();
      return {
        query: (sql, params) => hook(sql, () => client.query(sql, params)),
        release: (destroy) => client.release(destroy),
      };
    },
  };
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export async function asPrincipal<T>(
  pool: Pool,
  identity: AuthenticatedSession,
  operation: (client: DatabaseConnection) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('levex.actor_id',$1,true), set_config('levex.actor_role',$2,true), set_config('levex.session_id',$3,true)",
      [identity.actorId, identity.role, identity.sessionId]
    );
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
