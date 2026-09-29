import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

export const roles = ["db_owner", "migrator", "app_runtime", "worker_runtime"];
export const tables = ["actors", "accounts", "role_assignments"];
export const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
export const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
export const isMain = (url) =>
  process.argv[1] && url === pathToFileURL(process.argv[1]).href;
export function required(name) {
  assert.ok(process.env[name], `${name} is required`);
  return process.env[name];
}
export async function connect(connectionString) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}
export async function assertVersion(client) {
  const { rows } = await client.query("SHOW server_version_num");
  assert.equal(
    rows[0].server_version_num,
    "180006",
    "PostgreSQL 18.6 required"
  );
}
