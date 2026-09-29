import type { CriterionAssessment } from "../rubrics/rubric";
import { validateAssessments } from "../rubrics/rubric";
import { ensure, exactKeys, identifier, immutable } from "../shared/invariants";
import type { QuestDefinition } from "./quest";

export type KernelCommand =
  | { readonly type: "accept-quest" }
  | {
      readonly type: "submit-artifact";
      readonly contentHash: string;
      readonly objectVersion: string;
    }
  | {
      readonly type: "draft-evaluation";
      readonly artifactVersionId: string;
      readonly assessments: readonly CriterionAssessment[];
    }
  | {
      readonly type: "finalize-evaluation";
      readonly evaluationRevisionId: string;
    };

export interface CommandMetadata {
  readonly idempotencyKey: string;
  readonly expectedVersion: number;
}

export function validateCommand(
  command: KernelCommand,
  quest: QuestDefinition
): KernelCommand {
  ensure(command !== null && typeof command === "object", "INVALID_COMMAND");
  switch (command.type) {
    case "accept-quest":
      exactKeys(command, ["type"]);
      break;
    case "submit-artifact":
      exactKeys(command, ["type", "contentHash", "objectVersion"]);
      break;
    case "draft-evaluation":
      exactKeys(command, ["type", "artifactVersionId", "assessments"]);
      identifier(command.artifactVersionId);
      return immutable({
        ...command,
        assessments: validateAssessments(quest.rubric, command.assessments),
      });
    case "finalize-evaluation":
      exactKeys(command, ["type", "evaluationRevisionId"]);
      identifier(command.evaluationRevisionId);
      break;
    default:
      ensure(false, "UNKNOWN_COMMAND");
  }
  return immutable(command);
}
