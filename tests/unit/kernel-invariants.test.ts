import { describe, expect, it } from "vitest";
import {
  FIRST_MACHINE,
  defineQuest,
  type CriterionAssessment,
  type Evidence,
} from "../../packages/domain";
import { finalizeEvaluation } from "../../packages/domain/evaluations/evaluation";
import { verifyEvidence } from "../../packages/domain/evidence/evidence";
import { recomputeMastery } from "../../packages/domain/mastery/mastery";
import { applyProgression } from "../../packages/domain/progression/progression";
import { draft, mastered, NOW, scores, submitted } from "./kernel-fixtures";

function chain() {
  const state = mastered().snapshot;
  return {
    instance: state.instance,
    artifact: state.artifacts[0]!,
    evaluation: state.evaluations[0]!,
    evidence: state.evidence[0]!,
    mastery: state.masteryHistory[0]!,
    progression: state.progression[0]!,
  };
}

describe("versioned evidence invariants", () => {
  it("requires a finalized evaluation before evidence can exist", () => {
    const { instance, artifact, evaluation } = chain();
    expect(() =>
      verifyEvidence(
        instance,
        FIRST_MACHINE,
        artifact,
        { ...evaluation, status: "DRAFT", finalizedAt: null },
        [],
        NOW
      )
    ).toThrow("FINALIZED_EVALUATION_REQUIRED");
  });
  it.each(["participantId", "questInstanceId", "artifactId"] as const)(
    "rejects artifact %s substitution",
    (field) => {
      const { instance, artifact, evaluation } = chain();
      expect(() =>
        verifyEvidence(
          instance,
          FIRST_MACHINE,
          { ...artifact, [field]: "foreign" },
          evaluation,
          [],
          NOW
        )
      ).toThrow("ARTIFACT_OWNERSHIP_MISMATCH");
    }
  );
  it.each(["participantId", "questInstanceId", "mentorId"] as const)(
    "rejects evaluation %s substitution",
    (field) => {
      const { instance, artifact, evaluation } = chain();
      expect(() =>
        verifyEvidence(
          instance,
          FIRST_MACHINE,
          artifact,
          { ...evaluation, [field]: "foreign" },
          [],
          NOW
        )
      ).toThrow("EVALUATION_OWNERSHIP_MISMATCH");
    }
  );
  it.each(["artifactVersionId", "rubricVersionId"] as const)(
    "rejects evaluation %s mismatch",
    (field) => {
      const { instance, artifact, evaluation } = chain();
      expect(() =>
        verifyEvidence(
          instance,
          FIRST_MACHINE,
          artifact,
          { ...evaluation, [field]: "foreign" },
          [],
          NOW
        )
      ).toThrow("EVIDENCE_VERSION_MISMATCH");
    }
  );
  it("rejects evidence for another quest definition version", () => {
    const { instance, artifact, evaluation } = chain();
    expect(() =>
      verifyEvidence(
        instance,
        { ...FIRST_MACHINE, versionId: "v2" },
        artifact,
        evaluation,
        [],
        NOW
      )
    ).toThrow("EVIDENCE_VERSION_MISMATCH");
  });
  it("cannot verify the same evaluation revision twice", () => {
    const { instance, artifact, evaluation, evidence } = chain();
    expect(() =>
      verifyEvidence(
        instance,
        FIRST_MACHINE,
        artifact,
        evaluation,
        [evidence],
        NOW
      )
    ).toThrow("EVIDENCE_ALREADY_USED");
  });
  it("rejects invalid draft ownership during finalization", () => {
    const kernel = submitted();
    draft(kernel);
    const state = kernel.snapshot;
    expect(() =>
      finalizeEvaluation(
        state.instance,
        FIRST_MACHINE,
        state.artifacts[0]!,
        { ...state.evaluations[0]!, participantId: "bob" },
        NOW
      )
    ).toThrow("EVALUATION_OWNERSHIP_MISMATCH");
  });
  it("rejects obsolete rubric versions during finalization", () => {
    const kernel = submitted();
    draft(kernel);
    const state = kernel.snapshot;
    expect(() =>
      finalizeEvaluation(
        state.instance,
        FIRST_MACHINE,
        state.artifacts[0]!,
        { ...state.evaluations[0]!, rubricVersionId: "old" },
        NOW
      )
    ).toThrow("EVALUATION_VERSION_MISMATCH");
  });
});

