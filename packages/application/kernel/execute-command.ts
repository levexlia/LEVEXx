import type {
  CommandMetadata,
  CommandResult,
  KernelCommand,
} from "../../domain";
import { ensure, identifier } from "../../domain/shared/invariants";
import type { Authenticator, KernelUnitOfWork } from "./ports";

export interface ExecuteCommandInput {
  readonly credential: string;
  readonly online: boolean;
  readonly attemptId: string;
  readonly command: KernelCommand;
  readonly metadata: CommandMetadata;
}

export class ExecuteKernelCommand {
  constructor(
    private readonly authenticator: Authenticator,
    private readonly transactions: KernelUnitOfWork
  ) {}

  async execute(input: ExecuteCommandInput): Promise<CommandResult> {
    // External authentication can perform I/O here, never inside the transaction.
    const identity = await this.authenticator.authenticate(input.credential);
    identifier(identity.actorId);
    identifier(identity.sessionId);
    identifier(input.attemptId);
    ensure(["participant", "mentor"].includes(identity.role), "FORBIDDEN");
    ensure(input.online === true, "ONLINE_REQUIRED");
    return this.transactions.run(
      identity,
      input.attemptId,
      input.online,
      async (transaction) => {
        const attempt = await transaction.load();
        const result = attempt.execute(
          input.command,
          input.metadata,
          transaction.context
        );
        if (!result.replayed) {
          const receipt = attempt.receipts.at(-1);
          ensure(receipt !== undefined, "RECEIPT_REQUIRED");
          await transaction.save(result, receipt);
        }
        return result;
      }
    );
  }
}
