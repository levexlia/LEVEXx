import {
  canonical,
  ensure,
  exactKeys,
  identifier,
  immutable,
  timestamp,
} from "../shared/invariants";
import { authorize, type MutationContext } from "../shared/policy";
import {
  validateCommand,
  type CommandMetadata,
  type KernelCommand,
} from "./commands";
import { defineQuest, type QuestDefinition } from "./quest";
import type { CommandResult, KernelSnapshot } from "./state";
import { transition } from "./transition";

/** Server-only, process-local aggregate. No client-state rehydration API. */
export class QuestAttempt {
  readonly #quest: QuestDefinition;
  #state: KernelSnapshot;
  readonly #receipts = new Map<
    string,
    { fingerprint: string; result: CommandResult }
  >();

  constructor(input: {
    readonly instanceId: string;
    readonly participantId: string;
    readonly mentorId: string;
    readonly quest: QuestDefinition;
  }) {
    for (const id of [input.instanceId, input.participantId, input.mentorId])
      identifier(id);
    ensure(input.instanceId.length <= 96, "AGGREGATE_ID_TOO_LONG");
    ensure(input.participantId !== input.mentorId, "SELF_EVALUATION_FORBIDDEN");
    this.#quest = defineQuest(input.quest);
    this.#state = immutable({
      instance: {
        id: input.instanceId,
        participantId: input.participantId,
        mentorId: input.mentorId,
        questId: this.#quest.id,
        questVersionId: this.#quest.versionId,
      },
      version: 0,
      phase: "AVAILABLE",
      changedAt: null,
      masteryStatus: "UNASSESSED",
      artifacts: [],
      evaluations: [],
      evidence: [],
      masteryHistory: [],
      progression: [],
    });
  }

  get snapshot(): KernelSnapshot {
    return this.#state;
  }

  execute(
    input: KernelCommand,
    metadata: CommandMetadata,
    context: MutationContext
  ): CommandResult {
    ensure(input !== null && typeof input === "object", "INVALID_COMMAND");
    const role =
      input.type === "accept-quest" || input.type === "submit-artifact"
        ? "participant"
        : "mentor";
    // Reauthorize even an idempotent retry, including fresh consent/session policy.
    authorize(
      context,
      this.#state.instance.participantId,
      this.#state.instance.mentorId,
      role
    );
    const command = validateCommand(input, this.#quest);
    exactKeys(metadata, ["idempotencyKey", "expectedVersion"]);
    identifier(metadata.idempotencyKey);
    ensure(
      Number.isSafeInteger(metadata.expectedVersion) &&
        metadata.expectedVersion >= 0,
      "INVALID_EXPECTED_VERSION"
    );
    // Stable identity only: request/session metadata must not reserve another
    // principal's keys or change the identity of a retry after reauthentication.
    const principal = {
      actorId: context.principal.actorId,
      role: context.principal.role,
    };
    const receiptKey = canonical({
      principal,
      idempotencyKey: metadata.idempotencyKey,
    });
    const fingerprint = canonical({
      command,
      expectedVersion: metadata.expectedVersion,
      principal,
    });
    const receipt = this.#receipts.get(receiptKey);
    if (receipt) {
      ensure(receipt.fingerprint === fingerprint, "IDEMPOTENCY_CONFLICT");
      // Historical response; never rewind current state or republish events.
      return immutable({ ...receipt.result, events: [], replayed: true });
    }
    ensure(metadata.expectedVersion === this.#state.version, "STALE_VERSION");
    ensure(
      this.#state.changedAt === null ||
        timestamp(context.now) >= timestamp(this.#state.changedAt),
      "CLOCK_REGRESSION"
    );
    const result = transition(this.#state, this.#quest, command, context);
    // All domain validation finishes before a single state replacement.
    this.#state = result.snapshot;
    this.#receipts.set(receiptKey, { fingerprint, result });
    return result;
  }
}
