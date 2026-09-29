/** Small pg-compatible boundary also used to inject transport failures in tests. */
export interface DatabaseConnection {
  query(
    sql: string,
    parameters?: unknown[]
  ): Promise<{
    rows: Record<string, unknown>[];
    rowCount: number | null;
  }>;
  release(destroy?: boolean): void;
}

export interface ConnectionPool {
  connect(): Promise<DatabaseConnection>;
}

export class CommitOutcomeUnknownError extends Error {
  readonly code = "COMMIT_OUTCOME_UNKNOWN";
  constructor() {
    super(
      "Commit outcome unknown; retry the original command and idempotency key after reauthentication"
    );
    this.name = "CommitOutcomeUnknownError";
  }
}
