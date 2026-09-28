# Converge

**AI proposes. Humans approve. Smart contracts enforce.**

Converge helps a group choose a restaurant from private preferences, approve one shared spending policy, and pay a reservation deposit through a policy-bound group wallet.

> **Project status:** The shared TypeScript foundation and MockUSDC/group-wallet contracts are implemented and tested locally. Both contracts are deployed on Ethereum Sepolia. The web application, Kiln integration, and end-to-end demo are still pending. This README remains a draft and will be updated with live evidence.

For the implementation specification and self-assignment task register, see [project_guideline.md](project_guideline.md).

Before starting a feature branch, read [CONTRIBUTING.md](CONTRIBUTING.md) and [the shared foundation](docs/FOUNDATION.md).

**Demo platform:** MacBook. See [macOS setup and demo readiness](docs/MACBOOK_DEMO.md). Foundation CI includes Apple Silicon and Intel macOS; a full live rehearsal on the actual MacBook remains required after implementation.

## Selected Function

**Converge is a multi-user purchasing agent and programmable wallet that converts private group preferences into a jointly approved purchase and allows an AI agent to execute it only within smart-contract-enforced spending conditions.**

## Problem

Choosing and paying for a group reservation requires people to coordinate budgets, safety requirements, preferences, approvals, and contributions. Some of those inputs are private. An AI assistant can help interpret them, but the group needs a way to prevent that assistant from spending outside the terms everyone approved.

## Solution

The proposed MVP supports **six participants** and one restaurant reservation deposit:

1. Each person submits a private natural-language preference and confirms the structured interpretation.
2. Kiln `gpt-oss-120b` interprets the inputs. Application code filters and ranks a small, versioned catalog of synthetic restaurants.
3. The group reviews an immutable policy binding the participants, token, merchant, exact deposit, spending ceilings, executor, and expiry.
4. All six approve and contribute mock USDC. The decision becomes active only after six distinct approved contributions are confirmed on-chain.
5. The execution agent requests one deposit payment. The smart contract enforces the approved policy and rejects invalid attempts.
6. Each participant can claim their share of unused funds. Cancellation and expiry also permit recovery of contributed funds.

The restaurant catalog and token are synthetic. This prototype does not make a real restaurant booking, handle the remaining meal bill, or transfer real USDC.

## Demo

The baseline uses six separate participant accounts: Alice, Bob, Charlie, Dana, Erin, and Farah. These are demo personas, not team assignments. Dedicated accounts have been generated for a single-operator rehearsal; this does not demonstrate six independently controlled participants. Their public addresses are in [the participant manifest](contracts/deployments/demo-participants.11155111.json).

| Item | Planned baseline |
| --- | --- |
| Recommended restaurant | Restaurant A |
| Estimated meal price | $32 per person; $192 for six people |
| Contribution | 10 Mock USDC per person |
| Total contributed | 60 Mock USDC |
| Approved merchant | Restaurant A's deployed mock merchant address |
| Exact reservation deposit | 45 Mock USDC |
| Maximum deposit and total escrow spend | 60 Mock USDC each |
| Deliberately invalid request | 80 Mock USDC to Restaurant A; expected `MAX_DEPOSIT_EXCEEDED` |
| Valid request | 45 Mock USDC to Restaurant A |
| Remaining funds after payment | 15 Mock USDC; 2.5 per person |

The $45 deposit is credited toward the synthetic $192 meal estimate. The balance of the meal is outside the on-chain MVP. A successful live demo must show a real transaction receipt, matching contract event, and application history entry. The invalid attempt must be described according to its actual evidence type: read-only validation, simulation revert, or mined revert.

## Architecture

The planned application architecture is TypeScript with server-side Kiln calls, a persistent database, and deterministic decision logic. Solidity contracts are implemented and deployed on Ethereum Sepolia. Foundry v1.8.3, Solc 0.8.24, OpenZeppelin Contracts v5.4.0, Zod, and viem are in use; Next.js and wagmi remain proposed for the application.

```text
Private input -> Kiln extraction -> participant confirmation
              -> deterministic filtering and scoring
              -> policy review -> six on-chain approvals and contributions
              -> bounded agent payment -> contract validation and transfer
              -> receipt, event, history, and refunds
```

