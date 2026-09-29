# Converge

**AI proposes. Humans approve. Smart contracts enforce.**

Converge helps a group choose a restaurant from private preferences, approve one shared spending policy, and pay a reservation deposit through a policy-bound group wallet.

In the current Explore Demo catalog, Restaurant A is presented as **KAGAMI**, a fictional storefront at `/restaurant`. Its table meal estimate is synthetic and separate from the $148 omakase shown on the concept page. Its shellfish-safety metadata is unknown. The storefront displays a simulator-only booking state after a matching Sepolia test payment; it does not accept a real reservation.

> **Project status:** The ordinary-group baseline, lower-budget, and merchant-excluded lifecycles completed on the Neon development branch and Ethereum Sepolia, using live Kiln `qwen3-32b`, six distinct wallet keys and isolated authenticated HTTP clients. Each run has six contributions, one bounded payment, six refunds, and matching application history. Lost-broadcast and database-confirmation failures recovered across separate processes without duplicate payment. See [the acceptance record](docs/GROUP_ACCEPTANCE.md) for exact inputs, receipts, usage and finality. One test operator controlled all six keys; a six-human browser walkthrough and the presentation MacBook rehearsal remain open. Production deployment, independent review, and submission disclosures are separate remaining work.

For the implementation specification and self-assignment task register, see [project_guideline.md](project_guideline.md).

Before starting a feature branch, read [CONTRIBUTING.md](CONTRIBUTING.md) and [the shared foundation](docs/FOUNDATION.md).

**Demo platform:** MacBook. See [macOS setup and demo readiness](docs/MACBOOK_DEMO.md). Foundation CI includes Apple Silicon and Intel macOS; a full live rehearsal on the actual MacBook remains required after implementation.

## Selected Function

**Converge is a multi-user purchasing agent and programmable wallet that converts private group preferences into a jointly approved purchase and allows an AI agent to execute it only within smart-contract-enforced spending conditions.**

## Problem

Choosing and paying for a group reservation requires people to coordinate budgets, safety requirements, preferences, approvals, and contributions. Some of those inputs are private. An AI assistant can help interpret them, but the group needs a way to prevent that assistant from spending outside the terms everyone approved.

## Solution

Ordinary groups can choose **2–100 participants** when created. Invitations,
private preferences, progress and recommendations use that group's chosen size.
All members must join and confirm before evaluation. The per-person test
contribution remains 10 MockUSDC; recommendation spending limits cannot exceed
the actual group's total contribution (and retain the configured 60 MockUSDC cap).
Migration `0009_group_size.sql` preserves existing groups at six members.

Ordinary groups can search and select from **20 fictional restaurants** by name,
cuisine or area. All members approve one immutable policy and contribute before
payment. The deployed **v2 contract supports 2–100 participants**, including four.
Existing v1 policies remain supported. Explore Demo retains six participants and
its original five-candidate catalog. Apply migrations through `0010`.
See [variable-size payments](docs/GROUP_WALLET_V2.md) for deployment and verification.

The payment flow supports one test restaurant reservation deposit:

1. Each person submits a private natural-language preference and confirms the structured interpretation.
2. Kiln `qwen3-32b` interprets the inputs. Application code filters and ranks a small, versioned catalog of synthetic restaurants.
3. The group reviews an immutable policy binding the participants, token, merchant, exact deposit, spending ceilings, executor, and expiry.
4. All six approve and contribute mock USDC. The decision becomes active only after six distinct approved contributions are confirmed on-chain.
5. The execution agent requests one deposit payment. The smart contract enforces the approved policy and rejects invalid attempts.
6. Each participant can claim their share of unused funds. Cancellation and expiry also permit recovery of contributed funds.

The restaurant catalog and token are synthetic. This prototype does not make a real restaurant booking, handle the remaining meal bill, or transfer real USDC.

## Demo

Use **Explore Demo** on the home screen, or open `/demo`, for the wallet-connected judge flow. The judge's address is discovered at connection time; missing test funds are supplied within a bounded session. See [setup and operation](docs/EXPLORE_DEMO.md). The five automated participants and sample restaurants are disclosed in the interface.

The first [live Explore rehearsal](docs/evidence/explore-live-c1564c0c4a4c.json) used a locally controlled judge test wallet. Its on-chain evidence verifies six distinct contributions, the 45 MockUSDC payment to Restaurant A, and all six refunds; it does not claim six independent humans or a completed MacBook/browser walkthrough.

The baseline uses six separate participant accounts: Alice, Bob, Charlie, Dana, Erin, and Farah. These are demo personas, not team assignments. Dedicated accounts have been generated for a single-operator rehearsal; this does not demonstrate six independently controlled participants. Their public addresses are in [the participant manifest](contracts/deployments/demo-participants.11155111.json).

