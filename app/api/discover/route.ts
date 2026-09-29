import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  api,
  ApiError,
  sessionWallet,
  verifyOrigin,
  services,
} from "../../../src/lib/server/api.js";
import { createKilnClient, KilnError } from "../../../src/lib/kiln/client.js";
import { discoverRestaurants } from "../../../src/lib/discovery/search.js";
import { PlacesError } from "../../../src/lib/discovery/places.js";
import { discoveryRequestSchema } from "../../../src/lib/discovery/types.js";
import {
  discoverWithXapi,
  DiscoveryAgentError,
} from "../../../src/lib/discovery/xapi.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

export async function GET(request: NextRequest) {
  return api(async () => {
    const actor = await sessionWallet(request);
    return NextResponse.json({
      saved: await services().livePlans.latestSearch(actor),
    });
  });
}

export async function PATCH(request: NextRequest) {
  return api(async () => {
    verifyOrigin(request);
    const actor = await sessionWallet(request);
    const { z } = await import("zod");
    const body = z
      .strictObject({
        searchId: z.string().uuid(),
        placeIds: z.array(z.string().min(1).max(100)).max(5),
      })
      .parse(await request.json());
    await services().livePlans.select(actor, body.searchId, body.placeIds);
    return NextResponse.json({ saved: true });
  });
}

export async function POST(request: NextRequest) {
  return api(async () => {
    verifyOrigin(request);
    const actor = await sessionWallet(request);
    const raw = await request.text();
    if (raw.length > 12000) throw new ApiError(413, "INPUT_TOO_LARGE");
    const input = discoveryRequestSchema.parse(JSON.parse(raw));
    const provider = process.env.RESTAURANT_SEARCH_PROVIDER || "xapi";
    if (input.scope === "explore" && provider !== "xapi")
      throw new ApiError(503, "PLACES_NOT_CONFIGURED");
    if (provider !== "xapi" && input.category !== "restaurant")
      throw new ApiError(400, "CATEGORY_NOT_SUPPORTED");
    if (provider !== "xapi" && provider !== "kakao" && provider !== "google")
      throw new ApiError(503, "PLACES_NOT_CONFIGURED");
    const placesKey =
      provider === "xapi"
        ? process.env.XAPI_KEY
        : provider === "kakao"
          ? process.env.KAKAO_REST_API_KEY
          : process.env.GOOGLE_PLACES_API_KEY;
    if (!placesKey) throw new ApiError(503, "PLACES_NOT_CONFIGURED");
    const apiKey = process.env.KILN_API_KEY;
    if (!apiKey) throw new ApiError(503, "KILN_NOT_CONFIGURED");
    try {
      if (provider === "xapi") {
        const runId = `discover-${randomUUID()}`;
        return NextResponse.json(
          await services().livePlans.saveSearch(
            actor,
            input,
            await discoverWithXapi({
              kilnKey: apiKey,
              xapiKey: placesKey,
              input,
              onUsage: (usage) => {
                console.info("Restaurant discovery usage", { runId, ...usage });
              },
            }),
          ),
        );
      }
      const client = createKilnClient({
        apiKey,
        maxAttempts: 2,
        timeoutMs: 18_000,
        onAttempt: (attempt) => {
          console.info("Restaurant discovery usage", attempt);
        },
      });
      return NextResponse.json(
        await services().livePlans.saveSearch(
          actor,
          input,
          await discoverRestaurants(
            client,
            `discover-${randomUUID()}`,
            input,
            placesKey,
            undefined,
            provider,
          ),
        ),
      );
    } catch (error) {
      if (error instanceof DiscoveryAgentError)
        throw new ApiError(503, error.code);
      if (error instanceof PlacesError) throw new ApiError(503, error.code);
      if (error instanceof KilnError)
        throw new ApiError(503, "DISCOVERY_AI_UNAVAILABLE");
      throw error;
    }
  });
}
