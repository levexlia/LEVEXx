import {
  assertArtifactOwner,
  type ArtifactVersion,
} from "../artifacts/artifact";
import type { QuestDefinition, QuestInstance } from "../quests/quest";
import {
  validateAssessments,
  type CriterionAssessment,
} from "../rubrics/rubric";
import { ensure, immutable } from "../shared/invariants";

export interface EvaluationRevision {
  readonly evaluationId: string;
  readonly id: string;
  readonly revision: number;
  readonly supersedesRevisionId: string | null;
  readonly participantId: string;
  readonly questInstanceId: string;
  readonly artifactVersionId: string;
  readonly rubricVersionId: string;
  readonly mentorId: string;
  readonly assessments: readonly CriterionAssessment[];
  readonly status: "DRAFT" | "FINALIZED";
  readonly createdAt: string;
  readonly finalizedAt: string | null;
}

export function draftEvaluation(
  instance: QuestInstance,
  quest: QuestDefinition,
  artifact: ArtifactVersion,
  previous: readonly EvaluationRevision[],
  assessments: readonly CriterionAssessment[],
  now: string
): EvaluationRevision {
  assertArtifactOwner(instance, artifact);
  const last = previous.at(-1);
  ensure(last?.status !== "DRAFT", "DRAFT_ALREADY_EXISTS");
  const revision = previous.length + 1;
  return immutable({
    evaluationId: `${instance.id}:evaluation`,
    id: `${instance.id}:evaluation:${revision}`,
    revision,
    supersedesRevisionId: last?.id ?? null,
    participantId: instance.participantId,
    questInstanceId: instance.id,
    artifactVersionId: artifact.id,
    rubricVersionId: quest.rubric.versionId,
    mentorId: instance.mentorId,
    assessments: validateAssessments(quest.rubric, assessments),
    status: "DRAFT",
    createdAt: now,
    finalizedAt: null,
  });
}

export function finalizeEvaluation(
  instance: QuestInstance,
  quest: QuestDefinition,
  artifact: ArtifactVersion,
  draft: EvaluationRevision,
  now: string
): EvaluationRevision {
  assertArtifactOwner(instance, artifact);
  ensure(
    draft.status === "DRAFT" && draft.finalizedAt === null,
    "EVALUATION_ALREADY_FINALIZED"
  );
  ensure(
    draft.participantId === instance.participantId &&
      draft.questInstanceId === instance.id &&
      draft.mentorId === instance.mentorId,
    "EVALUATION_OWNERSHIP_MISMATCH"
  );
  ensure(
    draft.artifactVersionId === artifact.id &&
      draft.rubricVersionId === quest.rubric.versionId,
    "EVALUATION_VERSION_MISMATCH"
  );
  validateAssessments(quest.rubric, draft.assessments);
  return immutable({ ...draft, status: "FINALIZED", finalizedAt: now });
}
