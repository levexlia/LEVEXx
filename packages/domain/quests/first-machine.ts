import { defineQuest } from "./quest";

// A v0 server catalog example. Production publication/version policy is separate.
export const FIRST_MACHINE = defineQuest({
  id: "the-first-machine",
  versionId: "the-first-machine.v1",
  title: "The First Machine",
  skillId: "game-development",
  mastery: { id: "character-control", level: 1 },
  rubric: {
    rubricId: "character-control",
    versionId: "character-control-rubric.v1",
    criteria: [
      { id: "movement", mandatory: true },
      { id: "bounds", mandatory: true },
      { id: "explanation", mandatory: true },
      { id: "presentation", mandatory: false },
    ],
  },
  progression: {
    ruleId: "character-control-to-physics",
    versionId: "character-control-to-physics.v1",
    requiredMasteryId: "character-control",
    unlockQuestId: "physics-foundations",
  },
});
