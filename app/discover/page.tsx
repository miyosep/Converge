import { AppHeader } from "../components/product-ui";
import { RestaurantDiscovery } from "../components/restaurant-discovery";

export const dynamic = "force-dynamic";
export default function DiscoverPage() {
  const provider = process.env.RESTAURANT_SEARCH_PROVIDER || "xapi";
  const configured = Boolean(
    process.env.KILN_API_KEY &&
    (provider === "xapi"
      ? process.env.XAPI_KEY
      : provider === "kakao"
        ? process.env.KAKAO_REST_API_KEY
        : provider === "google"
          ? process.env.GOOGLE_PLACES_API_KEY
          : false),
  );
  return (
    <div className="shell">
      <AppHeader active="discover" />
      <main id="main-content" className="flow-content" tabIndex={-1}>
        <RestaurantDiscovery
          configured={configured}
          source={
            provider === "xapi"
              ? "xAPI (Google Maps)"
              : provider === "google"
                ? "Google Maps"
                : "Kakao Map"
          }
        />
      </main>
    </div>
  );
}
