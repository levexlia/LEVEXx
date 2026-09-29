import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_MACHINE,
  QuestAttempt,
  type KernelCommand,
  type MutationContext,
} from "../../packages/domain";
import * as progression from "../../packages/domain/progression/progression";
import {
  attempt,
  context,
  draft,
  finalize,
  HASH,
  mastered,
  NOW,
  run,
  scores,
  submitted,
} from "./kernel-fixtures";

afterEach(() => vi.restoreAllMocks());

describe("The First Machine domain loop", () => {
  it("accepts, submits, finalizes and grants traceable mastery/progression atomically", () => {
    const kernel = attempt();
    expect(kernel.snapshot.masteryStatus).toBe("UNASSESSED");
    expect(
      run(kernel, { type: "accept-quest" }).events.map((event) => event.type)
    ).toEqual(["quest.accepted"]);
    run(kernel, {
      type: "submit-artifact",
      contentHash: HASH,
      objectVersion: "object.v1",
    });
    const draftSnapshot = draft(kernel).snapshot;
    expect(draftSnapshot.evidence).toHaveLength(0);
    expect(draftSnapshot.masteryHistory).toHaveLength(0);
    const result = finalize(kernel);
    const state = result.snapshot;
    expect(state.phase).toBe("MASTERED");
    expect(state.version).toBe(4);
    expect(state.evaluations[0]?.status).toBe("FINALIZED");
    expect(draftSnapshot.evaluations[0]?.status).toBe("DRAFT");
    expect(state.evidence[0]).toMatchObject({
      participantId: "alice",
      questVersionId: FIRST_MACHINE.versionId,
      artifactVersionId: state.artifacts[0]?.id,
      contentHash: HASH,
      evaluationRevisionId: state.evaluations[0]?.id,
      rubricVersionId: FIRST_MACHINE.rubric.versionId,
      status: "VERIFIED",
    });
    expect(state.masteryHistory[0]).toMatchObject({
      participantId: "alice",
      skillId: "game-development",
      masteryId: "character-control",
      level: 1,
      status: "MASTERED",
      evidenceId: state.evidence[0]?.id,
      evaluationRevisionId: state.evaluations[0]?.id,
      artifactVersionId: state.artifacts[0]?.id,
      rubricVersionId: FIRST_MACHINE.rubric.versionId,
      source: "DOMAIN_EVALUATION",
      assessedAt: NOW,
    });
    expect(state.progression[0]).toMatchObject({
      unlockedQuestId: "physics-foundations",
      masteryRecordId: state.masteryHistory[0]?.id,
      evidenceId: state.evidence[0]?.id,
      ruleVersionId: FIRST_MACHINE.progression.versionId,
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "evaluation.finalized",
      "evidence.verified",
      "mastery.granted",
      "progression.unlocked",
    ]);
    expect(new Set(result.events.map((event) => event.id)).size).toBe(4);
    for (const event of result.events)
      expect(event).toMatchObject({
        aggregateVersion: 4,
        participantId: "alice",
        performedBy: "mentor",
        occurredAt: NOW,
      });
  });

  it.each(["NOT_MET", "PARTIAL"] as const)(
    "does not reward %s mandatory outcomes",
    (outcome) => {
      const kernel = submitted();
      draft(kernel, scores(outcome));
      const result = finalize(kernel);
      expect(result.snapshot.masteryStatus).toBe(
        outcome === "NOT_MET" ? "NOT_MASTERED" : "PARTIAL"
      );
      expect(result.snapshot.evidence).toHaveLength(1);
      expect(result.snapshot.progression).toHaveLength(0);
      expect(result.events.map((event) => event.type)).toEqual([
        "evaluation.finalized",
        "evidence.verified",
        "mastery.assessed",
      ]);
    }
  );

  it("does not let optional scores compensate for a missing mandatory capability", () => {
    const kernel = submitted();
    draft(
      kernel,
      scores().map((score) => ({
        ...score,
        outcome: score.criterionId === "movement" ? "NOT_MET" : "MET",
      }))
    );
    expect(finalize(kernel).snapshot.masteryStatus).toBe("PARTIAL");
    expect(kernel.snapshot.progression).toHaveLength(0);
  });

  it("allows mastery when optional presentation is not met", () => {
    const kernel = submitted();
    draft(
      kernel,
      scores().map((score) => ({
        ...score,
        outcome: score.criterionId === "presentation" ? "NOT_MET" : "MET",
      }))
    );
    expect(finalize(kernel).snapshot.masteryStatus).toBe("MASTERED");
  });

  it("appends corrected revisions without rewriting previous evidence", () => {
    const kernel = submitted();
    draft(kernel, scores("PARTIAL"));
    const old = finalize(kernel).snapshot;
    const oldRevision = old.evaluations[0];
    draft(kernel);
    const next = finalize(kernel).snapshot;
    expect(next.evaluations).toHaveLength(2);
    expect(next.evaluations[0]).toEqual(oldRevision);
    expect(next.evaluations[1]?.supersedesRevisionId).toBe(oldRevision?.id);
    expect(next.evidence[0]).toEqual(old.evidence[0]);
    expect(next.evidence[1]?.id).not.toBe(old.evidence[0]?.id);
    expect(next.masteryHistory.map((record) => record.status)).toEqual([
      "PARTIAL",
      "MASTERED",
    ]);
    expect(next.progression).toHaveLength(1);
  });

  it("keeps historical artifact versions when work is resubmitted", () => {
    const kernel = submitted();
    draft(kernel, scores("NOT_MET"));
    const old = finalize(kernel).snapshot;
    run(kernel, {
      type: "submit-artifact",
      contentHash: "b".repeat(64),
      objectVersion: "private-object.v2",
    });
    draft(kernel);
    const next = finalize(kernel).snapshot;
    expect(next.artifacts.map((artifact) => artifact.version)).toEqual([1, 2]);
    expect(next.evidence[0]?.artifactVersionId).toBe(old.artifacts[0]?.id);
    expect(next.evidence[1]?.artifactVersionId).toBe(next.artifacts[1]?.id);
  });

  it("rolls back finalization, evidence and receipts if the last computation fails", () => {
    const kernel = submitted();
    draft(kernel);
    const before = kernel.snapshot;
    vi.spyOn(progression, "applyProgression").mockImplementationOnce(() => {
      throw new Error("Injected computation failure");
    });
    expect(() => finalize(kernel, "atomic-finalization")).toThrow(
      "Injected computation failure"
    );
    expect(kernel.snapshot).toBe(before);
    expect(kernel.snapshot.evaluations[0]?.status).toBe("DRAFT");
    const retry = finalize(kernel, "atomic-finalization");
    expect(retry.replayed).toBe(false);
    expect(retry.snapshot.progression).toHaveLength(1);
  });
});

