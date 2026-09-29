import { z } from "zod";

export const discoveryCategories = {
  restaurant: {
    label: "Restaurants",
    query: "restaurants",
    example:
      "Find a quiet Italian restaurant for six people with parking, under KRW 30,000 per person.",
  },
  stay: {
    label: "Stays",
    query: "hotels and guesthouses",
    example:
      "Find a pet-friendly guesthouse for six people with parking, under KRW 200,000 per night in total.",
  },
  space: {
    label: "Spaces",
    query: "meeting and event spaces",
    example:
      "Find a private meeting room for ten people with a projector, under KRW 100,000 per hour.",
  },
  sport: {
    label: "Sports",
    query: "sports facilities",
    example:
      "Find an indoor badminton court for four people, with equipment rental and evening sessions.",
  },
  class: {
    label: "Classes",
    query: "workshops and classes",
    example:
      "Find an English-language pottery class for six beginners, under KRW 60,000 per person.",
  },
} as const;
export type DiscoveryCategory = keyof typeof discoveryCategories;

export const discoveryRequestSchema = z.strictObject({
  category: z
    .enum(["restaurant", "stay", "space", "sport", "class"])
    .default("restaurant"),
  location: z.string().trim().min(2).max(160),
  text: z.string().trim().min(3).max(2000),
});
export const discoveryIntentSchema = z.strictObject({
  area: z.string().min(2).max(160),
  cuisine: z.string().max(100),
  koreanQuery: z.string().min(2).max(240),
  budget: z
    .strictObject({
      amount: z.number().positive().max(10_000_000),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .nullable(),
  people: z.number().int().min(1).max(100).nullable(),
  facilities: z.array(z.enum(["parking", "wheelchair", "vegetarian"])).max(3),
  otherRequirements: z.array(z.string().min(1).max(200)).max(16),
  clarifications: z.array(z.string().min(1).max(300)).max(8),
});
export type DiscoveryIntent = z.infer<typeof discoveryIntentSchema>;
export type ConditionEvidence = {
  condition: string;
  status: "reported" | "conflict" | "unknown";
  detail: string;
};
export type DiscoveredPlace = {
  id: string;
  name: string;
  address: string;
  mapsUrl: string;
  websiteUrl: string | null;
  price: string | null;
  evidence: ConditionEvidence[];
  attributions: { name: string; url: string | null }[];
};
export type DiscoveryResult = {
  intent: DiscoveryIntent;
  query: string;
  searchedAt: string;
  places: DiscoveredPlace[];
  excludedCount: number;
  source: "Google Maps" | "Kakao Map" | "xAPI (Google Maps)";
};
