import {
  DomainError,
  ensure,
  identifier,
  immutable,
  timestamp,
} from "../shared/invariants";
import { authorize, type MutationContext } from "../shared/policy";
import { type CommandMetadata, type KernelCommand } from "./commands";
import { defineQuest, type QuestDefinition } from "./quest";
import type { CommandResult, KernelSnapshot } from "./state";
import { transition } from "./transition";
import { identifyCommand, receiptKey, type CommandReceipt } from "./receipts";
import { validateStoredHistory } from "./restore";

/** Server-only aggregate. One disposable instance per persistence transaction. */
export class QuestAttempt {
  readonly #quest: QuestDefinition;
  #state: KernelSnapshot;
  readonly #receipts = new Map<string, CommandReceipt>();

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

  get receipts(): readonly CommandReceipt[] {
    return immutable([...this.#receipts.values()]);
  }

  /** Repository-only loading: verify history and recompute every stored outcome. */
  static restore(input: {
    readonly quest: QuestDefinition;
    readonly snapshot: KernelSnapshot;
    readonly receipts: readonly CommandReceipt[];
  }): QuestAttempt {
    try {
      const attempt = new QuestAttempt({
        instanceId: input.snapshot.instance.id,
        participantId: input.snapshot.instance.participantId,
        mentorId: input.snapshot.instance.mentorId,
        quest: input.quest,
      });
      attempt.#state = validateStoredHistory(
        attempt.#quest,
        attempt.#state,
        input.snapshot,
        input.receipts
      );
      for (const receipt of input.receipts)
        attempt.#receipts.set(receiptKey(receipt), immutable(receipt));
      return attempt;
    } catch {
      throw new DomainError("INVALID_PERSISTED_STATE");
    }
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
    const identity = identifyCommand(
      input,
      metadata,
      context.principal,
      this.#quest
    );
    const key = receiptKey(identity);
    const receipt = this.#receipts.get(key);
    if (receipt) {
      ensure(
        receipt.fingerprint === identity.fingerprint,
        "IDEMPOTENCY_CONFLICT"
      );
      // Historical response; never rewind current state or republish events.
      return immutable({ ...receipt.result, events: [], replayed: true });
    }
    ensure(metadata.expectedVersion === this.#state.version, "STALE_VERSION");
    ensure(
      this.#state.changedAt === null ||
        timestamp(context.now) >= timestamp(this.#state.changedAt),
      "CLOCK_REGRESSION"
    );
    const result = transition(
      this.#state,
      this.#quest,
      identity.command,
      context
    );
    // All domain validation finishes before a single state replacement.
    this.#state = result.snapshot;
    this.#receipts.set(key, immutable({ ...identity, result }));
    return result;
  }
}
