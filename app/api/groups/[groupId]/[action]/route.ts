import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createKilnClient } from "../../../../../src/lib/kiln/client.js";
import { extractPreferences } from "../../../../../src/lib/kiln/extraction.js";
import {
  groupEvaluationOptions,
  groupPolicyConfig,
} from "../../../../../src/lib/server/group-config.js";
import {
  api,
  ApiError,
  recordKilnAttempt,
  services,
  sessionWallet,
  verifyOrigin,
  withDiagnostics,
} from "../../../../../src/lib/server/api.js";
import {
  analyzeEvaluationStatus,
  diagnostic,
  diagnoseLifecycle,
  summarizeDiagnostics,
} from "../../../../../src/lib/diagnostics/index.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ groupId: string; action: string }> };

// `startsAt` is the reservation slot the group is working towards, so it doubles
// as the deadline the expiry reminders count down to. An unparseable value
// yields null rather than NaN, which keeps the reminder quiet instead of
// claiming the group has expired.
function secondsUntil(at: string): number | null {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) return null;
  return Math.round((parsed - Date.now()) / 1000);
}

export async function GET(request: NextRequest, context: Context) {
  return api(async () => {
    const { groupId, action } = await context.params;
    const actor = await sessionWallet(request);
    if (action === "overview")
      return NextResponse.json(
        await services().preferences.getOverview(groupId, actor),
      );
    if (action === "progress") {
      const overview = await services().preferences.getOverview(groupId, actor);
      const participants = await services().preferences.getProgress(
        groupId,
        actor,
      );
      // The progress poll is the cheapest place to notice that a group is
      // stalled: no one has to click anything for the reminder to appear.
      const submittedCount = participants.filter(
        (entry) => entry.submitted,
      ).length;
      const confirmedCount = participants.filter(
        (entry) => entry.confirmed,
      ).length;
      const memberCount = overview.group.memberCount || participants.length;
      // This endpoint has no persisted workflow status to read, so the status
      // is derived from the counts we do have. Anything past funding is out of
      // scope here and reports nothing rather than guessing.
      const status =
        confirmedCount >= memberCount && memberCount > 0
          ? "AWAITING_APPROVAL"
          : "COLLECTING_PREFERENCES";
      const list = diagnoseLifecycle({
        status,
        submittedCount,
        confirmedCount,
        approvalCount: confirmedCount,
        memberCount,
        secondsToExpiry: secondsUntil(overview.group.startsAt),
      });
      return withDiagnostics(
        { participants, summary: summarizeDiagnostics(list) },
        list,
      );
    }
    if (action === "preferences")
      return NextResponse.json({
        preference: await services().preferences.getOwn(groupId, actor),
      });
    if (action === "diagnostics") {
      // The overview carries only the public evaluation projection, so this
      // reports what the status alone justifies. Per-participant attribution
      // stays server-side via `analyzeEvaluation` on the raw result.
      const overview = await services().preferences.getOverview(groupId, actor);
      const evaluation = overview.evaluation;
      const list = evaluation
        ? analyzeEvaluationStatus(evaluation)
        : [diagnostic({ code: "DEC_NO_ELIGIBLE_CANDIDATE" })];
      return withDiagnostics(
        { evaluation, summary: summarizeDiagnostics(list) },
        list,
      );
    }
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  });
}

export async function POST(request: NextRequest, context: Context) {
  return api(async () => {
    verifyOrigin(request);
    const { groupId, action } = await context.params;
    const actor = await sessionWallet(request);
    if (action === "evaluate") {
      z.strictObject({}).parse(await request.json());
      const repository = services().preferences;
      const overview = await repository.getOverview(groupId, actor);
      if (Date.parse(overview.group.startsAt) <= Date.now())
        return NextResponse.json(
          { error: "RESERVATION_PASSED" },
          { status: 409 },
        );
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
        groupPolicyConfig,
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
      if (!key)
        return NextResponse.json(
          { error: "KILN_NOT_CONFIGURED" },
          { status: 503 },
        );
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
        // A timeout and a malformed reply need different next steps: one is
        // worth resending, the other is not. The client already receives the
        // resolved diagnostic from `failure`, so this only picks the code.
        const detail =
          error instanceof Error ? `${error.name} ${error.message}` : "";
        const source = /abort|timeout|timed out/i.test(detail)
          ? "PROVIDER_TIMEOUT"
          : "EXTRACTION_FAILED";
        throw new ApiError(502, source);
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
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  });
}
