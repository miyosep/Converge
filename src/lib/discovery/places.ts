import { z } from "zod";
import type {
  ConditionEvidence,
  DiscoveredPlace,
  DiscoveryIntent,
} from "./types.js";

const moneySchema = z.object({
  currencyCode: z.string(),
  units: z.string().regex(/^\d+$/),
  nanos: z.number().int().min(0).max(999999999).optional(),
});
const placeSchema = z.object({
  id: z.string().min(1).max(256),
  displayName: z.object({ text: z.string().min(1).max(300) }),
  formattedAddress: z.string().max(1000).optional(),
  googleMapsUri: z.string().optional(),
  websiteUri: z.string().optional(),
  businessStatus: z.string().optional(),
  priceRange: z
    .object({
      startPrice: moneySchema.optional(),
      endPrice: moneySchema.optional(),
    })
    .optional(),
  parkingOptions: z.record(z.string(), z.boolean()).optional(),
  accessibilityOptions: z
    .object({
      wheelchairAccessibleEntrance: z.boolean().optional(),
      wheelchairAccessibleSeating: z.boolean().optional(),
    })
    .optional(),
  servesVegetarianFood: z.boolean().optional(),
  attributions: z
    .array(
      z.object({ provider: z.string(), providerUri: z.string().optional() }),
    )
    .optional(),
});
export type ProviderPlace = z.infer<typeof placeSchema>;
export class PlacesError extends Error {
  constructor(
    public readonly code: "PLACES_UNAVAILABLE" | "PLACES_NOT_CONFIGURED",
  ) {
    super(code);
  }
}

export function safeExternalUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
const amount = (money: z.infer<typeof moneySchema>) =>
  Number(money.units) + (money.nanos ?? 0) / 1e9;

export function assessPlace(
  place: ProviderPlace,
  intent: DiscoveryIntent,
): DiscoveredPlace {
  const evidence: ConditionEvidence[] = [];
  const start = place.priceRange?.startPrice;
  const end = place.priceRange?.endPrice;
  const price =
    start && end && start.currencyCode === end.currencyCode
      ? `${start.currencyCode} ${amount(start)}–${amount(end)} (provider estimate)`
      : null;
  if (intent.budget) {
    const { currency, amount: budget } = intent.budget;
    const comparable =
      start &&
      end &&
      start.currencyCode === currency &&
      end.currencyCode === currency &&
      amount(start) <= amount(end);
    const status = !comparable
      ? "unknown"
      : amount(start) > budget
        ? "conflict"
        : amount(end) <= budget
          ? "reported"
          : "unknown";
    evidence.push({
      condition: `Up to ${currency} ${budget} per person`,
      status,
      detail: !comparable
        ? "No comparable price range. Currency is not converted."
        : `${price}. Confirm the current menu, portions and additional charges.`,
    });
  }
  for (const facility of intent.facilities) {
    let supported: boolean | undefined;
    let label: string;
    if (facility === "parking") {
      label = "Parking";
      const values = Object.values(place.parkingOptions ?? {});
      supported = values.some(Boolean) ? true : undefined;
    } else if (facility === "wheelchair") {
      label = "Wheelchair entrance and seating";
      const access = place.accessibilityOptions;
      supported =
        access?.wheelchairAccessibleEntrance === false ||
        access?.wheelchairAccessibleSeating === false
          ? false
          : access?.wheelchairAccessibleEntrance === true &&
              access?.wheelchairAccessibleSeating === true
            ? true
            : undefined;
    } else {
      label = "Vegetarian food";
      supported = place.servesVegetarianFood;
    }
    evidence.push({
      condition: label,
      status:
        supported === undefined
          ? "unknown"
          : supported
            ? "reported"
            : "conflict",
      detail:
        supported === undefined
          ? "Not fully documented. Ask the restaurant."
          : supported
            ? "Reported by Google Maps; confirm with the restaurant."
            : "Provider data indicates this requirement is not supported.",
    });
  }
  if (intent.people)
    evidence.push({
      condition: `Table for ${intent.people} people`,
      status: "unknown",
      detail:
        "Group capacity and availability for your date require confirmation.",
    });
  for (const condition of intent.otherRequirements)
    evidence.push({
      condition,
      status: "unknown",
      detail:
        "Not verified by this search. Confirm directly with the restaurant.",
    });
  // Search relevance is not proof of geography, cuisine, or walking distance.
  evidence.push({
    condition: `Area: ${intent.area}${intent.cuisine ? ` · ${intent.cuisine}` : ""}`,
    status: "unknown",
    detail:
      "Returned for this area and cuisine query. Check the address and menu using the source links.",
  });
  return {
    id: place.id,
    name: place.displayName.text,
    address: place.formattedAddress ?? "Address not provided",
    mapsUrl:
      safeExternalUrl(place.googleMapsUri) ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.displayName.text)}&query_place_id=${encodeURIComponent(place.id)}`,
    websiteUrl: safeExternalUrl(place.websiteUri),
    price,
    evidence,
    attributions: (place.attributions ?? []).map((entry) => ({
      name: entry.provider,
      url: safeExternalUrl(entry.providerUri),
    })),
  };
}

export async function findPlaces(
  intent: DiscoveryIntent,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
) {
  if (!apiKey.trim()) throw new PlacesError("PLACES_NOT_CONFIGURED");
  const query = `${intent.cuisine} restaurants in ${intent.area}`.trim();
  try {
    const response = await fetchImpl(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.googleMapsUri,places.websiteUri,places.businessStatus,places.priceRange,places.parkingOptions,places.accessibilityOptions,places.servesVegetarianFood,places.attributions",
        },
        body: JSON.stringify({
          textQuery: query,
          includedType: "restaurant",
          strictTypeFiltering: true,
          pageSize: 20,
          languageCode: "en",
        }),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new PlacesError("PLACES_UNAVAILABLE");
    }
    const body = z
      .object({ places: z.array(placeSchema).max(20).optional() })
      .parse(await response.json());
    const seen = new Set<string>();
    const candidates = (body.places ?? []).filter((place) => {
      if (seen.has(place.id)) return false;
      seen.add(place.id);
      return true;
    });
    const open = candidates
      .filter((p) => p.businessStatus === "OPERATIONAL")
      .map((p) => assessPlace(p, intent));
    const eligible = open.filter(
      (p) => !p.evidence.some((e) => e.status === "conflict"),
    );
    eligible.sort(
      (a, b) =>
        b.evidence.filter((e) => e.status === "reported").length -
        a.evidence.filter((e) => e.status === "reported").length,
    );
    return {
      query,
      places: eligible.slice(0, 10),
      excludedCount: candidates.length - eligible.length,
    };
  } catch (error) {
    if (error instanceof PlacesError) throw error;
    throw new PlacesError("PLACES_UNAVAILABLE");
  }
}