| Item                                   | Verified baseline terms                                       |
| -------------------------------------- | ------------------------------------------------------------- |
| Recommended restaurant                 | Restaurant A                                                  |
| Estimated meal price                   | $32 per person; $192 for six people                           |
| Contribution                           | 10 Mock USDC per person                                       |
| Total contributed                      | 60 Mock USDC                                                  |
| Approved merchant                      | Restaurant A's deployed mock merchant address                 |
| Exact reservation deposit              | 45 Mock USDC                                                  |
| Maximum deposit and total escrow spend | 60 Mock USDC each                                             |
| Deliberately invalid request           | 80 Mock USDC to Restaurant A; expected `MAX_DEPOSIT_EXCEEDED` |
| Valid request                          | 45 Mock USDC to Restaurant A                                  |
| Remaining funds after payment          | 15 Mock USDC; 2.5 per person                                  |

The $45 deposit is credited toward the synthetic $192 meal estimate. The balance of the meal is outside the on-chain MVP. A successful live demo must show a real transaction receipt, matching contract event, and application history entry. The invalid attempt must be described according to its actual evidence type: read-only validation, simulation revert, or mined revert.

## Architecture

The application uses Next.js, TypeScript, server-side Kiln calls, Neon PostgreSQL, and deterministic decision logic. Solidity contracts are implemented and deployed on Ethereum Sepolia. Foundry v1.8.3, Solc 0.8.24, OpenZeppelin Contracts v5.4.0, Zod, and viem are in use. Wallet browser integration currently uses the EIP-1193 provider; wagmi remains optional for later transaction UI.

```text
Private input -> Kiln extraction -> participant confirmation
              -> deterministic filtering and scoring
              -> policy review -> six on-chain approvals and contributions
              -> bounded agent payment -> contract validation and transfer
              -> receipt, event, history, and refunds
```

The policy has a canonical, versioned ABI encoding and a `policyHash` calculated consistently in Solidity and TypeScript. Changing the merchant or any other approved financial term requires a new decision and fresh approvals.

## AI vs Code vs Smart Contract

| Layer            | Implemented responsibility                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kiln `qwen3-32b` | Extract structured constraints from private natural language and explain a sanitized recommendation. Clarification is optional; analysis of already structured merchant fixtures is normally unnecessary. |
| Application code | Validate model output, enforce participant access, filter mandatory constraints, calculate weighted scores, freeze policy inputs, track workflow state, and record evidence.                              |
| Smart contract   | Verify membership and approvals, hold contributions, enforce the immutable merchant/amount/expiry policy, execute one permitted payment, and make unused funds claimable.                                 |

The contract is the final authority for token movement. It cannot verify restaurant allergy safety, availability, or real-world service delivery; those are off-chain fixture claims in this MVP.

## Kiln Integration

**Selected model:** `qwen3-32b` through Kiln. The project owner confirmed that the updated competition requirement supersedes the older `gpt-oss-120b` wording in `hackathon_descrip.txt`. The server-side adapter passed two live synthetic extraction checks with schema validation and provider usage records. Authenticated web submission, correction, and participant confirmation are implemented. NPU execution and energy are not independently attested by these responses.

The deterministic decision engine selects A/B/B for the three offline fixture scenarios. The three live ordinary-group runs also select A/B/B using the explicitly documented budget-and-quiet input variant. Each live group has six fresh extractions, confirmations and a Kiln explanation; these records are separate from the earlier smoke and blockchain-only rehearsals. See [acceptance inputs and evidence](docs/GROUP_ACCEPTANCE.md), [decision engine details](docs/DECISION_ENGINE.md), and [Kiln integration](docs/KILN.md).

Preference revision transitions enforce explicit confirmation, stale-result rejection, correction reset, and proposal-lock checks. The [PostgreSQL workflow](docs/PREFERENCE_WORKFLOW.md) runs on an isolated Neon development branch with migrations through `0008`; production remains unmigrated. A no-match result does not freeze the group; a ready evaluation saves the confirmed snapshot. The [web workflow](docs/WEB_APP.md) includes EOA SIWE sessions, capped invitations, scoped APIs, live extraction, per-attempt usage, immutable policies, wallet actions, the payment worker and receipt-backed history. All three live acceptance groups completed this HTTP-to-chain-to-refund flow.

