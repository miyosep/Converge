import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createPublicClient, getAddress, http } from "viem";
import { sepolia } from "viem/chains";
import { readGroupChain } from "../../../../../src/lib/group-chain.js";
import { createKilnClient } from "../../../../../src/lib/kiln/client.js";
import { extractPreferences } from "../../../../../src/lib/kiln/extraction.js";
import {
  groupEvaluationOptions,
  currentGroupPolicyConfig,
  groupPolicyConfigFor,
} from "../../../../../src/lib/server/group-config.js";
import {
  api,
  apiFailure,
  recordKilnAttempt,
  services,
  sessionWallet,
  verifyOrigin,
} from "../../../../../src/lib/server/api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ groupId: string; action: string }> };

export async function GET(request: NextRequest, context: Context) {
  return api(async () => {
    const { groupId, action } = await context.params;
    const actor = await sessionWallet(request);
    if (action === "history") {
      await services().preferences.getOverview(groupId, actor);
      return NextResponse.json(
        await services().execution.history(groupId, actor),
      );
    }
    if (action === "chain") {
      const overview = await services().preferences.getOverview(groupId, actor);
      if (!overview.signingPolicy) return apiFailure(409, "NO_POLICY");
      if (!process.env.RPC_URL) return apiFailure(503, "CHAIN_UNAVAILABLE");
      try {
        const client = createPublicClient({
          chain: sepolia,
          transport: http(process.env.RPC_URL, {
            timeout: 15000,
            retryCount: 0,
          }),
        });
        return NextResponse.json(
          await readGroupChain(
            client,
            overview.signingPolicy,
            groupPolicyConfigFor(overview.signingPolicy.policy),
            getAddress(actor),
          ),
        );
      } catch {
        // RPC errors can contain credentials. Never return or log provider text.
        return apiFailure(503, "CHAIN_VERIFICATION_FAILED");
      }
    }
    if (action === "overview")
      return NextResponse.json(
        await services().preferences.getOverview(groupId, actor),
      );
    if (action === "progress")
      return NextResponse.json({
        participants: await services().preferences.getProgress(groupId, actor),
      });
    if (action === "preferences")
      return NextResponse.json({
        preference: await services().preferences.getOwn(groupId, actor),
      });
    return apiFailure(404, "NOT_FOUND");
  });
}

export async function POST(request: NextRequest, context: Context) {
  return api(async () => {
    verifyOrigin(request);
    const { groupId, action } = await context.params;
    const actor = await sessionWallet(request);
    if (action === "leave") {
      z.strictObject({}).parse(await request.json());
      return NextResponse.json(
        await services().preferences.leaveGroup(groupId, actor),
      );
    }
    if (action === "evaluate") {
      z.strictObject({}).parse(await request.json());
      const repository = services().preferences;
      const overview = await repository.getOverview(groupId, actor);
      if (Date.parse(overview.group.startsAt) <= Date.now())
        return apiFailure(409, "RESERVATION_PASSED");
      await repository.evaluateAndFreeze(
        groupId,
        actor,
        groupEvaluationOptions(overview.group.startsAt),
      );
      return NextResponse.json(await repository.getOverview(groupId, actor));
    }
    if (action === "decisions") {
      z.strictObject({}).parse(await request.json());
      await services().preferences.preparePolicy(
        groupId,
        actor,
        currentGroupPolicyConfig(),
      );
      return NextResponse.json(
        await services().preferences.getOverview(groupId, actor),
      );
    }
    if (action === "invite") {
      const invite = await services().auth.createInvite(groupId, actor);
      return NextResponse.json(invite, { status: 201 });
    }
    if (action === "join") {
      const body = z
        .strictObject({
          inviteToken: z.string(),
          displayName: z.string(),
        })
        .parse(await request.json());
      return NextResponse.json(
        await services().auth.joinWithInvite(
          groupId,
          actor,
          body.displayName,
          body.inviteToken,
        ),
      );
    }
    if (action === "preferences") {
      const body = z
        .strictObject({
          text: z.string(),
          expectedRevisionId: z.string().nullable(),
        })
        .parse(await request.json());
      const key = process.env.KILN_API_KEY;
      if (!key) return apiFailure(503, "KILN_NOT_CONFIGURED");
      const preference = await services().preferences.submit(
        groupId,
        actor,
        body.text,
        body.expectedRevisionId,
      );
      const kiln = createKilnClient({
        apiKey: key,
        onAttempt: (attempt) =>
          recordKilnAttempt(groupId, actor, preference.revisionId, attempt),
      });
      let output;
      try {
        output = await extractPreferences(kiln, {
          runId: preference.revisionId,
          text: preference.rawText,
        });
      } catch (error) {
        await services().preferences.failExtraction(
          groupId,
          actor,
          preference.revisionId,
        );
        console.error("Preference extraction failed", error);
        return apiFailure(502, "EXTRACTION_FAILED");
      }
      const parsed = await services().preferences.completeExtraction(
        groupId,
        actor,
        preference.revisionId,
        output,
      );
      return NextResponse.json({ preference: parsed }, { status: 201 });
    }
    if (action === "correct") {
      const body = z
        .strictObject({
          expectedRevisionId: z.string(),
          extraction: z.unknown(),
        })
        .parse(await request.json());
      const preference = await services().preferences.correct(
        groupId,
        actor,
        body.expectedRevisionId,
        body.extraction,
      );
      return NextResponse.json({ preference });
    }
    if (action === "confirm") {
      const body = z
        .strictObject({ revisionId: z.string() })
        .parse(await request.json());
      const preference = await services().preferences.confirm(
        groupId,
        actor,
        body.revisionId,
      );
      return NextResponse.json({ preference });
    }
    return apiFailure(404, "NOT_FOUND");
  });
}
