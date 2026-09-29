import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  api,
  clearSessionCookie,
  services,
  sessionWallet,
  setSessionCookie,
  verifyOrigin,
} from "../../../../src/lib/server/api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };

export async function GET(request: NextRequest, context: Context) {
  return api(async () => {
    if ((await context.params).action !== "session")
      return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json({ walletAddress: await sessionWallet(request) });
  });
}

export async function POST(request: NextRequest, context: Context) {
  return api(async () => {
    verifyOrigin(request);
    const action = (await context.params).action;
    if (action === "challenge") {
      const body = z
        .strictObject({ address: z.string() })
        .parse(await request.json());
      return NextResponse.json(
        await services().auth.createChallenge(body.address),
      );
    }
    if (action === "verify") {
      const body = z
        .strictObject({
          challengeId: z.string(),
          signature: z.string(),
        })
        .parse(await request.json());
      const session = await services().auth.verifyChallenge(
        body.challengeId,
        body.signature,
      );
      const response = NextResponse.json({
        walletAddress: session.walletAddress,
      });
      setSessionCookie(response, session.token);
      return response;
    }
    if (action === "logout") {
      const token = request.cookies.get("converge_session")?.value;
      if (token) await services().auth.revokeSession(token);
      const response = NextResponse.json({ ok: true });
      clearSessionCookie(response);
      return response;
    }
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  });
}
