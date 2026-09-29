# Ordinary-group acceptance runs

The acceptance runner uses the ordinary group HTTP APIs, seven isolated SIWE
cookie sessions (six members and one outsider), live Kiln `qwen3-32b`, the
existing Sepolia contracts, and the same transaction builder and payment worker
used by the application. All preference text is synthetic. Six separate keys
are controlled by one test operator; this does not claim six independent humans
or a manual browser-wallet walkthrough.

## Scenarios

| Run               | Conditions                                             | Winner     | Payment     | Refund per member |
| ----------------- | ------------------------------------------------------ | ---------- | ----------- | ----------------- |
| Baseline          | $35 meal budget, all sample merchants permitted        | A / KAGAMI | 45 MockUSDC | 2.5 MockUSDC      |
| Lower budget      | First member reduces the meal budget to $25            | B          | 36 MockUSDC | 4 MockUSDC        |
| Merchant excluded | Original budgets; A excluded when creating a new group | B          | 36 MockUSDC | 4 MockUSDC        |

Each group has a new evaluation, immutable policy and decision ID, six live
extractions, an explicit confirmation from each member's session, a live
privacy-safe explanation, six wallet contributions, one payment and six refunds.
Group creation stores a validated list of permitted sample restaurant IDs.
Evaluation intersects that list with the server's merchant permissions inside
the locked database transaction. The client cannot replace it during evaluation.

The live inputs are a controlled budget-and-quiet variant: each member submits
“My maximum meal budget is 35 USD per person, inclusive. I prefer a quiet
restaurant. I have no other requirements.” The lower-budget scenario changes
only the first member's number to 25; merchant exclusion restores 35 and removes
A from the group's saved permissions. These are fresh live extractions, with no
cross-group cache reuse. The guideline's varied subway/atmosphere persona inputs
remain separate deterministic fixtures; the exported `inputs` identify exactly
which text and confirmed constraints produced each live result.

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
pnpm demo:groups-acceptance group-acceptance-001 --run --checkpoint-recovery
pnpm demo:groups-verify group-acceptance-001 --wait-finality
pnpm demo:groups-acceptance group-acceptance-001 --verify
```

`--prepare` performs authenticated API and live Kiln work without chain writes.
`--run` resumes preparation and completes all three chain lifecycles. It may top
up the known test participants to 30 MockUSDC and the documented small Sepolia
gas targets. `--verify` checks existing receipts, historical rejection blocks,
stored history and usage; it requires every transaction to be in finalized
canonical blocks and sends no transactions. Authentication still creates fresh
local application sessions.

`--checkpoint-recovery` deliberately exits the process after the baseline lost
broadcast response and after the lower-budget confirmation-write failure. Run
the same command again after each `RECOVERY_CHECKPOINT` exit. The export records
the original and resumed process IDs and the unchanged payment hash, proving
recovery across separate processes. Omit the flag for an uninterrupted rehearsal.

`demo:groups-verify` is the independent public-artifact verifier. It needs only
`RPC_URL`; it does not use participant keys, the database, or Kiln credentials.
It verifies calldata and senders, all canonical finalized receipts, policy hashes,
six unique contributions and refunds, historical rejection blocks, application
event references, and the correlation between submitted revisions and recorded
Kiln attempts.
The optional `--wait-finality` flag waits in 30-second intervals for up to 20
minutes per scenario; it only reads the chain and never submits a transaction.

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

### Recorded run: September 29, 2026

`group-acceptance-001` completed all three lifecycles on Windows x64 with
Node.js 24.19.0, Neon `dev-preferences` migrations `0001`–`0008`, live Kiln
`qwen3-32b`, and Ethereum Sepolia. Each scenario has its own group, evaluation,
decision and policy hash; the batch ID plus scenario is its unique evidence ID.

| Scenario / public record                                                  | Winner | Paid        | Refund per member | Successful lifecycle receipts |
| ------------------------------------------------------------------------- | ------ | ----------- | ----------------- | ----------------------------- |
| [Baseline](evidence/group-acceptance-001-baseline.json)                   | A      | 45 MockUSDC | 2.5 MockUSDC      | 15                            |
| [Lower budget](evidence/group-acceptance-001-lower-budget.json)           | B      | 36 MockUSDC | 4 MockUSDC        | 15                            |
| [Merchant excluded](evidence/group-acceptance-001-merchant-excluded.json) | B      | 36 MockUSDC | 4 MockUSDC        | 15                            |

Each group recorded one registration, one required allowance transaction, six
contributions, one payment, and six refunds. Other members already had sufficient
allowance. Across the groups, 180 MockUSDC was contributed, 117 paid and 63
refunded. Funding transactions are setup activity and excluded from these 45
lifecycle receipts. The rejection records confirm codes 8 / 8 / 6 at their saved
canonical blocks. The independent RPC verifier passed for all 45 receipts in
finalized canonical blocks; each artifact records its checked height and time.

| Flow                  | Provider attempts | Successful | Failed | Automatic retry attempts | Input tokens       | Output tokens      |
| --------------------- | ----------------- | ---------- | ------ | ------------------------ | ------------------ | ------------------ |
| Constraint extraction | 28                | 18         | 10     | 9                        | 28,494             | 11,743             |
| Decision explanation  | 3                 | 3          | 0      | 0                        | 597                | 985                |
| Candidate analysis    | 0                 | 0          | 0      | 0                        | Unknown / no calls | Unknown / no calls |
| Clarification         | 0                 | 0          | 0      | 0                        | Unknown / no calls | Unknown / no calls |

All 18 final revisions were explicitly confirmed. One merchant-excluded revision
exhausted bounded JSON repair and became `PARSE_FAILED`; a fresh revision then
succeeded. Both its failure and all provider attempts remain in the export.
There were three application explanation-cache hits. Total measured tokens were
41,819 and provider-reported cost was USD 0.00479144; energy remains unknown.

Each group passed 12 recorded access/privacy checks. Baseline recovery used
different processes after losing the broadcast response; lower-budget recovery
used different processes after the confirmation-write failure. Both recovered
the original hash, one payment and six refunds with no duplicate events after
replay. Read-only public-artifact verification additionally checks every sender,
calldata, receipt, event reference, policy hash and historical rejection.

Local checks passed: `pnpm check` (70 application tests), `pnpm contracts:test`
(22 contract tests including fuzz and invariants), `pnpm demo:group-chain-test`,
`pnpm db:auth-rehearse:dev`, and `pnpm db:group-execution-rehearse:dev`.
The optimized Next.js production build also passed using the isolated
`.next-acceptance` output. It retained the existing upstream `ox`/`viem` dynamic
dependency warning. Actual presentation-MacBook/browser-wallet and six-human
usability checks remain separate work.

### Export format

The runner exports `docs/evidence/<run-id>-<scenario>.json`, connecting group and
revision IDs, evaluation and policy hash, actual confirmed synthetic inputs,
provider attempt records, per-flow usage, rejection block, transaction receipts,
application history and recovery results. Unknown energy metrics stay null.
Exports remain `confirmed-awaiting-finality` until a verification command checks
finality. `/evidence` labels confirmed and finalized records separately; only
completed, reviewed, explicitly synthetic exports are selected for publication.
