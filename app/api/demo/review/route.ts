import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  api,
  ApiError,
  sessionWallet,
  verifyOrigin,
} from "../../../../src/lib/server/api";
import { exploreStore } from "../../../../src/lib/explore/runtime-store";
import { createKilnClient } from "../../../../src/lib/kiln/client";
import { reviewDemoPreferences } from "../../../../src/lib/explore/preference-review";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return api(async () => {
    verifyOrigin(request);
    const actor = await sessionWallet(request);
    if (process.env.EXPLORE_DEMO_ENABLED !== "true")
      throw new ApiError(503, "DEMO_DISABLED");
    const raw = await request.text();
    if (raw.length > 8000) throw new ApiError(413, "INPUT_TOO_LARGE");
    const input = z
      .strictObject({
        runId: z.string().regex(/^[a-f0-9]{64}$/),
        text: z.string().trim().min(3).max(2000),
      })
      .parse(JSON.parse(raw));
    const run = await exploreStore().owned(actor);
    if (!run || run.id !== input.runId)
      throw new ApiError(409, "DEMO_SESSION_REPLACED");
    if (
      run.policy ||
      run.command ||
      !["preferences", "review"].includes(run.phase)
    )
      throw new ApiError(409, "DEMO_BUSY");
    if ((run.searchCalls ?? 0) >= 3)
      throw new ApiError(409, "SEARCH_LIMIT_REACHED");
    const key = process.env.KILN_API_KEY;
    if (!key) throw new ApiError(503, "REVIEW_UNAVAILABLE");
    try {
      const summary = await reviewDemoPreferences(
        createKilnClient({
          apiKey: key,
          maxAttempts: 2,
          timeoutMs: 25000,
          onAttempt: () => {},
        }),
        randomUUID(),
        input.text,
      );
      return NextResponse.json({ text: input.text, summary });
    } catch {
      throw new ApiError(502, "REVIEW_FAILED");
    }
  });
}