describe("mastery provenance and progression", () => {
  it.each(["participantId", "questInstanceId"] as const)(
    "rejects evidence %s substitution",
    (field) => {
      const { instance, evaluation, evidence } = chain();
      expect(() =>
        recomputeMastery(
          instance,
          FIRST_MACHINE,
          evaluation,
          { ...evidence, [field]: "foreign" },
          [],
          NOW
        )
      ).toThrow("EVIDENCE_OWNERSHIP_MISMATCH");
    }
  );
  it.each([
    "evaluationRevisionId",
    "artifactVersionId",
    "rubricVersionId",
    "questVersionId",
  ] as const)("rejects evidence %s mismatch", (field) => {
    const { instance, evaluation, evidence } = chain();
    expect(() =>
      recomputeMastery(
        instance,
        FIRST_MACHINE,
        evaluation,
        { ...evidence, [field]: "foreign" },
        [],
        NOW
      )
    ).toThrow("EVIDENCE_VERSION_MISMATCH");
  });
  it("requires VERIFIED evidence", () => {
    const { instance, evaluation, evidence } = chain();
    expect(() =>
      recomputeMastery(
        instance,
        FIRST_MACHINE,
        evaluation,
        { ...evidence, status: "PENDING" } as unknown as Evidence,
        [],
        NOW
      )
    ).toThrow("EVIDENCE_OWNERSHIP_MISMATCH");
  });
  it("rejects reuse of evidence in a mastery transition", () => {
    const { instance, evaluation, evidence, mastery } = chain();
    expect(() =>
      recomputeMastery(
        instance,
        FIRST_MACHINE,
        evaluation,
        evidence,
        [mastery],
        NOW
      )
    ).toThrow("EVIDENCE_ALREADY_USED");
  });
  it("rejects a new transition after MASTERED until a correction policy exists", () => {
    const { instance, evaluation, evidence, mastery } = chain();
    expect(() =>
      recomputeMastery(
        instance,
        FIRST_MACHINE,
        evaluation,
        { ...evidence, id: "another-evidence" },
        [mastery],
        NOW
      )
    ).toThrow("UNSUPPORTED_MASTERY_TRANSITION");
  });
  it("requires a finalized evaluation even when evidence claims verification", () => {
    const { instance, evaluation, evidence } = chain();
    expect(() =>
      recomputeMastery(
        instance,
        FIRST_MACHINE,
        { ...evaluation, status: "DRAFT", finalizedAt: null },
        evidence,
        [],
        NOW
      )
    ).toThrow("FINALIZED_EVALUATION_REQUIRED");
  });
  it("does not unlock for partial mastery", () => {
    const { instance, mastery } = chain();
    expect(
      applyProgression(
        instance,
        FIRST_MACHINE,
        { ...mastery, status: "PARTIAL" },
        [],
        NOW
      )
    ).toBeNull();
  });
  it.each([
    "participantId",
    "questInstanceId",
    "skillId",
    "masteryId",
  ] as const)("rejects mastery %s substitution", (field) => {
    const { instance, mastery } = chain();
    expect(() =>
      applyProgression(
        instance,
        FIRST_MACHINE,
        { ...mastery, [field]: "foreign" },
        [],
        NOW
      )
    ).toThrow("MASTERY_OWNERSHIP_MISMATCH");
  });
  it("never repeats an existing unlock, including a changed rule version", () => {
    const { instance, mastery, progression } = chain();
    expect(
      applyProgression(instance, FIRST_MACHINE, mastery, [progression], NOW)
    ).toBeNull();
    expect(
      applyProgression(
        instance,
        {
          ...FIRST_MACHINE,
          progression: { ...FIRST_MACHINE.progression, versionId: "v2" },
        },
        mastery,
        [progression],
        NOW
      )
    ).toBeNull();
  });
});

describe("rubric and catalog validation", () => {
  it.each([
    ["missing", scores().slice(1), "CRITERIA_INCOMPLETE"],
    [
      "duplicate",
      scores().map((score) => ({ ...score, criterionId: "movement" })),
      "CRITERION_MISMATCH",
    ],
    [
      "unknown",
      scores().map((score, index) =>
        index === 0 ? { ...score, criterionId: "fake" } : score
      ),
      "CRITERION_MISMATCH",
    ],
    [
      "invalid outcome",
      scores().map((score) => ({
        ...score,
        outcome: "AI_APPROVED",
      })) as unknown as CriterionAssessment[],
      "INVALID_OUTCOME",
    ],
    [
      "no rationale",
      scores().map((score) => ({ ...score, rationale: " " })),
      "RATIONALE_REQUIRED",
    ],
  ] as const)("rejects %s assessment data", (_label, assessments, code) => {
    const kernel = submitted();
    expect(() => draft(kernel, [...assessments])).toThrow(code);
    expect(kernel.snapshot.evaluations).toHaveLength(0);
  });
  it("rejects a rubric without mandatory criteria", () => {
    expect(() =>
      defineQuest({
        ...FIRST_MACHINE,
        rubric: {
          ...FIRST_MACHINE.rubric,
          criteria: [{ id: "presentation", mandatory: false }],
        },
      })
    ).toThrow("MANDATORY_CRITERIA_REQUIRED");
  });
  it("rejects duplicate rubric criteria", () => {
    expect(() =>
      defineQuest({
        ...FIRST_MACHINE,
        rubric: {
          ...FIRST_MACHINE.rubric,
          criteria: [
            { id: "movement", mandatory: true },
            { id: "movement", mandatory: true },
          ],
        },
      })
    ).toThrow("INVALID_CRITERION");
  });
  it("rejects a progression rule for a different mastery", () => {
    expect(() =>
      defineQuest({
        ...FIRST_MACHINE,
        progression: {
          ...FIRST_MACHINE.progression,
          requiredMasteryId: "unrelated",
        },
      })
    ).toThrow("INVALID_PROGRESSION_RULE");
  });
});
