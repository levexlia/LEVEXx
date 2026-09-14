import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for integration tests");
}

const client = new Client({ connectionString });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe("PostgreSQL bootstrap", () => {
  it("has the Gate 0 schema and migration record", async () => {
    const table = await client.query(
      "SELECT to_regclass('public.levex_meta')::text AS table_name"
    );

    expect(table.rows[0]?.table_name).toBe("levex_meta");

    const migration = await client.query(
      "SELECT COUNT(*)::text AS count FROM public.pgmigrations WHERE name = $1",
      ["1789327313237_gate0-bootstrap"]
    );

    expect(migration.rows[0]?.count).toBe("1");
  });
});
