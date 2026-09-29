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
import {
  ExploreError,
  verifyAccessCode,
  walletId,
} from "../../../src/lib/explore/store.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function enabled() {
  return process.env.EXPLORE_DEMO_ENABLED === "true";
}
function configured() {
  if (!enabled()) throw new ApiError(503, "DEMO_DISABLED");
  const origin = new URL(process.env.APP_ORIGIN || "http://localhost:3000");
  if (
    !["localhost", "127.0.0.1"].includes(origin.hostname) &&
    !process.env.EXPLORE_DEMO_ACCESS_CODE
  )
    throw new ApiError(503, "DEMO_CODE_NOT_CONFIGURED");
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
    if (request.cookies.has("converge_session"))
      run = (await store.read(walletId(await sessionWallet(request)))) ?? null;
    if (run?.policy || run?.command)
      await notifyJob({ kind: "explore", id: run.id });
    return NextResponse.json({
      enabled: enabled(),
      accessCodeRequired: Boolean(process.env.EXPLORE_DEMO_ACCESS_CODE),
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
    if ((body as { action?: string })?.action === "start") {
      const start = z
        .strictObject({
          action: z.literal("start"),
          accessCode: z.string().max(200).default(""),
        })
        .parse(body);
      verifyAccessCode(process.env.EXPLORE_DEMO_ACCESS_CODE, start.accessCode);
      const maxRuns = z.coerce
        .number()
        .int()
        .min(1)
        .max(20)
        .parse(process.env.EXPLORE_DEMO_MAX_RUNS || "8");
      return NextResponse.json({ run: await store.create(actor, maxRuns) });
    }
    const run = await store.queue(actor, body);
    await notifyJob({ kind: "explore", id: run.id });
    return NextResponse.json({ run });
  });
}
