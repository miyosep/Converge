import { keccak256, stringToHex, type Address } from "viem";
import { policySchema, hashPolicy } from "../policy.js";
import { commandSchema, validateLiveCommand } from "./store.js";
import type { ExploreRun } from "./types.js";
import {
  EXPLORE_DEMO_SLOT,
  requestMockReservation,
} from "./mock-reservation.js";

export function proposeLivePlace(
  run: ExploreRun,
  input: unknown,
  config: {
    escrow: Address;
    token: Address;
    merchant: Address;
    executor: Address;
    participants: Address[];
    blockTimestamp: number;
  },
) {
  const command = commandSchema.parse(input);
  if (command.action !== "select_place") throw new Error("INVALID_COMMAND");
  validateLiveCommand(run, command);
  if (config.participants[0]?.toLowerCase() !== run.judge.toLowerCase())
    throw new Error("JUDGE_MISMATCH");
  const place = run.discovery!.places.find(
    (item) => item.id === command.placeId,
  )!;
  const paymentAmount = String(BigInt(command.depositUsdc) * 1_000_000n);
  const policy = policySchema.parse({
    policyVersion: 1,
    chainId: 11155111,
    verifyingContract: config.escrow,
    decisionId: keccak256(
      stringToHex(`Converge:explore:${run.id}:${run.createdAt}`),
    ),
    token: config.token,
    merchant: config.merchant,
    executor: config.executor,
    participants: config.participants,
    approvalThreshold: 6,
    contributionPerParticipant: "10000000",
    paymentAmount,
    maxDeposit: "60000000",
    maxTotalSpend: "60000000",
    expiry: config.blockTimestamp + 23 * 3600,
    reservationReference: keccak256(
      stringToHex(
        JSON.stringify({
          version: "xapi-demo-v1",
          run: run.id,
          revision: run.revision,
          place,
          intent: run.discovery!.intent,
          searchedAt: run.discovery!.searchedAt,
          paymentAmount,
          merchant: config.merchant,
          slot: EXPLORE_DEMO_SLOT,
        }),
      ),
    ),
  });
  run.selectedPlace = structuredClone(place);
  run.restaurant = place.name;
  run.policy = policy;
  run.policyHash = hashPolicy(policy);
  run.reservation = {
    ...requestMockReservation(policy, place.name, EXPLORE_DEMO_SLOT.startsAt),
    source: "live-place-demo",
  };
  run.phase = "proposal";
}
