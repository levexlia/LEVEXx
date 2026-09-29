import { describe, expect, it } from "vitest";
import {
  FIRST_MACHINE,
  QuestAttempt,
  type CommandReceipt,
  type KernelSnapshot,
} from "../../packages/domain";
import {
  attempt,
  context,
  draft,
  finalize,
  mastered,
  run,
  scores,
  submitted,
} from "./kernel-fixtures";

function restore(kernel: QuestAttempt) {
  return QuestAttempt.restore(
    JSON.parse(
      JSON.stringify({
        quest: FIRST_MACHINE,
        snapshot: kernel.snapshot,
        receipts: kernel.receipts,
      })
    )
  );
}

describe("repository-only aggregate loading", () => {
  it("loads every phase and keeps durable retries after losing the original object", () => {
    let kernel = restore(attempt());
    run(kernel, { type: "accept-quest" });
    kernel = restore(kernel);
    run(kernel, {
      type: "submit-artifact",
      contentHash: "a".repeat(64),
      objectVersion: "object.v1",
    });
    kernel = restore(kernel);
    draft(kernel, scores("PARTIAL"));
    kernel = restore(kernel);
    finalize(kernel);
    kernel = restore(kernel);
    draft(kernel);
    kernel = restore(kernel);
    finalize(kernel, "final-success");
    const loaded = restore(kernel);
    expect(loaded.snapshot).toEqual(kernel.snapshot);
    const receipt = loaded.receipts.at(-1)!;
    const replay = loaded.execute(
      receipt.command,
      {
        idempotencyKey: receipt.idempotencyKey,
        expectedVersion: receipt.expectedVersion,
      },
      context("mentor")
    );
    expect(replay).toMatchObject({ replayed: true, events: [] });
    expect(loaded.snapshot.progression).toHaveLength(1);
    expect(loaded.snapshot.masteryHistory).toHaveLength(2);
    expect(Object.isFrozen(loaded.receipts[0]?.result.snapshot)).toBe(true);
  });

  type Stored = {
    quest: typeof FIRST_MACHINE;
    snapshot: KernelSnapshot;
    receipts: CommandReceipt[];
  };
  it.each([
    [
      "foreign artifact owner",
      (s: Stored) => {
        Object.assign(s.snapshot.artifacts[0]!, { participantId: "mallory" });
      },
    ],
    [
      "forged mastery",
      (s: Stored) => {
        Object.assign(s.snapshot.masteryHistory[0]!, {
          evidenceId: "invented",
        });
      },
    ],
    [
      "extra progression",
      (s: Stored) => {
        Object.assign(s.snapshot, {
          progression: [...s.snapshot.progression, s.snapshot.progression[0]],
        });
      },
    ],
    [
      "incorrect projection",
      (s: Stored) => {
        Object.assign(s.snapshot, { phase: "ACCEPTED" });
      },
    ],
    [
      "lost receipt",
      (s: Stored) => {
        s.receipts.splice(1, 1);
      },
    ],
    [
      "duplicate receipt",
      (s: Stored) => {
        s.receipts.push(s.receipts[0]!);
      },
    ],
    [
      "changed fingerprint",
      (s: Stored) => {
        Object.assign(s.receipts[0]!, { fingerprint: "invented" });
      },
    ],
    [
      "unsupported format",
      (s: Stored) => {
        Object.assign(s.receipts[0]!, { schemaVersion: 2 });
      },
    ],
    [
      "forged historical reward",
      (s: Stored) => {
        Object.assign(s.receipts[0]!.result.snapshot, {
          masteryStatus: "MASTERED",
        });
      },
    ],
    [
      "changed historical principal",
      (s: Stored) => {
        Object.assign(s.receipts[0]!.principal, { actorId: "mallory" });
      },
    ],
    [
      "changed rubric version",
      (s: Stored) => {
        Object.assign(s.quest.rubric, { versionId: "other-rubric" });
      },
    ],
    [
      "malformed JSON state",
      (s: Stored) => {
        Object.assign(s, { snapshot: null });
      },
    ],
  ] as const)("rejects %s", (_name, corrupt) => {
    const kernel = mastered();
    const stored: Stored = JSON.parse(
      JSON.stringify({
        quest: FIRST_MACHINE,
        snapshot: kernel.snapshot,
        receipts: kernel.receipts,
      })
    );
    corrupt(stored);
    expect(() => QuestAttempt.restore(stored)).toThrow(
      "INVALID_PERSISTED_STATE"
    );
  });

  it("does not restore stale permission to replay a valid historical command", () => {
    const loaded = restore(mastered());
    const receipt = loaded.receipts.at(-1)!;
    const revoked = context("mentor");
    expect(() =>
      loaded.execute(
        receipt.command,
        {
          idempotencyKey: receipt.idempotencyKey,
          expectedVersion: receipt.expectedVersion,
        },
        {
          ...revoked,
          consent: { ...revoked.consent, status: "REVOKED" },
        }
      )
    ).toThrow("CONSENT_INVALID");
  });

  it("keeps copied inputs isolated and permits finalizing a restored draft once", () => {
    const kernel = submitted();
    draft(kernel);
    const loaded = restore(kernel);
    finalize(loaded);
    expect(kernel.snapshot.evaluations[0]?.status).toBe("DRAFT");
    expect(loaded.snapshot.evaluations[0]?.status).toBe("FINALIZED");
    expect(() => finalize(restore(loaded), "another-key")).toThrow(
      "EVALUATION_ALREADY_FINALIZED"
    );
  });
});
