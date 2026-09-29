# First Web Workflow

## Live place search and archived examples

New-plan links at `/group/new` redirect to `/discover`. Kiln Qwen tool calling and
xAPI provide live search for restaurants, stays, spaces, sports and classes from
English requests. Authentication is requested within the search page. Configure
server-only `KILN_API_KEY` and `XAPI_KEY`; see [setup and evidence](LIVE_RESTAURANT_SEARCH.md).
For the hackathon, candidates are assumed reservable using USDC; availability is
not checked. This search/comparison flow does not itself create a group payment policy.

The archived planner at `/demo/catalog` uses 200 fictional examples, 40 per category.
Apply migrations through `0014_catalog_forty.sql` for its saved shortlists.
See [archived catalog behavior](MULTI_INDUSTRY.md). The group and payment workflows
below describe this compatible synthetic merchant flow and existing groups.


## Flexible group formation

New ordinary groups accept `targetMemberCount` from 2 to 100, including the
creator. Omitted values default to 6 for existing clients. The chosen size is
fixed for that group. Migration `0009_group_size.sql` adds this field, preserves
existing six-member groups, and extends invitation capacity. Apply it using
`pnpm db:migrate:dev` before running the updated app.

Invites and joins use the saved capacity while holding the group row lock.
Every expected member must join and confirm before evaluation. Recommendation
funding uses the actual member count, with deposit and spending caps limited to
the group's contribution total and the existing configured caps.

New ordinary policies use the deployed v2 contract with 2–100 members and
unanimous approval. Existing v1 policies still use their original contract.
Archived demo groups select among 40 fictional restaurants or one of four other
40-example categories. Migrations through `0014_catalog_forty.sql` expand saved
shortlists while preserving existing selections. Explore Demo keeps six participants
and its original five candidates.
See [v2 deployment and verification](GROUP_WALLET_V2.md).

Run `node --env-file=.env.development --import tsx scripts/group-size-rehearsal.ts`
to check 2-, 4-, 6- and 8-member groups, competing invitations for the final
seat, confirmation readiness, recommendation funding and variable-size policy
persistence. It also checks the 100-member capacity limit. This uses synthetic
preferences and temporary rows on `dev-preferences`, cleans up its own groups,
and sends no chain transactions or Kiln requests.

## Payment workflow

The Next.js app supports wallet-signature login, group creation, capped invite links, progress for the chosen group size, private preference submission through Kiln `qwen3-32b`, correction, explicit confirmation, saved candidate results, and immutable policy preparation. The ordinary-group approval page supports Sepolia policy registration, exact token allowance, participant contribution, cancellation, and refund claims using each participant's own browser wallet. A separately enabled worker executes eligible payments and persists receipt-checked events and history. Three live lifecycles passed through equivalent authenticated HTTP clients and the shared wallet transaction builder; see [acceptance scope and records](GROUP_ACCEPTANCE.md). Six-human browser use and the actual presentation MacBook remain separate checks. See [UI direction](UI_DIRECTION.md) for routes and data boundaries.

## Ordinary-group wallet actions

Group creation saves a nonempty, unique list of permitted sample restaurants
under migration `0008_group_conditions.sql`. Evaluation intersects this list
with server-side merchant permissions while holding the group lock. Changed
merchant conditions require a new group and policy. See the
[three-scenario acceptance runner](GROUP_ACCEPTANCE.md) for full HTTP, Kiln,
Sepolia, authorization, and process-restart checks using six separate wallets.

After preparing a signing policy, open `/group/:id/approve`. Any of its six participants can register it. Each participant then allows the exact contribution amount and contributes in a separate wallet transaction. The page checks the session wallet, configured deployment, policy hash, chain state, token balance and allowance before simulating and requesting each transaction. Ordinary groups supply their own Sepolia ETH and MockUSDC; no test-funding worker or automated participants are attached.

`GET /api/groups/:id/chain` requires a valid session and membership before contacting the configured server-side `RPC_URL`. It reports amounts from one canonical block with two confirmations. RPC errors disable actions rather than showing fabricated zero balances. The client checks fresh wallet-provider state again before signing. Pending hashes survive reload when browser storage is available. Replacements detected by the wallet receipt watcher are tracked; for a replacement or dropped hash missed across reload, the page exposes an explicit stop-tracking action without resubmitting a transaction.

The optional `groups:worker` process scans policies from the configured deployment block, verifies event logs against successful canonical receipts, and records a two-confirmation snapshot. It journals the exact signed payment before broadcast. On restart it checks the saved hash and payment event against the approved policy and contract state before marking completion; an uncertain payment is never replaced with a newly signed payment. Run `groups:worker-check` for read-only preflight. Sending payments requires `GROUP_EXECUTION_ENABLED=true`, the configured executor key, RPC access, and migration `0006_group_execution.sql` on the intended database branch. The `/group/:id/execution` page shows the stored transaction and event history to group members. Participants can cancel before payment or claim contract-calculated refunds after completion, cancellation, or expiry.

