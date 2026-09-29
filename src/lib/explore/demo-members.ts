import manifest from "../../../contracts/deployments/demo-participants.11155111.json";
import type { DemoReview } from "./preference-review";

// Each automated participant contributes a distinct preference, in manifest order.
const wishes = [
  "Prefer a restaurant close to the subway station.",
  "Prefer a restaurant with parking available.",
  "Prefer a quiet restaurant where the group can talk.",
  "Prefer a restaurant with vegetarian options on the menu.",
  "Prefer a spacious table where all six people can sit together.",
];
export const demoMembers = manifest.participants
  .slice(1)
  .map((person, index) => ({
    name: person.persona,
    address: person.address as `0x${string}`,
    preference: {
      requirements: [
        { text: wishes[index]!, importance: "preferred" as const },
      ],
      clarifications: [],
      notes: [],
    } satisfies DemoReview,
  }));
