import { submitArtifact } from "../artifacts/artifact";
import { draftEvaluation, finalizeEvaluation } from "../evaluations/evaluation";
import { verifyEvidence } from "../evidence/evidence";
import { recomputeMastery } from "../mastery/mastery";
import { applyProgression } from "../progression/progression";
import type { DomainEvent, DomainEventType } from "../shared/events";
import { ensure, immutable } from "../shared/invariants";
import type { MutationContext } from "../shared/policy";
import type { KernelCommand } from "./commands";
import type { QuestDefinition } from "./quest";
import type { CommandResult, KernelSnapshot } from "./state";

// Computes a candidate change only. No external effect or mutation of current state.
export function transition(
  state: KernelSnapshot,
  quest: QuestDefinition,
  command: KernelCommand,
  context: MutationContext
): CommandResult {
  const next = { ...state, version: state.version + 1, changedAt: context.now };
  const events: DomainEvent[] = [];
  const emit = (type: DomainEventType, recordId: string): void => {
    events.push({
      id: `${state.instance.id}:v${next.version}:${type}`,
      type,
      schemaVersion: 1,
      aggregateId: state.instance.id,
      aggregateVersion: next.version,
      participantId: state.instance.participantId,
      performedBy: context.principal.actorId,
      occurredAt: context.now,
      recordId,
    });
  };
  const instance = state.instance;
  switch (command.type) {
    case "accept-quest":
      ensure(state.phase === "AVAILABLE", "QUEST_ALREADY_ACCEPTED");
      next.phase = "ACCEPTED";
      emit("quest.accepted", instance.id);
      break;
    case "submit-artifact": {
      ensure(
        ["ACCEPTED", "SUBMITTED", "ASSESSED"].includes(state.phase),
        "INVALID_QUEST_STATE"
      );
      ensure(
        state.evaluations.at(-1)?.status !== "DRAFT",
        "EVALUATION_PENDING"
      );
      const artifact = submitArtifact(
        instance,
        state.artifacts,
        {
          contentHash: command.contentHash,
          objectVersion: command.objectVersion,
        },
        context.now
      );
      next.artifacts = [...state.artifacts, artifact];
      next.phase = "SUBMITTED";
      emit("artifact.submitted", artifact.id);
      break;
    }
    case "draft-evaluation": {
      ensure(
        ["SUBMITTED", "ASSESSED"].includes(state.phase),
        "INVALID_QUEST_STATE"
      );
      const artifact = state.artifacts.at(-1);
      ensure(
        artifact !== undefined && artifact.id === command.artifactVersionId,
        "ARTIFACT_VERSION_MISMATCH"
      );
      const draft = draftEvaluation(
        instance,
        quest,
        artifact,
        state.evaluations,
        command.assessments,
        context.now
      );
      next.evaluations = [...state.evaluations, draft];
      emit("evaluation.drafted", draft.id);
      break;
    }
    case "finalize-evaluation": {
      const draft = state.evaluations.at(-1);
      ensure(
        draft !== undefined && draft.id === command.evaluationRevisionId,
        "EVALUATION_VERSION_MISMATCH"
      );
      ensure(draft.status === "DRAFT", "EVALUATION_ALREADY_FINALIZED");
      ensure(
        ["SUBMITTED", "ASSESSED"].includes(state.phase),
        "INVALID_QUEST_STATE"
      );
      const artifact = state.artifacts.at(-1);
      ensure(artifact !== undefined, "ARTIFACT_REQUIRED");
      const finalized = finalizeEvaluation(
        instance,
        quest,
        artifact,
        draft,
        context.now
      );
      const evidence = verifyEvidence(
        instance,
        quest,
        artifact,
        finalized,
        state.evidence,
        context.now
      );
      const mastery = recomputeMastery(
        instance,
        quest,
        finalized,
        evidence,
        state.masteryHistory,
        context.now
      );
      const progression = applyProgression(
        instance,
        quest,
        mastery,
        state.progression,
        context.now
      );
      next.evaluations = [...state.evaluations.slice(0, -1), finalized];
      next.evidence = [...state.evidence, evidence];
      next.masteryHistory = [...state.masteryHistory, mastery];
      next.masteryStatus = mastery.status;
      next.phase = mastery.status === "MASTERED" ? "MASTERED" : "ASSESSED";
      emit("evaluation.finalized", finalized.id);
      emit("evidence.verified", evidence.id);
      emit(
        mastery.status === "MASTERED" ? "mastery.granted" : "mastery.assessed",
        mastery.id
      );
      if (progression) {
        next.progression = [...state.progression, progression];
        emit("progression.unlocked", progression.id);
      }
      break;
    }
  }
  return immutable({ snapshot: next, events, replayed: false });
}