| Flow                    | Purpose                                                 | Expected usage before retries                                      |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `constraint_extraction` | Parse each participant's latest preference revision     | Six calls for an unchanged baseline, before retries or corrections |
| `decision_explanation`  | Explain the deterministic result from privacy-safe data | One call per proposal revision                                     |
| `clarification`         | Ask about a consequential ambiguity                     | Only when needed                                                   |
| `candidate_analysis`    | Interpret unstructured candidate facts                  | Normally zero calls for structured fixtures                        |

These are expected call counts before retries or corrections. Observed provider attempts are reported separately below. Acceptance evidence uses real Kiln responses; development mocks are labeled and excluded from live evidence.

## Kiln Token Usage by Flow

These totals come only from the three live ordinary-group records, including failed attempts and retries. Earlier smoke and Explore runs are excluded.

| Flow                    | Provider attempts | Input tokens | Output tokens | Total tokens | Evidence                                                                     |
| ----------------------- | ----------------: | -----------: | ------------: | -----------: | ---------------------------------------------------------------------------- |
| `constraint_extraction` |                28 |       28,494 |        11,743 |       40,237 | [Three-run records](docs/GROUP_ACCEPTANCE.md#recorded-run-september-29-2026) |
| `decision_explanation`  |                 3 |          597 |           985 |        1,582 | Same records                                                                 |
| `clarification`         |                 0 |            — |             — |            — | No calls                                                                     |
| `candidate_analysis`    |                 0 |            — |             — |            — | No calls                                                                     |

Extraction had 18 successful and 10 failed attempts, including nine automatic retry attempts. One failed revision required a fresh submission; it was never confirmed or used in a policy. All three explanation calls succeeded, with three subsequent application-cache hits. Total measured tokens were 41,819; provider-reported cost was USD 0.00479144. Unused flows have no measured token total. Energy remains unknown.

The `/evidence` page publishes allowlisted projections of the three correlated records and keeps earlier evidence separate. The member-only insights API reports usage, failures, retries and cache hits. Public JSON includes explicitly synthetic test inputs for auditability; the public page omits input text and private fields. Real participant prompts and all secrets stay private.

## Inference / Energy Efficiency

The design uses structured state instead of repeatedly sending conversation history; deterministic code handles filtering, scoring, arithmetic, approvals, and spending rules. Candidate data is compact, clarification is conditional, and unchanged extraction results may be cached within a participant's access scope.

Direct energy measurements are **not yet available**. If the Kiln API does not expose them, the project will report measured token and call counts as efficiency indicators and label any energy estimate with its source and assumptions. Token counts alone are not energy measurements.

## Blockchain Integration

### Why Blockchain Is Necessary for This Design

A conventional web service could collect six approvals and enforce a spending limit, but the group would have to trust its operator to keep those rules, safeguard the pooled funds, and process refunds. Converge's intended guarantee is stronger: after participants approve and fund a decision, neither the AI executor nor the application operator can change its merchant, payment amount, expiry, or recipients of unused funds. The smart contract, rather than the server's database, must be the authority for moving the escrowed tokens; it must provide no administrator withdrawal or policy-editing path around those rules.

Participants should also be able to verify approvals, payment, and refunds from on-chain transactions and claim eligible refunds directly through the contract if the Converge server or website is unavailable. The acceptance demo should prove this by showing an out-of-policy payment rejected by the contract and a participant refund without relying on the application server. These are the reasons to use a blockchain for the chosen trust model, not a claim that a group purchase is impossible with Web2. The prototype uses MockUSDC and synthetic merchants on a testnet, so it does not prove real-world booking or payment settlement.

The implemented contracts have a six-decimal `MockUSDC` token and a `ConvergeGroupWallet` with decision-specific accounting. Only the token's deployer can mint. Each participant signs their own approval and 10 Mock USDC contribution. The approved executor may request only the single deposit bound in the immutable policy.

The wallet rejects the wrong caller or merchant, insufficient approval/funding, an expired or inactive decision, an amount above the deposit or total spending ceiling, an amount different from the exact approved deposit, and a second payment. A participant may cancel before payment; expiry and completion make eligible refunds claimable. A policy expires no later than 24 hours after creation. See [the contract behavior](docs/BLOCKCHAIN.md) and [deployment procedure](docs/DEPLOYMENT.md).

**Selected demo network:** Ethereum Sepolia (chain ID `11155111`). Contract development and automated tests may use a local EVM chain, but the final acceptance runs and transaction evidence must use Ethereum Sepolia. Each participant and the executor will need Sepolia ETH for gas; the contributed token remains the project's separate MockUSDC. Deployment used the public PublicNode Sepolia RPC; the demo MacBook must verify connectivity before the presentation.

## Contract Addresses

| Contract            | Address                                                                                                                         | Deployment transaction                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| MockUSDC            | [`0x4707bde238399a27f88855a34bfb31f20b386b17`](https://sepolia.etherscan.io/address/0x4707bde238399a27f88855a34bfb31f20b386b17) | [`0xf329f3...f21991`](https://sepolia.etherscan.io/tx/0xf329f33842f286b2007693d604c66779ad879bd4061c6c4852bd62a4a9f21991) |
| ConvergeGroupWallet | [`0xd43172d5bd904b68004d69545fd01dbcfdb82a89`](https://sepolia.etherscan.io/address/0xd43172d5bd904b68004d69545fd01dbcfdb82a89) | [`0x2ba1af...33b57`](https://sepolia.etherscan.io/tx/0x2ba1af22b6ba1ea410d482c195671caec2184fa49462feea449a9cc57de33b57)  |
| Mock merchants A-E  | [Five receipt-only EOAs](contracts/deployments/demo-roles.11155111.json)                                                        | No contract deployment required                                                                                           |

## On-chain Transactions

The two deployment transactions above succeeded and were checked against their receipts and deployed bytecode; see the [public deployment manifest](contracts/deployments/11155111.json).

The [blockchain-only baseline](docs/evidence/baseline-001.json) completed 20 successful Sepolia transactions: one decision creation, six token allowances, six contributions, one payment, and six refunds. Six 10 MockUSDC contributions funded the policy. An 80 MockUSDC `eth_call` simulation was rejected with `MaxDepositExceeded`; no invalid transaction was broadcast. The [45 MockUSDC payment](https://sepolia.etherscan.io/tx/0x62e3f93d6b868e5742778cc18c3d28d079cfd1288d5184463ee974c075af4ef5) then succeeded, and each participant claimed 2.5 MockUSDC. Receipts, matching wallet/token events, final decision accounting, and balance changes were verified. Each participant finished with 22.5 MockUSDC and the escrow retained none of this decision's funds.

Decision ID: `0xfe4303ad9410db46828e983ed1c13cb2656b35264ca575fd81d332b2dc551abe`.
Policy hash: `0xf5c21e9945568ab0bfcb51998257f9465f151a9636db050b71ca3614ba453a4d`.
This direct-contract rehearsal used one operator and synthetic inputs; it did not call Kiln or exercise the web application. See [rehearsal instructions](docs/CHAIN_REHEARSAL.md).

## Condition Check Experiments

The baseline and two changed-condition ordinary groups completed with fresh policies and six fresh live extractions each. They use the controlled budget-and-quiet inputs documented in [the acceptance record](docs/GROUP_ACCEPTANCE.md), independently of the earlier blockchain-only baseline.

| Run                                                                            | Changed condition                | Observed recommendation | Recorded result                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | -------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Baseline](docs/evidence/group-acceptance-001-baseline.json)                   | Six budget-and-quiet preferences | A                       | 80 MockUSDC simulation rejected; [45 paid](https://sepolia.etherscan.io/tx/0xd24fa24c9a0d84c514330abca00b28ee186e833fddee92e5ef63a4baf7d9a7fd); six 2.5 refunds                              |
| [Lower budget](docs/evidence/group-acceptance-001-lower-budget.json)           | First budget $35 → $25           | B                       | Fresh policy and six contributions; [36 paid](https://sepolia.etherscan.io/tx/0x3f6a846511de38ad8fabb3486e0fddb032c57ecc0d19d9ddda8692cd462a58a4); six 4 refunds                             |
| [Merchant excluded](docs/evidence/group-acceptance-001-merchant-excluded.json) | Restore $35 and exclude A        | B                       | A payment simulation rejected with `MERCHANT_NOT_ALLOWED`; [36 paid to B](https://sepolia.etherscan.io/tx/0x08914573a043f0c9ecca3c22624dd80af928cb06beab881cf372e0cee1d1cbfb); six 4 refunds |

All amounts are MockUSDC on Sepolia. There are 45 successful lifecycle receipts across these records; invalid requests were read-only calls, not failed mined transactions. Each record correlates confirmed input revisions, real Kiln attempts, evaluation, immutable policy, receipts and persisted history. Baseline and lower-budget recovery retain the same payment hash across process restarts.

Changing an active policy in place would invalidate the meaning of earlier approvals. Each rerun therefore uses a new decision. If an older decision still holds funds, it must be cancelled or settled under its own rules.

## Privacy Model

Raw preference text and parsed individual constraints are visible to the submitting participant and the authorized server processing them. Other participants see submission progress and sanitized group results. Shared explanations do not identify who supplied a sensitive condition. The evidence export omits private inputs unless the examples are explicitly synthetic or sharing is consented to.

This is application-level privacy, not cryptographic anonymity. Wallet addresses, approvals, contributions, payments, and refunds are public on-chain, and a small group may infer information from a result.

## Security Model

The financial policy binds all distinct participant addresses, the token, chain, escrow contract, merchant, executor, exact payment, caps, and expiry. Contract state and per-decision balances decide whether a transfer is allowed. Refunds are pull-based and protected against duplicate claims. Relevant contract invariants and access controls are specified in [project_guideline.md](project_guideline.md).

This is a hackathon prototype using mock funds. The local Solidity suite currently passes 22 tests, including fuzzing and randomized state sequences. The verified Sepolia deployment is not evidence of an end-to-end application run.

## How to Run

The shared foundation runs with Node.js 24.19.0 and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo:decision
pnpm db:migrate:dev
pnpm db:rehearse:dev
pnpm contracts:build
pnpm contracts:test
pnpm contracts:abi
```

`pnpm check` runs TypeScript validation, formatting checks, and 70 application/foundation tests. `pnpm dev` starts the web application; `pnpm build` checks its production build. The application needs an initialized development database and Kiln key to submit preferences. Contract commands require Foundry v1.8.3 and no external credentials. `pnpm deploy:sepolia` has been used for the current deployment and refuses to replace its completed manifest. `pnpm demo:wallets` reuses or creates local demo keys; `pnpm demo:fund` records and confirms the authorized allocation of 30 MockUSDC and 0.001 Sepolia ETH per demo account, reusing recorded transactions on reruns. `pnpm mint:mock` performs an additional explicit mint. See [the web setup](docs/WEB_APP.md) and [deployment guide](docs/DEPLOYMENT.md).

Expected external prerequisites are Kiln credentials, a persistent database, an Ethereum Sepolia RPC, test accounts funded with Sepolia ETH for gas, and a dedicated agent executor account. Keep all secrets outside Git.

With `KILN_API_KEY`, `KILN_BASE_URL`, and `KILN_MODEL=qwen3-32b` in the ignored `.env`, run `pnpm kiln:check` for two live synthetic extractions. Each invocation consumes provider usage and replaces the latest smoke evidence. It neither confirms preferences nor sends blockchain transactions.

The six demo accounts and dedicated executor are now funded, and the five
synthetic merchant recipients are configured. Run `pnpm demo:preflight` to
check the deployed blockchain setup, or `pnpm demo:preflight --check-signers`
to check local demo keys as well. This is a read-only check; it does not run the
application or complete the payment/refund workflow.

`pnpm demo:chain baseline-001` runs or resumes the direct-contract baseline.
For the already completed run, use `pnpm demo:chain baseline-001 --verify-only`
to check its evidence without preparing or broadcasting transactions. A new
run ID creates a fresh decision and spends another allocation of mock funds.

For ordinary groups, follow [the three-scenario acceptance workflow](docs/GROUP_ACCEPTANCE.md).
It uses migrations through `0008`, a separate local server on port 3010, six
isolated authenticated clients, real Kiln calls and the application payment
worker. `pnpm demo:groups-verify group-acceptance-001` independently checks the
published artifacts against finalized Sepolia receipts using only RPC access.

## Environment Variables

[`.env.example`](.env.example) contains placeholders for Kiln, database, sessions, chain/RPC, deployed addresses, and executor credentials, plus separate script-only deployment/demo keys. Keep populated settings in ignored local environment files. Development commands use `.env.development` for the isolated Neon branch. Routes and workers validate the configuration they require. No credentials should be committed or pasted into evidence.

## Pre-built vs Hackathon-built Work

The initial README contained only design documentation. Subsequent work added repository tooling, TypeScript schemas, checks, collaboration instructions, the Next.js group and Explore flows, Solidity contracts with local tests, the Sepolia deployment, and three live ordinary-group acceptance records. Dependencies are listed in `package.json` and pinned in `pnpm-lock.yaml`. The team must confirm the event's actual start time before categorizing work as hackathon-built, and disclose any pre-existing code or templates based on records rather than assumptions.

## Team

Current self-assigned owners, reviewers and evidence-backed statuses are in the [task register](project_guideline.md#19-self-assignment-task-register). Claimed work and implementation evidence do not establish final per-person contributions. Confirm the team contribution statement and event timeline before submission.

## README Update Plan

This draft records the implemented architecture, deployment, three correlated live acceptance runs, and current limitations. Remaining submission work includes the actual presentation MacBook rehearsal, final team contributions and prior-work disclosure. Energy remains unmeasured. Replace unknown or pending values only when corresponding evidence exists.
