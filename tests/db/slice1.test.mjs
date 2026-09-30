import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { runner } from "node-pg-migrate";
import {
  assertVersion,
  connect,
  identifier,
  required,
  tables,
} from "../../scripts/db/common.mjs";
import { provision } from "../../scripts/db/provision-roles.mjs";
import { inspectRoles } from "../../scripts/db/verify-runtime-roles.mjs";

const adminUrl = required("PROVISION_DATABASE_URL");
const passwords = Object.fromEntries(
  ["migrator", "app_runtime", "worker_runtime"].map((r) => [
    r,
    randomBytes(24).toString("hex"),
  ])
);
const urlFor = (role, db) => {
  const u = new URL(adminUrl);
  u.username = role;
  u.password = passwords[role];
  if (db) u.pathname = `/${db}`;
  return u.toString();
};
const clients = {};
let admin;
const migrationOptions = {
  dir: "packages/infrastructure/database/migrations",
  migrationsTable: "pgmigrations",
  direction: "up",
  count: Infinity,
  log: () => {},
};
const evidenceDir = "evidence/slice1";
const ids = {
  a: randomUUID(),
  b: randomUUID(),
  account: randomUUID(),
  role: randomUUID(),
  revoked: randomUUID(),
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function migrate() {
  return runner({ ...migrationOptions, databaseUrl: urlFor("migrator") });
}
async function catalog(client = admin) {
  return (
    await client.query(`SELECT c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner,
    ARRAY(SELECT pg_get_constraintdef(x.oid) FROM pg_constraint x WHERE x.conrelid=c.oid ORDER BY x.conname) AS constraints
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('levex','levex_private') ORDER BY n.nspname,c.relname`)
  ).rows;
}
async function denied(client, sql, params = [], codes = ["42501"]) {
  await assert.rejects(client.query(sql, params), (e) =>
    codes.includes(e.code)
  );
}
async function rejectedInside(client, sql, params = [], code = "23514") {
  await client.query("SAVEPOINT expected_failure");
  try {
    await denied(client, sql, params, [code]);
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT expected_failure");
    await client.query("RELEASE SAVEPOINT expected_failure");
  }
}
async function fixture(fn) {
  const c = clients.migrator;
  await c.query("BEGIN; SET LOCAL ROLE db_owner");
  try {
    // Disposable migration-authority fixture only. Never grants any runtime path.
    // Rollback restores the exact deployed FORCE RLS configuration and all test rows.
    for (const table of tables)
      await c.query(`ALTER TABLE levex.${table} DISABLE ROW LEVEL SECURITY`);
    await c.query(
      "INSERT INTO levex.actors(id,display_name) VALUES ($1,'Alice'),($2,'Bob')",
      [ids.a, ids.b]
    );
    await c.query(
      "INSERT INTO levex.accounts(id,actor_id,provider,provider_subject) VALUES ($1,$2,'oidc','subject-a')",
      [ids.account, ids.a]
    );
    await c.query(
      "INSERT INTO levex.role_assignments(id,actor_id,role,assignment_source) VALUES ($1,$2,'operator','BOOTSTRAP')",
      [ids.role, ids.a]
    );
    await fn(c);
  } finally {
    await c.query("ROLLBACK");
  }
}
before(async () => {
  mkdirSync(evidenceDir, { recursive: true });
  admin = await connect(adminUrl);
  await assertVersion(admin);
  assert.equal(
    (
      await admin.query(
        "SELECT to_regclass('public.pgmigrations') AS ledger, to_regnamespace('levex') AS domain"
      )
    ).rows[0].ledger,
    null,
    "Requires fresh dedicated test DB"
  );
  assert.equal(
    (await admin.query("SELECT to_regnamespace('levex') AS domain")).rows[0]
      .domain,
    null
  );
  await provision(admin, passwords);
  for (const role of Object.keys(passwords))
    clients[role] = await connect(urlFor(role));
  execFileSync(process.execPath, ["scripts/db/migrate.mjs"], {
    env: { ...process.env, DATABASE_URL: urlFor("migrator") },
    stdio: "pipe",
  });
  // D-F01 disposable proof guard: fail immediately if the intentional
  // FORCE RLS regression reached the migrated schema. This assertion is
  // proof-branch-only and is never merged into canonical code.
  const forceRls = (
    await admin.query(
      "SELECT relforcerowsecurity FROM pg_class WHERE oid='levex.accounts'::regclass"
    )
  ).rows[0]?.relforcerowsecurity;
  assert.equal(forceRls, true, "D_F01_FORCE_RLS_REGRESSION_DETECTED");
});
after(async () => {
  if (admin) {
    const names = readdirSync(migrationOptions.dir)
      .filter((n) => n.endsWith(".cjs"))
      .sort();
    const migrations = names.map((name) => ({
      name,
      sha256: digest(readFileSync(`${migrationOptions.dir}/${name}`)),
    }));
    const schema = await catalog();
    const record = {
      generatedAt: new Date().toISOString(),
      candidateSha: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      ciCommit: process.env.GITHUB_SHA ?? null,
      node: process.version,
      postgres: (await admin.query("SHOW server_version")).rows[0]
        .server_version,
      migrations,
      migrationSetSha256: digest(JSON.stringify(migrations)),
      packageLockSha256: digest(readFileSync("package-lock.json")),
      schemaCatalogSha256: digest(JSON.stringify(schema)),
      roles: await inspectRoles(admin),
      schema,
      phaseBAttribution:
        "NOT RUN — deferred; A1/ATTR-002 differs from QA-v1.1/ATTR-002",
    };
    writeFileSync(
      `${evidenceDir}/catalog.json`,
      JSON.stringify(record, null, 2) + "\n"
    );
  }
  await Promise.all(
    [...Object.values(clients), admin].filter(Boolean).map((c) => c.end())
  );
});
test("P03-M-001/002 + TRIGGER-007: clean migrations immediately fail closed", async () => {
  assert.equal(
    (await admin.query("SELECT count(*)::int AS n FROM public.pgmigrations"))
      .rows[0].n,
    4
  );
  await inspectRoles(admin);
  for (const role of ["app_runtime", "worker_runtime"]) {
    const c = clients[role];
    assert.deepEqual(
      (await c.query("SELECT session_user,current_user")).rows[0],
      { session_user: role, current_user: role }
    );
    for (const table of tables) {
      for (const sql of [
        `SELECT * FROM levex.${table}`,
        `INSERT INTO levex.${table}(id) VALUES ('${randomUUID()}')`,
        `UPDATE levex.${table} SET version=2`,
        `DELETE FROM levex.${table}`,
        `TRUNCATE levex.${table}`,
      ])
        await denied(c, sql);
    }
  }
  await clients.migrator.query("BEGIN; SET LOCAL ROLE db_owner");
  try {
    await rejectedInside(
      clients.migrator,
      "INSERT INTO levex.actors(id,display_name) VALUES ($1,'Denied owner')",
      [randomUUID()],
      "42501"
    );
  } finally {
    await clients.migrator.query("ROLLBACK");
  }
});
test("DBROLE-001..008 + TRIGGER-004: runtime privilege and escalation attempts", async () => {
  await inspectRoles(admin);
  for (const c of [clients.app_runtime, clients.worker_runtime]) {
    for (const role of ["db_owner", "migrator"])
      await denied(c, `SET ROLE ${role}`);
    for (const sql of [
      "CREATE TABLE levex.forbidden(id integer)",
      "CREATE TABLE public.forbidden(id integer)",
      "CREATE TEMP TABLE forbidden(id integer)",
      "ALTER TABLE levex.accounts DISABLE ROW LEVEL SECURITY",
      "ALTER TABLE levex.accounts NO FORCE ROW LEVEL SECURITY",
      "CREATE POLICY forbidden ON levex.accounts USING (true)",
      "ALTER TABLE levex.accounts DISABLE TRIGGER accounts_guard_binding",
      "DROP TRIGGER accounts_guard_binding ON levex.accounts",
      "DROP FUNCTION levex_private.guard_account_binding() CASCADE",
      "CREATE OR REPLACE FUNCTION levex_private.guard_account_binding() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RETURN NEW; END'",
      "CREATE ROLE forbidden",
      "SET session_replication_role = replica",
    ])
      await denied(c, sql);
  }
});
test("DBROLE-009: inventory rejects incoming membership from outside canonical roles", async () => {
  const adminName = (await admin.query("SELECT session_user AS name")).rows[0]
    .name;
  for (const role of [
    "db_owner",
    "migrator",
    "app_runtime",
    "worker_runtime",
  ]) {
    await admin.query("BEGIN");
    try {
      // Existing ephemeral CI administrator is the outsider; no fifth role is created.
      await admin.query(
        `GRANT ${identifier(role)} TO ${identifier(adminName)}`
      );
      await assert.rejects(
        inspectRoles(admin),
        /Unexpected canonical role membership/
      );
    } finally {
      await admin.query("ROLLBACK");
    }
  }
  await inspectRoles(admin);
});
test("DBROLE-010: provisioning rejects incoming memberships without silently removing them", async () => {
  const adminName = (await admin.query("SELECT session_user AS name")).rows[0]
    .name;
  for (const role of [
    "db_owner",
    "migrator",
    "app_runtime",
    "worker_runtime",
  ]) {
    await admin.query(`GRANT ${identifier(role)} TO ${identifier(adminName)}`);
    try {
      await assert.rejects(
        provision(admin, passwords),
        /Unexpected canonical role membership/
      );
      assert.equal(
        (
          await admin.query(
            `SELECT count(*)::int AS n FROM pg_auth_members m
         JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
         WHERE member.rolname=$1 AND parent.rolname=$2`,
            [adminName, role]
          )
        ).rows[0].n,
        1
      );
    } finally {
      await admin.query(
        `REVOKE ${identifier(role)} FROM ${identifier(adminName)}`
      );
    }
  }
  await inspectRoles(admin);
});
test("DBROLE-011: provisioning rejects unsafe existing membership options without repair", async () => {
  const canonical = "ADMIN FALSE, INHERIT FALSE, SET TRUE";
  for (const options of [
    "ADMIN TRUE, INHERIT FALSE, SET TRUE",
    "ADMIN FALSE, INHERIT TRUE, SET TRUE",
    "ADMIN FALSE, INHERIT FALSE, SET FALSE",
  ]) {
    await admin.query(`GRANT db_owner TO migrator WITH ${options}`);
    try {
      const before = (
        await admin.query(
          "SELECT admin_option,inherit_option,set_option FROM pg_auth_members WHERE member='migrator'::regrole AND roleid='db_owner'::regrole"
        )
      ).rows;
      await assert.rejects(
        provision(admin, passwords),
        /Unexpected canonical role membership/
      );
      assert.deepEqual(
        (
          await admin.query(
            "SELECT admin_option,inherit_option,set_option FROM pg_auth_members WHERE member='migrator'::regrole AND roleid='db_owner'::regrole"
          )
        ).rows,
        before
      );
    } finally {
      await admin.query(`GRANT db_owner TO migrator WITH ${canonical}`);
    }
  }
  await inspectRoles(admin);
});
test("DBROLE-012: safe provisioning rerun preserves schema, roles and login credentials", async () => {
  const before = await inspectRoles(admin);
  const schema = await catalog();
  await provision(admin, passwords);
  assert.deepEqual(await inspectRoles(admin), before);
  assert.deepEqual(await catalog(), schema);
  for (const role of Object.keys(passwords)) {
    const c = await connect(urlFor(role));
    try {
      assert.equal(
        (await c.query("SELECT session_user AS name")).rows[0].name,
        role
      );
    } finally {
      await c.end();
    }
  }
});
test("TRIGGER-001/005: exact function and trigger inventory", async () => {
  const functions = (
    await admin.query(`SELECT p.proname,p.prosecdef,p.pronargs,p.prorettype::regtype::text AS result,p.proconfig,p.prosrc,
    pg_get_userbyid(p.proowner) AS owner,l.lanname,l.lanpltrusted,
    EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute,
    has_function_privilege('app_runtime',p.oid,'EXECUTE') AS app_execute,has_function_privilege('worker_runtime',p.oid,'EXECUTE') AS worker_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
    WHERE n.nspname='levex_private' ORDER BY p.proname`)
  ).rows;
  assert.deepEqual(
    functions.map((f) => f.proname),
    ["guard_account_binding", "guard_role_assignment"]
  );
  for (const f of functions) {
    assert.equal(f.prosecdef, false);
    assert.equal(f.pronargs, 0);
    assert.equal(f.result, "trigger");
    assert.equal(f.owner, "db_owner");
    assert.equal(f.lanname, "plpgsql");
    assert.equal(f.lanpltrusted, true);
    assert.deepEqual(f.proconfig, [
      "search_path=pg_catalog, levex_private, pg_temp",
    ]);
    assert.equal(f.public_execute, false);
    assert.equal(f.app_execute, false);
    assert.equal(f.worker_execute, false);
    assert.doesNotMatch(
      f.prosrc,
      /\b(EXECUTE|SELECT|DELETE|INSERT\s+INTO|UPDATE\s+levex|TG_ARGV)\b/i
    );
    assert.doesNotMatch(f.prosrc, /levex_private\.\w+\s*\(/);
  }
  const triggers = (
    await admin.query(`SELECT c.relname,t.tgname,t.tgenabled,t.tgtype,t.tgnargs,p.proname FROM pg_trigger t
    JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE n.nspname='levex' AND NOT t.tgisinternal ORDER BY c.relname`)
  ).rows;
  assert.deepEqual(triggers, [
    {
      relname: "accounts",
      tgname: "accounts_guard_binding",
      tgenabled: "O",
      tgtype: 19,
      tgnargs: 0,
      proname: "guard_account_binding",
    },
    {
      relname: "role_assignments",
      tgname: "role_assignments_guard",
      tgenabled: "O",
      tgtype: 23,
      tgnargs: 0,
      proname: "guard_role_assignment",
    },
  ]);
  writeFileSync(
    `${evidenceDir}/triggers.json`,
    JSON.stringify({ functions, triggers }, null, 2) + "\n"
  );
});
test("TRIGGER-002: account immutable fields and permitted lifecycle control", () =>
  fixture(async (c) => {
    const changes = {
      id: `'${randomUUID()}'::uuid`,
      actor_id: `'${ids.b}'::uuid`,
      provider: "'other'",
      provider_subject: "'other-subject'",
      created_at: "created_at + interval '1 second'",
    };
    for (const [column, value] of Object.entries(changes))
      await rejectedInside(
        c,
        `UPDATE levex.accounts SET ${column}=${value} WHERE id=$1`,
        [ids.account]
      );
    await c.query(
      "UPDATE levex.accounts SET status='DEACTIVATED',deactivated_at=transaction_timestamp(),version=version+1,updated_at=transaction_timestamp() WHERE id=$1",
      [ids.account]
    );
    const row = (
      await c.query(
        "SELECT provider,provider_subject,status,version FROM levex.accounts WHERE id=$1",
        [ids.account]
      )
    ).rows[0];
    assert.deepEqual(row, {
      provider: "oidc",
      provider_subject: "subject-a",
      status: "DEACTIVATED",
      version: "2",
    });
  }));
test("TRIGGER-003: immutable role history, no Phase A updates, no revoked reuse", () =>
  fixture(async (c) => {
    const changes = {
      id: `'${randomUUID()}'::uuid`,
      actor_id: `'${ids.b}'::uuid`,
      role: "'mentor'",
      assignment_source: "'OPERATOR'",
      assigned_by_actor_id: `'${ids.b}'::uuid`,
      assigned_at: "assigned_at + interval '1 second'",
      created_at: "created_at + interval '1 second'",
    };
    for (const [column, value] of Object.entries(changes))
      await rejectedInside(
        c,
        `UPDATE levex.role_assignments SET ${column}=${value} WHERE id=$1`,
        [ids.role]
      );
    await rejectedInside(
      c,
      "UPDATE levex.role_assignments SET status='REVOKED',revoked_at=transaction_timestamp(),revoked_by_actor_id=$2,version=version+1 WHERE id=$1",
      [ids.role, ids.a],
      "42501"
    );
    // Historical row fixture only: migration owner loads a past row before reenabling guard.
    await c.query(
      "ALTER TABLE levex.role_assignments DISABLE TRIGGER role_assignments_guard"
    );
    await c.query(
      "INSERT INTO levex.role_assignments(id,actor_id,role,status,assignment_source,revoked_by_actor_id,revoked_at) VALUES ($1,$2,'guardian','REVOKED','BOOTSTRAP',$3,transaction_timestamp())",
      [ids.revoked, ids.b, ids.a]
    );
    await c.query(
      "ALTER TABLE levex.role_assignments ENABLE TRIGGER role_assignments_guard"
    );
    await rejectedInside(
      c,
      "UPDATE levex.role_assignments SET status='ACTIVE',revoked_at=NULL,revoked_by_actor_id=NULL WHERE id=$1",
      [ids.revoked]
    );
  }));
test("ROLE-001 + identity/FK/CHECK invariants: canonical provisioning fixture", () =>
  fixture(async (c) => {
    await rejectedInside(
      c,
      "INSERT INTO levex.role_assignments(id,actor_id,role,assignment_source) VALUES ($1,$2,'mentor','BOOTSTRAP')",
      [randomUUID(), ids.a],
      "23505"
    );
    await rejectedInside(
      c,
      "INSERT INTO levex.accounts(id,actor_id,provider,provider_subject) VALUES ($1,$2,'oidc','subject-a')",
      [randomUUID(), ids.b],
      "23505"
    );
    await rejectedInside(
      c,
      "INSERT INTO levex.accounts(id,actor_id,provider,provider_subject) VALUES ($1,$2,'oidc','foreign')",
      [randomUUID(), randomUUID()],
      "23503"
    );
    for (const name of ["", " padded "])
      await rejectedInside(
        c,
        "INSERT INTO levex.actors(id,display_name) VALUES ($1,$2)",
        [randomUUID(), name]
      );
    await rejectedInside(
      c,
      "UPDATE levex.actors SET status='DEACTIVATED' WHERE id=$1",
      [ids.a]
    );
    await rejectedInside(c, "UPDATE levex.actors SET version=0 WHERE id=$1", [
      ids.a,
    ]);
    await rejectedInside(
      c,
      "DELETE FROM levex.actors WHERE id=$1",
      [ids.a],
      "23001" // PostgreSQL 18 RESTRICT violation; missing parent remains 23503.
    );
  }));
test("TRIGGER-006: both session and effective migration identity required", () =>
  fixture(async (c) => {
    assert.deepEqual(
      (await c.query("SELECT session_user,current_user")).rows[0],
      { session_user: "migrator", current_user: "db_owner" }
    );
    await rejectedInside(
      c,
      "INSERT INTO levex.role_assignments(id,actor_id,role,assignment_source,assigned_by_actor_id) VALUES ($1,$2,'mentor','OPERATOR',$3)",
      [randomUUID(), ids.b, ids.a],
      "42501"
    );
    for (const runtime of [clients.app_runtime, clients.worker_runtime]) {
      await runtime.query("SET levex.actor_role='operator'");
      await runtime.query(`SET levex.actor_id='${ids.a}'`);
      await denied(
        runtime,
        "INSERT INTO levex.role_assignments(id,actor_id,role,assignment_source) VALUES ($1,$2,'operator','BOOTSTRAP')",
        [randomUUID(), ids.b]
      );
      await runtime.query("RESET ALL");
    }
  }));
test("TRIGGER-008 mechanism: isolated DML invokes guard without direct EXECUTE", async () => {
  // Test-only transaction: no policies/grants survive and no Phase B function is installed.
  await admin.query("BEGIN");
  try {
    await admin.query(
      "INSERT INTO levex.actors(id,display_name) VALUES ($1,'ACL fixture')",
      [ids.a]
    );
    await admin.query(
      "INSERT INTO levex.accounts(id,actor_id,provider,provider_subject) VALUES ($1,$2,'oidc','acl-fixture')",
      [ids.account, ids.a]
    );
    await admin.query(
      "GRANT USAGE ON SCHEMA levex,levex_private TO app_runtime; GRANT SELECT,UPDATE ON levex.accounts TO app_runtime"
    );
    await admin.query(
      "CREATE POLICY test_only_select ON levex.accounts FOR SELECT TO app_runtime USING (true)"
    );
    await admin.query(
      "CREATE POLICY test_only_update ON levex.accounts FOR UPDATE TO app_runtime USING (true) WITH CHECK (true)"
    );
    await admin.query("SET LOCAL ROLE app_runtime");
    assert.equal(
      (
        await admin.query(
          "SELECT has_function_privilege(current_user,'levex_private.guard_account_binding()','EXECUTE') AS allowed"
        )
      ).rows[0].allowed,
      false
    );
    await rejectedInside(
      admin,
      "SELECT levex_private.guard_account_binding()",
      [],
      "42501"
    );
    await rejectedInside(
      admin,
      "UPDATE levex.accounts SET provider_subject='forged' WHERE id=$1",
      [ids.account]
    );
    assert.equal(
      (
        await admin.query(
          "UPDATE levex.accounts SET status='DEACTIVATED',deactivated_at=transaction_timestamp(),version=version+1,updated_at=transaction_timestamp() WHERE id=$1",
          [ids.account]
        )
      ).rowCount,
      1
    );
  } finally {
    await admin.query("ROLLBACK");
  }
  await inspectRoles(admin);
});
test("TRIGGER-006 session guard: owner effective role alone cannot bootstrap", async () => {
  await admin.query("BEGIN");
  try {
    await admin.query(
      "ALTER TABLE levex.actors DISABLE ROW LEVEL SECURITY; ALTER TABLE levex.role_assignments DISABLE ROW LEVEL SECURITY"
    );
    await admin.query(
      "INSERT INTO levex.actors(id,display_name) VALUES ($1,'Session fixture')",
      [ids.a]
    );
    await admin.query("SET LOCAL ROLE db_owner");
    await rejectedInside(
      admin,
      "INSERT INTO levex.role_assignments(id,actor_id,role,assignment_source) VALUES ($1,$2,'operator','BOOTSTRAP')",
      [ids.role, ids.a],
      "42501"
    );
  } finally {
    await admin.query("ROLLBACK");
  }
});
test("P03-M-003: rerun at head preserves catalog and ledger", async () => {
  const schema = await catalog();
  assert.deepEqual(await migrate(), []);
  assert.deepEqual(await catalog(), schema);
  assert.equal(
    (await admin.query("SELECT count(*)::int AS n FROM public.pgmigrations"))
      .rows[0].n,
    4
  );
});
test("P03-F-004: real migration runner failure rolls back schema and ledger; retry recovers", async () => {
  const { mkdtempSync, rmSync, copyFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "levex-migration-test-"));
  try {
    for (const file of readdirSync(migrationOptions.dir))
      if (file.endsWith(".cjs"))
        copyFileSync(`${migrationOptions.dir}/${file}`, `${dir}/${file}`);
    const candidate = `${dir}/1790000000004_test-failure.cjs`;
    writeFileSync(
      candidate,
      `exports.up=p=>{p.sql("SET LOCAL ROLE db_owner; CREATE TABLE levex.failure_probe(id integer); SELECT 1/0;")};`
    );
    const before = await catalog();
    await assert.rejects(
      runner({ ...migrationOptions, dir, databaseUrl: urlFor("migrator") })
    );
    assert.deepEqual(await catalog(), before);
    assert.equal(
      (await admin.query("SELECT count(*)::int AS n FROM public.pgmigrations"))
        .rows[0].n,
      4
    );
    writeFileSync(
      candidate,
      `exports.up=p=>{p.sql("SET LOCAL ROLE db_owner; CREATE TABLE levex.failure_probe(id integer); DROP TABLE levex.failure_probe; RESET ROLE;")};`
    );
    // A corrected deployment starts a fresh process. Reusing this process would
    // replay Node's cached CJS fixture rather than load the corrected file.
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { runner } from 'node-pg-migrate';
         const applied = await runner({
           dir: process.env.RECOVERY_MIGRATIONS_DIR,
           databaseUrl: process.env.DATABASE_URL,
           migrationsTable: 'pgmigrations', direction: 'up', count: Infinity
         });
         if (applied.length !== 1) throw new Error('EXPECTED_ONE_RECOVERY_MIGRATION');`,
      ],
      {
        env: {
          ...process.env,
          DATABASE_URL: urlFor("migrator"),
          RECOVERY_MIGRATIONS_DIR: dir,
        },
        stdio: "pipe",
      }
    );
    assert.deepEqual(await catalog(), before);
    assert.equal(
      (await admin.query("SELECT count(*)::int AS n FROM public.pgmigrations"))
        .rows[0].n,
      5
    );
    // Test-only completed probe ledger entry, not a shipped migration.
    await clients.migrator.query(
      "DELETE FROM public.pgmigrations WHERE name='1790000000004_test-failure'"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("P03-M-004: forward-only policy rejects down without data/schema mutation", async () => {
  const before = await catalog();
  await assert.rejects(
    runner({
      ...migrationOptions,
      direction: "down",
      count: 1,
      databaseUrl: urlFor("migrator"),
    }),
    /FORWARD_ONLY_MIGRATION/
  );
  assert.deepEqual(await catalog(), before);
  // Backup/restore alternative is a separate required CI recovery test below.
});
test("P03-M-004 recovery: PostgreSQL18.6 backup/restore preserves representative data and guards", async () => {
  const container = required("POSTGRES_CONTAINER_ID");
  const db = new URL(adminUrl).pathname.slice(1);
  const adminUser = new URL(adminUrl).username;
  const restored = `levex_restore_${randomBytes(5).toString("hex")}`;
  const probe = randomUUID();
  // Trusted test admin creates representative identity data; role provisioning is tested above.
  await admin.query(
    "INSERT INTO levex.actors(id,display_name) VALUES ($1,'Recovery fixture')",
    [probe]
  );
  try {
    const backup = execFileSync(
      "docker",
      ["exec", container, "pg_dump", "-U", adminUser, "-Fc", db],
      { maxBuffer: 20 * 1024 * 1024 }
    );
    await admin.query(`CREATE DATABASE ${restored}`);
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        container,
        "pg_restore",
        "-U",
        adminUser,
        "--exit-on-error",
        "-d",
        restored,
      ],
      { input: backup, stdio: ["pipe", "pipe", "pipe"] }
    );
    const restoreUrl = new URL(adminUrl);
    restoreUrl.pathname = `/${restored}`;
    const restoredClient = await connect(restoreUrl.toString());
    try {
      assert.equal(
        (
          await restoredClient.query(
            "SELECT display_name FROM levex.actors WHERE id=$1",
            [probe]
          )
        ).rows[0].display_name,
        "Recovery fixture"
      );
      assert.deepEqual(await catalog(restoredClient), await catalog());
      assert.equal(
        (
          await restoredClient.query(
            "SELECT count(*)::int AS n FROM public.pgmigrations"
          )
        ).rows[0].n,
        4
      );
      assert.equal(
        (
          await restoredClient.query(
            "SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('levex.accounts'::regclass,'levex.role_assignments'::regclass)"
          )
        ).rows[0].n,
        2
      );
    } finally {
      await restoredClient.end();
    }
    writeFileSync(
      `${evidenceDir}/recovery.json`,
      JSON.stringify(
        {
          backupSha256: digest(backup),
          restoredRows: 1,
          restoredMigrationHead: "1790000000003_p02-authorization",
          result: "PASS",
        },
        null,
        2
      ) + "\n"
    );
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${restored}`);
    await admin.query("DELETE FROM levex.actors WHERE id=$1", [probe]);
  }
});
