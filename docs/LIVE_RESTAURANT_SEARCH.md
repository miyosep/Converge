# Real place discovery

Open `/discover`, also linked from the main navigation. New-plan links at
`/group/new` redirect here. Sign in within the search page when prompted; the
English request stays in place. xAPI supports restaurants, stays, spaces, sports
and classes. Qwen supplies the requested venue or activity type to live search.
Google/Kakao legacy adapters remain restaurant-only.

Explore Demo queues a search with `scope=explore`, a fixed restaurant category and
Gangnam Station location. The server overrides client/model location changes.
Results are saved to the authenticated session and are vicinity candidates, not a
verified distance radius. A judge-selected result and demo deposit can create a
frozen booking policy payable to the configured demo recipient. See
[Explore Demo](EXPLORE_DEMO.md) and [payment verification](LIVE_DEMO_BOOKING.md).

For the hackathon, returned places are assumed reservable with USDC. Availability
and USDC acceptance are not checked or treated as eligibility blockers. This is
a demo assumption, not provider evidence. Search and comparison do not themselves
send payments or register real venues as on-chain merchants.

Nightly, hourly, room and total budgets retain their original units in requirements;
they are not converted into per-person prices. Missing provider IDs use a stable
name/address ID and a Google Maps name/address search link.

The previous fictional planning flow is explicitly available at `/demo/catalog`.
Its 200 examples (40 in each of five categories) are preserved in
`data/demo/catalog-archive.json`; live searches never use them as a fallback.

## Setup

Keep all credentials server-only. Configure the same application origin and
database/session settings as the main app, plus `KILN_API_KEY`.

xAPI is the default provider. Configure the existing xAPI account's key in a
server-only environment variable:

```dotenv
RESTAURANT_SEARCH_PROVIDER=xapi
XAPI_KEY=your-server-side-xapi-key
```

The owner increased the dedicated key's total usage cap to USD 0.90, verified in
the xAPI console. This is a key spending cap, not an application usage quota.
The local worktree uses an ignored `.env.local`; hosted deployments need their
own environment configuration. No credentials are committed.

For xAPI, Qwen on Kiln proposes one `search_places` call with the interpreted
requirements. The server validates its schema, allows only that function and
executes one `web.search.places` request. Clarifications stop before searching.
The UI is rendered directly from validated provider data without a second model
interpretation. Each flow logs status, latency and available token/cost metadata
with a shared run ID, excluding prompts, restaurant payloads and credentials.

xAPI listings are not evidence of menu prices, group seating, quietness or
opening status. Price strings are labeled estimates and all requested conditions
remain unverified. Candidate IDs are deduplicated and source links use the
returned Google CID when available, or a name/address map search otherwise.
Provider errors never fall back to invented places;
an exhausted balance or key cap shows a specific message. Searches are bounded
to two model attempts (the second only for invalid JSON/schema output) and one
provider request with time and response-size limits. Ordinary successful searches
use one model call. Provider searches are not automatically retried.

Multi-category live verification returned 9 guesthouses, 10 meeting spaces and
4 badminton venues. Initial class extraction omitted the specific activity, so
nonrestaurant tool schemas now require `venueType` and the live check asserts
that pottery remains in the query. Some follow-up xAPI requests returned an
unsuccessful envelope despite HTTP 201; these correctly surface as search errors.
The final class recheck searched `pottery class near Seoul, South Korea` and
returned 10 candidates (see `docs/evidence/place-categories-2026-09-29T16-12-20-487Z.json`).
These smoke checks demonstrate integration, not exhaustive search accuracy.

The area is included in the query; a neighborhood/landmark is not passed as a
provider localization identifier. During live rehearsal there were an initial
model validation failure and provider timeout/failure responses. After the
bounded model repair and query-only location handling, authenticated requests
with KRW 30,000 and KRW 20,000 budgets both returned ten candidates and kept all
conditions unverified. See [HTTP evidence](evidence/xapi-http-2026-09-29T15-57-35-715Z.json).
The two searches took approximately 10.7 and 9.2 seconds. This is limited smoke
evidence, not an uptime or model reliability guarantee. Browser visual verification
was blocked by the browser URL policy; HTTP and automated checks were used.

For Korea, create a Kakao Developers application, enable access to the local API
as required by the account, and obtain its REST API key:

```dotenv
RESTAURANT_SEARCH_PROVIDER=kakao
KAKAO_REST_API_KEY=your-server-side-rest-api-key
```

The AI translates English requests into a Korean area/cuisine query. Kakao's
keyword endpoint is restricted to food establishments (`FD6`), up to 15 results;
the UI displays up to 10 distinct candidates and compares up to 5. Kakao local
search does not provide menu prices, facilities, seating availability or current
opening status. These remain explicitly unknown, never inferred from a name.

For the optional Google provider, enable Places API (New) on a Cloud project with the
appropriate billing and API restrictions:

```dotenv
RESTAURANT_SEARCH_PROVIDER=google
GOOGLE_PLACES_API_KEY=your-server-side-places-key
```

Google Text Search requests up to 20 restaurants with an explicit field mask.
The adapter excludes closed/undocumented business status and known conflicts,
deduplicates place IDs, and ranks remaining candidates by reported condition
support. Budget checks use the reported price range only in the user's currency;
partially overlapping ranges and missing values remain unknown. No currency
conversion is performed. Reported prices are estimates, not quotes.

For the optional Google and Kakao adapters, each request performs at most two bounded AI attempts and one provider call.
Ambiguous budgets or locations stop before the provider request and ask for
clarification. Requirements such as quietness, allergies, group capacity and
reservation dates remain visible but unverified. The search query itself is not
evidence that the address, cuisine or walking distance meets every requirement.

Provider content stays in page memory; it is not cached in local storage or the
database. Search replies use `Cache-Control: no-store`. Only provider usage
metadata is logged, not the user sentence or restaurant payload. External URLs
must be HTTPS and credential-free. Provider responses are validated, never sent
to the AI as instructions. No restaurant website scraping is performed.

Before publicly enabling a provider, complete its applicable account, attribution,
terms and privacy requirements. Google Maps source attribution and any returned
third-party attribution are displayed. Applications using Google Places also
need the publicly accessible terms/privacy pages described in Google's policy.

## Validation

`tests/discovery.test.ts` exercises both provider contracts with synthetic
responses, the English-to-Korean orchestration, clarification gating, currency
and uncertainty handling, deduplication, source URLs, and authentication/origin
guards. Synthetic test responses are never used as live fallback results.
`tests/xapi-discovery.test.ts` covers function allowlisting, argument validation,
clarification gating, deduplication, unknown evidence, unsafe links, credit errors
and oversized/malformed responses. `scripts/verify-xapi-http.ts --live` exercises
wallet sign-in and actual searches through the HTTP route with changed budgets.
Live provider verification requires an actual API key. No credentials are bundled.

## Official references

- [Kakao Local API](https://developers.kakao.com/docs/ko/local/dev-guide)
- [Google Places Text Search](https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places/searchText)
- [Google Places policies and attribution](https://developers.google.com/maps/documentation/places/web-service/policies)
