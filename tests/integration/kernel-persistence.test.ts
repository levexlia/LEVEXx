import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ExecuteKernelCommand } from "../../packages/application";
import {
  PostgresKernelUnitOfWork,
  type ConnectionPool,
} from "../../packages/infrastructure/database/kernel";
import {
  asPrincipal,
  counts,
  deferred,
  finalInput,
  fixture,
  handler,
  input,
  intercept,
} from "./kernel-fixtures";
import { scores } from "../unit/kernel-fixtures";

if (!process.env.DATABASE_URL)
  throw new Error("DATABASE_URL is required for integration tests");
const admin = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const runtimeRole = `levex_kernel_it_${randomBytes(6).toString("hex")}`;
let runtime: Pool;
let runtimeUrl: string;
const pools: Pool[] = [];

beforeAll(async () => {
  const password = randomBytes(24).toString("hex");
  // Random test-only identifiers/password contain hex and a fixed identifier prefix.
  await admin.query(
    `CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD '${password}' IN ROLE levex_kernel_runtime`
  );
  const url = new URL(process.env.DATABASE_URL!);
  url.username = runtimeRole;
  url.password = password;
  runtimeUrl = url.toString();
  runtime = new Pool({ connectionString: runtimeUrl, max: 4 });
  pools.push(runtime);
});

