import {
  QuestAttempt,
  type CommandReceipt,
  type CommandResult,
  type KernelSnapshot,
  type QuestDefinition,
} from "../../../domain";
import { canonical, ensure } from "../../../domain/shared/invariants";
import type { DatabaseConnection } from "./connection";

export function auditRecord(receipt: CommandReceipt) {
  return {
    attempt_id: receipt.result.snapshot.instance.id,
    participant_id: receipt.result.snapshot.instance.participantId,
    version: receipt.result.snapshot.version,
    actor_id: receipt.principal.actorId,
    actor_role: receipt.principal.role,
    idempotency_key: receipt.idempotencyKey,
    command_type: receipt.command.type,
    occurred_at: receipt.result.snapshot.changedAt,
  };
}

export async function loadAttempt(
  client: DatabaseConnection,
  row: Record<string, unknown>
): Promise<QuestAttempt> {
  const id = row.id;
  const catalog = await client.query(
    "SELECT body FROM levex_kernel.catalog WHERE version_id = $1",
    [row.quest_version_id]
  );
  ensure(catalog.rows.length === 1, "CATALOG_REQUIRED");
  const artifacts = await client.query(
    "SELECT body FROM levex_kernel.artifacts WHERE attempt_id = $1 ORDER BY position",
    [id]
  );
  const evaluations = await client.query(
    "SELECT body FROM levex_kernel.evaluations WHERE attempt_id = $1 ORDER BY position",
    [id]
  );
  const evidence = await client.query(
    `SELECT r.body FROM levex_kernel.evidence r JOIN levex_kernel.evaluations e
    ON e.id = r.evaluation_id WHERE r.attempt_id = $1 ORDER BY e.position`,
    [id]
  );
  const mastery = await client.query(
    `SELECT r.body FROM levex_kernel.mastery r JOIN levex_kernel.evaluations e
    ON e.id = r.evaluation_id WHERE r.attempt_id = $1 ORDER BY e.position`,
    [id]
  );
  const progression = await client.query(
    "SELECT body FROM levex_kernel.progression WHERE attempt_id = $1 ORDER BY id",
    [id]
  );
  const receipts = await client.query(
    "SELECT body FROM levex_kernel.receipts WHERE attempt_id = $1 ORDER BY version",
    [id]
  );
  // The assertion crosses the JSON/SQL boundary only; restore validates every value
  // against recomputed domain transitions before any aggregate can be returned.
  const snapshot = {
    instance: {
      id,
      participantId: row.participant_id,
      mentorId: row.mentor_id,
      questId: row.quest_id,
      questVersionId: row.quest_version_id,
    },
    version: row.version,
    phase: row.phase,
    changedAt: row.changed_at,
    masteryStatus: row.mastery_status,
    artifacts: artifacts.rows.map((r) => r.body),
    evaluations: evaluations.rows.map((r) => r.body),
    evidence: evidence.rows.map((r) => r.body),
    masteryHistory: mastery.rows.map((r) => r.body),
    progression: progression.rows.map((r) => r.body),
  } as KernelSnapshot;
  const history = receipts.rows.map((r) => r.body) as CommandReceipt[];
  const aggregate = QuestAttempt.restore({
    quest: catalog.rows[0]?.body as QuestDefinition,
    snapshot,
    receipts: history,
  });
  const outbox = await client.query(
    'SELECT body FROM levex_kernel.outbox WHERE attempt_id = $1 ORDER BY id COLLATE "C"',
    [id]
  );
  const expectedEvents = history
    .flatMap((r) => r.result.events)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ensure(
    canonical(outbox.rows.map((r) => r.body)) === canonical(expectedEvents),
    "INVALID_PERSISTED_OUTBOX"
  );
  const audit = await client.query(
    "SELECT * FROM levex_kernel.audit WHERE attempt_id = $1 ORDER BY version",
    [id]
  );
  const auditRows = audit.rows.map((r) => ({
    ...r,
    occurred_at:
      r.occurred_at instanceof Date
        ? r.occurred_at.toISOString()
        : r.occurred_at,
  }));
  ensure(
    canonical(auditRows) === canonical(history.map(auditRecord)),
    "INVALID_PERSISTED_AUDIT"
  );
  return aggregate;
}

export async function saveAttempt(
  client: DatabaseConnection,
  before: KernelSnapshot,
  result: CommandResult,
  receipt: CommandReceipt
): Promise<void> {
  const after = result.snapshot;
  ensure(
    !result.replayed &&
      after.version === before.version + 1 &&
      canonical(before.instance) === canonical(after.instance) &&
      canonical(receipt.result) === canonical(result),
    "INVALID_PERSISTENCE_WRITE"
  );
  // Append only new versions. Finalization is the single allowed draft update.
  for (const record of after.artifacts.slice(before.artifacts.length))
    await client.query("INSERT INTO levex_kernel.artifacts(body) VALUES ($1)", [
      JSON.stringify(record),
    ]);
  for (const record of after.evaluations) {
    const old = before.evaluations.find((r) => r.id === record.id);
    if (!old)
      await client.query(
        "INSERT INTO levex_kernel.evaluations(body) VALUES ($1)",
        [JSON.stringify(record)]
      );
    else if (canonical(old) !== canonical(record)) {
      const update = await client.query(
        "UPDATE levex_kernel.evaluations SET body = $1 WHERE id = $2 AND status = 'DRAFT'",
        [JSON.stringify(record), record.id]
      );
      ensure(update.rowCount === 1, "STALE_EVALUATION");
    }
  }
  for (const record of after.evidence.slice(before.evidence.length))
    await client.query("INSERT INTO levex_kernel.evidence(body) VALUES ($1)", [
      JSON.stringify(record),
    ]);
  for (const record of after.masteryHistory.slice(before.masteryHistory.length))
    await client.query("INSERT INTO levex_kernel.mastery(body) VALUES ($1)", [
      JSON.stringify(record),
    ]);
  for (const record of after.progression.slice(before.progression.length))
    await client.query(
      "INSERT INTO levex_kernel.progression(body) VALUES ($1)",
      [JSON.stringify(record)]
    );
  const update = await client.query(
    `UPDATE levex_kernel.attempts SET version = $1, phase = $2, changed_at = $3, mastery_status = $4
    WHERE id = $5 AND version = $6`,
    [
      after.version,
      after.phase,
      after.changedAt,
      after.masteryStatus,
      after.instance.id,
      before.version,
    ]
  );
  ensure(update.rowCount === 1, "STALE_VERSION");
  await client.query("INSERT INTO levex_kernel.receipts(body) VALUES ($1)", [
    JSON.stringify(receipt),
  ]);
  const audit = auditRecord(receipt);
  await client.query(
    `INSERT INTO levex_kernel.audit(attempt_id, participant_id, version, actor_id, actor_role, idempotency_key, command_type, occurred_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      audit.attempt_id,
      audit.participant_id,
      audit.version,
      audit.actor_id,
      audit.actor_role,
      audit.idempotency_key,
      audit.command_type,
      audit.occurred_at,
    ]
  );
  for (const event of result.events)
    await client.query("INSERT INTO levex_kernel.outbox(body) VALUES ($1)", [
      JSON.stringify(event),
    ]);
}
