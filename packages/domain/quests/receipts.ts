import type { MutationContext } from "../shared/policy";
import {
  canonical,
  ensure,
  exactKeys,
  identifier,
  immutable,
} from "../shared/invariants";
import {
  validateCommand,
  type CommandMetadata,
  type KernelCommand,
} from "./commands";
import type { QuestDefinition } from "./quest";
import type { CommandResult } from "./state";

export interface CommandReceipt {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly principal: MutationContext["principal"];
  readonly command: KernelCommand;
  readonly expectedVersion: number;
  readonly fingerprint: string;
  readonly result: CommandResult;
}

// Versioned, locale-independent encoding. Do not change version 1 after storage.
export function identifyCommand(
  input: KernelCommand,
  metadata: CommandMetadata,
  identity: MutationContext["principal"],
  quest: QuestDefinition
) {
  const command = validateCommand(input, quest);
  exactKeys(metadata, ["idempotencyKey", "expectedVersion"]);
  identifier(metadata.idempotencyKey);
  identifier(identity.actorId);
  ensure(["participant", "mentor"].includes(identity.role), "FORBIDDEN");
  ensure(
    Number.isSafeInteger(metadata.expectedVersion) &&
      metadata.expectedVersion >= 0,
    "INVALID_EXPECTED_VERSION"
  );
  const principal = { actorId: identity.actorId, role: identity.role };
  return immutable({
    schemaVersion: 1 as const,
    idempotencyKey: metadata.idempotencyKey,
    principal,
    command,
    expectedVersion: metadata.expectedVersion,
    fingerprint: canonical({
      schemaVersion: 1,
      command,
      expectedVersion: metadata.expectedVersion,
      principal,
    }),
  });
}

export function receiptKey(
  receipt: Pick<CommandReceipt, "principal" | "idempotencyKey">
): string {
  return canonical({
    principal: receipt.principal,
    idempotencyKey: receipt.idempotencyKey,
  });
}