The policy will have a canonical, versioned ABI encoding and a `decisionHash` calculated consistently in Solidity and TypeScript. Changing the merchant or any other approved financial term will require a new decision and fresh approvals.

## AI vs Code vs Smart Contract

| Layer | Planned responsibility |
| --- | --- |
| Kiln `gpt-oss-120b` | Extract structured constraints from private natural language and explain a sanitized recommendation. Clarification is optional; analysis of already structured merchant fixtures is normally unnecessary. |
| Application code | Validate model output, enforce participant access, filter mandatory constraints, calculate weighted scores, freeze policy inputs, track workflow state, and record evidence. |
| Smart contract | Verify membership and approvals, hold contributions, enforce the immutable merchant/amount/expiry policy, execute one permitted payment, and make unused funds claimable. |

The contract is the final authority for token movement. It cannot verify restaurant allergy safety, availability, or real-world service delivery; those are off-chain fixture claims in this MVP.

## Kiln Integration

**Planned model:** `gpt-oss-120b` through the NPU-based Kiln API. The API key will stay on the server. Model output will be checked against a restricted schema and confirmed by the submitting participant before evaluation.

| Flow | Purpose | Planned usage |
| --- | --- | --- |
| `constraint_extraction` | Parse each participant's latest preference revision | Six calls for an unchanged baseline, before retries or corrections |
| `decision_explanation` | Explain the deterministic result from privacy-safe data | One call per proposal revision |
| `clarification` | Ask about a consequential ambiguity | Only when needed |
| `candidate_analysis` | Interpret unstructured candidate facts | Normally zero calls for structured fixtures |

These are proposed call counts, not observed measurements. Final acceptance runs must use real Kiln responses; a development mock must be visibly labeled and excluded from live evidence.

## Kiln Token Usage by Flow

No Kiln requests have been made for this repository yet. The table will be filled from provider usage records after live runs. Unknown values will remain unknown rather than be reported as zero.

| Flow | Calls | Input tokens | Output tokens | Total tokens | Evidence |
| --- | ---: | ---: | ---: | ---: | --- |
| `constraint_extraction` | Pending | Pending | Pending | Pending | Pending |
| `decision_explanation` | Pending | Pending | Pending | Pending | Pending |
| `clarification` | Pending | Pending | Pending | Pending | Pending |
| `candidate_analysis` | Pending | Pending | Pending | Pending | Pending |

The `/evidence` page is planned to show per-flow usage and each run's completeness. Request IDs, timestamps, model, flow, retries, and cache hits will be recorded without publishing private prompts or secrets.

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

