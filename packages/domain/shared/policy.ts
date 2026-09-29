import { ensure, identifier, timestamp } from "./invariants";

// Trusted, freshly resolved SERVER policy. This is not a request-body schema.
export interface MutationContext {
  readonly principal: {
    readonly actorId: string;
    readonly role: "participant" | "mentor";
  };
  readonly online: boolean;
  readonly sessionActive: boolean;
  readonly now: string;
  readonly consent: {
    readonly participantId: string;
    readonly status: "ACTIVE" | "REVOKED";
    readonly validUntil: string;
  };
}

export function authorize(
  context: MutationContext,
  participantId: string,
  mentorId: string,
  role: "participant" | "mentor"
): void {
  ensure(context.online === true, "ONLINE_REQUIRED");
  ensure(context.sessionActive === true, "SESSION_INACTIVE");
  identifier(context.principal.actorId);
  ensure(
    context.principal.role === role &&
      context.principal.actorId ===
        (role === "participant" ? participantId : mentorId),
    "FORBIDDEN"
  );
  ensure(
    context.consent.participantId === participantId &&
      context.consent.status === "ACTIVE",
    "CONSENT_INVALID"
  );
  ensure(
    timestamp(context.now) < timestamp(context.consent.validUntil),
    "CONSENT_EXPIRED"
  );
}
