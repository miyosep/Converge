import manifest from "../../../contracts/deployments/demo-participants.11155111.json";
import type { DemoReview } from "./preference-review";

// These are the five existing baseline demo preferences, in manifest order.
const wishes = [
  "Prefer a restaurant close to the subway station.",
  "Prefer a restaurant with a pleasant atmosphere.",
  "Prefer a quiet restaurant where the group can talk.",
  "Prefer a restaurant with a pleasant atmosphere.",
  "Prefer a restaurant close to the subway station.",
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