afterAll(async () => {
  await Promise.all(pools.map((p) => p.end()));
  await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`);
  await admin.end();
});

describe("durable kernel workflow", () => {
  it("persists the full loop and replays from a separate Node process with new connections", async () => {
    const f = await fixture(admin, runtime, 3);
    const result = await handler(runtime, f).execute(finalInput(f));
    expect(result.snapshot).toMatchObject({
      phase: "MASTERED",
      masteryStatus: "MASTERED",
      version: 4,
    });
    expect(result.snapshot.masteryHistory[0]?.evidenceId).toBe(
      result.snapshot.evidence[0]?.id
    );
    expect(result.snapshot.progression[0]?.unlockedQuestId).toBe(
      "physics-foundations"
    );
    const before = await counts(admin, f.id);
    const script = `
      const { Pool } = require('pg');
      const { ExecuteKernelCommand } = require('./packages/application');
      const { PostgresKernelUnitOfWork } = require('./packages/infrastructure/database/kernel');
      const state = JSON.parse(process.env.KERNEL_RESTART_TEST);
      const pool = new Pool({ connectionString: process.env.KERNEL_TEST_URL });
      const app = new ExecuteKernelCommand({ authenticate: async () => state.identity }, new PostgresKernelUnitOfWork(pool));
      app.execute(state.input).then(result => process.stdout.write(JSON.stringify(result)))
        .catch(error => { process.stderr.write(error.code || error.message); process.exitCode = 1; })
        .finally(() => pool.end());
    `;
    const child = await promisify(execFile)(
      process.execPath,
      ["-r", "ts-node/register", "-e", script],
      {
        env: {
          ...process.env,
          TS_NODE_PROJECT: "tsconfig.build.json",
          KERNEL_TEST_URL: runtimeUrl,
          KERNEL_RESTART_TEST: JSON.stringify({
            identity: f.mentor,
            input: finalInput(f),
          }),
        },
        timeout: 20000,
      }
    );
    const replay = JSON.parse(child.stdout);
    expect(replay).toEqual({ ...result, events: [], replayed: true });
    expect(await counts(admin, f.id)).toEqual(before);
  }, 25000);

  it("accepts participant/mentor key reuse and reordered criteria across database reloads", async () => {
    const f = await fixture(admin, runtime);
    const app = handler(runtime, f);
    await app.execute(input(f, { type: "accept-quest" }, 0, "shared"));
    await app.execute(
      input(
        f,
        {
          type: "submit-artifact",
          contentHash: "a".repeat(64),
          objectVersion: "object.v1",
        },
        1
      )
    );
    const command = {
      type: "draft-evaluation" as const,
      artifactVersionId: `${f.id}:artifact:1`,
      assessments: scores(),
    };
    await app.execute(input(f, command, 2, "shared"));
    expect(
      (
        await app.execute(
          input(
            f,
            { ...command, assessments: [...scores()].reverse() },
            2,
            "shared"
          )
        )
      ).replayed
    ).toBe(true);
    expect(
      (await app.execute(input(f, { type: "accept-quest" }, 0, "shared")))
        .snapshot.version
    ).toBe(1);
    await app.execute(finalInput(f));
    await expect(
      app.execute(
        input(f, { ...command, assessments: scores("PARTIAL") }, 2, "shared")
      )
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect((await counts(admin, f.id)).progression).toBe(1);
  });

  it("preserves partial assessments and immutable superseding revisions", async () => {
    const f = await fixture(admin, runtime, 2);
    const app = handler(runtime, f);
    await app.execute(
      input(
        f,
        {
          type: "draft-evaluation",
          artifactVersionId: `${f.id}:artifact:1`,
          assessments: scores("PARTIAL"),
        },
        2
      )
    );
    expect((await app.execute(finalInput(f))).snapshot.masteryStatus).toBe(
      "PARTIAL"
    );
    await app.execute(
      input(
        f,
        {
          type: "draft-evaluation",
          artifactVersionId: `${f.id}:artifact:1`,
          assessments: scores(),
        },
        4
      )
    );
    const result = await app.execute(
      input(
        f,
        {
          type: "finalize-evaluation",
          evaluationRevisionId: `${f.id}:evaluation:2`,
        },
        5
      )
    );
    expect(result.snapshot.masteryHistory.map((m) => m.status)).toEqual([
      "PARTIAL",
      "MASTERED",
    ]);
    expect(result.snapshot.evaluations[1]?.supersedesRevisionId).toBe(
      result.snapshot.evaluations[0]?.id
    );
    expect((await counts(admin, f.id)).progression).toBe(1);
  });

  it("rejects duplicate artifact submissions and stale writes without consuming a receipt", async () => {
    const f = await fixture(admin, runtime, 2);
    const app = handler(runtime, f);
    const before = await counts(admin, f.id);
    await expect(
      app.execute(
        input(
          f,
          {
            type: "submit-artifact",
            contentHash: "a".repeat(64),
            objectVersion: "other.v1",
          },
          2,
          "duplicate"
        )
      )
    ).rejects.toThrow("DUPLICATE_ARTIFACT");
    await expect(
      app.execute(
        input(
          f,
          {
            type: "submit-artifact",
            contentHash: "b".repeat(64),
            objectVersion: "other.v1",
          },
          1,
          "stale"
        )
      )
    ).rejects.toThrow("STALE_VERSION");
    expect(await counts(admin, f.id)).toEqual(before);
  });

  it("rejects loading a projection that has no matching immutable history", async () => {
    const f = await fixture(admin, runtime, 4);
    await admin.query(
      "UPDATE levex_kernel.attempts SET version = version + 1, phase = 'ACCEPTED' WHERE id = $1",
      [f.id]
    );
    await expect(handler(runtime, f).execute(finalInput(f))).rejects.toThrow(
      "INVALID_PERSISTED_STATE"
    );
  });
});

describe("concurrency and transaction outcomes", () => {
  it("serializes identical finalizations on two backend connections and rewards once", async () => {
    const f = await fixture(admin, runtime, 3);
    const backendIds = new Set<number>();
    const pool: ConnectionPool = {
      connect: async () => {
        const client = await runtime.connect();
        const result = await client.query("SELECT pg_backend_pid() AS id");
        backendIds.add(result.rows[0].id);
        return client;
      },
    };
    const app = handler(pool, f);
    const results = await Promise.all([
      app.execute(finalInput(f)),
      app.execute(finalInput(f)),
    ]);
    expect(backendIds.size).toBe(2);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    expect(await counts(admin, f.id)).toMatchObject({
      version: 4,
      evidence: 1,
      mastery: 1,
      progression: 1,
      receipts: 4,
      audit: 4,
      outbox: 7,
    });
  });

  it("rejects a competing new key with the same stale expected version", async () => {
    const f = await fixture(admin, runtime, 3);
    const app = handler(runtime, f);
    const results = await Promise.allSettled([
      app.execute(finalInput(f, "a")),
      app.execute(finalInput(f, "b")),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.message).toBe(
      "STALE_VERSION"
    );
    expect((await counts(admin, f.id)).progression).toBe(1);
  });

  it.each([
    "UPDATE levex_kernel.evaluations",
    "INSERT INTO levex_kernel.evidence",
    "INSERT INTO levex_kernel.mastery",
    "INSERT INTO levex_kernel.progression",
    "UPDATE levex_kernel.attempts",
    "INSERT INTO levex_kernel.receipts",
    "INSERT INTO levex_kernel.audit",
    "INSERT INTO levex_kernel.outbox",
  ])(
    "rolls back failure after %s and safely retries the original key",
    async (stage) => {
      const f = await fixture(admin, runtime, 3);
      const before = await counts(admin, f.id);
      const broken = intercept(runtime, async (sql, next) => {
        const result = await next();
        if (sql.startsWith(stage)) throw new Error("INJECTED_WRITE_FAILURE");
        return result;
      });
      await expect(handler(broken, f).execute(finalInput(f))).rejects.toThrow(
        "INJECTED_WRITE_FAILURE"
      );
      expect(await counts(admin, f.id)).toEqual(before);
      await handler(runtime, f).execute(finalInput(f));
      expect((await counts(admin, f.id)).progression).toBe(1);
    }
  );

  it.each(["committed", "rolled-back"] as const)(
    "resolves a lost COMMIT response when the database actually %s",
    async (outcome) => {
      const f = await fixture(admin, runtime, 3);
      const before = await counts(admin, f.id);
      let destroyed = false;
      const pool: ConnectionPool = {
        connect: async () => {
          const client = await runtime.connect();
          return {
            query: async (sql, parameters) => {
              if (sql === "COMMIT") {
                await client.query(
                  outcome === "committed" ? "COMMIT" : "ROLLBACK"
                );
                throw new Error("CONNECTION_LOST");
              }
              return client.query(sql, parameters);
            },
            release: (destroy) => {
              destroyed = destroy === true;
              client.release(destroy);
            },
          };
        },
      };
      await expect(handler(pool, f).execute(finalInput(f))).rejects.toThrow(
        "Commit outcome unknown"
      );
      expect(destroyed).toBe(true);
      if (outcome === "rolled-back")
        expect(await counts(admin, f.id)).toEqual(before);
      const retry = await handler(runtime, f).execute(finalInput(f));
      expect(retry.replayed).toBe(outcome === "committed");
      expect((await counts(admin, f.id)).progression).toBe(1);
    }
  );

  it("keeps new outbox events invisible to other connections until commit", async () => {
    const f = await fixture(admin, runtime, 3);
    const reached = deferred();
    const release = deferred();
    let paused = false;
    const pool = intercept(runtime, async (sql, next) => {
      const result = await next();
      if (sql.startsWith("INSERT INTO levex_kernel.outbox") && !paused) {
        paused = true;
        reached.resolve();
        await release.promise;
      }
      return result;
    });
    const pending = handler(pool, f).execute(finalInput(f));
    try {
      await reached.promise;
      expect((await counts(admin, f.id)).outbox).toBe(3);
    } finally {
      release.resolve();
    }
    await pending;
    expect((await counts(admin, f.id)).outbox).toBe(7);
  });
});

describe("authorization, policy and RLS", () => {
  it.each([
    [
      "revoked session",
      "UPDATE levex_kernel.session_policy SET active = false WHERE session_id = $1",
      "session",
      "SESSION_INACTIVE",
    ],
    [
      "expired session",
      "UPDATE levex_kernel.session_policy SET expires_at = '2000-01-01' WHERE session_id = $1",
      "session",
      "SESSION_EXPIRED",
    ],
    [
      "revoked consent",
      "UPDATE levex_kernel.subject_policy SET consent_status = 'REVOKED' WHERE participant_id = $1",
      "participant",
      "CONSENT_INVALID",
    ],
    [
      "expired consent",
      "UPDATE levex_kernel.subject_policy SET consent_until = '2000-01-01' WHERE participant_id = $1",
      "participant",
      "CONSENT_EXPIRED",
    ],
    [
      "revoked assignment",
      "UPDATE levex_kernel.attempts SET assignment_active = false WHERE id = $1",
      "attempt",
      "ASSIGNMENT_INACTIVE",
    ],
  ])(
    "denies an already committed retry after %s",
    async (_name, sql, target, error) => {
      const f = await fixture(admin, runtime, 4);
      const before = await counts(admin, f.id);
      await admin.query(sql!, [
        target === "session"
          ? f.mentor.sessionId
          : target === "participant"
          ? f.participant.actorId
          : f.id,
      ]);
      await expect(handler(runtime, f).execute(finalInput(f))).rejects.toThrow(
        error!
      );
      expect(await counts(admin, f.id)).toEqual(before);
    }
  );

  it("denies foreign attempts, foreign artifacts, forged session identity and privileged runtime pools", async () => {
    const a = await fixture(admin, runtime, 2);
    const b = await fixture(admin, runtime, 2);
    await expect(
      handler(runtime, b).execute(
        input(
          a,
          {
            type: "draft-evaluation",
            artifactVersionId: `${a.id}:artifact:1`,
            assessments: scores(),
          },
          2
        )
      )
    ).rejects.toThrow("ATTEMPT_NOT_FOUND_OR_FORBIDDEN");
    await expect(
      handler(runtime, a).execute(
        input(
          a,
          {
            type: "draft-evaluation",
            artifactVersionId: `${b.id}:artifact:1`,
            assessments: scores(),
          },
          2
        )
      )
    ).rejects.toThrow("ARTIFACT_VERSION_MISMATCH");
    const forged = new ExecuteKernelCommand(
      {
        authenticate: async () => ({
          ...a.mentor,
          sessionId: a.participant.sessionId,
        }),
      },
      new PostgresKernelUnitOfWork(runtime)
    );
    await expect(
      forged.execute(input(a, { type: "accept-quest" }, 0))
    ).rejects.toThrow("SESSION_INACTIVE");
    await expect(
      handler(admin, a).execute(input(a, { type: "accept-quest" }, 0))
    ).rejects.toThrow("UNSAFE_DATABASE_ROLE");
  });

  it("enforces row isolation and denies direct policy/history changes under the runtime role", async () => {
    const a = await fixture(admin, runtime, 4);
    const b = await fixture(admin, runtime, 4);
    await asPrincipal(runtime, b.participant, async (client) => {
      for (const table of [
        "artifacts",
        "evaluations",
        "evidence",
        "mastery",
        "progression",
        "receipts",
        "audit",
        "outbox",
      ]) {
        const result = await client.query(
          `SELECT * FROM levex_kernel.${table} WHERE attempt_id = $1`,
          [a.id]
        );
        expect(result.rows).toHaveLength(0);
      }
      expect(
        (
          await client.query(
            "SELECT * FROM levex_kernel.attempts WHERE id = $1",
            [a.id]
          )
        ).rows
      ).toHaveLength(0);
    });
    for (const sql of [
      "UPDATE levex_kernel.subject_policy SET consent_status = 'ACTIVE' WHERE participant_id = $1",
      "UPDATE levex_kernel.mastery SET body = body WHERE participant_id = $1",
      "DELETE FROM levex_kernel.evidence WHERE participant_id = $1",
      "UPDATE levex_kernel.attempts SET mentor_id = participant_id WHERE participant_id = $1",
    ])
      await expect(
        asPrincipal(runtime, a.participant, (c) =>
          c.query(sql, [a.participant.actorId])
        )
      ).rejects.toMatchObject({ code: "42501" });
    await expect(
      asPrincipal(runtime, a.mentor, (c) =>
        c.query(
          "UPDATE levex_kernel.evaluations SET body = body WHERE attempt_id = $1",
          [a.id]
        )
      )
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      asPrincipal(runtime, a.participant, (c) =>
        c.query("TRUNCATE levex_kernel.mastery")
      )
    ).rejects.toMatchObject({ code: "42501" });
    const record = (
      await admin.query(
        "SELECT body FROM levex_kernel.artifacts WHERE attempt_id = $1",
        [a.id]
      )
    ).rows[0].body;
    await expect(
      asPrincipal(runtime, b.participant, (c) =>
        c.query("INSERT INTO levex_kernel.artifacts(body) VALUES ($1)", [
          JSON.stringify({
            ...record,
            id: `${a.id}:artifact:2`,
            version: 2,
            contentHash: "b".repeat(64),
            objectVersion: "other.v1",
          }),
        ])
      )
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      admin.query(
        "UPDATE levex_kernel.evidence SET body = body WHERE attempt_id = $1",
        [a.id]
      )
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("rejects cross-owner provenance through relational foreign keys even for the migration owner", async () => {
    const a = await fixture(admin, runtime, 4);
    const b = await fixture(admin, runtime, 2);
    const record = (
      await admin.query(
        "SELECT body FROM levex_kernel.evidence WHERE attempt_id = $1",
        [a.id]
      )
    ).rows[0].body;
    await expect(
      admin.query("INSERT INTO levex_kernel.evidence(body) VALUES ($1)", [
        JSON.stringify({
          ...record,
          id: `${b.id}:invented-evidence`,
          participantId: b.participant.actorId,
          questInstanceId: b.id,
        }),
      ])
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("clears pooled actor/session context after successful and failed commands", async () => {
    const single = new Pool({ connectionString: runtimeUrl, max: 1 });
    pools.push(single);
    const a = await fixture(admin, single, 1);
    const b = await fixture(admin, single);
    await expect(
      handler(single, a).execute(input(a, { type: "accept-quest" }, 0, "stale"))
    ).rejects.toThrow("STALE_VERSION");
    await handler(single, b).execute(input(b, { type: "accept-quest" }, 0));
    const context = await single.query(
      "SELECT current_setting('levex.actor_id',true) AS actor, current_setting('levex.session_id',true) AS session"
    );
    expect([null, ""]).toContain(context.rows[0].actor);
    expect([null, ""]).toContain(context.rows[0].session);
    expect(
      (await single.query("SELECT * FROM levex_kernel.attempts")).rows
    ).toHaveLength(0);
  });
});

describe("revocation serialization", () => {
  const cases = [
    {
      name: "consent",
      sql: "UPDATE levex_kernel.subject_policy SET consent_status = 'REVOKED' WHERE participant_id = $1",
      lock: "SELECT * FROM levex_kernel.subject_policy",
      error: "CONSENT_INVALID",
    },
    {
      name: "session",
      sql: "UPDATE levex_kernel.session_policy SET active = false WHERE session_id = $1",
      lock: "SELECT * FROM levex_kernel.session_policy",
      error: "SESSION_INACTIVE",
    },
    {
      name: "assignment",
      sql: "UPDATE levex_kernel.attempts SET assignment_active = false WHERE id = $1",
      lock: "SELECT * FROM levex_kernel.attempts",
      error: "ASSIGNMENT_INACTIVE",
    },
  ];
  it.each(cases)(
    "rejects finalization when $name revocation locks first",
    async (test) => {
      const f = await fixture(admin, runtime, 3);
      const revoke = await admin.connect();
      const reached = deferred();
      const target =
        test.name === "consent"
          ? f.participant.actorId
          : test.name === "session"
          ? f.mentor.sessionId
          : f.id;
      await revoke.query("BEGIN");
      await revoke.query(test.sql, [target]);
      const pool = intercept(runtime, async (sql, next) => {
        if (sql.startsWith(test.lock)) reached.resolve();
        return next();
      });
      const pending = handler(pool, f).execute(finalInput(f));
      const rejection = expect(pending).rejects.toThrow(test.error);
      try {
        await reached.promise;
        await revoke.query("COMMIT");
      } finally {
        revoke.release();
      }
      await rejection;
      expect((await counts(admin, f.id)).progression).toBe(0);
    }
  );

  it.each(cases)(
    "commits once when finalization locks before $name revocation",
    async (test) => {
      const f = await fixture(admin, runtime, 3);
      const reached = deferred();
      const release = deferred();
      const pool = intercept(runtime, async (sql, next) => {
        const result = await next();
        if (sql.startsWith("INSERT INTO levex_kernel.evidence")) {
          reached.resolve();
          await release.promise;
        }
        return result;
      });
      const pending = handler(pool, f).execute(finalInput(f));
      await reached.promise;
      const target =
        test.name === "consent"
          ? f.participant.actorId
          : test.name === "session"
          ? f.mentor.sessionId
          : f.id;
      const revocation = admin.query(test.sql, [target]);
      release.resolve();
      expect((await pending).snapshot.phase).toBe("MASTERED");
      await revocation;
      await expect(handler(runtime, f).execute(finalInput(f))).rejects.toThrow(
        test.error
      );
      expect((await counts(admin, f.id)).progression).toBe(1);
    }
  );
});
