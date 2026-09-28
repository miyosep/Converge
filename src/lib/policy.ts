import { encodeAbiParameters, keccak256 } from "viem";
import { z } from "zod";
import { MVP_PARTICIPANT_COUNT } from "./constants.js";
import {
  addressSchema,
  bytes32Schema,
  participantAddressesSchema,
  tokenAmountSchema,
  unixSecondsSchema,
} from "./schemas/index.js";

export const POLICY_VERSION = 1;
const uint256Max = (1n << 256n) - 1n;

const positiveAmountSchema = tokenAmountSchema.refine(
  (value) => BigInt(value) > 0n,
  "Amount must be positive",
);

export const policySchema = z
  .strictObject({
    policyVersion: z.literal(POLICY_VERSION),
    chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    verifyingContract: addressSchema,
    decisionId: bytes32Schema.refine(
      (value) => BigInt(value) !== 0n,
      "Decision ID must be nonzero",
    ),
    token: addressSchema,
    merchant: addressSchema,
    executor: addressSchema,
    participants: participantAddressesSchema,
    approvalThreshold: z.literal(MVP_PARTICIPANT_COUNT),
    contributionPerParticipant: positiveAmountSchema,
    paymentAmount: positiveAmountSchema,
    maxDeposit: positiveAmountSchema,
    maxTotalSpend: positiveAmountSchema,
    expiry: unixSecondsSchema,
    reservationReference: bytes32Schema,
  })
  .superRefine((policy, context) => {
    const funding =
      BigInt(policy.contributionPerParticipant) * BigInt(MVP_PARTICIPANT_COUNT);
    const payment = BigInt(policy.paymentAmount);
    const deposit = BigInt(policy.maxDeposit);
    const spend = BigInt(policy.maxTotalSpend);
    if (funding > uint256Max) {
      context.addIssue({
        code: "custom",
        path: ["contributionPerParticipant"],
        message: "Total planned funding exceeds uint256",
      });
    }
    if (
      policy.merchant.toLowerCase() === policy.verifyingContract.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        path: ["merchant"],
        message: "Merchant cannot be the escrow contract",
      });
    }
    if (!(payment <= deposit && deposit <= spend && spend <= funding)) {
      context.addIssue({
        code: "custom",
        path: ["paymentAmount"],
        message: "Expected payment <= deposit <= total spend <= funding",
      });
    }
  });

export type Policy = z.infer<typeof policySchema>;

// This order and these Solidity types are the Policy struct in contracts/src/PolicyHash.sol.
export const POLICY_ABI = [
  {
    type: "tuple",
    components: [
      { name: "policyVersion", type: "uint256" },
      { name: "chainId", type: "uint256" },
      { name: "verifyingContract", type: "address" },
      { name: "decisionId", type: "bytes32" },
      { name: "token", type: "address" },
      { name: "merchant", type: "address" },
      { name: "executor", type: "address" },
      { name: "participants", type: "address[6]" },
      { name: "approvalThreshold", type: "uint256" },
      { name: "contributionPerParticipant", type: "uint256" },
      { name: "paymentAmount", type: "uint256" },
      { name: "maxDeposit", type: "uint256" },
      { name: "maxTotalSpend", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "reservationReference", type: "bytes32" },
    ],
  },
] as const;

export function toContractPolicy(input: unknown) {
  const policy = policySchema.parse(input);
  const [a, b, c, d, e, f] = policy.participants;
  if (!a || !b || !c || !d || !e || !f) {
    throw new Error("Policy requires six participants");
  }
  return {
    policyVersion: BigInt(policy.policyVersion),
    chainId: BigInt(policy.chainId),
    verifyingContract: policy.verifyingContract,
    decisionId: policy.decisionId as `0x${string}`,
    token: policy.token,
    merchant: policy.merchant,
    executor: policy.executor,
    participants: [a, b, c, d, e, f] as const,
    approvalThreshold: BigInt(policy.approvalThreshold),
    contributionPerParticipant: BigInt(policy.contributionPerParticipant),
    paymentAmount: BigInt(policy.paymentAmount),
    maxDeposit: BigInt(policy.maxDeposit),
    maxTotalSpend: BigInt(policy.maxTotalSpend),
    expiry: BigInt(policy.expiry),
    reservationReference: policy.reservationReference as `0x${string}`,
  };
}

export function hashPolicy(input: unknown): `0x${string}` {
  return keccak256(encodeAbiParameters(POLICY_ABI, [toContractPolicy(input)]));
}
