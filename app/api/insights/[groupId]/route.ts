import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  explainPublicEvaluation,
  fallbackPublicExplanation,
} from "../../../../src/lib/group-explanation.js";
import { createKilnClient } from "../../../../src/lib/kiln/client.js";
import {
  api,
  ApiError,
  services,
  sessionWallet,
  verifyOrigin,
} from "../../../../src/lib/server/api.js";
import { GroupInsightsError } from "../../../../src/lib/db/group-insights.js";

export const runtime = "nodejs";
type Context = { params: Promise<{ groupId: string }> };

export async function GET(request: NextRequest, context: Context) {
  return api(async () => {
    const { groupId } = await context.params;
    const actor = await sessionWallet(request);
    const overview = await services().preferences.getOverview(groupId, actor);
    const insights = services().insights;
    const [explanation, usage] = await Promise.all([
      overview.evaluation
        ? insights.getExplanation(overview.evaluation.id)
        : Promise.resolve(null),
      insights.getUsage(groupId),
    ]);
    return NextResponse.json({ explanation, usage });
  });
}

export async function POST(request: NextRequest, context: Context) {
  return api(async () => {
    verifyOrigin(request);
    z.strictObject({}).parse(await request.json());
    const { groupId } = await context.params;
    const actor = await sessionWallet(request);
    const overview = await services().preferences.getOverview(groupId, actor);
    const evaluation = overview.evaluation;
    if (!overview.group.locked || evaluation?.status !== "PROPOSAL_READY")
      throw new ApiError(409, "NO_PROPOSAL");
    const insights = services().insights;
    let claim;
    try {
      claim = await insights.claim(groupId, evaluation.id);
    } catch (error) {
      if (error instanceof GroupInsightsError)
        throw new ApiError(409, error.code);
      throw error;
    }
    if (claim.kind === "cached")
      return NextResponse.json({
        explanation: claim.explanation,
        usage: await insights.getUsage(groupId),
        cacheHit: true,
      });

    let output = fallbackPublicExplanation(evaluation);
    let source: "FALLBACK" | "KILN" = "FALLBACK";
    const apiKey = process.env.KILN_API_KEY;
    if (apiKey) {
      let loggingFailed = false;
      const kiln = createKilnClient({
        apiKey,
        onAttempt: async (attempt) => {
          try {
            await insights.recordAttempt(groupId, evaluation.id, attempt);
          } catch (error) {
            loggingFailed = true;
            throw error;
          }
        },
      });
      try {
        output = await explainPublicEvaluation(kiln, evaluation);
        source = "KILN";
      } catch (error) {
        if (loggingFailed) throw error;
        // The deterministic fallback is visibly labelled and makes no AI claim.
      }
    }
    const explanation = await insights.complete(
      evaluation.id,
      claim.token,
      source,
      output.reasonIds,
      output.text,
    );
    return NextResponse.json({
      explanation,
      usage: await insights.getUsage(groupId),
      cacheHit: false,
    });
  });
}
