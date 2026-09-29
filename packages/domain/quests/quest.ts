import type { RubricVersion } from "../rubrics/rubric";
import { validateRubric } from "../rubrics/rubric";
import { ensure, identifier, immutable } from "../shared/invariants";

export interface QuestDefinition {
  readonly id: string;
  readonly versionId: string;
  readonly title: string;
  readonly skillId: string;
  readonly mastery: { readonly id: string; readonly level: 1 };
  readonly rubric: RubricVersion;
  readonly progression: {
    readonly ruleId: string;
    readonly versionId: string;
    readonly requiredMasteryId: string;
    readonly unlockQuestId: string;
  };
}

export interface QuestInstance {
  readonly id: string;
  readonly participantId: string;
  readonly mentorId: string;
  readonly questId: string;
  readonly questVersionId: string;
}

export function defineQuest(quest: QuestDefinition): QuestDefinition {
  for (const id of [
    quest.id,
    quest.versionId,
    quest.skillId,
    quest.mastery.id,
    quest.progression.ruleId,
    quest.progression.versionId,
    quest.progression.unlockQuestId,
  ])
    identifier(id);
  ensure(
    typeof quest.title === "string" && quest.title.trim().length > 0,
    "QUEST_TITLE_REQUIRED"
  );
  ensure(quest.mastery.level === 1, "UNSUPPORTED_MASTERY_LEVEL");
  ensure(
    quest.progression.requiredMasteryId === quest.mastery.id &&
      quest.progression.unlockQuestId !== quest.id,
    "INVALID_PROGRESSION_RULE"
  );
  validateRubric(quest.rubric);
  return immutable(quest);
}
