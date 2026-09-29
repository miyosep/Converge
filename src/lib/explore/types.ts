import type { Extraction } from "../schemas/constraints.js";
import type { Policy } from "../policy.js";
import type { publicEvaluation } from "../decision-engine.js";
import type { MockReservation } from "./mock-reservation.js";
import type { DiscoveryResult, DiscoveredPlace } from "../discovery/types.js";

export type ExploreCommand =
  | {
      action: "group_search";
      text: string;
      preference: import("./preference-review").DemoReview;
      /** Accepted from older clients; booking terms are confirmed after selection. */
      depositUsdc?: number | undefined;
      acknowledgeDemo?: true | undefined;
    }
  | { action: "search"; text: string }
  | {
      action: "select_place";
      revision: number;
      placeId: string;
      depositUsdc: number;
      acknowledgeDemo: true;
    }
  | { action: "extract"; text: string }
  | { action: "confirm"; revision: number; extraction: Extraction }
  | { action: "prepare" };

export type ExploreRun = {
  id: string;
  judge: `0x${string}`;
  createdAt: string;
  sequence?: number;
  previousRunId?: string;
  phase:
    | "preferences"
    | "review"
    | "proposal"
    | "preparing"
    | "approval"
    | "contributing"
    | "completed"
    | "cancelled"
    | "expired";
  command?: ExploreCommand;
  error?: string;
  text?: string;
  extraction?: Extraction;
  revision: number;
  extractionCalls: number;
  extractionInFlight?: boolean;
  extractionAttempts?: number;
  discovery?: DiscoveryResult;
  groupDecision?: import("./group-decision").DemoGroupDecision;
  selectedPlace?: DiscoveredPlace;
  searchCalls?: number;
  searchInFlight?: boolean;
  searchUsage?: import("../discovery/xapi.js").SearchUsage[];
  automationComplete?: boolean;
  evaluation?: ReturnType<typeof publicEvaluation>;
  restaurant?: string;
  policy?: Policy;
  policyHash?: `0x${string}`;
  reservation?: MockReservation | undefined;
  transactions: {
    label: string;
    hash: `0x${string}`;
    confirmed: boolean;
    failed?: boolean;
  }[];
  approvals: number;
  contributions: string[];
  refund: string;
  refunded: boolean;
  rejection?: {
    amount: "80000000";
    reason: string;
    kind: "eth_call";
    block: string;
  };
  lastCheckedAt?: string;
};

export type ExploreView = {
  history?: Pick<
    ExploreRun,
    "id" | "createdAt" | "phase" | "restaurant" | "refund" | "refunded"
  >[];
  currentRunId?: string;
  searchConfigured?: boolean;
  enabled: boolean;
  accessCodeRequired: boolean;
  workerOnline: boolean;
  run: ExploreRun | null;
};
