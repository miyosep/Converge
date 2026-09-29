import { z } from "zod";
import { assessPlace, PlacesError } from "./places.js";
import type { DiscoveryIntent } from "./types.js";

const documentSchema = z.object({
  id: z.string().regex(/^\d+$/),
  place_name: z.string().min(1).max(300),
  category_group_code: z.string(),
  category_name: z.string(),
  address_name: z.string(),
  road_address_name: z.string(),
});

export async function findKakaoPlaces(
  intent: DiscoveryIntent,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
) {
  if (!apiKey.trim()) throw new PlacesError("PLACES_NOT_CONFIGURED");
  const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  url.search = new URLSearchParams({
    query: intent.koreanQuery,
    category_group_code: "FD6",
    size: "15",
  }).toString();
  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new PlacesError("PLACES_UNAVAILABLE");
    }
    const body = z
      .object({ documents: z.array(documentSchema).max(15) })
      .parse(await response.json());
    const seen = new Set<string>();
    const restaurants = body.documents.filter((place) => {
      if (place.category_group_code !== "FD6" || seen.has(place.id))
        return false;
      seen.add(place.id);
      return true;
    });
    const places = restaurants.slice(0, 10).map((place) => {
      const result = assessPlace(
        {
          id: `kakao-${place.id}`,
          displayName: { text: place.place_name },
          formattedAddress: place.road_address_name || place.address_name,
          googleMapsUri: `https://place.map.kakao.com/${place.id}`,
        },
        intent,
      );
      return {
        ...result,
        evidence: [
          ...result.evidence,
          {
            condition: "Current opening status",
            status: "unknown" as const,
            detail:
              "Kakao local search does not verify current opening status or reservation availability.",
          },
        ],
      };
    });
    return {
      query: intent.koreanQuery,
      places,
      excludedCount: body.documents.length - restaurants.length,
    };
  } catch (error) {
    if (error instanceof PlacesError) throw error;
    throw new PlacesError("PLACES_UNAVAILABLE");
  }
}
