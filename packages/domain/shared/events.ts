export type DomainEventType =
  | "quest.accepted"
  | "artifact.submitted"
  | "evaluation.drafted"
  | "evaluation.finalized"
  | "evidence.verified"
  | "mastery.assessed"
  | "mastery.granted"
  | "progression.unlocked";

export interface DomainEvent {
  readonly id: string;
  readonly type: DomainEventType;
  readonly schemaVersion: 1;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly participantId: string;
  readonly performedBy: string;
  readonly occurredAt: string;
  readonly recordId: string;
}
