export const MVP_PARTICIPANT_COUNT = 6;
export const MOCK_USDC_DECIMALS = 6;
export const KILN_MODEL = "gpt-oss-120b";
export const CONSTRAINT_SCHEMA_VERSION = 1;
export const DISPLAY_TIME_ZONE = "Asia/Seoul";
export const DEMO_CHAIN_ID = 11155111; // Ethereum Sepolia

// Demo defaults are not authorization. Execution must read the on-chain policy.
export const BASELINE_AMOUNTS = {
  contributionPerParticipant: "10000000",
  totalContributed: "60000000",
  paymentAmount: "45000000",
  maxDeposit: "60000000",
  maxTotalSpend: "60000000",
} as const;

export const KILN_FLOWS = [
  "constraint_extraction",
  "candidate_analysis",
  "decision_explanation",
  "clarification",
] as const;

// These labels are not Solidity enum ordinals. Map ordinals from the final ABI.
export const DECISION_STATUSES = [
  "Funding",
  "Active",
  "Completed",
  "Cancelled",
  "Expired",
] as const;

export const WORKFLOW_STATUSES = [
  "COLLECTING_PREFERENCES",
  "PARSING_CONSTRAINTS",
  "AWAITING_CONFIRMATION",
  "EVALUATING",
  "PROPOSAL_READY",
  "AWAITING_APPROVAL",
  "AUTHORIZED",
  "EXECUTING",
  "COMPLETED",
  "NO_MATCH",
  "NEEDS_CLARIFICATION",
  "RETRYABLE_ERROR",
  "CANCELLED",
  "EXPIRED",
] as const;