`pnpm contracts:build` followed by `pnpm demo:group-chain-test` exercises the same transaction builder and chain reader against disposable Anvil contracts. It checks six contributions, mismatched policy and participant rejection, insufficient balance/allowance, duplicate prevention, cancellation, expiry and refunds. It makes no Sepolia writes and loads no credentials. Browser wallet interaction by six independent users remains an acceptance step.

### Worker operations and verified recovery

Apply `pnpm db:migrate:dev`, then run `pnpm groups:worker-check`. The worker needs the direct `DATABASE_URL_UNPOOLED` for its session advisory lock. Keep the executor key in the private worker environment. After setting `GROUP_EXECUTION_ENABLED=true`, run `pnpm groups:worker`. The default `GROUP_EXECUTION_MAX_ETH=0.01` caps the sum of reserved maximum transaction fees in the execution journal, including earlier attempts; it is not a per-transaction limit or an ETH funding mechanism.

Run only one signing mode for this executor. The Explore Demo and ordinary-group workers share `.demo/worker.lock`, so stop the Explore worker before starting ordinary-group execution. Keep both modes on the same host and shared demo directory, and do not use this executor key in another signing process. Do not delete transaction journals to retry an uncertain payment: restart recovery checks and reuses its saved hash. History requires the worker to run, uses two block confirmations, and does not imply Ethereum finality. Refund claims remain individual wallet transactions.

The Anvil rehearsal also verifies that payment waits for the sixth contribution, a lost broadcast response resumes the same signed hash, and history replay records one payment and six refunds without duplicates. `pnpm db:group-execution-rehearse:dev` verifies journal persistence, gas-budget rejection, unique attempts, event replay and replacement, member-scoped history and private journal omission using temporary records on `dev-preferences`. Both rehearsals passed; six independent browser wallets on Sepolia remain an acceptance step.

## Local Development

### MetaMask connection

Connect wallet connects directly to MetaMask in both the workspace and Explore
Demo. The app discovers MetaMask through EIP-6963 with a legacy injected-provider
fallback that excludes known compatibility providers. MetaMask handles sign-in,
network switching, approvals and refunds. If it is unavailable, the app asks the
user to install or enable it. Existing session-account and policy-participant
checks still apply before transactions.
Sign-in requests account access before switching networks, adds Sepolia only
when the wallet reports an unknown chain, and verifies the chain and account
before requesting the login signature. Messages use hex-encoded UTF-8 for
`personal_sign`. Pending-request and cancellation errors provide recovery
instructions; a reconnect still requests a fresh sign-in signature even when
the wallet has already granted site access.

Use Node.js 24.19.0 and pnpm 11.19.0 on Windows or macOS. Install with `pnpm install --frozen-lockfile`. Place the **development branch** pooled Neon URL in ignored `.env.development` as `DATABASE_URL`, its direct URL as `DATABASE_URL_UNPOOLED`, and set `NEON_BRANCH=dev-preferences`. Keep `KILN_API_KEY` server-side in ignored `.env`; do not prefix it with `NEXT_PUBLIC_`. Set `APP_ORIGIN=http://localhost:3000` for local use. No secrets belong in Git, screenshots, or chat.

Run `pnpm db:migrate:dev` and `pnpm dev`, then open `http://localhost:3000` in a browser with an EIP-1193 wallet such as MetaMask. The wallet must support Ethereum Sepolia. The login signature is not a transaction. This version verifies signatures from externally owned accounts only. Six independently controlled wallets are required to verify the actual user flow. Dedicated demo keys should never be imported into an everyday wallet profile.

For local checks, run `pnpm db:auth-rehearse:dev` to validate DB replay/invite behavior and `pnpm http:rehearse:dev` while the dev server is running. `pnpm http:kiln-rehearse:dev` additionally spends a live Kiln request, submits and confirms a synthetic preference, and verifies usage persistence. With the local server running, `node --env-file=.env.development --import tsx scripts/group-workflow-rehearsal.ts` checks saved results and policy preparation on `dev-preferences` using synthetic inputs. These scripts generate ephemeral accounts and write synthetic records only to the development branch. They do not submit transactions. `pnpm check` and `pnpm build` validate code; the actual presentation MacBook still needs a manual browser-wallet check.

## Boundaries

The production Neon branch remains unmigrated. A production deployment must set an HTTPS `APP_ORIGIN`, apply reviewed migrations to the intended branch, configure Kiln privately, and pass a multi-device access review. A localhost invite link is usable only by browsers on that machine; it is not a public invitation for friends on other devices. The Next.js server, not a browser, owns Neon and Kiln credentials. POST routes require a matching `Origin`, JSON content type, and a valid HttpOnly SameSite session cookie after login. Group APIs derive the actor from that session. The other members' progress response includes only display names, wallet addresses, and submitted/confirmed flags; individual raw text and extracted constraints are not shared.

Challenge messages bind the address, Ethereum Sepolia chain ID, expected origin, nonce, and five-minute expiry. Challenges are consumed atomically; sessions use random hashed tokens and can be revoked. Invite tokens are random, stored only as hashes, expire after 24 hours, and cannot exceed the six-person capacity. These are application controls, not blockchain payment authorization. Rate limiting, contract-wallet signatures, production deployment, and independent security review remain open.
