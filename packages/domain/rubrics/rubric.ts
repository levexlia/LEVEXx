import { ensure, exactKeys, identifier, immutable } from "../shared/invariants";

export type CriterionOutcome = "NOT_MET" | "PARTIAL" | "MET";
export interface CriterionAssessment {
  readonly criterionId: string;
  readonly outcome: CriterionOutcome;
  readonly rationale: string;
}
export interface RubricVersion {
  readonly rubricId: string;
  readonly versionId: string;
  readonly criteria: readonly {
    readonly id: string;
    readonly mandatory: boolean;
  }[];
}

export function validateRubric(rubric: RubricVersion): void {
  identifier(rubric.rubricId);
  identifier(rubric.versionId);
  ensure(
    Array.isArray(rubric.criteria) && rubric.criteria.length > 0,
    "EMPTY_RUBRIC"
  );
  ensure(
    rubric.criteria.some((criterion) => criterion.mandatory === true),
    "MANDATORY_CRITERIA_REQUIRED"
  );
  const ids = new Set<string>();
  for (const criterion of rubric.criteria) {
    identifier(criterion.id);
    ensure(
      typeof criterion.mandatory === "boolean" && !ids.has(criterion.id),
      "INVALID_CRITERION"
    );
    ids.add(criterion.id);
  }
}

export function validateAssessments(
  rubric: RubricVersion,
  assessments: readonly CriterionAssessment[]
): readonly CriterionAssessment[] {
  validateRubric(rubric);
  ensure(
    Array.isArray(assessments) && assessments.length === rubric.criteria.length,
    "CRITERIA_INCOMPLETE"
  );
  const ids = new Set<string>();
  for (const assessment of assessments) {
    exactKeys(assessment, ["criterionId", "outcome", "rationale"]);
    ensure(
      rubric.criteria.some(
        (criterion) => criterion.id === assessment.criterionId
      ) && !ids.has(assessment.criterionId),
      "CRITERION_MISMATCH"
    );
    ensure(
      ["NOT_MET", "PARTIAL", "MET"].includes(assessment.outcome),
      "INVALID_OUTCOME"
    );
    ensure(
      typeof assessment.rationale === "string" &&
        assessment.rationale.trim().length > 0 &&
        assessment.rationale.length <= 2000,
      "RATIONALE_REQUIRED"
    );
    ids.add(assessment.criterionId);
  }
  return immutable(
    [...assessments].sort((a, b) => a.criterionId.localeCompare(b.criterionId))
  );
}
