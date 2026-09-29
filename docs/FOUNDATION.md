# Shared Foundation

This is the initial common foundation to merge before feature branches diverge. These conventions are stable defaults for the six-person MVP, not a promise that requirements will never change.

This document records the initial foundation. For current implemented scope and
remaining work, use `README.md`, `project_guideline.md` and `LIVE_RESTAURANT_SEARCH.md`.
The original open-task list below is historical, not the current implementation status.

## Available Now

- Node.js 24.19.0, pnpm 11.19.0, exact dependency versions, and one lockfile.
- Ethereum Sepolia (`11155111`) as the final demo chain; local chains remain available for contract development.
- Strict TypeScript, Prettier, Node's test runner through tsx, and a GitHub Actions check.
- Git ignore rules, LF normalization, editor conventions, and environment placeholders.
- Shared constants, amount/address/time primitives, extraction validation, status labels, a public participant projection, an API error shape, and provider usage validation.
- Policy encoding v1 with matching Solidity/TypeScript hash vectors and Foundry contract tests.
- Focused tests for numeric boundaries, membership, untrusted model output, privacy projection, and unknown usage.

## Module Contract

| Path | Contract |
| --- | --- |
| `src/lib/constants.ts` | Six participants; six token decimals; model and schema identifiers; baseline amount strings; flow/status labels |
| `src/lib/schemas/primitives.ts` | Nonzero EVM addresses via viem; integer cents; uint256 decimal strings; UTC timestamps and time zones |
| `src/lib/schemas/constraints.ts` | Strict allowed field/operator/value combinations and bounded extraction envelope |
| `src/lib/schemas/shared.ts` | Unique six-wallet membership; public lobby fields; sanitized API error contract; nullable provider usage |
| `src/lib/policy.ts` and `contracts/src/PolicyHash.sol` | Policy encoding v1 and cross-language hash |

Token JSON uses base-unit strings: `"10000000"` means 10 Mock USDC. Convert validated strings to `bigint` inside financial code. Restaurant estimates use integer USD cents. Do not coerce floating-point or model-generated numeric strings into token amounts. Baseline constants do not authorize payment; the deployed contract remains authoritative.

Use `.js` suffixes for local TypeScript imports under the initial NodeNext setup. A future Next.js scaffold may adjust compiler options in coordination with these modules.

## Validation Limits

Successful parsing does not mean a participant confirmed a preference or that a candidate is eligible. The application must still verify identity, revisions, confirmations, unresolved clarifications, unsupported conditions, and candidate data. The public participant schema protects response shape; server authorization must separately protect access.

Duplicate fields in an extraction require resolution instead of silently changing a budget or multiplying a preference's weight. Multiple distinct dietary requirements are permitted. The initial dietary enum is `vegetarian`, `vegan`, `halal`, and `gluten_free`; fixture support must be affirmative and missing information must fail the corresponding eligibility check. An unsupported requirement must remain visible to its submitting participant for resolution.

Provider usage may be partially known. Set unknown fields to `null`; use `unavailable` only when all three counts are unknown. This schema describes provider calls only: record cache hits separately, without creating fictional calls. Derived totals and provider-specific metrics can be added in T12 with explicit provenance. Timestamps in these initial schemas are UTC ISO strings at whole-second precision; latency is independently recorded in milliseconds.

## Still Open

- T01: Next.js scaffold and application-specific lint/build/dev configuration.
- T02: Candidate, group, decision, execution, and complete evidence schemas.
- Database provider, migrations, wallet authentication, agent execution integration, Kiln endpoint, and runtime deployment. A public Sepolia RPC, funded deployer/executor, six funded demo accounts, and five mock merchant addresses are configured locally; do not treat them as shared production infrastructure.
- The fixture dataset, scoring engine, UI, and end-to-end demo. The token and group-wallet contracts are deployed on Ethereum Sepolia, and the initial participant allocations are recorded in the public funding manifest.

Do not mark T01 or T02 Done based on this foundation alone. Sage owns the blockchain tasks in the guideline; the other work remains open for self-assignment.

## Checks

The required demo platform is macOS. CI installs and checks the foundation on Linux, Windows, macOS 15 arm64, and macOS 15 Intel. See [MacBook demo readiness](MACBOOK_DEMO.md) for setup and the later full-workflow rehearsal gate.

`pnpm check` runs type checking, formatting checks for source/tests/configuration, and foundation tests. Long-form project documentation is edited manually and is not reformatted by this command. CI runs the same command on pull requests and pushes to main. Separate macOS CI jobs run `forge test --root contracts -vv` with Foundry v1.8.3. App build, browser, and live-service checks will be added when those implementations exist.

Initial local verification covered frozen-lockfile installation, TypeScript checking, formatting, and foundation tests on Windows with the pinned Node/pnpm versions. The later blockchain suite passed 22 tests, and both contracts were deployed and verified on Sepolia; see [the deployment manifest](../contracts/deployments/11155111.json). These checks do not verify the application or live Kiln integration.

## References

- [Zod schema API](https://zod.dev/api)
- [Node.js test runner](https://nodejs.org/api/test.html)
- [pnpm continuous integration](https://pnpm.io/continuous-integration)
