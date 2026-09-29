import { canonical, ensure, exactKeys, timestamp } from "../shared/invariants";
import type { QuestDefinition } from "./quest";
import { identifyCommand, receiptKey, type CommandReceipt } from "./receipts";
import type { KernelSnapshot } from "./state";
import { transition } from "./transition";

/** Validate repository records, never request-body state. No historical policy is invented. */
export function validateStoredHistory(
  quest: QuestDefinition,
  initial: KernelSnapshot,
  stored: KernelSnapshot,
  receipts: readonly CommandReceipt[]
): KernelSnapshot {
  ensure(Array.isArray(receipts), "INVALID_PERSISTED_STATE");
  let current = initial;
  const keys = new Set<string>();
  for (const receipt of receipts) {
    exactKeys(receipt, [
      "schemaVersion",
      "idempotencyKey",
      "principal",
      "command",
      "expectedVersion",
      "fingerprint",
      "result",
    ]);
    exactKeys(receipt.principal, ["actorId", "role"]);
    ensure(receipt.schemaVersion === 1, "UNSUPPORTED_RECEIPT_SCHEMA");
    const identity = identifyCommand(
      receipt.command,
      {
        idempotencyKey: receipt.idempotencyKey,
        expectedVersion: receipt.expectedVersion,
      },
      receipt.principal,
      quest
    );
    ensure(
      identity.fingerprint === receipt.fingerprint,
      "INVALID_PERSISTED_STATE"
    );
    const key = receiptKey(identity);
    ensure(!keys.has(key), "INVALID_PERSISTED_STATE");
    keys.add(key);
    const role = ["accept-quest", "submit-artifact"].includes(
      identity.command.type
    )
      ? "participant"
      : "mentor";
    ensure(
      identity.principal.role === role &&
        identity.principal.actorId ===
          (role === "participant"
            ? initial.instance.participantId
            : initial.instance.mentorId),
      "INVALID_PERSISTED_STATE"
    );
    ensure(
      identity.expectedVersion === current.version,
      "INVALID_PERSISTED_STATE"
    );
    const now = receipt.result.snapshot.changedAt;
    ensure(now !== null, "INVALID_PERSISTED_STATE");
    timestamp(now);
    ensure(
      current.changedAt === null || now >= current.changedAt,
      "INVALID_PERSISTED_STATE"
    );
    // Integrity verification of stored facts; not authorization to execute a new command.
    const expected = transition(current, quest, identity.command, {
      principal: identity.principal,
      now,
    });
    ensure(
      canonical(expected) === canonical(receipt.result),
      "INVALID_PERSISTED_STATE"
    );
    current = expected.snapshot;
  }
  ensure(canonical(current) === canonical(stored), "INVALID_PERSISTED_STATE");
  return current;
}
