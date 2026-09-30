import assert from "node:assert/strict";
import {
  assertVersion,
  canonicalMembership,
  connect,
  identifier,
  isMain,
  literal,
  readCanonicalMemberships,
  required,
  roles,
} from "./common.mjs";

// Run only with an explicitly supplied provisioning credential against a dedicated DB.
// Existing roles must already match; this script never silently weakens an existing role.
export async function provision(client, passwords) {
  await assertVersion(client);
  const database = (await client.query("SELECT current_database() AS name"))
    .rows[0].name;
  await client.query("BEGIN");
  await client.query("SET LOCAL standard_conforming_strings = on");
  try {
    for (const role of roles) {
      const existing = (
        await client.query("SELECT * FROM pg_roles WHERE rolname=$1", [role])
      ).rows[0];
      if (existing) {
        for (const flag of [
          "rolsuper",
          "rolcreatedb",
          "rolcreaterole",
          "rolbypassrls",
          "rolinherit",
          "rolreplication",
        ]) {
          assert.equal(
            existing[flag],
            false,
            `Unsafe existing ${role}.${flag}`
          );
        }
        assert.equal(existing.rolcanlogin, role !== "db_owner");
      } else {
        const login = role === "db_owner" ? "NOLOGIN" : "LOGIN";
        const password =
          role === "db_owner" ? "" : ` PASSWORD ${literal(passwords[role])}`;
        await client.query(
          `CREATE ROLE ${identifier(
            role
          )} ${login} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT NOREPLICATION${password}`
        );
      }
    }
    const memberships = await readCanonicalMemberships(client);
    // A fresh cluster has no membership yet. Existing grants must match exactly:
    // do not silently repair ADMIN/INHERIT/SET drift or ignore incoming members.
    if (memberships.length > 0) {
      assert.deepEqual(
        memberships,
        [canonicalMembership],
        "Unexpected canonical role membership"
      );
    }
    await client.query(
      "GRANT db_owner TO migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE"
    );
    await client.query(
      `REVOKE ALL ON DATABASE ${identifier(database)} FROM PUBLIC`
    );
    await client.query(
      `GRANT CONNECT ON DATABASE ${identifier(
        database
      )} TO migrator, app_runtime, worker_runtime`
    );
    await client.query(
      `GRANT CREATE ON DATABASE ${identifier(database)} TO db_owner`
    );
    // Gate 0's immutable migration and node-pg-migrate ledger live in public.
    await client.query("REVOKE ALL ON SCHEMA public FROM PUBLIC");
    await client.query("GRANT USAGE, CREATE ON SCHEMA public TO migrator");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}
if (isMain(import.meta.url)) {
  const passwords = Object.fromEntries(
    roles
      .filter((r) => r !== "db_owner")
      .map((r) => [r, required(`${r.toUpperCase()}_PASSWORD`)])
  );
  const client = await connect(required("PROVISION_DATABASE_URL"));
  try {
    await provision(client, passwords);
    console.log("Role provisioning complete");
  } finally {
    await client.end();
  }
}
