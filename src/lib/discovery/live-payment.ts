import { z } from "zod";
import { parseUnits, keccak256, stringToHex } from "viem";
import { addressSchema } from "../schemas/primitives";
import { policySchema, hashPolicy } from "../signing-policy";
import type { GroupPolicyConfig } from "../group-policy";
export const livePaymentTermsSchema = z.strictObject({
  recommendationRevision: z.string().min(1),
  placeId: z.string().min(1).max(100),
  amount: z
    .string()
    .regex(/^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$/)
    .refine(
      (value) =>
        /^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$/.test(value) &&
        parseUnits(value, 6) > 0n,
    ),
  recipient: addressSchema,
  acknowledgeTestPayment: z.literal(true),
});
export function buildLivePayment(input: {
  terms: z.infer<typeof livePaymentTermsSchema>;
  config: GroupPolicyConfig;
  groupId: string;
  members: string[];
  startsAt: string;
  nowSeconds: number;
}) {
  const terms = livePaymentTermsSchema.parse(input.terms);
  if (input.config.chainId !== 11155111 || input.config.policyVersion !== 2)
    throw new Error("TEST_PAYMENT_NOT_CONFIGURED");
  if (
    [input.config.token, input.config.verifyingContract].some(
      (a) => a.toLowerCase() === terms.recipient.toLowerCase(),
    )
  )
    throw new Error("INVALID_PAYMENT_RECIPIENT");
  const amount = parseUnits(terms.amount, 6);
  const count = BigInt(input.members.length);
  if (count < 2n) throw new Error("UNANIMOUS_CHOICE_REQUIRED");
  const contribution = (amount + count - 1n) / count;
  const expiry = Math.min(
    input.nowSeconds + 3600,
    Math.floor(Date.parse(input.startsAt) / 1000),
  );
  if (expiry <= input.nowSeconds + 60) throw new Error("RESERVATION_PASSED");
  const reference = keccak256(
    stringToHex(
      JSON.stringify([input.groupId, terms, input.members, input.startsAt]),
    ),
  );
  const policy = policySchema.parse({
    ...input.config,
    policyVersion: 2,
    decisionId: keccak256(stringToHex(`live-payment:${reference}`)),
    reservationReference: reference,
    merchant: terms.recipient,
    participants: input.members,
    approvalThreshold: input.members.length,
    contributionPerParticipant: String(contribution),
    paymentAmount: String(amount),
    maxDeposit: String(amount),
    maxTotalSpend: String(contribution * count),
    expiry,
  });
  return {
    policy,
    policyHash: hashPolicy(policy),
    createdAt: new Date(input.nowSeconds * 1000).toISOString(),
  };
}
