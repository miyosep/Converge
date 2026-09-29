import deployment from "../../../contracts/deployments/11155111.json";
import publicRoles from "../../../contracts/deployments/demo-roles.11155111.json";
import { demoRolesSchema } from "../demo-roles.js";
import { createRestaurantCatalog } from "../fixtures/restaurants.js";
import type { GroupPolicyConfig } from "../group-policy.js";

// Shared public Sepolia infrastructure only. No demo users, keys, sessions or grants.
const roles = demoRolesSchema.parse(publicRoles);
export const groupPolicyConfig: GroupPolicyConfig = {
  chainId: deployment.chainId,
  verifyingContract: deployment.convergeGroupWallet.address as `0x${string}`,
  token: deployment.mockUSDC.address as `0x${string}`,
  executor: roles.executor,
};

export function groupEvaluationOptions(startsAt: string) {
  return {
    catalog: createRestaurantCatalog(roles, [startsAt]),
    permittedMerchants: Object.values(roles.merchants),
    contributionPerParticipant: "10000000",
    maxDeposit: "60000000",
    maxTotalSpend: "60000000",
  };
}
