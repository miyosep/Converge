import { NextRequest, NextResponse } from "next/server";
import { notifyJob } from "../../../../src/lib/jobs/client.js";
import { z } from "zod";
import {
  api,
  ApiError,
  sessionWallet,
  services,
  verifyOrigin,
} from "../../../../src/lib/server/api.js";
import {
  calendarConfig,
  calendarConfigured,
  seal,
  unseal,
} from "../../../../src/lib/calendar/google.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
const COOKIE = "converge_google_state",
  PENDING = "converge_google_pending";
function cookieOptions() {
  return {
    httpOnly: true,
    secure: calendarConfig().origin.startsWith("https:"),
    sameSite: "lax" as const,
    path: "/api/calendar",
    maxAge: 600,
  };
}
export async function GET(request: NextRequest, context: Context) {
  const action = (await context.params).action;
  if (action === "callback") {
    if (!calendarConfigured())
      return NextResponse.redirect(
        new URL("/calendar/complete?error=setup", request.url),
      );
    const config = calendarConfig(),
      state = request.nextUrl.searchParams.get("state"),
      code = request.nextUrl.searchParams.get("code");
    const valid =
      state &&
      /^[A-Za-z0-9_-]{43}$/.test(state) &&
      state === request.cookies.get(COOKIE)?.value &&
      code &&
      code.length <= 4096 &&
      !request.nextUrl.searchParams.has("error");
    const response = NextResponse.redirect(
      new URL(
        valid ? "/calendar/complete" : "/calendar/complete?error=denied",
        config.origin,
      ),
    );
    if (valid)
      response.cookies.set(
        PENDING,
        seal(JSON.stringify({ state, code }), "oauth-callback"),
        cookieOptions(),
      );
    response.cookies.set(COOKIE, "", { ...cookieOptions(), maxAge: 0 });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  return api(async () => {
    if (action !== "status") throw new ApiError(404, "NOT_FOUND");
    const wallet = await sessionWallet(request),
      group = z
        .string()
        .min(1)
        .max(128)
        .parse(request.nextUrl.searchParams.get("group"));
    await services().preferences.getOverview(group, wallet);
    return NextResponse.json(await services().calendar.status(group, wallet));
  });
}
export async function POST(request: NextRequest, context: Context) {
  return api(async () => {
    verifyOrigin(request);
    const wallet = await sessionWallet(request),
      action = (await context.params).action;
    if (action === "finish") {
      if (!calendarConfigured())
        throw new ApiError(503, "CALENDAR_NOT_CONFIGURED");
      try {
        const pending = request.cookies.get(PENDING)?.value;
        if (!pending) throw new Error("MISSING_CALLBACK");
        const { state, code } = z
          .object({ state: z.string(), code: z.string() })
          .parse(JSON.parse(unseal(pending, "oauth-callback")));
        const group = await services().calendar.finish(
          state,
          code,
          wallet,
          request.cookies.get("converge_session")!.value,
        );
        const response = NextResponse.json({
          redirect: `/group/${encodeURIComponent(group)}/approve`,
        });
        response.cookies.set(PENDING, "", { ...cookieOptions(), maxAge: 0 });
        return response;
      } catch {
        throw new ApiError(400, "GOOGLE_CONNECTION_FAILED");
      }
    }
    const body = z
      .object({
        group: z.string().min(1).max(128),
        durationMinutes: z.number().int().min(15).max(10080).optional(),
      })
      .parse(await request.json());
    await services().preferences.getOverview(body.group, wallet);
    if (action === "connect") {
      if (!calendarConfigured())
        throw new ApiError(503, "CALENDAR_NOT_CONFIGURED");
      const result = await services().calendar.start(
        body.group,
        wallet,
        request.cookies.get("converge_session")!.value,
      );
      const response = NextResponse.json({ url: result.url });
      response.cookies.set(COOKIE, result.state, cookieOptions());
      return response;
    }
    if (action === "enable") {
      if (!calendarConfigured())
        throw new ApiError(503, "CALENDAR_NOT_CONFIGURED");
      if (!body.durationMinutes) throw new ApiError(400, "DURATION_REQUIRED");
      try {
        await services().calendar.enable(
          body.group,
          wallet,
          body.durationMinutes,
        );
        await notifyJob({ kind: "group", id: body.group });
      } catch {
        throw new ApiError(409, "CALENDAR_ENABLE_FAILED");
      }
    } else if (action === "disable")
      await services().calendar.disable(body.group, wallet);
    else if (action === "disconnect")
      await services().calendar.disconnect(wallet);
    else throw new ApiError(404, "NOT_FOUND");
    return NextResponse.json({ ok: true });
  });
}
