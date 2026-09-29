# xAPI restaurant search trial

## Successful retry with the owner's existing account

The owner logged into their existing account and explicitly approved a new
`Converge restaurant search` key with a USD 0.10 total usage cap. The console
confirmed that cap before any search. The CLI now uses that account's key;
no credential is included in this repository.

The direct English Places search succeeded and returned ten real search listings.
The key's available amount changed from USD 0.100 to USD 0.098 after that call.
This is an observed balance delta, not a guaranteed future unit price.

Then `scripts/verify-xapi-discovery.ts --live` successfully ran the full
Kiln Qwen tool-call -> xAPI Places search -> Qwen candidate selection flow.
It preserved Gangnam Station, Japanese food, six people and KRW 30,000 in tool
arguments. xAPI returned ten listings. Qwen selected three returned IDs and
marked quietness, seating and budget as unverified. The selected names were
일품 강남점, 산쇼쿠라멘 강남본점 and 오제제 강남.

Kiln returned HTTP 200 for both calls; xAPI returned HTTP 201. Kiln used 879
tokens for tool selection and 1,792 for result interpretation: 2,671 total,
with reported USD 0.00036424 cost. This was one fixed English smoke case with
live data, not a reliability benchmark or an end-to-end payment demonstration.
The app now defaults to a separate bounded xAPI discovery adapter. It uses Qwen
tool calling followed by deterministic result rendering; see
[application setup and validation](LIVE_RESTAURANT_SEARCH.md). The standalone
two-inference smoke runner remains independent.

See [live evidence](evidence/xapi-kiln-2026-09-29T15-45-16-041Z.json).

## Initial attempt with a new empty account

The owner requested the skill at https://www.xapi.to/skill. Installed the linked
`skills/xapi` directory from `xapi-labs/xapi-cli` into the user's Codex skills
directory and read its Google Search guide.

The xapi-to 0.2.0 CLI is installed in an isolated local tools directory, outside
this project. Direct pnpm dlx failed to resolve dependencies on this Windows
runtime; a separate hoisted installation worked. No project dependency was added.

CLI registration created a virtual BASIC account without asking for a phone
number. The key is saved by the CLI in the user's private configuration, never
in this repository. No payment or OAuth account binding was performed.

## Live attempt

Account balance before the attempt: USD 0.

Retrieved the live schema for `web.search.places` before calling it. The schema
describes title, address, coordinates, category, rating, telephone and website.
It does not establish menu prices, quietness, seating availability or reservations.

Input:

```json
{
  "q": "Japanese restaurants near Gangnam Station Seoul",
  "gl": "kr",
  "hl": "en",
  "location": "Seoul, South Korea"
}
```

Response:

```json
{
  "success": false,
  "error": {
    "code": "PLATFORM_HTTP_402",
    "message": "Insufficient balance or API Key limit exceeded. Please top up at https://xapi.to/topup or increase your key limit."
  }
}
```

This verifies schema discovery and the account's balance gate, not successful
restaurant retrieval. No results were returned or invented. The normalized
capability metadata did not expose a per-call price, so no price is asserted.

The CLI's generated TypeScript example targets
`POST https://action.xapi.to/v1/actions/execute`, authenticates using `XAPI-Key`,
and sends `{action_id: "web.search.places", input: {...}}`.
Qwen on Kiln can select a bounded search tool backed by this gateway, once search
access is funded and the actual response contract has been validated. This would
use xAPI for external data and Kiln for model inference. The application provider
has not been switched based on a failed live trial.
