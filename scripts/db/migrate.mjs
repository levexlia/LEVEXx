import { runner } from "node-pg-migrate";
import { assertVersion, connect, required } from "./common.mjs";
const url = required("DATABASE_URL");
const client = await connect(url);
try {
  await assertVersion(client);
  const row = (await client.query("SELECT session_user, current_user")).rows[0];
  if (row.session_user !== "migrator" || row.current_user !== "migrator")
    throw new Error("MIGRATOR_SESSION_REQUIRED");
} finally {
  await client.end();
}
await runner({
  databaseUrl: url,
  dir: "packages/infrastructure/database/migrations",
  direction: "up",
  migrationsTable: "pgmigrations",
  count: Infinity,
});
