import { NextRequest, NextResponse } from "next/server";
import {
  api,
  ApiError,
  services,
  sessionWallet,
  verifyOrigin,
} from "../../../../src/lib/server/api.js";
import roles from "../../../../contracts/deployments/demo-roles.11155111.json";
import { demoRolesSchema } from "../../../../src/lib/demo-roles.js";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  return api(async () => {
    verifyOrigin(request);
    const actor = await sessionWallet(request);
    const raw = await request.text();
    if (raw.length > 12000) throw new ApiError(413, "INPUT_TOO_LARGE");
    const merchant = demoRolesSchema.parse(roles).merchants.A;
    const groupId = await services().livePlans.create(
      actor,
      JSON.parse(raw),
      merchant,
    );
    return NextResponse.json({ groupId }, { status: 201 });
  });
}
