import type {
  CommandReceipt,
  CommandResult,
  MutationContext,
  QuestAttempt,
} from "../../domain";

/** Resolved by a real server authenticator before opening the database transaction. */
export interface AuthenticatedSession {
  readonly sessionId: string;
  readonly actorId: string;
  readonly role: "participant" | "mentor";
}

export interface Authenticator {
  authenticate(credential: string): Promise<AuthenticatedSession>;
}

export interface KernelTransaction {
  readonly context: MutationContext;
  load(): Promise<QuestAttempt>;
  save(result: CommandResult, receipt: CommandReceipt): Promise<void>;
}

export interface KernelUnitOfWork {
  run<T>(
    identity: AuthenticatedSession,
    attemptId: string,
    online: boolean,
    operation: (transaction: KernelTransaction) => Promise<T>
  ): Promise<T>;
}
