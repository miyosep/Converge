import { NextRequest, NextResponse } from "next/server";
import { notifyJob } from "../../../../../src/lib/jobs/client.js";
import { z } from "zod";
import { createPublicClient, getAddress, http } from "viem";
import { sepolia } from "viem/chains";
import {
  readGroupChain,
  prepareGroupChainAction,
} from "../../../../../src/lib/group-chain.js";
import {
  createKilnClient,
  KilnError,
} from "../../../../../src/lib/kiln/client.js";
import { extractPreferences } from "../../../../../src/lib/kiln/extraction.js";
import {
  interpretLivePreference,
  recommendOneForGroup,
} from "../../../../../src/lib/discovery/group-preferences.js";
import {
  groupEvaluationOptions,
  currentGroupPolicyConfig,
  automaticGroupPaymentTerms,
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
export const maxDuration = 300;
type Context = { params: Promise<{ groupId: string; action: string }> };

export async function GET(request: NextRequest, context: Context) {
  return api(async () => {
    const { groupId, action } = await context.params;
    const actor = await sessionWallet(request);
    if (action === "live-preferences")
      return NextResponse.json({
        preference: await services().livePlans.ownPreference(groupId, actor),
      });
    if (action === "history") {
      await services().preferences.getOverview(groupId, actor);
      await notifyJob({ kind: "group", id: groupId });
      return NextResponse.json(
        await services().execution.history(groupId, actor),
      );
    }
    if (action === "chain") {
      const overview = await services().preferences.getOverview(groupId, actor);
      if (!overview.signingPolicy) return apiFailure(409, "NO_POLICY");
      await notifyJob({ kind: "group", id: groupId });
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
    if (action === "chain-transaction") {
      const body = z
        .strictObject({
          action: z.enum([
            "register",
            "allowance",
            "contribute",
            "cancel",
            "refund",
          ]),
          policyHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
        })
        .parse(await request.json());
      const overview = await services().preferences.getOverview(groupId, actor);
      const saved = overview.signingPolicy;
      if (!saved || saved.policyHash !== body.policyHash)
        return apiFailure(409, "POLICY_CHANGED");
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
          await prepareGroupChainAction(
            client,
            saved,
            groupPolicyConfigFor(saved.policy),
            getAddress(actor),
            body.action,
          ),
        );
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        const safe = [
          "REGISTRATION_UNAVAILABLE",
          "CONTRIBUTION_UNAVAILABLE",
          "INSUFFICIENT_MOCKUSDC",
          "ALLOWANCE_REQUIRED",
          "ALLOWANCE_ALREADY_SUFFICIENT",
          "REFUND_UNAVAILABLE",
          "CANCELLATION_UNAVAILABLE",
          "GAS_LIMIT_EXCEEDED",
        ];
        return apiFailure(
          409,
          safe.includes(code) ? code : "CHAIN_PREFLIGHT_FAILED",
        );
      }
    }
    if (action === "live-preferences") {
      const body = z
        .strictObject({
          text: z.string().trim().min(1).max(2000),
          expectedRevisionId: z.string().nullable(),
        })
        .parse(await request.json());
      const key = process.env.KILN_API_KEY;
      if (!key) return apiFailure(503, "KILN_NOT_CONFIGURED");
      const repository = services().livePlans;
      const context = await repository.submitPreference(
        groupId,
        actor,
        body.text,
        body.expectedRevisionId,
      );
      let extraction;
      try {
        extraction = await interpretLivePreference(
          createKilnClient({
            apiKey: key,
            maxAttempts: 2,
            timeoutMs: 25000,
            onAttempt: (attempt) => repository.recordUsage(groupId, attempt),
          }),
          { ...context, runId: context.revisionId, text: context.rawText },
        );
      } catch {
        await repository.completePreference(
          groupId,
          actor,
          context.revisionId,
          null,
        );
        return apiFailure(502, "EXTRACTION_FAILED");
      }
      return NextResponse.json({
        preference: await repository.completePreference(
          groupId,
          actor,
          context.revisionId,
          extraction,
        ),
      });
    }
    if (action === "live-confirm") {
      const body = z
        .strictObject({ revisionId: z.string() })
        .parse(await request.json());
      return NextResponse.json({
        preference: await services().livePlans.confirmPreference(
          groupId,
          actor,
          body.revisionId,
        ),
      });
    }
    if (action === "recommend") {
      z.strictObject({}).parse(await request.json());
      if (!process.env.KILN_API_KEY || !process.env.XAPI_KEY)
        return apiFailure(503, "PLACES_NOT_CONFIGURED");
      const repository = services().livePlans;
      const context = await repository.beginRecommendation(groupId, actor);
      let result;
      try {
        result = await recommendOneForGroup({
          ...context,
          runId: context.token,
          xapiKey: process.env.XAPI_KEY,
          client: createKilnClient({
            apiKey: process.env.KILN_API_KEY,
            maxAttempts: 2,
            timeoutMs: 25000,
            onAttempt: (attempt) => repository.recordUsage(groupId, attempt),
          }),
        });
      } catch (error) {
        const codes = [
          "INCOMPLETE_GROUP_INTERPRETATION",
          "GROUP_REQUIREMENTS_TOO_LARGE",
          "PREFERENCES_NOT_CONFIRMED",
          "PLACES_UNAVAILABLE",
          "SEARCH_CREDIT_EXHAUSTED",
        ];
        console.warn("Group recommendation unavailable", {
          groupId,
          code:
            error instanceof KilnError
              ? error.code
              : error instanceof Error && codes.includes(error.message)
                ? error.message
                : "REQUEST_FAILED",
        });
        await repository.completeRecommendation(
          groupId,
          actor,
          context.token,
          context.revision,
          null,
        );
        return apiFailure(502, "GROUP_SEARCH_UNAVAILABLE");
      }
      await repository.completeRecommendation(
        groupId,
        actor,
        context.token,
        context.revision,
        result,
      );
      return NextResponse.json(
        await services().preferences.getOverview(groupId, actor),
      );
    }
    if (action === "vote") {
      const body = z
        .strictObject({
          placeId: z.string().min(1).max(100),
          acknowledgeChoice: z.literal(true),
          recommendationRevision: z.string().min(1),
        })
        .parse(await request.json());
      await services().livePlans.vote(
        groupId,
        actor,
        body.placeId,
        body.recommendationRevision,
      );
      return NextResponse.json(
        await services().preferences.getOverview(groupId, actor),
      );
    }
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
      if (overview.livePlan) return apiFailure(409, "USE_LIVE_PLAN_VOTE");
      if (Date.parse(overview.group.startsAt) <= Date.now())
        return apiFailure(409, "RESERVATION_PASSED");
      await repository.evaluateAndFreeze(
        groupId,
        actor,
        groupEvaluationOptions(
          overview.group.startsAt,
          overview.group.category,
        ),
      );
      return NextResponse.json(await repository.getOverview(groupId, actor));
    }
    if (action === "decisions") {
      const body: unknown = await request.json();
      const overview = await services().preferences.getOverview(groupId, actor);
      if (overview.livePlan)
        await services().livePlans.prepare(
          groupId,
          actor,
          currentGroupPolicyConfig(),
          automaticGroupPaymentTerms(body),
          true,
        );
      else {
        z.strictObject({}).parse(body);
        await services().preferences.preparePolicy(
          groupId,
          actor,
          currentGroupPolicyConfig(),
        );
      }
      await notifyJob({ kind: "group", id: groupId });
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
      const overview = await services().preferences.getOverview(groupId, actor);
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
          category: overview.group.category ?? "restaurant",
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