| Contract | Address | Deployment transaction |
| --- | --- | --- |
| MockUSDC | [`0x4707bde238399a27f88855a34bfb31f20b386b17`](https://sepolia.etherscan.io/address/0x4707bde238399a27f88855a34bfb31f20b386b17) | [`0xf329f3...f21991`](https://sepolia.etherscan.io/tx/0xf329f33842f286b2007693d604c66779ad879bd4061c6c4852bd62a4a9f21991) |
| ConvergeGroupWallet | [`0xd43172d5bd904b68004d69545fd01dbcfdb82a89`](https://sepolia.etherscan.io/address/0xd43172d5bd904b68004d69545fd01dbcfdb82a89) | [`0x2ba1af...33b57`](https://sepolia.etherscan.io/tx/0x2ba1af22b6ba1ea410d482c195671caec2184fa49462feea449a9cc57de33b57) |
| Mock merchant, if used | Pending decision | Pending |

## On-chain Transactions

The two deployment transactions above succeeded and were checked against their receipts and deployed bytecode; see the [public deployment manifest](contracts/deployments/11155111.json). No decision, contribution, payment, or refund transaction has been produced yet. The final README will list the Ethereum Sepolia decision hash, six approval/contribution transactions, successful payment transaction and decoded event, and refund transactions for each complete run. A transaction hash will be reported as successful only after checking its receipt and matching event.

## Condition Check Experiments

The challenge requires the baseline plus two complete reruns with changed conditions. The following are expected results from the proposed fixtures, not completed experiments.

| Run | Changed condition | Expected recommendation | Required chain and log evidence |
| --- | --- | --- | --- |
| Baseline | Six baseline preferences | Restaurant A | Six approvals; 80 Mock USDC rejected; 45 Mock USDC paid to A; six 2.5 Mock USDC refunds |
| Lower budget | Alice's maximum decreases from $35 to $25 | Restaurant B | New decision and six approvals; 36 Mock USDC paid to B; six 4 Mock USDC refunds |
| Merchant excluded | A is removed from the permitted set | Restaurant B | New B policy and six approvals; attempted payment to A rejected as `MERCHANT_NOT_ALLOWED`; 36 Mock USDC paid to B; six 4 Mock USDC refunds |

Changing an active policy in place would invalidate the meaning of earlier approvals. Each rerun therefore uses a new decision. If an older decision still holds funds, it must be cancelled or settled under its own rules.

## Privacy Model

Raw preference text and parsed individual constraints are visible to the submitting participant and the authorized server processing them. Other participants see submission progress and sanitized group results. Shared explanations do not identify who supplied a sensitive condition. The evidence export omits private inputs unless the examples are explicitly synthetic or sharing is consented to.

This is application-level privacy, not cryptographic anonymity. Wallet addresses, approvals, contributions, payments, and refunds are public on-chain, and a small group may infer information from a result.

## Security Model

The financial policy will bind six distinct participant addresses, the token, chain, escrow contract, merchant, executor, exact payment, caps, and expiry. Contract state and per-decision balances, not browser or database assertions, decide whether a transfer is allowed. Refunds will be pull-based and protected against duplicate claims. Relevant contract invariants and access controls are specified in [project_guideline.md](project_guideline.md).

This is a hackathon prototype using mock funds. The local Solidity suite currently passes 22 tests, including fuzzing and randomized state sequences. The verified Sepolia deployment is not evidence of an end-to-end application run.

## How to Run

The shared foundation runs with Node.js 24.19.0 and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm contracts:build
pnpm contracts:test
pnpm contracts:abi
```

`pnpm check` runs TypeScript validation, formatting checks, and foundation tests. Contract commands require Foundry v1.8.3 and no external credentials. `pnpm deploy:sepolia` has been used for the current deployment and refuses to replace its completed manifest. `pnpm demo:wallets` reuses or creates local demo keys; `pnpm demo:fund` records and confirms the authorized allocation of 30 MockUSDC and 0.001 Sepolia ETH per demo account, reusing recorded transactions on reruns. `pnpm mint:mock` performs an additional explicit mint. The web application is not scaffolded yet: there is no `dev`, app `build`, or end-to-end demo command. See [the deployment guide](docs/DEPLOYMENT.md).

Expected external prerequisites are Kiln credentials, a persistent database, an Ethereum Sepolia RPC, test accounts funded with Sepolia ETH for gas, and a dedicated agent executor account. Keep all secrets outside Git.

## Environment Variables

[`.env.example`](.env.example) contains placeholders for Kiln, database, sessions, chain/RPC, deployed addresses, and executor credentials, plus separate script-only deployment/demo keys. Create an ignored local `.env` when implementing integrations. Service-specific validation will be added with each integration. No credentials should be committed or pasted into evidence.

## Pre-built vs Hackathon-built Work

The initial README contained only design documentation. Subsequent work added repository tooling, TypeScript schemas, checks, collaboration instructions, Solidity contracts with local tests, and the verified Sepolia deployment. No complete application has been produced yet. Dependencies are listed in `package.json` and pinned in `pnpm-lock.yaml`. The team must confirm the event's actual start time before categorizing work as hackathon-built, and disclose any pre-existing code or templates based on records rather than assumptions.

## Team

Engineering responsibilities were not preassigned in the initial plan. Sage has claimed the policy encoding, token, escrow, payment enforcement, refunds, contract verification, and deployment tasks in the [self-assignment task register](project_guideline.md#19-self-assignment-task-register). Other contributors can enter their own names in open `Owner` cells. Claimed work is not yet completed work; this summary will be updated from actual contributions before submission.

## README Update Plan

This first version establishes the selected function, intended workflow, architecture, and acceptance evidence. After implementation, update it with the actual stack, working setup commands, verified Kiln usage by flow, measured efficiency data, deployment addresses, transaction receipts, experiment outcomes, tests run, known limitations, and an accurate team contribution record. Remove `Pending` only when the corresponding evidence exists.
