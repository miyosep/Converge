import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reservationSlotSchema } from "../../../src/lib/schemas/decision.js";
import {
  api,
  services,
  sessionWallet,
  verifyOrigin,
} from "../../../src/lib/server/api.js";

export const runtime = "nodejs";

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
        name: z.string(),
        displayName: z.string(),
        slot: reservationSlotSchema,
      })
      .parse(await request.json());
    const groupId = await services().preferences.createGroup({
      ...body,
      creator,
    });
    return NextResponse.json({ groupId }, { status: 201 });
  });
}
