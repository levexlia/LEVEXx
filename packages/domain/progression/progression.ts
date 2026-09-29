import type { MasteryRecord } from "../mastery/mastery";
import type { QuestDefinition, QuestInstance } from "../quests/quest";
import { ensure, immutable } from "../shared/invariants";

export interface ProgressionEvent {
  readonly id: string;
  readonly participantId: string;
  readonly questInstanceId: string;
  readonly ruleVersionId: string;
  readonly masteryRecordId: string;
  readonly evidenceId: string;
  readonly unlockedQuestId: string;
  readonly unlockedAt: string;
}

export function applyProgression(
  instance: QuestInstance,
  quest: QuestDefinition,
  mastery: MasteryRecord,
  previous: readonly ProgressionEvent[],
  now: string
): ProgressionEvent | null {
  ensure(
    mastery.participantId === instance.participantId &&
      mastery.questInstanceId === instance.id &&
      mastery.skillId === quest.skillId &&
      mastery.masteryId === quest.progression.requiredMasteryId &&
      mastery.level === quest.mastery.level,
    "MASTERY_OWNERSHIP_MISMATCH"
  );
  if (mastery.status !== "MASTERED") return null;
  if (
    previous.some(
      (event) =>
        event.participantId === instance.participantId &&
        event.unlockedQuestId === quest.progression.unlockQuestId
    )
  )
    return null;
  return immutable({
    id: `${instance.id}:unlock:${quest.progression.versionId}`,
    participantId: instance.participantId,
    questInstanceId: instance.id,
    ruleVersionId: quest.progression.versionId,
    masteryRecordId: mastery.id,
    evidenceId: mastery.evidenceId,
    unlockedQuestId: quest.progression.unlockQuestId,
    unlockedAt: now,
  });
}
