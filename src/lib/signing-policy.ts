import { z } from "zod";
import type { Abi } from "viem";
import * as v1 from "./policy.js";
import * as v2 from "./policy-v2.js";
import abiV1 from "./abi/convergeGroupWallet.json";
import abiV2 from "./abi/convergeGroupWalletV2.json";

export const policySchema = z.union([v1.policySchema, v2.policySchema]);
export type Policy = z.infer<typeof policySchema>;
export function hashPolicy(input: unknown) {
  const policy = policySchema.parse(input);
  return policy.policyVersion === 1
    ? v1.hashPolicy(policy)
    : v2.hashPolicy(policy);
}
export function toContractPolicy(input: unknown) {
  const policy = policySchema.parse(input);
  return policy.policyVersion === 1
    ? v1.toContractPolicy(policy)
    : v2.toContractPolicy(policy);
}
export function policyWalletAbi(policy: Pick<Policy, "policyVersion">): Abi {
  return (policy.policyVersion === 1 ? abiV1 : abiV2) as Abi;
}
