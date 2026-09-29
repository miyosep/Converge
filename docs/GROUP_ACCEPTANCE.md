# Ordinary-group acceptance runs

The acceptance runner uses the ordinary group HTTP APIs, seven isolated SIWE
cookie sessions (six members and one outsider), live Kiln `qwen3-32b`, the
existing Sepolia contracts, and the same transaction builder and payment worker
used by the application. All preference text is synthetic. Six separate keys
are controlled by one test operator; this does not claim six independent humans
or a manual browser-wallet walkthrough.

## Scenarios

| Run | Conditions | Winner | Payment | Refund per member |
| --- | --- | --- | --- | --- |
| Baseline | $35 meal budget, all sample merchants permitted | A / KAGAMI | 45 MockUSDC | 2.5 MockUSDC |
| Lower budget | First member reduces the meal budget to $25 | B | 36 MockUSDC | 4 MockUSDC |
| Merchant excluded | Original budgets; A excluded when creating a new group | B | 36 MockUSDC | 4 MockUSDC |

Each group has a new evaluation, immutable policy and decision ID, six live
extractions, an explicit confirmation from each member's session, a live
privacy-safe explanation, six wallet contributions, one payment and six refunds.
Group creation stores a validated list of permitted sample restaurant IDs.
Evaluation intersects that list with the server's merchant permissions inside
the locked database transaction. The client cannot replace it during evaluation.

The baseline and lower-budget runs simulate an 80 MockUSDC request. The
merchant-excluded run simulates a payment to A against B's policy. Both the
contract's validator and enforcing payment function must reject at the recorded
block. These are read-only `eth_call` rejections, not mined failed transactions.

## Commands

Use the existing private `.env` and `.env.development`. The runner requires the
isolated `dev-preferences` branch, direct PostgreSQL connection, live Kiln key,
Sepolia RPC and the existing test participant, executor and deployer keys. It
checks chain identity, deployed bytecode and signer addresses before using them.

```sh
pnpm db:migrate:dev
pnpm demo:groups-server
```

The acceptance server uses port 3010 and `.next-acceptance`, independently of the
interactive demo on port 3000. In a second terminal:

```sh
pnpm demo:groups-acceptance group-acceptance-001 --prepare
pnpm demo:groups-acceptance group-acceptance-001 --run
pnpm demo:groups-acceptance group-acceptance-001 --verify
```

`--prepare` performs authenticated API and live Kiln work without chain writes.
`--run` resumes preparation and completes all three chain lifecycles. It may top
up the known test participants to 30 MockUSDC and the documented small Sepolia
gas targets. `--verify` checks existing receipts, historical rejection blocks,
stored history and usage; it requires every transaction to be in finalized
canonical blocks and sends no transactions. Authentication still creates fresh
local application sessions.

Stop the Explore and ordinary-group signing workers before the chain phase.
The runner uses the shared `.demo/worker.lock` and the database executor lock;
it refuses competing signers. An existing lock must not be deleted while its
owner is alive. Use the same run ID after interruption. Private signed journals
and run state stay under `.demo/private/<run-id>/`; never remove them to retry.
A new run ID creates new groups, API usage and payments.

## Recovery and privacy checks

- Every participant signs a separate SIWE challenge; replay of each challenge fails.
- Unauthenticated and outsider access to group, preference, chain, history and
  explanation endpoints fails. Query parameters cannot select another member's
  private preference. Cross-member confirmations and non-creator invitations fail.
- Foreign-Origin POSTs, client-supplied merchant overrides and mutations of a
  frozen proposal fail. Every member sees the same policy hash.
- Repeated explanation requests use the persisted cache without another inference.
- The baseline deliberately loses the response to a real payment broadcast. A
  new worker instance recovers the persisted signed hash without another payment.
- The lower-budget run deliberately fails the database confirmation write after
  a real successful payment. Restart reconciles that same payment from receipts.
- Repeated event ingestion retains one payment and one correctly sized refund
  per member; the HTTP history excludes signed transaction payloads.

Supplementary tests exercise provider timeout, RPC failure, cancellation, expiry,
reorganizations, write-before-broadcast failures and interrupted broadcasts in
controlled local environments. Those fault injections are labeled separately
from successful live provider calls and Sepolia transactions.

## Evidence

The runner exports `docs/evidence/<run-id>-<scenario>.json`, connecting group and
revision IDs, evaluation and policy hash, actual confirmed synthetic inputs,
provider attempt records, per-flow usage, rejection block, transaction receipts,
application history and recovery results. Unknown energy metrics stay null.
Exports remain `confirmed-awaiting-finality` until `--verify` succeeds. Only
completed, reviewed exports should be published through `/evidence`.
