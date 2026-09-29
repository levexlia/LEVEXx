import { describe, expect, it, vi } from "vitest";
import {
  ExecuteKernelCommand,
  type Authenticator,
  type KernelUnitOfWork,
} from "../../packages/application";
import { attempt, context } from "./kernel-fixtures";

const identity = {
  actorId: "alice",
  role: "participant" as const,
  sessionId: "session-alice",
};
const input = {
  credential: "test-credential",
  online: true,
  attemptId: "attempt-1",
  command: { type: "accept-quest" as const },
  metadata: { idempotencyKey: "accept", expectedVersion: 0 },
};

describe("application command boundary", () => {
  it("authenticates before entering a transaction, writes once and returns retries without saving again", async () => {
    const calls: string[] = [];
    const kernel = attempt();
    const auth: Authenticator = {
      authenticate: async () => {
        calls.push("authenticate");
        return identity;
      },
    };
    const save = vi.fn(async () => {
      calls.push("save");
    });
    const transactions: KernelUnitOfWork = {
      run: async (_identity, _id, _online, work) => {
        calls.push("begin");
        const result = await work({
          context: context(),
          load: async () => kernel,
          save,
        });
        calls.push("commit");
        return result;
      },
    };
    const handler = new ExecuteKernelCommand(auth, transactions);
    expect((await handler.execute(input)).replayed).toBe(false);
    expect(calls).toEqual(["authenticate", "begin", "save", "commit"]);
    expect((await handler.execute(input)).replayed).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c === "authenticate")).toHaveLength(2);
    expect(JSON.stringify(save.mock.calls)).not.toContain(input.credential);
  });

  it("never opens the transaction if authentication fails", async () => {
    const run = vi.fn();
    const handler = new ExecuteKernelCommand(
      {
        authenticate: async () => {
          throw new Error("AUTHENTICATION_FAILED");
        },
      },
      { run }
    );
    await expect(handler.execute(input)).rejects.toThrow(
      "AUTHENTICATION_FAILED"
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("never opens an offline mutation transaction", async () => {
    const run = vi.fn();
    const handler = new ExecuteKernelCommand(
      { authenticate: async () => identity },
      { run }
    );
    await expect(handler.execute({ ...input, online: false })).rejects.toThrow(
      "ONLINE_REQUIRED"
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("does not report success if persistence or commit fails", async () => {
    const transactions: KernelUnitOfWork = {
      run: async (_identity, _id, _online, work) => {
        await work({
          context: context(),
          load: async () => attempt(),
          save: async () => {},
        });
        throw new Error("COMMIT_OUTCOME_UNKNOWN");
      },
    };
    const handler = new ExecuteKernelCommand(
      { authenticate: async () => identity },
      transactions
    );
    await expect(handler.execute(input)).rejects.toThrow(
      "COMMIT_OUTCOME_UNKNOWN"
    );
  });
});
