import type { QuestInstance } from "../quests/quest";
import { ensure, identifier, immutable, timestamp } from "../shared/invariants";

export interface ArtifactVersion {
  readonly artifactId: string;
  readonly id: string;
  readonly version: number;
  readonly participantId: string;
  readonly questInstanceId: string;
  readonly contentHash: string;
  readonly objectVersion: string;
  readonly submittedAt: string;
}

export function submitArtifact(
  instance: QuestInstance,
  previous: readonly ArtifactVersion[],
  input: { readonly contentHash: string; readonly objectVersion: string },
  now: string
): ArtifactVersion {
  ensure(
    typeof input.contentHash === "string" &&
      /^[a-f0-9]{64}$/.test(input.contentHash),
    "INVALID_CONTENT_HASH"
  );
  identifier(input.objectVersion);
  timestamp(now);
  ensure(
    !previous.some(
      (artifact) =>
        artifact.contentHash === input.contentHash ||
        artifact.objectVersion === input.objectVersion
    ),
    "DUPLICATE_ARTIFACT"
  );
  const version = previous.length + 1;
  return immutable({
    artifactId: `${instance.id}:artifact`,
    id: `${instance.id}:artifact:${version}`,
    version,
    participantId: instance.participantId,
    questInstanceId: instance.id,
    ...input,
    submittedAt: now,
  });
}

export function assertArtifactOwner(
  instance: QuestInstance,
  artifact: ArtifactVersion
): void {
  ensure(
    artifact.participantId === instance.participantId &&
      artifact.questInstanceId === instance.id &&
      artifact.artifactId === `${instance.id}:artifact`,
    "ARTIFACT_OWNERSHIP_MISMATCH"
  );
}
