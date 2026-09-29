import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createKilnClient } from "../../../src/lib/kiln/client.js";
import { extractPreferences } from "../../../src/lib/kiln/extraction.js";
import { categoryForIds } from "../../../src/lib/catalog-options.js";
import { reservationSlotSchema } from "../../../src/lib/schemas/decision.js";
import { permittedRestaurantIdsSchema } from "../../../src/lib/group-conditions.js";
import { groupSizeSchema } from "../../../src/lib/group-size.js";
import {
  api,
  services,
  recordKilnAttempt,
  sessionWallet,
  verifyOrigin,
} from "../../../src/lib/server/api.js";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return api(async () => {
    const actor = await sessionWallet(request);
    return NextResponse.json({
      groups: await services().preferences.listGroups(actor),
    });
  });
}

export async function POST(request: NextRequest) {
  return api(async () => {
    verifyOrigin(request);
    const creator = await sessionWallet(request);
    const body = z
      .strictObject({
        initialPreferences: z.string().trim().max(4000).optional(),
        name: z.string(),
        displayName: z.string(),
        targetMemberCount: groupSizeSchema.optional(),
        slot: reservationSlotSchema,
        permittedRestaurantIds: permittedRestaurantIdsSchema.optional(),
      })
      .parse(await request.json());
    const groupId = await services().preferences.createGroup({
      ...body,
      creator,
    });
    // Save the suggestion atomically with the plan; AI failure must not lose it.
    if (body.initialPreferences) {
      const repository = services().preferences;
      const preference = await repository.getOwn(groupId, creator);
      if (preference) {
        try {
          const key = process.env.KILN_API_KEY;
          if (!key) throw new Error("KILN_NOT_CONFIGURED");
          const kiln = createKilnClient({
            apiKey: key,
            onAttempt: (attempt) =>
              recordKilnAttempt(
                groupId,
                creator,
                preference.revisionId,
                attempt,
              ),
          });
          const output = await extractPreferences(kiln, {
            runId: preference.revisionId,
            text: preference.rawText,
            category: body.permittedRestaurantIds
              ? categoryForIds(body.permittedRestaurantIds)
              : "restaurant",
          });
          await repository.completeExtraction(
            groupId,
            creator,
            preference.revisionId,
            output,
          );
        } catch {
          await repository.failExtraction(
            groupId,
            creator,
            preference.revisionId,
          );
        }
      }
    }
    return NextResponse.json({ groupId }, { status: 201 });
  });
}
