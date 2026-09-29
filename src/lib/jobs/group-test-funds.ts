import type { Pool } from "pg";
import type { Address, Hex } from "viem";
import { ExploreWorker } from "../../../scripts/lib/explore-worker";
import { ExploreStore } from "../explore/store";
import type { ExploreRun } from "../explore/types";
import type { ExecutionPolicy } from "../db/group-execution";
import type { JobLease } from "./lease";
import { readGroupChain } from "../group-chain";
import { groupPolicyConfigFor } from "../server/group-config";
import { groupFundingPersistence } from "./journal";

// UI transaction lists are unnecessary here: immutable signed transactions and
// confirmations live in the group funding journal, under the shared signer lease.
class FundingJournalStore extends ExploreStore {
  override async init() {}
  override async save(_run: ExploreRun) {}
}
export async function prepareGroupTestFunds(
  pool: Pool,
  lease: JobLease,
  saved: ExecutionPolicy,
) {
  const persistence = groupFundingPersistence(pool, lease);
  persistence.store = new FundingJournalStore();
  const worker = new ExploreWorker(persistence, false);
  await worker.init();
  return fundGroupMembers(worker, saved, () =>
    readGroupChain(
      worker.client,
      saved,
      groupPolicyConfigFor(saved.policy),
      saved.policy.participants[0] as Address,
      1,
    ),
  );
}
export async function fundGroupMembers(
  worker: Pick<ExploreWorker, "ledger" | "deployer" | "transact" | "provision">,
  saved: ExecutionPolicy,
  readChain: () => Promise<
    Pick<
      import("../group-chain").GroupChainState,
      "registered" | "status" | "members"
    >
  >,
) {
  const run: ExploreRun = {
    id: saved.policy.decisionId.slice(2),
    judge: saved.policy.participants[0] as Address,
    createdAt: saved.createdAt,
    phase: "preparing",
    revision: 0,
    extractionCalls: 0,
    transactions: [],
    approvals: 0,
    contributions: [],
    refund: "0",
    refunded: false,
  };
  // Reconcile previously signed transactions even if the policy has since expired.
  for (const [key, entry] of Object.entries(worker.ledger)) {
    if (key.startsWith(`${run.id}:`) && !entry.confirmed) {
      await worker.transact(
        run,
        key.slice(run.id.length + 1),
        worker.deployer,
        entry.intent.to as Address,
        entry.intent.data as Hex,
        BigInt(entry.intent.valueWei),
      );
      return false;
    }
  }
  if (saved.policy.expiry <= Math.floor(Date.now() / 1000)) return true;
  // The policy may not be registered yet. Terminal states must never trigger new grants.
  // Status is read through the shared chain reader to avoid relying on struct positions.
  const chain = await readChain();
  if (chain.registered && chain.status !== 0) return true;
  for (const address of saved.policy.participants) {
    const member = chain.members.find(
      (m) => m.address.toLowerCase() === address.toLowerCase(),
    );
    if (member && BigInt(member.contribution) > 0n) continue;
    if (
      !(await worker.provision(
        run,
        address as Address,
        address.toLowerCase(),
        "0.001",
        true,
        BigInt(saved.policy.contributionPerParticipant),
      ))
    )
      return false;
  }
  return true;
}
