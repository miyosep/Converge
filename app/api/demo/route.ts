import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exploreStore } from "../../../src/lib/explore/runtime-store.js";
import { notifyJob } from "../../../src/lib/jobs/client.js";
import { jobsEnabled, serverlessJobs } from "../../../src/lib/jobs/config.js";
import {
  api,
  ApiError,
  sessionWallet,
  verifyOrigin,
} from "../../../src/lib/server/api.js";
import { ExploreError } from "../../../src/lib/explore/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function enabled() {
  return process.env.EXPLORE_DEMO_ENABLED === "true";
}
function configured() {
  if (!enabled()) throw new ApiError(503, "DEMO_DISABLED");
}
async function demoApi(work: () => Promise<NextResponse>) {
  return api(async () => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof ExploreError) throw new ApiError(409, error.message);
      throw error;
    }
  });
}
export async function GET(request: NextRequest) {
  return demoApi(async () => {
    const store = exploreStore();
    let run = null;
    let history: import("../../../src/lib/explore/types.js").ExploreRun[] = [];
    if (request.cookies.has("converge_session")) {
      const actor = await sessionWallet(request);
      history = await store.listRuns(actor);
      const id = request.nextUrl.searchParams.get("runId");
      run = (id ? await store.owned(actor, id) : history[0]) ?? null;
      if (id && !run) throw new ApiError(404, "RUN_NOT_FOUND");
    }
    if (run?.policy || run?.command)
      await notifyJob({ kind: "explore", id: run.id });
    return NextResponse.json({
      currentRunId: history[0]?.id,
      history: history.map(
        ({ id, createdAt, phase, restaurant, refund, refunded }) => ({
          id,
          createdAt,
          phase,
          restaurant,
          refund,
          refunded,
        }),
      ),
      searchConfigured: Boolean(
        process.env.KILN_API_KEY &&
        process.env.XAPI_KEY &&
        (!process.env.RESTAURANT_SEARCH_PROVIDER ||
          process.env.RESTAURANT_SEARCH_PROVIDER === "xapi"),
      ),
      enabled: enabled(),
      accessCodeRequired: false,
      workerOnline:
        (!serverlessJobs() || jobsEnabled()) && (await store.online()),
      run,
    });
  });
}
export async function POST(request: NextRequest) {
  return demoApi(async () => {
    configured();
    verifyOrigin(request);
    const actor = await sessionWallet(request);
    const raw = await request.text();
    if (raw.length > 16000) throw new ApiError(413, "INPUT_TOO_LARGE");
    const body: unknown = JSON.parse(raw);
    const store = exploreStore();
    if (
      ["start", "restart"].includes((body as { action?: string })?.action ?? "")
    ) {
      const start = z
        .strictObject({
          action: z.enum(["start", "restart"]),
          // Older clients may still send this field; no access code is required.
          accessCode: z.string().max(200).optional(),
          previousRunId: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        })
        .parse(body);
      if (start.action === "restart" && !start.previousRunId)
        throw new ApiError(400, "RUN_REQUIRED");
      const maxRuns = z.coerce
        .number()
        .int()
        .min(1)
        .max(20)
        .parse(process.env.EXPLORE_DEMO_MAX_RUNS || "8");
      return NextResponse.json({
        run: await store.create(
          actor,
          maxRuns,
          start.action === "restart" ? start.previousRunId : undefined,
        ),
      });
    }
    const run = await store.queue(
      actor,
      body,
      request.nextUrl.searchParams.get("runId") ?? undefined,
    );
    await notifyJob({ kind: "explore", id: run.id });
    return NextResponse.json({ run });
  });
}
