import { livePaymentTermsSchema } from "../discovery/live-payment";
import deployment from "../../../contracts/deployments/11155111.json";
import deploymentV2 from "../../../contracts/deployments/11155111-v2.json";
import publicRoles from "../../../contracts/deployments/demo-roles.11155111.json";
import { demoRolesSchema } from "../demo-roles.js";
import { createOrdinaryCatalog } from "../fixtures/ordinary-catalog.js";
import type { Category } from "../catalog-options.js";
import type { GroupPolicyConfig } from "../group-policy.js";
import { GroupPolicyError } from "../group-policy.js";
import type { Policy } from "../signing-policy.js";

export type GroupDeployment = {
  address: `0x${string}`;
  blockNumber: string;
  deployedCodeHash: string;
  transactionHash: string;
  blockHash: string;
};
export const groupDeploymentV2 =
  deploymentV2.convergeGroupWallet as GroupDeployment | null;

// Shared public Sepolia infrastructure only. No demo users, keys, sessions or grants.
const roles = demoRolesSchema.parse(publicRoles);
export const groupPolicyConfig: GroupPolicyConfig = {
  chainId: deployment.chainId,
  verifyingContract: deployment.convergeGroupWallet.address as `0x${string}`,
  token: deployment.mockUSDC.address as `0x${string}`,
  executor: roles.executor,
};

export function currentGroupPolicyConfig(): GroupPolicyConfig {
  if (!groupDeploymentV2) throw new GroupPolicyError("PAYMENT_NOT_CONFIGURED");
  return {
    ...groupPolicyConfig,
    policyVersion: 2,
    verifyingContract: groupDeploymentV2.address,
  };
}

export function groupPolicyConfigFor(
  policy: Pick<Policy, "policyVersion">,
): GroupPolicyConfig {
  return policy.policyVersion === 1
    ? groupPolicyConfig
    : currentGroupPolicyConfig();
}

export function groupEvaluationOptions(
  startsAt: string,
  category: Category = "restaurant",
) {
  const catalog = createOrdinaryCatalog(roles, [startsAt], category);
  return {
    catalog,
    permittedMerchants: catalog.restaurants.map(
      (restaurant) => restaurant.merchant,
    ),
    contributionPerParticipant: "10000000",
    maxDeposit: "60000000",
    maxTotalSpend: "60000000",
  };
}

const automaticPaymentRequestSchema = livePaymentTermsSchema.pick({
  placeId: true,
  recommendationRevision: true,
  acknowledgeTestPayment: true,
});

// Owner-authorized Sepolia test configuration, never inferred from a venue quote.
export function automaticGroupPaymentTerms(
  request: unknown,
  environment: Record<string, string | undefined> = process.env,
) {
  return {
    ...automaticPaymentRequestSchema.parse(request),
    recipient: environment.GROUP_TEST_PAYMENT_RECIPIENT ?? roles.merchants.A,
  };
}
