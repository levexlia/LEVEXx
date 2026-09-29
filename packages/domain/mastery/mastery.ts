import type { Evidence } from "../evidence/evidence";
import type { EvaluationRevision } from "../evaluations/evaluation";
import type { QuestDefinition, QuestInstance } from "../quests/quest";
import { validateAssessments } from "../rubrics/rubric";
import { ensure, immutable } from "../shared/invariants";

export type MasteryStatus =
  | "UNASSESSED"
  | "NOT_MASTERED"
  | "PARTIAL"
  | "MASTERED";
export interface MasteryRecord {
  readonly id: string;
  readonly participantId: string;
  readonly questInstanceId: string;
  readonly skillId: string;
  readonly masteryId: string;
  readonly level: 1;
  readonly status: Exclude<MasteryStatus, "UNASSESSED">;
  readonly evidenceId: string;
  readonly evaluationRevisionId: string;
  readonly artifactVersionId: string;
  readonly rubricVersionId: string;
  readonly source: "DOMAIN_EVALUATION";
  readonly assessedAt: string;
}

export function recomputeMastery(
  instance: QuestInstance,
  quest: QuestDefinition,
  evaluation: EvaluationRevision,
  evidence: Evidence,
  previous: readonly MasteryRecord[],
  now: string
): MasteryRecord {
  ensure(
    evidence.status === "VERIFIED" &&
      evidence.participantId === instance.participantId &&
      evidence.questInstanceId === instance.id,
    "EVIDENCE_OWNERSHIP_MISMATCH"
  );
  ensure(
    evaluation.status === "FINALIZED" && evaluation.finalizedAt !== null,
    "FINALIZED_EVALUATION_REQUIRED"
  );
  ensure(
    evaluation.participantId === instance.participantId &&
      evaluation.questInstanceId === instance.id &&
      evaluation.mentorId === instance.mentorId,
    "EVALUATION_OWNERSHIP_MISMATCH"
  );
  ensure(
    evidence.evaluationRevisionId === evaluation.id &&
      evidence.artifactVersionId === evaluation.artifactVersionId &&
      evidence.rubricVersionId === evaluation.rubricVersionId &&
      evidence.rubricVersionId === quest.rubric.versionId &&
      evidence.questVersionId === quest.versionId,
    "EVIDENCE_VERSION_MISMATCH"
  );
  ensure(
    !previous.some((record) => record.evidenceId === evidence.id),
    "EVIDENCE_ALREADY_USED"
  );
  ensure(
    previous.at(-1)?.status !== "MASTERED",
    "UNSUPPORTED_MASTERY_TRANSITION"
  );
  const assessments = validateAssessments(quest.rubric, evaluation.assessments);
  const mandatory = assessments.filter((assessment) =>
    quest.rubric.criteria.some(
      (criterion) =>
        criterion.id === assessment.criterionId && criterion.mandatory
    )
  );
  const status = mandatory.every((item) => item.outcome === "MET")
    ? "MASTERED"
    : mandatory.some((item) => item.outcome !== "NOT_MET")
    ? "PARTIAL"
    : "NOT_MASTERED";
  return immutable({
    id: `${evidence.id}:mastery`,
    participantId: instance.participantId,
    questInstanceId: instance.id,
    skillId: quest.skillId,
    masteryId: quest.mastery.id,
    level: quest.mastery.level,
    status,
    evidenceId: evidence.id,
    evaluationRevisionId: evaluation.id,
    artifactVersionId: evidence.artifactVersionId,
    rubricVersionId: evidence.rubricVersionId,
    source: "DOMAIN_EVALUATION",
    assessedAt: now,
  });
}
