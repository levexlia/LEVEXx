import {
  assertArtifactOwner,
  type ArtifactVersion,
} from "../artifacts/artifact";
import type { EvaluationRevision } from "../evaluations/evaluation";
import type { QuestDefinition, QuestInstance } from "../quests/quest";
import { validateAssessments } from "../rubrics/rubric";
import { ensure, immutable } from "../shared/invariants";

export interface Evidence {
  readonly id: string;
  readonly participantId: string;
  readonly questInstanceId: string;
  readonly questVersionId: string;
  readonly artifactVersionId: string;
  readonly contentHash: string;
  readonly evaluationRevisionId: string;
  readonly rubricVersionId: string;
  readonly status: "VERIFIED";
  readonly verifiedAt: string;
}

export function verifyEvidence(
  instance: QuestInstance,
  quest: QuestDefinition,
  artifact: ArtifactVersion,
  evaluation: EvaluationRevision,
  previous: readonly Evidence[],
  now: string
): Evidence {
  assertArtifactOwner(instance, artifact);
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
    evaluation.artifactVersionId === artifact.id &&
      evaluation.rubricVersionId === quest.rubric.versionId &&
      instance.questVersionId === quest.versionId &&
      instance.questId === quest.id,
    "EVIDENCE_VERSION_MISMATCH"
  );
  validateAssessments(quest.rubric, evaluation.assessments);
  ensure(
    !previous.some(
      (evidence) => evidence.evaluationRevisionId === evaluation.id
    ),
    "EVIDENCE_ALREADY_USED"
  );
  return immutable({
    id: `${evaluation.id}:evidence`,
    participantId: instance.participantId,
    questInstanceId: instance.id,
    questVersionId: quest.versionId,
    artifactVersionId: artifact.id,
    contentHash: artifact.contentHash,
    evaluationRevisionId: evaluation.id,
    rubricVersionId: quest.rubric.versionId,
    status: "VERIFIED",
    verifiedAt: now,
  });
}