describe("policy, actor and client-state boundaries", () => {
  const cases: readonly [
    string,
    (ctx: MutationContext) => MutationContext,
    string
  ][] = [
    [
      "other participant",
      (ctx) => ({ ...ctx, principal: { actorId: "bob", role: "participant" } }),
      "FORBIDDEN",
    ],
    [
      "wrong role",
      (ctx) => ({ ...ctx, principal: { actorId: "alice", role: "mentor" } }),
      "FORBIDDEN",
    ],
    ["offline", (ctx) => ({ ...ctx, online: false }), "ONLINE_REQUIRED"],
    [
      "stale session",
      (ctx) => ({ ...ctx, sessionActive: false }),
      "SESSION_INACTIVE",
    ],
    [
      "revoked consent",
      (ctx) => ({ ...ctx, consent: { ...ctx.consent, status: "REVOKED" } }),
      "CONSENT_INVALID",
    ],
    [
      "other participant's consent",
      (ctx) => ({ ...ctx, consent: { ...ctx.consent, participantId: "bob" } }),
      "CONSENT_INVALID",
    ],
    [
      "expired consent",
      (ctx) => ({ ...ctx, consent: { ...ctx.consent, validUntil: NOW } }),
      "CONSENT_EXPIRED",
    ],
    [
      "invalid time",
      (ctx) => ({ ...ctx, now: "2026-02-30T20:00:00.000Z" }),
      "INVALID_TIMESTAMP",
    ],
  ];
  it.each(cases)("rejects %s without changing state", (_label, alter, code) => {
    const kernel = attempt();
    const before = kernel.snapshot;
    expect(() =>
      run(kernel, { type: "accept-quest" }, "accept", alter(context()))
    ).toThrow(code);
    expect(kernel.snapshot).toBe(before);
  });

  it.each(["intruder", "alice"])(
    "does not let %s finalize as assigned mentor",
    (actorId) => {
      const kernel = submitted();
      draft(kernel);
      expect(() =>
        run(
          kernel,
          {
            type: "finalize-evaluation",
            evaluationRevisionId: "attempt-1:evaluation:1",
          },
          "attack",
          { ...context("mentor"), principal: { actorId, role: "mentor" } }
        )
      ).toThrow("FORBIDDEN");
      expect(kernel.snapshot.masteryStatus).toBe("UNASSESSED");
    }
  );

  it("rejects self-evaluation assignment", () => {
    expect(
      () =>
        new QuestAttempt({
          instanceId: "self",
          participantId: "alice",
          mentorId: "alice",
          quest: FIRST_MACHINE,
        })
    ).toThrow("SELF_EVALUATION_FORBIDDEN");
  });

  it("does not accept client supplied mastery or evidence fields", () => {
    const kernel = attempt();
    const forged = {
      type: "accept-quest",
      masteryStatus: "MASTERED",
      evidence: [{ id: "forged" }],
    } as unknown as KernelCommand;
    expect(() => run(kernel, forged)).toThrow("INVALID_COMMAND");
    expect(kernel.snapshot.masteryStatus).toBe("UNASSESSED");
  });

  it("rejects direct grant commands including AI-shaped proposals", () => {
    const kernel = submitted();
    const forged = {
      type: "grant-mastery",
      confidence: 1,
    } as unknown as KernelCommand;
    expect(() => run(kernel, forged, "grant", context("mentor"))).toThrow(
      "UNKNOWN_COMMAND"
    );
    expect(kernel.snapshot.masteryStatus).toBe("UNASSESSED");
  });

  it("freezes all result history and isolates caller-owned catalog/scores", () => {
    const quest = structuredClone(FIRST_MACHINE);
    const kernel = attempt(quest);
    (
      quest.rubric.criteria as { id: string; mandatory: boolean }[]
    )[0]!.mandatory = false;
    run(kernel, { type: "accept-quest" });
    run(kernel, {
      type: "submit-artifact",
      contentHash: HASH,
      objectVersion: "object.v1",
    });
    const assessments = scores("NOT_MET");
    draft(kernel, assessments);
    Object.assign(assessments[0]!, { outcome: "MET" });
    const result = finalize(kernel);
    expect(result.snapshot.masteryStatus).toBe("NOT_MASTERED");
    expect(() =>
      Object.assign(result.snapshot, { masteryStatus: "MASTERED" })
    ).toThrow();
    expect(() =>
      Object.assign(result.snapshot.evaluations[0]!.assessments[0]!, {
        outcome: "MET",
      })
    ).toThrow();
    expect(() =>
      Object.assign(kernel, { snapshot: { masteryStatus: "MASTERED" } })
    ).toThrow();
    expect(Object.isFrozen(result.events)).toBe(true);
    expect(Object.isFrozen(result.snapshot.evidence[0])).toBe(true);
  });
});

