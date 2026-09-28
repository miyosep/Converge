# Converge

**AI proposes. Humans approve. Smart contracts enforce.**

Converge helps a group choose a restaurant from private preferences, approve one shared spending policy, and pay a reservation deposit through a policy-bound group wallet.

> **Project status:** This is the initial README for a planned hackathon prototype. The repository currently contains design documentation, not a runnable application. Kiln calls, deployed contracts, transactions, tests, and measured token usage are pending. This README will be updated with real implementation details and evidence as the project develops.

For the implementation specification and self-assignment task register, see [project_guideline.md](project_guideline.md).

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

The planned baseline uses six separate participant accounts: Alice, Bob, Charlie, Dana, Erin, and Farah. These are demo personas, not team assignments.

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

The planned architecture is a TypeScript web application with server-side Kiln calls, a persistent database, deterministic decision logic, and Solidity contracts on an EVM devnet or testnet. Foundry, Next.js, Zod, viem, and wagmi are proposed tools. Final versions and commands will be recorded after implementation.

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

The planned deployment has a six-decimal `MockUSDC` token and a `ConvergeGroupWallet` contract with decision-specific accounting. Each participant signs their own approval and 10 Mock USDC contribution. An approved executor may request only the single deposit bound in the immutable policy.

The contract is intended to reject the wrong caller or merchant, insufficient approval/funding, an expired or inactive decision, an amount above the deposit or total spending ceiling, an amount different from the exact approved deposit, and a second payment. A participant may cancel before payment; expiry and completion make eligible refunds claimable.

**Network:** Pending selection. A devnet or testnet satisfies the challenge brief. Public explorer links will be included only if the selected network provides them.

## Contract Addresses

| Contract | Address | Deployment transaction |
| --- | --- | --- |
| MockUSDC | Pending deployment | Pending |
| ConvergeGroupWallet | Pending deployment | Pending |
| Mock merchant, if used | Pending decision | Pending |

## On-chain Transactions

No on-chain transactions have been produced yet. The final README will list the chain ID, decision hash, six approval/contribution transactions, successful payment transaction and decoded event, and refund transactions for each complete run. A transaction hash will be reported as successful only after checking its receipt and matching event.

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

This is a hackathon prototype using mock funds. The final README will state which contract checks were implemented and which tests actually passed.

## How to Run

**Not runnable yet.** No application scaffold, dependency manifest, database migrations, contracts, or demo scripts exist in this repository at the time of this draft. The implementation plan proposes development, build, test, deployment, preflight, and demo commands; exact working commands and tested versions will replace this paragraph after they exist. See [the setup sequence](project_guideline.md#172-setup-sequence) and [proposed command contract](project_guideline.md#173-command-contract-to-implement).

Expected external prerequisites are Kiln credentials, a persistent database, an EVM RPC, funded test accounts, and a dedicated agent executor account. Keep all secrets outside Git.

## Environment Variables

The planned `.env.example` will document `KILN_API_KEY`, `KILN_BASE_URL`, `KILN_MODEL`, `DATABASE_URL`, session and app origin settings, chain/RPC and contract addresses, an executor key for server-side execution, and script-only deployment/demo keys. Their final names and validation rules will be updated with the implementation. No credentials should be committed or pasted into evidence.

## Pre-built vs Hackathon-built Work

At this README's first draft, the repository contains design documentation. No application code or contract implementation has been verified here. The team will document any templates, libraries, or work that predated the hackathon using the actual repository history and contributor records. This section will be updated before submission; it must not claim unverified work was built during the event.

## Team

Engineering responsibilities were not preassigned in the initial plan. Sage has claimed the policy encoding, token, escrow, payment enforcement, refunds, contract verification, and deployment tasks in the [self-assignment task register](project_guideline.md#19-self-assignment-task-register). Other contributors can enter their own names in open `Owner` cells. Claimed work is not yet completed work; this summary will be updated from actual contributions before submission.

## README Update Plan

This first version establishes the selected function, intended workflow, architecture, and acceptance evidence. After implementation, update it with the actual stack, working setup commands, verified Kiln usage by flow, measured efficiency data, deployment addresses, transaction receipts, experiment outcomes, tests run, known limitations, and an accurate team contribution record. Remove `Pending` only when the corresponding evidence exists.
