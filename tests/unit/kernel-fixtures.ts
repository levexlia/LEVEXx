import {
  FIRST_MACHINE,
  QuestAttempt,
  type CriterionAssessment,
  type CriterionOutcome,
  type KernelCommand,
  type MutationContext,
  type QuestDefinition,
} from "../../packages/domain";

export const NOW = "2026-09-29T20:00:00.000Z";
export const EXPIRES = "2026-09-30T20:00:00.000Z";
export const HASH = "a".repeat(64);
export function context(
  role: "participant" | "mentor" = "participant"
): MutationContext {
  return {
    principal: { actorId: role === "participant" ? "alice" : "mentor", role },
    online: true,
    sessionActive: true,
    now: NOW,
    consent: { participantId: "alice", status: "ACTIVE", validUntil: EXPIRES },
  };
}
export function scores(
  outcome: CriterionOutcome = "MET"
): CriterionAssessment[] {
  return FIRST_MACHINE.rubric.criteria.map((criterion) => ({
    criterionId: criterion.id,
    outcome,
    rationale: `Observed ${criterion.id}`,
  }));
}
export function attempt(quest: QuestDefinition = FIRST_MACHINE): QuestAttempt {
  return new QuestAttempt({
    instanceId: "attempt-1",
    participantId: "alice",
    mentorId: "mentor",
    quest,
  });
}
export function run(
  kernel: QuestAttempt,
  command: KernelCommand,
  key = `command-${kernel.snapshot.version}`,
  ctx = context(
    command.type === "draft-evaluation" ||
      command.type === "finalize-evaluation"
      ? "mentor"
      : "participant"
  )
) {
  return kernel.execute(
    command,
    { idempotencyKey: key, expectedVersion: kernel.snapshot.version },
    ctx
  );
}
export function submitted(): QuestAttempt {
  const kernel = attempt();
  run(kernel, { type: "accept-quest" });
  run(kernel, {
    type: "submit-artifact",
    contentHash: HASH,
    objectVersion: "private-object.v1",
  });
  return kernel;
}
export function draft(kernel: QuestAttempt, assessments = scores()) {
  const artifact = kernel.snapshot.artifacts.at(-1);
  if (!artifact) throw new Error("Fixture needs an artifact");
  return run(kernel, {
    type: "draft-evaluation",
    artifactVersionId: artifact.id,
    assessments,
  });
}
export function finalize(kernel: QuestAttempt, key?: string) {
  const evaluation = kernel.snapshot.evaluations.at(-1);
  if (!evaluation) throw new Error("Fixture needs an evaluation");
  return run(
    kernel,
    { type: "finalize-evaluation", evaluationRevisionId: evaluation.id },
    key
  );
}
export function mastered() {
  const kernel = submitted();
  draft(kernel);
  finalize(kernel);
  return kernel;
}
