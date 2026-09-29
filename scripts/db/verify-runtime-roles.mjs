import assert from "node:assert/strict";
import {
  assertVersion,
  connect,
  isMain,
  required,
  roles,
  tables,
} from "./common.mjs";

export async function inspectRoles(client) {
  await assertVersion(client);
  const roleRows = (
    await client.query(
      `SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
    rolinherit, rolcanlogin, rolreplication FROM pg_roles WHERE rolname=ANY($1) ORDER BY rolname`,
      [roles]
    )
  ).rows;
  assert.equal(roleRows.length, 4);
  for (const row of roleRows) {
    for (const flag of [
      "rolsuper",
      "rolbypassrls",
      "rolcreatedb",
      "rolcreaterole",
      "rolinherit",
      "rolreplication",
    ])
      assert.equal(row[flag], false, `${row.rolname}.${flag}`);
    assert.equal(row.rolcanlogin, row.rolname !== "db_owner");
  }
  const membershipRows = (
    await client.query(
      `SELECT member.rolname AS member, parent.rolname AS parent,
    m.admin_option, m.inherit_option, m.set_option FROM pg_auth_members m
    JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
    WHERE member.rolname=ANY($1) ORDER BY member.rolname,parent.rolname`,
      [roles]
    )
  ).rows;
  assert.deepEqual(membershipRows, [
    {
      member: "migrator",
      parent: "db_owner",
      admin_option: false,
      inherit_option: false,
      set_option: true,
    },
  ]);
  const schemaRows = (
    await client.query(
      "SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname IN ('levex','levex_private') ORDER BY nspname"
    )
  ).rows;
  assert.deepEqual(schemaRows, [
    { nspname: "levex", owner: "db_owner" },
    { nspname: "levex_private", owner: "db_owner" },
  ]);
  const tableRows = (
    await client.query(`SELECT c.relname, pg_get_userbyid(c.relowner) AS owner,
    c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='levex' AND c.relkind='r' ORDER BY c.relname`)
  ).rows;
  assert.deepEqual(
    tableRows.map((r) => r.relname),
    [...tables].sort()
  );
  for (const row of tableRows) {
    assert.equal(row.owner, "db_owner");
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
  }
  const policies = (
    await client.query(
      "SELECT * FROM pg_policies WHERE schemaname IN ('levex','levex_private')"
    )
  ).rows;
  assert.equal(policies.length, 0, "Phase A has no permissive policies");
  for (const role of ["app_runtime", "worker_runtime"]) {
    for (const table of tables) {
      for (const privilege of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ]) {
        const row = (
          await client.query(
            "SELECT has_table_privilege($1,$2,$3) AS allowed",
            [role, `levex.${table}`, privilege]
          )
        ).rows[0];
        assert.equal(
          row.allowed,
          false,
          `${role} premature ${table} ${privilege}`
        );
      }
      for (const privilege of ["SELECT", "INSERT", "UPDATE", "REFERENCES"]) {
        assert.equal(
          (
            await client.query(
              "SELECT has_any_column_privilege($1,$2,$3) AS allowed",
              [role, `levex.${table}`, privilege]
            )
          ).rows[0].allowed,
          false
        );
      }
    }
    assert.equal(
      (
        await client.query(
          "SELECT has_database_privilege($1,current_database(),'CREATE') OR has_database_privilege($1,current_database(),'TEMP') AS allowed",
          [role]
        )
      ).rows[0].allowed,
      false
    );
    const schemas = (
      await client.query(
        "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND has_schema_privilege($1,oid,'CREATE')",
        [role]
      )
    ).rows;
    assert.deepEqual(schemas, []);
  }
  return {
    roles: roleRows,
    memberships: membershipRows,
    tables: tableRows,
    policies,
    phase: "A",
  };
}
if (isMain(import.meta.url)) {
  const client = await connect(required("DATABASE_URL"));
  try {
    console.log(JSON.stringify(await inspectRoles(client), null, 2));
  } finally {
    await client.end();
  }
}
