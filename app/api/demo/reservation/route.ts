import { NextRequest, NextResponse } from "next/server";
import { exploreStore } from "../../../../src/lib/explore/runtime-store.js";
import { ExploreError, walletId } from "../../../../src/lib/explore/store.js";
import {
  EXPLORE_DEMO_SLOT,
  requestMockReservation,
} from "../../../../src/lib/explore/mock-reservation.js";
import {
  api,
  ApiError,
  sessionWallet,
  verifyOrigin,
} from "../../../../src/lib/server/api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownedRun(request: NextRequest) {
  if (process.env.EXPLORE_DEMO_ENABLED !== "true")
    throw new ApiError(503, "DEMO_DISABLED");
  const store = exploreStore();
  const wallet = await sessionWallet(request);
  const id = walletId(wallet);
  const run = await store.read(id);
  if (!run || run.judge.toLowerCase() !== wallet.toLowerCase())
    throw new ApiError(404, "RUN_NOT_FOUND");
  return { store, id, run };
}

export async function GET(request: NextRequest) {
  return api(async () => {
    const { run } = await ownedRun(request);
    return NextResponse.json({ reservation: run.reservation ?? null });
  });
}

export async function POST(request: NextRequest) {
  return api(async () => {
    verifyOrigin(request);
    const { store, id } = await ownedRun(request);
    try {
      return await store.withRunLock(id, async () => {
        const run = await store.read(id);
        if (!run?.policy || !run.restaurant)
          throw new ApiError(409, "POLICY_NOT_READY");
        if (!run.reservation && run.phase !== "proposal")
          throw new ApiError(409, "RESERVATION_REQUEST_CLOSED");
        if (!run.reservation) {
          // The worker normally records this at proposal creation. This endpoint
          // safely recovers a proposal saved before its reservation was recorded.
          run.reservation = requestMockReservation(
            run.policy,
            run.restaurant,
            EXPLORE_DEMO_SLOT.startsAt,
          );
          if (run.selectedPlace) run.reservation.source = "live-place-demo";
          await store.save(run);
        }
        return NextResponse.json({ reservation: run.reservation });
      });
    } catch (error) {
      if (error instanceof ExploreError) throw new ApiError(409, error.message);
      throw error;
    }
  });
}
