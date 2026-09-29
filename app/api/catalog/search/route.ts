import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { catalogSearchRequestSchema } from "../../../../src/lib/catalog-search.js";
import { searchCatalog } from "../../../../src/lib/kiln/catalog-search.js";
import {
  createKilnClient,
  KilnError,
} from "../../../../src/lib/kiln/client.js";
import {
  api,
  ApiError,
  sessionWallet,
  verifyOrigin,
} from "../../../../src/lib/server/api.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  return api(async () => {
    verifyOrigin(request);
    await sessionWallet(request);
    const raw = await request.text();
    if (raw.length > 12000) throw new ApiError(413, "INPUT_TOO_LARGE");
    const input = catalogSearchRequestSchema.parse(JSON.parse(raw));
    const apiKey = process.env.KILN_API_KEY;
    if (!apiKey) throw new ApiError(503, "KILN_NOT_CONFIGURED");
    const client = createKilnClient({
      apiKey,
      maxAttempts: 2,
      timeoutMs: 25_000,
      onAttempt: (attempt) => {
        console.info("Catalog search usage", attempt);
      },
    });
    try {
      return NextResponse.json(
        await searchCatalog(client, `search-${randomUUID()}`, input),
      );
    } catch (error) {
      if (error instanceof KilnError)
        throw new ApiError(503, "CATALOG_SEARCH_UNAVAILABLE");
      throw error;
    }
  });
}
