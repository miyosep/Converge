import type { Extraction } from "../schemas/constraints.js";
import type { Policy } from "../policy.js";
import type { publicEvaluation } from "../decision-engine.js";
import type { MockReservation } from "./mock-reservation.js";

export type ExploreCommand =
  | { action: "extract"; text: string }
  | { action: "confirm"; revision: number; extraction: Extraction }
  | { action: "prepare" };

export type ExploreRun = {
  id: string;
  judge: `0x${string}`;
  createdAt: string;
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
  enabled: boolean;
  accessCodeRequired: boolean;
  workerOnline: boolean;
  run: ExploreRun | null;
};