describe("duplicate, stale and invalid commands", () => {
  it("isolates participant and mentor receipt namespaces for the same key", () => {
    const kernel = attempt();
    const accept: KernelCommand = { type: "accept-quest" };
    const participantMetadata = {
      idempotencyKey: "request-1",
      expectedVersion: 0,
    };
    kernel.execute(accept, participantMetadata, context());
    run(kernel, {
      type: "submit-artifact",
      contentHash: HASH,
      objectVersion: "object.v1",
    });
    const evaluate: KernelCommand = {
      type: "draft-evaluation",
      artifactVersionId: "attempt-1:artifact:1",
      assessments: scores(),
    };
    const mentorMetadata = { idempotencyKey: "request-1", expectedVersion: 2 };
    const mentorResult = kernel.execute(
      evaluate,
      mentorMetadata,
      context("mentor")
    );
    expect(mentorResult.replayed).toBe(false);
    expect(kernel.snapshot.version).toBe(3);
    expect(
      kernel.execute(accept, participantMetadata, context())
    ).toMatchObject({ replayed: true, events: [], snapshot: { version: 1 } });
    expect(
      kernel.execute(evaluate, mentorMetadata, context("mentor"))
    ).toMatchObject({ replayed: true, events: [], snapshot: { version: 3 } });
    expect(() =>
      kernel.execute(
        { ...evaluate, assessments: scores("PARTIAL") },
        mentorMetadata,
        context("mentor")
      )
    ).toThrow("IDEMPOTENCY_CONFLICT");
    expect(finalize(kernel).snapshot.progression).toHaveLength(1);
  });

  it("keeps retry identity stable when server principal metadata changes", () => {
    const kernel = submitted();
    draft(kernel);
    const command: KernelCommand = {
      type: "finalize-evaluation",
      evaluationRevisionId: "attempt-1:evaluation:1",
    };
    const metadata = { idempotencyKey: "finalize", expectedVersion: 3 };
    const trusted = context("mentor");
    const firstContext = {
      ...trusted,
      principal: { ...trusted.principal, sessionReference: "session-a" },
    };
    const refreshedContext = {
      ...trusted,
      principal: { ...trusted.principal, sessionReference: "session-b" },
    };
    kernel.execute(command, metadata, firstContext);
    const retry = kernel.execute(command, metadata, refreshedContext);
    expect(retry.replayed).toBe(true);
    expect(retry.events).toHaveLength(0);
    expect(kernel.snapshot.progression).toHaveLength(1);
  });

  it("replays every command without emitting events or duplicating records", () => {
    const kernel = attempt();
    const commands: KernelCommand[] = [
      { type: "accept-quest" },
      {
        type: "submit-artifact",
        contentHash: HASH,
        objectVersion: "object.v1",
      },
      {
        type: "draft-evaluation",
        artifactVersionId: "attempt-1:artifact:1",
        assessments: scores(),
      },
      {
        type: "finalize-evaluation",
        evaluationRevisionId: "attempt-1:evaluation:1",
      },
    ];
    commands.forEach((command, expectedVersion) => {
      const ctx = context(expectedVersion < 2 ? "participant" : "mentor");
      const metadata = {
        idempotencyKey: `step-${expectedVersion}`,
        expectedVersion,
      };
      const first = kernel.execute(command, metadata, ctx);
      const second = kernel.execute(command, metadata, ctx);
      expect(second).toMatchObject({
        replayed: true,
        events: [],
        snapshot: first.snapshot,
      });
      expect(kernel.snapshot.version).toBe(expectedVersion + 1);
    });
    expect(kernel.snapshot.progression).toHaveLength(1);
    expect(kernel.snapshot.masteryHistory).toHaveLength(1);
    expect(kernel.snapshot.evidence).toHaveLength(1);
    const before = kernel.snapshot;
    const replay = kernel.execute(
      commands[0]!,
      { idempotencyKey: "step-0", expectedVersion: 0 },
      context()
    );
    expect(replay.snapshot.version).toBe(1);
    expect(kernel.snapshot).toBe(before);
  });

  it("reauthorizes a retry after consent revocation", () => {
    const kernel = attempt();
    run(kernel, { type: "accept-quest" }, "accept");
    expect(() =>
      kernel.execute(
        { type: "accept-quest" },
        { idempotencyKey: "accept", expectedVersion: 0 },
        { ...context(), consent: { ...context().consent, status: "REVOKED" } }
      )
    ).toThrow("CONSENT_INVALID");
  });

  it("rejects a reused key with a different payload", () => {
    const kernel = submitted();
    expect(() =>
      kernel.execute(
        {
          type: "submit-artifact",
          contentHash: "b".repeat(64),
          objectVersion: "private-object.v1",
        },
        { idempotencyKey: "command-1", expectedVersion: 1 },
        context()
      )
    ).toThrow("IDEMPOTENCY_CONFLICT");
    expect(kernel.snapshot.artifacts).toHaveLength(1);
  });

  it("accepts reordered scores as the same logical retry", () => {
    const kernel = submitted();
    draft(kernel);
    const result = kernel.execute(
      {
        type: "draft-evaluation",
        artifactVersionId: "attempt-1:artifact:1",
        assessments: scores().reverse(),
      },
      { idempotencyKey: "command-2", expectedVersion: 2 },
      context("mentor")
    );
    expect(result.replayed).toBe(true);
  });

  it("lets only one command with the same expected version win", () => {
    const kernel = attempt();
    run(kernel, { type: "accept-quest" });
    const command: KernelCommand = {
      type: "submit-artifact",
      contentHash: HASH,
      objectVersion: "object.v1",
    };
    kernel.execute(
      command,
      { idempotencyKey: "first", expectedVersion: 1 },
      context()
    );
    expect(() =>
      kernel.execute(
        { ...command, contentHash: "b".repeat(64), objectVersion: "object.v2" },
        { idempotencyKey: "racer", expectedVersion: 1 },
        context()
      )
    ).toThrow("STALE_VERSION");
    expect(kernel.snapshot.artifacts).toHaveLength(1);
  });

  it.each([-1, 1.5, NaN, Infinity])(
    "rejects invalid expected version %s",
    (expectedVersion) => {
      expect(() =>
        attempt().execute(
          { type: "accept-quest" },
          { idempotencyKey: "accept", expectedVersion },
          context()
        )
      ).toThrow("INVALID_EXPECTED_VERSION");
    }
  );

  it("rejects submitting before acceptance", () => {
    expect(() =>
      run(attempt(), {
        type: "submit-artifact",
        contentHash: HASH,
        objectVersion: "object.v1",
      })
    ).toThrow("INVALID_QUEST_STATE");
  });
  it("rejects a second acceptance under a new key", () => {
    expect(() => run(submitted(), { type: "accept-quest" })).toThrow(
      "QUEST_ALREADY_ACCEPTED"
    );
  });
  it.each([
    { contentHash: HASH, objectVersion: "different.v1" },
    { contentHash: "b".repeat(64), objectVersion: "private-object.v1" },
  ])("rejects a duplicate artifact under a fresh key: %o", (input) => {
    expect(() =>
      run(submitted(), { type: "submit-artifact", ...input })
    ).toThrow("DUPLICATE_ARTIFACT");
  });
  it("requires a valid content hash", () => {
    expect(() =>
      run(submitted(), {
        type: "submit-artifact",
        contentHash: "fake",
        objectVersion: "other.v1",
      })
    ).toThrow("INVALID_CONTENT_HASH");
  });
  it("rejects another participant's artifact reference", () => {
    expect(() =>
      run(submitted(), {
        type: "draft-evaluation",
        artifactVersionId: "bob-attempt:artifact:1",
        assessments: scores(),
      })
    ).toThrow("ARTIFACT_VERSION_MISMATCH");
  });
  it("rejects obsolete artifact versions", () => {
    const kernel = submitted();
    run(kernel, {
      type: "submit-artifact",
      contentHash: "b".repeat(64),
      objectVersion: "private-object.v2",
    });
    expect(() =>
      run(kernel, {
        type: "draft-evaluation",
        artifactVersionId: "attempt-1:artifact:1",
        assessments: scores(),
      })
    ).toThrow("ARTIFACT_VERSION_MISMATCH");
  });
  it("rejects replacing an artifact while evaluation is pending", () => {
    const kernel = submitted();
    draft(kernel);
    expect(() =>
      run(kernel, {
        type: "submit-artifact",
        contentHash: "b".repeat(64),
        objectVersion: "object.v2",
      })
    ).toThrow("EVALUATION_PENDING");
    expect(() => draft(kernel)).toThrow("DRAFT_ALREADY_EXISTS");
  });
  it("rejects a foreign evaluation reference", () => {
    const kernel = submitted();
    draft(kernel);
    expect(() =>
      run(kernel, {
        type: "finalize-evaluation",
        evaluationRevisionId: "bob-attempt:evaluation:1",
      })
    ).toThrow("EVALUATION_VERSION_MISMATCH");
  });
  it("rejects duplicate finalization with a new key and post-mastery amendments", () => {
    const kernel = mastered();
    expect(() => finalize(kernel)).toThrow("EVALUATION_ALREADY_FINALIZED");
    expect(() => draft(kernel, scores("NOT_MET"))).toThrow(
      "INVALID_QUEST_STATE"
    );
    expect(() =>
      run(kernel, {
        type: "submit-artifact",
        contentHash: "b".repeat(64),
        objectVersion: "object.v2",
      })
    ).toThrow("INVALID_QUEST_STATE");
    expect(kernel.snapshot.progression).toHaveLength(1);
  });
  it("rejects time regression without consuming a command key", () => {
    const kernel = submitted();
    const command: KernelCommand = {
      type: "submit-artifact",
      contentHash: "b".repeat(64),
      objectVersion: "object.v2",
    };
    expect(() =>
      run(kernel, command, "clock", {
        ...context(),
        now: "2026-09-29T19:59:59.000Z",
      })
    ).toThrow("CLOCK_REGRESSION");
    expect(run(kernel, command, "clock").replayed).toBe(false);
  });
});
