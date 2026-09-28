# Shared Foundation

This is the initial common foundation to merge before feature branches diverge. These conventions are stable defaults for the six-person MVP, not a promise that requirements will never change.

## Available Now

- Node.js 24.19.0, pnpm 11.19.0, exact dependency versions, and one lockfile.
- Strict TypeScript, Prettier, Node's test runner through tsx, and a GitHub Actions check.
- Git ignore rules, LF normalization, editor conventions, and environment placeholders.
- Shared constants, amount/address/time primitives, extraction validation, status labels, a public participant projection, an API error shape, and provider usage validation.
- Focused tests for numeric boundaries, membership, untrusted model output, privacy projection, and unknown usage.

## Module Contract

| Path | Contract |
| --- | --- |
| `src/lib/constants.ts` | Six participants; six token decimals; model and schema identifiers; baseline amount strings; flow/status labels |
| `src/lib/schemas/primitives.ts` | Nonzero EVM addresses via viem; integer cents; uint256 decimal strings; UTC timestamps and time zones |
| `src/lib/schemas/constraints.ts` | Strict allowed field/operator/value combinations and bounded extraction envelope |
| `src/lib/schemas/shared.ts` | Unique six-wallet membership; public lobby fields; sanitized API error contract; nullable provider usage |

Token JSON uses base-unit strings: `"10000000"` means 10 Mock USDC. Convert validated strings to `bigint` inside financial code. Restaurant estimates use integer USD cents. Do not coerce floating-point or model-generated numeric strings into token amounts. Baseline constants do not authorize payment; the deployed contract remains authoritative.

Use `.js` suffixes for local TypeScript imports under the initial NodeNext setup. A future Next.js scaffold may adjust compiler options in coordination with these modules.

## Validation Limits

Successful parsing does not mean a participant confirmed a preference or that a candidate is eligible. The application must still verify identity, revisions, confirmations, unresolved clarifications, unsupported conditions, and candidate data. The public participant schema protects response shape; server authorization must separately protect access.

Duplicate fields in an extraction require resolution instead of silently changing a budget or multiplying a preference's weight. Multiple distinct dietary requirements are permitted. The initial dietary enum is `vegetarian`, `vegan`, `halal`, and `gluten_free`; fixture support must be affirmative and missing information must fail the corresponding eligibility check. An unsupported requirement must remain visible to its submitting participant for resolution.

Provider usage may be partially known. Set unknown fields to `null`; use `unavailable` only when all three counts are unknown. This schema describes provider calls only: record cache hits separately, without creating fictional calls. Derived totals and provider-specific metrics can be added in T12 with explicit provenance. Timestamps in these initial schemas are UTC ISO strings at whole-second precision; latency is independently recorded in milliseconds.

## Still Open

- T01: Next.js scaffold and application-specific lint/build/dev configuration.
- T02: Candidate, group, decision, execution, and complete evidence schemas.
- T03 (Sage): Solidity policy types, encoding order, final ABI, and cross-language hash vectors.
- Database provider, migrations, wallet authentication, chain/RPC, Kiln endpoint, and runtime deployment.
- The fixture dataset, scoring engine, UI, contracts, and end-to-end demo.

Do not mark T01 or T02 Done based on this foundation alone. No teammate has been assigned the remaining work. The broader architecture remains in the guideline.

## Checks

`pnpm check` runs type checking, formatting checks for source/tests/configuration, and foundation tests. Long-form project documentation is edited manually and is not reformatted by this command. CI runs the same command on pull requests and pushes to main. Solidity, app build, browser, and live-service checks will be added when those implementations exist.

Initial local verification: frozen-lockfile installation, TypeScript checking, formatting checking, and all six foundation tests passed on Windows with the pinned Node/pnpm versions. This does not verify any live integration or deployed contract.

## References

- [Zod schema API](https://zod.dev/api)
- [Node.js test runner](https://nodejs.org/api/test.html)
- [pnpm continuous integration](https://pnpm.io/continuous-integration)
