# Friends planning and repeatable judge demos

**Product contract:** [PRODUCT_RULES.md](PRODUCT_RULES.md). Current groups receive one Qwen-selected proposal; historical test records below may describe older candidate-selection behavior.

## Current payment calculation

New friends decisions collect a 30% partial deposit from supported restaurant pricing, or confirmed budgets when pricing is unavailable. No fixed 10 MockUSDC default and no manual amount/recipient fields. Disclose source, currency conversion, estimates and exact shares before approval; never automatically collect the remaining 70%. The server recipient is a test wallet. [Calculation and error handling](IMPLEMENTATION_STRUCTURE.md#price-basis-and-30-calculation).

Registration/allowance/contribution preflight uses authenticated server RPC simulation; the browser independently encodes the policy transaction and requests the member's own wallet approval. Saved policies remain immutable. See [submission evidence scopes](EVIDENCE_INDEX.md).

## User flows

- **Judge /demo:** one connected human and five disclosed automated participants. Start a new round from the same wallet after a terminal outcome, or discard an unfunded draft. History preserves old policies, payment records and pending refund actions. Restart is idempotent and cannot bypass an active approval/payment or an unconfirmed transaction. Search limits reset per round; the shared lifetime gas budget and signed journal do not reset.
- **Friends /discover:** create a group with 2–100 members, a category, location and future time, then invite members. Legacy saved shortlists must be searched again to produce one shared proposal. Payment terms are set after the group agrees on a place. Each member privately submits their own natural-language requirements, reviews Kiln's interpretation, and explicitly confirms. Only when all expected members join and confirm can the group search run. It includes every confirmed requirement, rejects incomplete model coverage, and blocks any confirmed reported allergy, as well as genuinely incompatible indispensable safety/access conditions, without revealing another member's private text.
- Qwen compares fresh xAPI candidates internally and proposes exactly one place, with a group-level rationale. Search listings do not establish that every price, dietary, accessibility or capacity condition is satisfied; unknown facts remain labelled. Each member reviews and agrees to that one proposal before the organizer continues to review server-configured test payment terms.
- The saved v2 policy binds the chosen place and recommendation version, reservation time, recipient, exact payment and participant shares. The total is divided equally among the actual participants, rounding each share up to the nearest token base unit (0.000001 MockUSDC). A 12 MockUSDC payment shared by two members requires 6 each; a 10 MockUSDC payment shared by three requires 3.333334 each, with the 0.000002 remainder claimable under the contract's refund rules. Members review the fixed terms and independently register/allow/contribute with their browser wallets. The PC processor executes only when the contract permits. Existing cancellation, expiry, refund and calendar flows remain available.
- For live test-payment policies, the hybrid processor supplies missing MockUSDC up to each member's required share and tops up eligible wallets toward a 0.001 Sepolia ETH balance. Grants share the `GROUP_EXECUTION_MAX_ETH` lifetime budget with group execution, use a signed transaction journal, and stop creating new grants after expiry or a registered policy leaves the funding state. Each member still signs their own approval, contribution and refund. Automated participants are specific to the six-person Explore Demo.

Changing a preference, membership or search invalidates previous place agreements. Even a repeat search with unchanged preferences has a new result version. A locked policy cannot be edited. Raw preferences and interpretations are member-scoped; shared progress shows confirmation state, proposal agreement and public plan terms. Server-side provider calls necessarily process the submitted requirements.

Booking availability and USDC acceptance remain hackathon assumptions. Friends groups use the server-configured test recipient, reviewed by every participant; xAPI listings do not establish a venue's payment address or a payable quote. Explore Demo uses its configured demo recipient. No actual venue booking or production-token payment is sent.

## Deployment

Apply all checked-in migrations through **0018_group_before_search.sql** before deploying this code. Migrations 0016–0017 add saved searches, live plans, private preference revisions, membership invalidation and usage records; 0018 allows a group to exist before its first search. Existing evaluation-backed policies and Explore journals remain intact. Deploy the same version to Vercel and the PC. Keep `BACKGROUND_DRIVER=hybrid`, shared Neon configuration and operator keys only on the PC, as described in [hybrid setup](HYBRID_PC.md). Kiln and xAPI keys must also be present on the web server for friends' interactive requests. Inngest is unnecessary for this setup.

## Verification

- `pnpm check` and `pnpm build`.
- `node --import tsx scripts/explore-local-rehearsal.ts --live-place --repeat-wallet`: same disposable judge wallet across payment, cancellation and expiry, all refunds, retained historical rounds and transaction replay.
- Build Foundry's `v2` profile, then `node --import tsx scripts/group-chain-rehearsal.ts --v2 --live-place`: generated friends policy, independent contributions, constrained execution, broadcast recovery, cancellation, expiry and refunds on disposable Anvil.
- `node --env-file=.env.production-verify --import tsx scripts/live-group-db-rehearsal.ts`: restricted to the isolated verification branch. Exercises saved searches, invitations, private confirmations, late-result rejection, repeated searches, membership changes, unanimous agreement and immutable policy creation. Removes its synthetic records in `finally`.
- `node --env-file=.env.production-verify --import tsx scripts/live-group-http-rehearsal.ts --credentials <local-env-file>`: requires a production build and real Kiln/xAPI credentials. Uses two disposable SIWE identities and a temporary loopback Next server to exercise actual authenticated HTTP routes through shared policy creation. Makes paid provider calls but disables background execution and sends no chain transactions. Optional `--preview` retains the temporary server for ten minutes for UI inspection using the test identity; it is only part of this standalone test harness.

These checks distinguish live provider/HTTP evidence from disposable-chain evidence. They do not establish a complete two-human browser-wallet Sepolia walkthrough of the new friends flow.

## Recorded verification — 2026-09-30

The implementation passed 151 application tests, TypeScript/format checks, and the production build. The build retains the existing viem/ox dynamic-import warning. Both the file and PostgreSQL repeat-session checks passed. Disposable Anvil passed three successive rounds using the same judge wallet (payment, cancellation and expiry with refunds), and the generated friends v2 policy passed contribution/execution/refund and broadcast-recovery checks.

The isolated Neon branch passed membership, privacy, stale-search and immutable-policy tests with migrations 0016–0017. A production-built loopback Next server completed actual HTTP SIWE authentication for two disposable identities, live xAPI discovery, invitation/join, two live Kiln interpretations with explicit confirmations, a shared search returning five real candidates, unanimous agreement and matching saved policies. No Sepolia transactions were sent in this HTTP test; execution was verified separately on Anvil. Earlier provider requests failed before a subsequent end-to-end run succeeded, so this is successful integration evidence rather than a provider availability guarantee.

Browser inspection confirmed the agreed venue and 2-of-2 policy screen, the friends creation form, and retained candidate selection after refreshing /discover. Temporary HTTP identities, groups, searches and the loopback server were removed after verification. Production migrations and deployment were not performed in this change.
