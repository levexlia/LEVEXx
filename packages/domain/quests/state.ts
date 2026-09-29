import type { ArtifactVersion } from "../artifacts/artifact";
import type { EvaluationRevision } from "../evaluations/evaluation";
import type { Evidence } from "../evidence/evidence";
import type { MasteryRecord, MasteryStatus } from "../mastery/mastery";
import type { ProgressionEvent } from "../progression/progression";
import type { DomainEvent } from "../shared/events";
import type { QuestInstance } from "./quest";

export interface KernelSnapshot {
  readonly instance: QuestInstance;
  readonly version: number;
  readonly phase:
    | "AVAILABLE"
    | "ACCEPTED"
    | "SUBMITTED"
    | "ASSESSED"
    | "MASTERED";
  readonly changedAt: string | null;
  readonly masteryStatus: MasteryStatus;
  readonly artifacts: readonly ArtifactVersion[];
  readonly evaluations: readonly EvaluationRevision[];
  readonly evidence: readonly Evidence[];
  readonly masteryHistory: readonly MasteryRecord[];
  readonly progression: readonly ProgressionEvent[];
}

export interface CommandResult {
  readonly snapshot: KernelSnapshot;
  readonly events: readonly DomainEvent[];
  readonly replayed: boolean;
}
