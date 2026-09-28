# Converge Project Guideline

> AI proposes. Humans approve. Smart contracts enforce.

Document status: implementation specification, not a report of completed work.
Reviewed on: 2026-09-28.
Language: English for project documentation, code comments, issues, and demo evidence.
Demo platform: MacBook. Native macOS support is required; the foundation targets Apple Silicon and Intel. See `docs/MACBOOK_DEMO.md` for setup and rehearsal requirements.
Task ownership: self-assigned. Sage has claimed the blockchain contract and deployment work in Section 19; other tasks remain open for contributors to claim.

## 1. Purpose and Source of Truth

This document turns the supplied Converge architecture into a concrete hackathon implementation guide. It defines the product scope, system boundaries, shared contracts, security rules, implementation sequence, acceptance tests, and evidence required for the final demo.

The challenge brief in `hackathon_descrip.txt` is the source of truth for competition requirements. The supplied architecture is the starting design. Where that design is ambiguous or inconsistent, the decisions in this document explain the proposed resolution.

At the initial architecture review, repository inspection found the challenge brief and an empty `New folder` directory. No application, dependency manifest, or smart contracts were present then. Subsequent implementation created tooling, schemas, locally tested contracts, and a verified Ethereum Sepolia deployment. Planned flows and measurements remain proposals until supported by evidence.

The current deliverables include this guideline, a draft `README.md`, a shared TypeScript foundation, locally tested blockchain contracts, and a verified Ethereum Sepolia deployment. See `docs/FOUNDATION.md` for tooling and schemas, `docs/BLOCKCHAIN.md` for contract behavior, the [deployment manifest](contracts/deployments/11155111.json), and `CONTRIBUTING.md` before creating feature branches. The README must be revised as implementation and evidence become available. The application, database, and live integrations remain subsequent work.

### 1.1 Required README Declaration

Use this exact sentence prominently in the README:

> **Converge is a multi-user purchasing agent and programmable wallet that converts private group preferences into a jointly approved purchase and allows an AI agent to execute it only within smart-contract-enforced spending conditions.**

### 1.2 Mandatory Challenge Outcomes

| Requirement | Implementation outcome | Required evidence |
| --- | --- | --- |
| User need and workflow | At least six participants move from private preferences to an approved restaurant reservation deposit | Full workflow demonstration and clear AI/code boundaries |
| Kiln integration | Real server-side Kiln calls using `qwen3-32b` influence the recommendation | Request metadata, validated outputs, and per-flow usage |
| Efficiency | Limit unnecessary inference and disclose measurement limits | Calls and input/output tokens by flow; measured metrics or explicit assumptions |
| Blockchain | Execute the selected workflow on a devnet or testnet | Successful transaction hash with matching contract event and application history |
| Selected function | Declare the purchasing-agent and programmable-wallet function | Exact README declaration above |
| Changed conditions | Repeat the end-to-end workflow twice with changed conditions | Baseline plus two separate recorded runs, including input changes and outcomes |

The brief permits a devnet or testnet. Converge has selected **Ethereum Sepolia (chain ID `11155111`)** for deployed contracts, final acceptance runs, and judge-facing transaction evidence. Local EVM chains remain useful for development and contract tests. Record the actual network used for each run; a local chain hash alone is not independently available after the chain is reset.

## 2. Architecture Review and Corrections

| Original ambiguity or risk | Decision for the MVP | Why it matters |
| --- | --- | --- |
| Change the approved merchant on an active decision | Financial policies are immutable. Create a new decision and obtain fresh approvals | Old approvals must never authorize a changed recipient |
| `maxDeposit` checked separately on every payment | One reservation payment per decision; mark payment consumed atomically | Multiple small transfers must not bypass the deposit ceiling |
| A $120 spending limit with only $60 funded and a $35 personal budget | Separate estimated meal price from escrow spending. Baseline escrow cap is $60, actual payment is $45 | Meal cost, deposit, and authorized on-chain spending are different quantities |
| Approvals without explicit participant membership | Freeze six unique participant addresses in the MVP policy | Outside accounts must not count toward activation |
| Six approvals automatically mean ready | Require six unique approvals and exactly $60 of credited contributions | An approval alone does not prove funding |
| JSON-derived decision hash unspecified | Use a versioned ABI-encoded policy hash computed identically in Solidity and TypeScript | Object ordering and number formatting must not change authorization |
| Reject event emitted before a revert | Use custom errors and application rejection records; reverted logs do not survive | Evidence must describe what actually happened |
| Private inputs hidden only in the interface | Enforce server authorization and private data projections | Browser visibility controls alone do not provide privacy |
| Allergy interpreted as an ordinary Boolean fact | Distinguish verified fixture metadata from unknown information | Missing safety data must not become an affirmative safety claim |
| AI explanation may disclose private restrictions | Give the explanation flow only a privacy-safe evaluation summary | Unattributed sensitive facts can still identify someone in a small group |
| Refund after payment only | Support cancellation and expiry before payment, including partial funding | Funds must not be trapped when someone never approves |
| Token usage always a number | Preserve missing usage as unknown; never synthesize measured counts | Evidence must remain truthful when the provider omits fields |
| Changed-condition checks treated as isolated calls | Run baseline and two complete new decision lifecycles | The challenge asks for repeated end-to-end runs |
| Agent implicitly has arbitrary execution privileges | A fixed executor may call only the bounded payment function | Compromising the agent must not expose arbitrary transfers |

## 3. Product Scope

### 3.1 Primary User Story

Six friends want to choose a restaurant together without sharing all of their personal restrictions. Each person submits preferences privately. Converge interprets those preferences with Kiln, filters a small restaurant catalog in deterministic code, and proposes one restaurant. All six review the same spending policy and contribute mock USDC. The execution agent can then pay only the approved restaurant within that policy. Participants recover the unused balance.

Alice, Bob, Charlie, Dana, Erin, and Farah are demo participant personas, not engineering assignments.

Use six as the fixed MVP group size and unanimous approval threshold. Future support for larger groups may generalize the participant array and threshold, but the acceptance runs must involve at least six distinct people/accounts.

### 3.2 Baseline Financial Example

| Item | Baseline value |
| --- | --- |
| Participants | Six unique wallet addresses |
| Contribution | 10 mock USDC per participant |
| Total credited funds | 60 mock USDC |
| Restaurant A estimated meal price | 32 USD per person, 192 USD for the group |
| Actual reservation deposit | 45 mock USDC for the group |
| Maximum authorized deposit | 60 mock USDC |
| Maximum escrow spending | 60 mock USDC |
| Number of permitted payments | One |
| Invalid attempt | 80 mock USDC to Restaurant A |
| Valid attempt | 45 mock USDC to Restaurant A |
| Remaining refundable funds | 15 mock USDC |
| Refund | 2.5 mock USDC per participant |

For these synthetic fixtures, the reservation deposit is credited toward the quoted meal price. The remaining meal bill is outside this MVP and is never automatically charged. USD prices and mock USDC amounts use a documented 1:1 demo convention, not a real exchange-rate guarantee. Show mock-token labels clearly.

### 3.3 Included

- One restaurant-selection scenario with six participants.
- Private preference submission and participant-confirmed structured constraints.
- A deterministic catalog of five mock restaurants.
- Real Kiln extraction and recommendation explanation.
- Immutable policy review, on-chain approvals, contributions, bounded payment, and refunds.
- An evidence view and reproducible baseline plus two changed-condition runs.
- Essential authorization, validation, failure handling, and contract tests.

### 3.4 Excluded

- Real restaurant booking, real payment processing, and real USDC custody.
- Hotels, travel planning, multiple currencies, and multiple chains.
- ZK proofs, MPC, DAO governance, arbitration, NFTs, and token economics.
- Account abstraction, generalized contract calls, and autonomous retry loops.
- Production identity infrastructure, complex recommendation models, and live restaurant APIs.
- Collection of the remaining meal bill after the reservation deposit.

Basic participant authentication and authorization are required despite production identity infrastructure being out of scope.

## 4. System Architecture

### 4.1 Recommended Initial Stack

These are design selections for an empty repository, not claims that dependencies are already installed.

| Layer | Default | Selection rule |
| --- | --- | --- |
| Web and server | Next.js with TypeScript | One application with server-side routes |
| Shared validation | Zod | Validate all external inputs and model outputs |
| Database | PostgreSQL on Neon Free, confirmed by the project owner on September 29, 2026 (KST) | Project `rough-cake-92709912` linked to `production`; CLI deployment retry and connection validation pending; see `docs/DATABASE_SETUP.md` |
| Local-only alternative | SQLite, not selected | Do not introduce a second persistence strategy into this implementation |
| EVM interaction | viem; wagmi for browser wallet state | Share generated ABI and network configuration |
| Smart contracts | Solidity and Foundry | Hardhat is acceptable if the team's environment makes it more reliable |
| Token and transfer helpers | Established OpenZeppelin ERC-20 and safety utilities | Pin compatible versions during setup |
| AI | Kiln, `qwen3-32b` | Verify the actual organizer-provided API contract before integration |

Avoid introducing a separate backend service, message broker, vector database, or agent framework unless a concrete requirement cannot be met within the application.

### 4.2 Data Flow

```text
Participant browser
  -> authenticated private preference endpoint
  -> server-side Kiln extraction
  -> schema validation and participant confirmation
  -> deterministic filtering and scoring
  -> privacy-safe Kiln explanation
  -> immutable policy proposal
  -> participant wallet approvals and contributions
  -> on-chain activation
  -> server-side execution agent
  -> contract policy validation and payment
  -> confirmed events, history, settlement, and evidence
```

### 4.3 Authority Boundaries

| Component | Responsible for | Must not do |
| --- | --- | --- |
| Kiln | Interpret natural language, identify ambiguity, explain an approved evaluation result | Authorize funds, invent merchant facts, override deterministic results |
| Decision engine | Validate normalized constraints, filter, score, resolve ties | Relax mandatory conditions without participant confirmation |
| Application server | Authenticate requests, persist records, call Kiln, orchestrate execution, reconcile events | Treat browser assertions as confirmed on-chain state |
| Participant wallet | Sign token allowance and decision contribution transactions | Share private keys with the server |
| Execution agent | Read active policy and submit one bounded deposit request | Approve on behalf of participants or submit arbitrary calldata |
| Smart contract | Enforce membership, funding, approvals, recipient, limits, expiry, payment uniqueness, refunds | Depend on the LLM or database for final authorization |
| Evidence view | Present inspectable public or explicitly shared records | Publish private inputs, credentials, or fabricated usage |

The contract enforces financial authorization. It does not verify restaurant allergy safety, meal quality, opening hours, or real-world reservation fulfillment. Those are off-chain fixture and application claims, which must be described accurately.

### 4.4 Proposed Repository Layout

```text
project_guideline.md
README.md
.env.example
src/
  app/                       # Pages and route handlers
  lib/
    schemas/                 # Shared input and output contracts
    auth/                    # Participant sessions and wallet binding
    kiln/                    # Provider client, prompts, validation, usage
    decision/                # Filtering, scoring, proposal construction
    chain/                   # ABI, policy encoding, reads, reconciliation
    db/                      # Database access and migrations
    evidence/                # Redacted evidence projections and export
  data/restaurants.json
contracts/
  src/MockUSDC.sol
  src/ConvergeGroupWallet.sol
  test/
  script/
scripts/
  demo.ts
  run-condition-tests.ts
tests/
  decision/
  integration/
  e2e/
docs/
  evidence/                  # Sanitized, explicitly exported run artifacts
```

Keep ownership in Section 19 initially. Create a separate ownership document only if the team needs one, and preserve self-assignment rather than preassigning names.

## 5. Identity, Privacy, and Data Access

### 5.1 Minimum Authentication

Use wallet-signature login with a server-issued nonce, expiration, domain binding, and replay prevention through a maintained authentication implementation. Bind the verified address to a server session. A participant record must not be claimable merely by posting a wallet address or display name.

Group invitations establish membership through a server-validated invitation. Freeze membership before publishing a proposal. In a local automated demo, six dedicated test accounts may perform the same operations programmatically. Any persona-switching convenience must be explicitly limited to development and disabled in a shared deployment.

### 5.2 Access Rules

| Resource | Participant access | Public evidence access |
| --- | --- | --- |
| Own raw preference | Read and edit before proposal freeze | None by default |
| Another participant's raw preference | Denied | None |
| Own parsed constraints | Read, correct, confirm | None by default |
| Another participant's parsed constraints | Denied | None |
| Submission progress | Group members see submitted/confirmed flags | Aggregate counts only if useful |
| Candidate result | Group members see sanitized reasons | Sanitized result |
| Financial policy | Group members see complete proposal | Public on-chain policy fields |
| Transaction and event evidence | Group members can inspect | Public chain data |
| Kiln usage | Sanitized metadata | Sanitized per-flow usage |

Enforce access in server queries and responses, including exports and debug endpoints. Do not send private fields to the browser and hide them with CSS. Scope every identifier lookup to the authenticated participant and group. Use secure session cookies and appropriate CSRF protection for cookie-authenticated mutations.

### 5.3 Privacy Limits and Explanation Policy

- Private means hidden from other participants by application access controls. The application server and Kiln receive information needed for extraction.
- Wallet addresses, contributions, payments, and refunds are visible on-chain.
- Do not put raw preferences, allergy details, or hashes of low-entropy private text on-chain.
- Even a six-person group can infer facts from a result without names. Do not promise anonymity or cryptographic confidentiality.
- Shared rejection copy should say: `Does not satisfy all mandatory group conditions.`
- Shared recommendation copy should say: `Meets the group's confirmed requirements and has the highest preference score among eligible options.`
- Do not mention shellfish, a specific participant's budget, or another private condition in shared explanations unless that participant explicitly opted to share it.
- Synthetic Alice/Bob/Charlie/Dana/Erin/Farah inputs may be included in demo evidence when clearly labeled synthetic. Real participant evidence requires separate consent and redaction.
- Never log raw prompts or provider response bodies to public consoles by default. Keep any necessary private diagnostic capture access-controlled and time-limited.

## 6. Shared Data and Constraint Contracts

### 6.1 Representation Rules

- Use integer USD cents for restaurant meal estimates.
- Use integer token base units for blockchain amounts: `10 USDC = 10000000` for a six-decimal mock token.
- Use `bigint` internally for token arithmetic and decimal strings at JSON boundaries.
- Reject floating-point token amounts, negative values, unsupported precision, and out-of-range values.
- Use UTC Unix seconds for on-chain expiry. Display the event timezone, initially `Asia/Seoul`, in the interface.
- Store an explicit date and time; do not persist only `Saturday evening`.
- Validate addresses using the chain library. Compare normalized addresses and display checksummed addresses.
- Version schemas, prompts, fixtures, scoring rules, and policies independently.

### 6.2 Supported Constraint Fields

Use a discriminated schema that restricts the allowed field, operator, and value combinations.

| Category | Field | Value | Evaluation |
| --- | --- | --- | --- |
| Hard | `budget_per_person_cents` | Nonnegative integer | Candidate estimate must be at most the budget |
| Hard | `subway_distance_meters` | Nonnegative integer | Candidate distance must be at most the maximum |
| Hard | `reservation_slot` | Explicit timestamp and timezone context | Fixture must support the requested slot |
| Non-negotiable | `shellfish_safe` | `true` | Candidate must have affirmative fixture evidence |
| Non-negotiable | `wheelchair_accessible` | `true` | Candidate must have affirmative fixture evidence |
| Non-negotiable | `dietary_requirement` | Supported enumerated value | Candidate must explicitly support it |
| Soft | `quiet` | Weight from 0 to 1 | Use normalized quiet score |
| Soft | `atmosphere` | Weight from 0 to 1 | Use normalized atmosphere score |
| Soft | `subway_proximity` | Weight from 0 to 1 | Use normalized proximity score |

Do not accept arbitrary model-generated fields or executable expressions. Unknown requirements produce a clarification or an unsupported-condition result, not an ignored constraint. Unknown safety metadata fails eligibility when the corresponding non-negotiable requirement is present.

### 6.3 Example Extraction Envelope

```json
{
  "schemaVersion": 1,
  "constraints": [
    {
      "type": "hard",
      "field": "budget_per_person_cents",
      "operator": "lte",
      "value": 3500
    },
    {
      "type": "soft",
      "field": "quiet",
      "weight": 0.8
    }
  ],
  "clarifications": [],
  "unsupportedRequirements": []
}
```

Store source text spans privately when useful for correction. The model's confidence must not replace validation or user confirmation. `Close to a subway station` does not justify inventing a mandatory distance threshold. Treat it as a soft preference unless the participant confirms a specific maximum. Likewise, clarify whether `under $35` means strictly below $35 or at most $35 when the distinction changes eligibility.

### 6.4 Confirmation and Revisions

1. Submit private natural-language input.
2. Run real Kiln extraction and validate the result.
3. Show the normalized interpretation only to that participant.
4. Resolve necessary ambiguity and allow structured correction.
5. Require explicit confirmation before including that revision in evaluation.
6. Freeze the six confirmed preference revision IDs in the evaluation record.
7. If any input changes, invalidate the unpublished proposal and recompute.
8. If a policy already exists on-chain, create a new decision with fresh approvals; handle the old funds through cancellation or settlement.

## 7. Restaurant Fixtures and Decision Engine

### 7.1 Reproducible Catalog

Use synthetic data with five candidates. Resolve merchant addresses from a deployment-generated map; never use placeholder addresses in a live execution. Scores below are on a 0-100 scale, with larger values better except distance.

| ID | Name | Meal price/person | Deposit/group | Shellfish fixture status | Subway distance | Quiet | Atmosphere | Availability |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | Restaurant A | $32 | 45 USDC | Confirmed safe in mock data | 150 m | 90 | 95 | Available |
| B | Restaurant B | $24 | 36 USDC | Confirmed safe in mock data | 300 m | 70 | 70 | Available |
| C | Restaurant C | $22 | 30 USDC | Not safe in mock data | 100 m | 80 | 85 | Available |
| D | Restaurant D | $28 | 42 USDC | Confirmed safe in mock data | 900 m | 50 | 60 | Available |
| E | Restaurant E | $30 | 45 USDC | Unknown | 200 m | 85 | 90 | Unavailable |

Include currency, fixture version, supported reservation slots, accessibility/dietary fields, and the deposit-credit convention. All prices are synthetic final estimates including assumed fees; do not imply a live restaurant quote.

Shellfish labels describe a fixture only. They are not medical advice or a guarantee about an actual restaurant's cross-contact practices.

### 7.2 Evaluation Algorithm

1. Require six confirmed preference revisions from distinct members and a valid group reservation slot.
2. Exclude unavailable candidates and candidates outside an explicitly configured permitted-merchant set.
3. Reject candidates failing any non-negotiable condition; unknown required metadata also fails.
4. Reject candidates failing any hard condition from any participant.
5. Check reservation affordability separately: the required deposit must fit the proposed escrow cap and planned funding.
6. Score only eligible candidates using confirmed soft preferences.
7. Sort by score descending, then meal price ascending, then stable candidate ID ascending.
8. Persist the complete internal evaluation and a separate sanitized group projection.
9. If no candidate is eligible, return `NO_MATCH`; do not weaken a restriction or create a fundable policy.

### 7.3 Scoring Definition

Normalize candidate features to the range 0-1:

```text
quietSatisfaction = quietScore / 100
atmosphereSatisfaction = atmosphereScore / 100
subwaySatisfaction = max(0, 1 - subwayDistanceMeters / 1000)

participantScore = sum(weight * satisfaction) / sum(weight)
groupScore = mean(participantScore for participants with positive soft weights)
```

A participant with no positive soft weights is omitted from the soft-score average; their mandatory constraints still apply. If nobody supplies positive soft weights, all candidates have score zero and the documented tie-breakers decide. Store `scoreMicros = Math.round(groupScore * 1_000_000)` and rank by that stored integer, then meal price ascending, then stable candidate ID ascending. Replaying the same structured inputs and fixture version must produce the same result. See `docs/DECISION_ENGINE.md` for implemented boundaries and fixture evidence.

This normalizes each participant's influence so adding more soft-preference fields does not automatically provide more voting power. It is a pragmatic ranking rule, not a claim of mathematically optimal group fairness.

### 7.4 Expected Outcomes

Use these six synthetic baseline submissions in the scripted demo. Each person submits through a separate authenticated account and confirms the parsed result:

| Participant | Private example input | Confirmed interpretation |
| --- | --- | --- |
| Alice | `I can spend at most $35 per person, and I would like somewhere quiet.` | Hard budget at most $35; soft quiet |
| Bob | `I have a shellfish allergy and would prefer to be near a subway station.` | Non-negotiable shellfish-safe fixture requirement; soft subway proximity |
| Charlie | `Atmosphere matters most to me.` | Soft atmosphere |
| Dana | `I want a calm place where we can talk.` | Soft quiet |
| Erin | `I prefer a place with a strong atmosphere.` | Soft atmosphere |
| Farah | `Easy subway access would make the evening simpler.` | Soft subway proximity |

- Baseline: Alice confirms a $35 maximum and quiet preference; Bob confirms shellfish safety and subway proximity; Charlie confirms atmosphere preference; Dana prefers quiet conversation; Erin prefers atmosphere; Farah prefers subway proximity. Restaurant A wins.
- Lower budget: Alice confirms a $25 maximum. Restaurant A and D fail the budget, C fails shellfish safety, E is unavailable, and B wins.
- Changed merchant permission: exclude A in a fresh run while restoring the baseline budget. B wins over D under the same confirmed soft-preference structure.

Test ranking with fixed structured inputs. Real LLM output may vary, so end-to-end runs must record and confirm the actual parsed constraints rather than assume exact model output bytes.

## 8. Kiln Integration and Efficiency

### 8.1 Provider Adapter

Implement a server-only adapter in `src/lib/kiln/client.ts`. Verify the actual Kiln endpoint, authentication header, request format, model identifier, response format, usage fields, and any NPU metrics against organizer-provided documentation or a real response. Do not assume OpenAI-compatible behavior without verification.

The adapter must provide timeouts, bounded output sizes, schema validation, sanitized errors, and usage logging for every provider attempt. Use bounded retries only for appropriate transient failures. A retry may create additional usage and must be recorded as a separate attempt.

### 8.2 Flow Definitions

| Flow | Input | Output | Default frequency |
| --- | --- | --- | --- |
| `constraint_extraction` | One participant's latest private input and supported schema | Validated extraction envelope | Once per new preference revision |
| `candidate_analysis` | Compact public merchant metadata | Optional semantic summary, never authoritative safety facts | Disabled for already structured fixtures |
| `decision_explanation` | Sanitized deterministic winner, ranking, and approved public facts | Short group-safe explanation | Once per proposal revision |
| `clarification` | Minimal unresolved ambiguity | A focused question | Only when necessary; prefer extraction-provided questions |

Record all flow categories in the dashboard, including zero calls and `not used` for candidate analysis. Candidate analysis is optional because the catalog is already structured. A clean baseline normally uses six extraction calls and one explanation call, excluding justified clarifications, retries, or corrections. This is a call budget, not measured evidence.

### 8.3 Reliability and Prompt Boundaries

- Treat participant text and merchant descriptions as untrusted data, not instructions.
- Give the model no payment-signing key, raw database access, or arbitrary tool execution.
- Validate JSON shape and allowed values before persistence or evaluation.
- Do not silently fall back to invented constraints after malformed output or provider failure.
- Allow a bounded repair attempt and then return an actionable failure requiring retry or correction.
- An explanation failure may use a clearly labeled deterministic explanation; record that the AI explanation failed.
- Cache extraction only within the participant's access scope using input revision, model, prompt version, and schema version.
- Mark a cache hit as a cache hit. Do not count it as a new provider call or newly measured tokens.
- Do not send previous conversation history when current structured state is sufficient.
- Make live Kiln mode mandatory for final acceptance runs. A development mock mode must be visible and excluded from live evidence.

### 8.4 Usage Records

```typescript
type KilnUsageRecord = {
  runId: string;
  requestId: string;          // Local correlation ID
  providerRequestId: string | null;
  flow: "constraint_extraction" | "candidate_analysis"
      | "decision_explanation" | "clarification";
  model: "qwen3-32b";
  attempt: number;
  status: "success" | "provider_error" | "validation_error";
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageSource: "provider" | "unavailable";
  startedAt: string;
  completedAt: string;
  latencyMs: number;
  promptVersion: string;
  schemaVersion: number;
};
```

If total tokens are derived from reported input/output tokens, label that derivation separately. Never turn unknown values into zero. Show measured subtotals with missing-record counts when coverage is incomplete. Preserve provider-specific additional usage fields in a sanitized metadata object if available.

### 8.5 Energy Claims

Show calls, input tokens, output tokens, total tokens, and observed latency by flow and run. Report any actual NPU metrics only when supplied by the provider with known units and meaning.

Use this disclosure when applicable:

> Direct energy measurements were not exposed by the API. We therefore report token counts and inference-call counts as the directly measured efficiency indicators and state any energy estimate assumptions separately.

Do not infer actual NPU energy from API wall-clock latency. Any organizer-supplied estimation model must include its source, units, assumptions, and an `estimated` label. Efficiency design choices include structured state, compact fixtures, deterministic arithmetic, optional clarification, and revision-scoped caching.

## 9. Immutable Financial Policy

### 9.1 Policy Contents

Each decision binds at least:

```text
policyVersion
chainId
verifyingContract
decisionId
token
merchant
executor
participants[6]              # Fixed ordered unique addresses
approvalThreshold           # Exactly 6 in this MVP
contributionPerParticipant   # 10_000_000 baseline
paymentAmount               # 45_000_000 baseline
maxDeposit                  # 60_000_000 baseline
maxTotalSpend               # 60_000_000 baseline
expiry                      # Unix seconds
reservationReference        # Public opaque identifier
```

Exact `paymentAmount` is included so the agent cannot choose a different amount within the cap without new consent. The upper bounds remain independently enforced and explain the excessive-deposit demo. The policy also binds the token, executor, chain, and contract so approvals are not ambiguously reusable elsewhere.

### 9.2 Hash Construction

Define one explicit Solidity struct and one matching TypeScript tuple schema. Compute:

```text
decisionHash = keccak256(abi.encode(versionedPolicyFieldsInDeclaredOrder))
```

The final field order and Solidity types must be frozen in the shared ABI before frontend integration. Do not hash ordinary `JSON.stringify()` output. Do not use packed encoding for ambiguous dynamic values. Solidity computes the authoritative hash; TypeScript computes the same hash for review and verifies it against the chain.

Policy encoding v1 is recorded in [docs/POLICY_ENCODING.md](docs/POLICY_ENCODING.md), with matching Solidity and TypeScript definitions and a fixed hash vector. Its Solidity test passed locally with Foundry v1.8.3; macOS CI and the presentation MacBook still require verification.

Add fixed test vectors proving matching TypeScript and Solidity hashes. A change to any bound field must produce a different hash. Participant order is fixed at proposal creation and reused for deterministic refund rounding.

### 9.3 Approval Semantics

`approveAndContribute(decisionId, expectedDecisionHash)` must compare the supplied hash to the stored policy before taking tokens. Only a listed participant can call it, once. Successful transfer and approval recording occur atomically; a failed transfer cannot leave an approval behind.

All six participants must inspect the same policy, including token, chain, merchant, exact payment, ceilings, contribution, executor, and expiry. Changes require a new decision. A database edit must never alter authorization already on-chain.

## 10. Smart Contract Specification

### 10.1 Chosen Shape

Use one `ConvergeGroupWallet` contract with a mapping of decision IDs to isolated logical escrows. Deploy one six-decimal `MockUSDC`. A separate contract per decision is unnecessary for the MVP.

All financial conditions must use per-decision accounting. The contract's global token balance is not a decision's available balance. Direct unsolicited transfers do not create contribution credit or increase a spending allowance.

Use a standard non-rebasing, non-fee-on-transfer mock token. Reject unsupported tokens at decision creation by allowing only the deployment's configured token. A merchant EOA is sufficient; a mock merchant contract is optional. Do not invent a merchant event if only an ERC-20 transfer and wallet payment event occurred.

### 10.2 State Machine

```text
Funding -> Active -> Completed
   |          |
   +-> Cancelled
   +-> Expired <-+
```

- `Funding`: fewer than six successful approvals/contributions.
- `Active`: all six have approved and the required amount is credited.
- `Completed`: the single payment succeeded; remaining funds are refundable.
- `Cancelled`: a participant cancelled before payment; credited funds are refundable.
- `Expired`: expiry was reached before payment; credited funds are refundable.

Successful payment atomically moves `Active` to `Completed`. A separate `completeDecision()` is unnecessary in this one-payment design and must not be able to strand funds. An equivalent architecture is explicitly permitted by the supplied specification.

### 10.3 Proposed Contract Interface

```solidity
function createDecision(Policy calldata policy) external returns (bytes32);
function approveAndContribute(bytes32 decisionId, bytes32 expectedHash) external;
function validatePayment(bytes32 decisionId, address caller, address to, uint256 amount)
    external view returns (bool allowed, RejectReason reason);
function executePayment(bytes32 decisionId, address to, uint256 amount) external;
function cancelDecision(bytes32 decisionId) external;
function expireDecision(bytes32 decisionId) external;
function claimRefund(bytes32 decisionId) external;
```

`validatePayment`'s `caller` is for previewing a transaction from a known address. `executePayment` must validate its actual `msg.sender`, never a caller supplied by the client. Both functions share one internal validation implementation to prevent divergent behavior.

### 10.4 Creation Rules

- Require a fresh decision ID and a supported policy version.
- Require six unique nonzero participant addresses, threshold six, and a positive equal contribution.
- Require the creator to be one of the listed participants; creation alone does not approve the policy.
- Reject zero merchant/executor addresses and the escrow itself as merchant.
- Require the configured token and the current chain/contract domain.
- Require future expiry and a maximum decision lifetime of 24 hours from on-chain creation.
- Require `0 < paymentAmount <= maxDeposit <= maxTotalSpend <= plannedFunding`.
- Freeze every policy field. No admin or executor policy-editing escape hatch.

### 10.5 Execution Validation Order

Use a stable reason order so the demo and tests are reproducible:

1. Decision exists.
2. Caller is the approved executor.
3. Decision is active and payment has not been consumed.
4. Approval threshold and credited funding are satisfied.
5. `block.timestamp < expiry`.
6. Destination equals the approved merchant.
7. Amount is positive.
8. Amount is at most `maxDeposit`.
9. `totalSpent + amount <= maxTotalSpend`.
10. Amount equals approved `paymentAmount`.
11. Amount does not exceed the decision's remaining credited funds.

The $80 baseline attempt must fail at step 8 as `MAX_DEPOSIT_EXCEEDED`, before the exact-amount or balance checks. In the changed-merchant run, the old merchant must fail at step 6 as `MERCHANT_NOT_ALLOWED`.

The cumulative-spend check remains defense in depth even though one-payment semantics and creation-time validation make some violations unreachable in valid MVP policies. Do not weaken policy creation merely to make such a test reachable; test the invariant across valid call sequences.

### 10.6 Cancellation and Expiry

Any listed participant may cancel a funding or active decision before payment. This is a conservative veto policy for a six-person unanimous group. The executor cannot cancel on behalf of participants unless it is also an actual participant.

Anyone may finalize expiry after `block.timestamp >= expiry`. `claimRefund` may also finalize an expired funding/active decision internally, so refunds do not depend on a separate maintenance transaction.

Cancellation takes effect when mined. It does not retroactively reverse an earlier payment or guarantee priority over an already submitted transaction. The interface must distinguish a requested cancellation from a confirmed cancellation. Completed decisions cannot be cancelled; they already permit refunds of the remainder.

### 10.7 Refund Accounting

Maintain per-participant contribution and refund-claimed records.

- Cancelled or expired without payment: each contributor receives their full credited contribution, including partial-funding cases.
- Completed: distribute the unused balance equally among the six equal contributors.
- Let `remaining = totalContributed - totalSpent`, `base = remaining / 6`, and `remainder = remaining % 6` in token base units.
- Participants at fixed indexes lower than `remainder` receive one additional base unit. This makes rounding deterministic and leaves no credited dust.
- Compute entitlements from the fixed terminal accounting snapshot, not from the decreasing contract balance.
- Mark the claim before transferring. Reject repeat claims and non-contributors. A zero entitlement may be marked claimed without a token transfer.
- Refund only to the participant's bound wallet. Never accept an arbitrary refund recipient.

For the baseline, all six receive exactly 2.5 USDC. For Restaurant B with a 36 USDC deposit, all six receive exactly 4 USDC.

### 10.8 Security Invariants

- Use SafeERC20 and checks-effects-interactions; protect token-moving entry points against reentrancy.
- No arbitrary destination, calldata, `delegatecall`, or unlimited executor withdrawal.
- Duplicate approvals and contributions are rejected.
- Token allowance alone does not count as a contribution.
- No payment before activation, after expiry, or after completion/cancellation.
- `totalSpent + totalRefunded <= totalContributed` for every decision.
- One decision cannot consume another decision's funds.
- Failed transfers revert all associated state changes.
- No upgrade, rescue, or owner-only function may bypass authorized escrow accounting in the MVP.
- Direct token donations remain uncredited; document this limitation rather than exposing a dangerous sweep function.

### 10.9 Events and Rejection Evidence

Emit `DecisionCreated`, `ParticipantApproved`, `WalletActivated`, `PaymentExecuted`, `DecisionCompleted`, `DecisionCancelled`, `DecisionExpired`, and `RefundClaimed`, with the relevant decision ID and addresses/amounts.

Use structured custom errors for failed execution. A reverted transaction cannot persist `PaymentRejected` from the same execution. Application history must classify rejection evidence as one of:

- `validation_rejected`: a read-only contract validation result; no transaction hash.
- `simulation_reverted`: transaction simulation reverted; no submitted transaction hash.
- `transaction_reverted`: an actual submitted transaction has a failed receipt and real hash.

Each proves a different action. Do not label a simulation as a mined transaction. Contract tests must call the enforcing payment function directly to show invalid transfers revert. A successful payment transaction remains mandatory in every complete acceptance run.

## 11. Application State and Persistence

### 11.1 Workflow States

```text
COLLECTING_PREFERENCES
  -> PARSING_CONSTRAINTS
  -> AWAITING_CONFIRMATION
  -> EVALUATING
  -> PROPOSAL_READY
  -> AWAITING_APPROVAL
  -> AUTHORIZED
  -> EXECUTING
  -> COMPLETED
```

Also support explicit `NO_MATCH`, `NEEDS_CLARIFICATION`, `RETRYABLE_ERROR`, `CANCELLED`, and `EXPIRED` outcomes. Track preference processing per participant so one pending parse does not overwrite another's progress.

Application workflow status and contract status are separate concepts. `AUTHORIZED` requires confirmed chain activation. `EXECUTING` means submitted or pending, not successful. Rejected payment attempts must leave the active decision available for a valid attempt before expiry.

### 11.2 Minimum Database Entities

| Entity | Essential fields and constraints |
| --- | --- |
| `groups` | ID, name, reservation slot, timezone, membership version, creator, timestamps |
| `participants` | ID, group ID, verified wallet, display name; unique group/wallet |
| `preference_submissions` | ID, participant ID, revision, private raw text, timestamps |
| `parsed_constraints` | Submission ID, schema/prompt versions, validated JSON, confirmation timestamp |
| `candidate_versions` | Fixture version, immutable candidate snapshot, deployment merchant mapping |
| `evaluations` | Group/revision IDs, scoring version, private results, sanitized results, selected candidate |
| `decisions` | Evaluation ID, complete policy, hash, chain/contract/decision IDs, chain status |
| `approvals` | Decision ID, participant wallet, transaction/event identity; unique decision/participant |
| `contributions` | Decision ID, participant, base-unit amount, confirmed event identity |
| `executions` | Attempt ID, decision ID, requested destination/amount, outcome, error code, optional tx hash |
| `refunds` | Decision ID, participant, entitlement, confirmed claim event |
| `kiln_usage` | Run, flow, attempt, provider/local request IDs, nullable counts, versions, timestamps |
| `chain_events` | Chain, contract, transaction hash, log index, block number/hash; unique event identity |
| `scenario_runs` | Run ID, scenario, changed conditions, versions, status, evidence references |

Use database types capable of storing full EVM integer values, or validated decimal text. Do not use floating-point columns for token amounts.

### 11.3 Concurrency and Reconciliation

- Use idempotency keys for proposal generation and execution requests.
- Guard proposal creation against preference revisions changing during evaluation.
- Store a submitted transaction before waiting for confirmation when possible.
- Derive confirmed approvals, payments, and refunds from receipts/events, not browser callbacks.
- Index events idempotently using chain, contract, transaction hash, and log index.
- After restart, reconcile pending records with chain receipts and current contract state.
- A successful chain transaction followed by a failed database write must be recoverable without resending payment.
- Configure and document confirmation depth per network. Pending and confirmed must be distinct.
- A reorg or replaced transaction must cause reconciliation, not duplicate credit.
- Avoid a queue for the MVP unless needed; a bounded worker or explicit reconciliation command is sufficient.

## 12. API Boundaries

The following routes are proposed contracts between the frontend and server. Freeze exact request/response schemas before independent implementation.

| Method and route | Responsibility | Key rule |
| --- | --- | --- |
| `POST /api/groups` | Create group and reservation context | Authenticated creator |
| `POST /api/groups/:id/join` | Join with valid invitation | Verify identity and capacity |
| `GET /api/groups/:id` | Lobby and shared progress | Never return private inputs |
| `POST /api/groups/:id/preferences` | Submit own new revision | Ignore any client attempt to select another owner |
| `GET /api/groups/:id/preferences/me` | Read own raw/parsed input | Current participant only |
| `POST /api/groups/:id/preferences/confirm` | Confirm or correct own parsed revision | Validate supported schema |
| `POST /api/groups/:id/evaluations` | Evaluate frozen confirmed revisions | Idempotent per revision snapshot |
| `GET /api/groups/:id/results` | Return sanitized results | No internal sensitive reason details |
| `POST /api/groups/:id/decisions` | Build immutable policy proposal | Valid evaluation and membership snapshot |
| `GET /api/decisions/:id` | Return policy and reconciled chain state | Group access or sanitized evidence view |
| `POST /api/decisions/:id/executions` | Request bounded agent execution | Authorized group action; server signer remains constrained on-chain |
| `GET /api/decisions/:id/history` | Execution, approval, refund history | Distinguish submitted and confirmed |
| `GET /api/evidence/runs/:id` | Sanitized run evidence | Public only for explicitly published synthetic runs |

Participant approval/contribution and refund transactions are signed in the participant's wallet. No API endpoint may fake those actions by inserting an approval row. The server may accept a transaction hash as a reconciliation hint, then independently verify its chain, contract, sender, method, and receipt.

Use a consistent error envelope containing `code`, a safe `message`, `requestId`, and `retryable`. Keep validation errors, authentication failures, model failures, contract reverts, and RPC failures distinct. Never include secrets or full private provider payloads in error responses.

## 13. Frontend Requirements

### 13.1 Required Views

| Route | Content and interactions | Essential states |
| --- | --- | --- |
| `/` | Existing groups and create-group action | Empty, loading, error |
| `/group/new` | Group name, reservation date/time, invitation creation | Invalid slot, submitting, created |
| `/group/[id]` | Six members, submission/confirmation progress | Waiting, complete, membership locked |
| `/group/[id]/preferences` | Private text, extracted interpretation, correction and confirmation | Parsing, clarification, provider failure, confirmed |
| `/group/[id]/results` | Eligible/rejected candidates, sanitized reasons, winner | No match, proposal stale, explanation fallback |
| `/group/[id]/approve` | Complete financial policy and wallet contribution action | Wrong chain/account, allowance needed, pending, confirmed |
| `/group/[id]/execution` | Contract policy, bounded attempts, transaction evidence, refund status | Inactive, active, rejected, pending, completed, expired |
| `/evidence` | Run selector, per-flow usage, chain records, changed-condition comparison | Missing evidence, partial usage, complete run |

### 13.2 Approve and Contribute Experience

The button may say `Approve & Contribute 10 Mock USDC`, but a standard ERC-20 flow can require two wallet transactions: token allowance, then contribution. Show both steps and explain their pending/confirmed states. Request only the required allowance where feasible.

Before signing, show merchant, exact payment, contribution, both caps, token, chain, expiry, threshold, and policy hash. Verify that the connected account matches the participant. A rejected wallet signature must leave the user able to retry without duplicate approval.

### 13.3 Execution Experience

Make the distinction between an agent request and contract authorization obvious. Show the requested amount/destination, result, structured rejection reason, and the relevant transaction or validation evidence.

The excessive-payment demo action is a deliberate synthetic invalid request. Label it that way; do not claim Kiln spontaneously generated the invalid amount. The valid request derives from the selected fixture and approved policy after real Kiln-assisted preference interpretation.

Display actual credited balance, spent amount, and each user's refund entitlement. Do not display the contract's global token balance as the group's spendable balance. Include pending, reverted, and RPC-unavailable states without falsely reporting success.

## 14. Required Demo Runs

Each run gets a new `runId`, group/revision snapshot, immutable decision, approvals, payment, and evidence bundle. Use fresh decision IDs even when reusing funded test wallets.

### 14.1 Run 1: Baseline

1. Create a group with six authenticated synthetic participants.
2. Submit the baseline natural-language inputs and make real Kiln extraction calls.
3. Confirm parsed constraints and compute the deterministic result: Restaurant A.
4. Generate the privacy-safe explanation with Kiln.
5. Create the immutable policy with 10 USDC contribution each, 45 USDC exact payment, and 60 USDC caps.
6. Record six real approval/contribution transactions and confirm activation.
7. Validate or simulate the deliberate 80 USDC attempt to A; record `MAX_DEPOSIT_EXCEEDED` with its evidence type.
8. Submit the valid 45 USDC payment and capture its successful receipt and `PaymentExecuted` event.
9. Claim 2.5 USDC per participant and capture refund receipts.
10. Export the run's sanitized AI, decision, chain, and settlement evidence.

### 14.2 Run 2: Lower Budget

1. Start a fresh run with Alice's budget changed from $35 to $25.
2. Make a real extraction call for the changed input. Clearly identify any unchanged-input cache reuse, or disable caching for a fully fresh demonstration.
3. Confirm the new constraints; record why A became ineligible without exposing private data in the group view.
4. Select B with a 36 USDC exact deposit, 60 USDC total contributions, and 60 USDC caps.
5. Create a new policy; obtain six new approvals/contributions.
6. Execute the 36 USDC payment to B and record the real transaction and event.
7. Refund 4 USDC to each participant.
8. Compare input revision, parsed budget, eligible set, selected merchant, policy hash, and payment against baseline.

### 14.3 Run 3: Merchant No Longer Permitted

1. Start a fresh run restoring the baseline budget and explicitly excluding A from the permitted merchant set.
2. Record this condition change and run the full preference/evaluation workflow, including live Kiln participation and usage evidence.
3. Select B and create a new immutable policy bound to B with a 36 USDC payment.
4. Obtain six new approvals and contributions, reaching active state.
5. Attempt payment to A with otherwise valid conditions; record `MERCHANT_NOT_ALLOWED` from contract validation or simulation.
6. Pay the approved 36 USDC to B successfully and record receipt/event evidence.
7. Refund 4 USDC per participant and export the comparison.

Do not mutate a live A policy into a B policy. If demonstrating replacement while an old policy is still active, cancel the old decision on-chain first and refund it. Application supersession alone does not revoke old on-chain spending authority.

### 14.4 Demo Script Requirements

`scripts/demo.ts` should perform one complete baseline. `scripts/run-condition-tests.ts` should run the three scenarios and produce a comparison. Both must use the same core modules as the web app.

- Verify configuration, chain ID, deployed bytecode, token decimals, executor identity, API reachability, and test-account funding before starting.
- Derive a future reservation slot and expiry from a run configuration. Do not hard-code a soon-expiring timestamp.
- Mint mock USDC only on the configured development/test deployment.
- Use test account secrets from local environment configuration, never committed source.
- Generate fresh IDs, wait for receipts, and fail with a precise stage/error on a blocker.
- Persist progress so a failure does not erase completed evidence.
- Do not automatically resubmit an uncertain payment; reconcile its transaction first.
- Print real hashes, per-flow usage, actual selection, refund amounts, and missing evidence.
- Never print a successful completion banner unless the required checks passed.

## 15. Evidence and Observability

### 15.1 Evidence Bundle

```text
runId and scenario
startedAt / completedAt / status
application commit or build identifier when available
fixture, prompt, schema, scoring, and policy versions
network name, chain ID, token and wallet contract addresses
synthetic changed input or explicitly consented redacted description
validated extraction references
deterministic evaluation and public explanation
complete public policy and decision hash
approval and contribution transaction references
execution attempts with exact evidence classification
successful payment receipt and decoded event
refund transaction references and final accounting
per-flow Kiln calls and usage with completeness indicators
measurement limitations and unresolved blockers
```

### 15.2 Correlation and Integrity

Link `runId -> evaluationId -> decisionId -> decisionHash -> executionAttemptId -> txHash`. Provider requests also carry local correlation IDs and provider IDs where available.

For every claimed successful payment, verify receipt status, chain, contract address, decoded decision ID, merchant, amount, and matching application history. Preserve block number/hash and log index. Explorer links are useful when supported; local devnets should provide downloadable receipts instead of invented explorer links.

The evidence page must show incomplete records as incomplete. A transaction hash string is not proof of success without its receipt. A database approval count is not proof of chain authorization.

### 15.3 Logging Boundaries

General logs may contain IDs, status, sanitized errors, durations, and public transaction information. Private extraction payloads belong in protected storage, not general logs. API keys, session cookies, invitations, private keys, and authorization headers must never appear in evidence exports.

## 16. Verification Plan

### 16.1 Contract Tests

| Area | Required checks |
| --- | --- |
| Creation | Valid policy; duplicate ID; invalid addresses; duplicate participants; wrong threshold; past expiry; inconsistent amount/caps/funding |
| Approval | Member only; correct expected hash; exact contribution; duplicate approval blocked; allowance failure leaves state unchanged |
| Activation | First through fifth contributions remain funding; sixth valid contribution activates exactly once |
| Authorization | Non-executor blocked; payment before activation blocked; wrong decision blocked |
| Spending | Valid payment succeeds; wrong merchant rejected; excessive deposit rejected; incorrect exact amount rejected; second payment rejected |
| Expiry | Allowed before expiry; rejected exactly at and after expiry; expiry finalization enables refunds |
| Cancellation | Participant veto before payment; outsider blocked; cancellation after completion blocked |
| Refund | Baseline 2.5 each; B scenario 4 each; partial-funding full refund; deterministic remainder; duplicate claim blocked |
| Isolation | Two funded decisions cannot spend or refund each other's balance; unsolicited transfer creates no credit |
| Transfer failure | Failed payment/refund reverts accounting changes; reentrancy cannot duplicate payment or claim |
| Hashes | Solidity and TypeScript agree; changing any policy field changes the hash |
| Invariants | Spending never exceeds either applicable cap; spent plus refunded never exceeds contributions; total entitlements equal remainder |

Use unit tests for explicit errors and fuzz/invariant tests for accounting and call sequences. Since the MVP permits only one payment, prove cumulative-spend safety through invariants rather than adding unsupported multi-payment behavior solely for testing.

### 16.2 Decision and API Tests

- Baseline selects A; lower budget selects B; excluding A selects B.
- Unknown non-negotiable metadata fails closed.
- Empty eligible sets return `NO_MATCH` without a policy.
- Equal scores follow documented tie-breakers.
- Zero soft weights, unsupported fields, malformed JSON, and ambiguous inputs are handled explicitly.
- Private data cannot be read by changing participant/group IDs.
- Shared responses and evidence exports exclude sensitive constraints.
- Stale revisions cannot become current proposals.
- Missing provider usage remains unknown and retries are separately counted.
- Chain-event replay does not duplicate approvals, contributions, or refunds.
- Successful chain execution with a failed database write is recovered by reconciliation.

### 16.3 End-to-End Tests

Use six isolated browser sessions or equivalent authenticated clients. Cover input, confirmation, policy review, wallet contribution, invalid request, valid payment, and refunds. Run the two changed-condition scenarios as full lifecycles. Include a wallet rejection, provider timeout, RPC failure, expired decision, and a reload during pending confirmation.

Unit tests may mock Kiln for deterministic assertions. Final acceptance evidence must use live Kiln and actual chain transactions. Development mock results must not be mixed into the accepted live-run totals.

### 16.4 Completion Gates

Do not call a stage complete based only on a screenshot. Contract behavior requires tests/receipts, AI participation requires actual provider records, and privacy requires access-control checks. Record commands and actual results as implementation progresses. Foundation checks do not establish that the application or contract acceptance criteria pass.

## 17. Configuration and Operational Setup

### 17.1 Proposed Environment Variables

```dotenv
KILN_API_KEY=
KILN_BASE_URL=
KILN_MODEL=qwen3-32b
DATABASE_URL=
SESSION_SECRET=
APP_ORIGIN=
CHAIN_ID=11155111
RPC_URL=
GROUP_WALLET_ADDRESS=
MOCK_USDC_ADDRESS=
AGENT_EXECUTOR_PRIVATE_KEY=
DEPLOYER_PRIVATE_KEY=
DEMO_PARTICIPANT_1_PRIVATE_KEY=
DEMO_PARTICIPANT_2_PRIVATE_KEY=
DEMO_PARTICIPANT_3_PRIVATE_KEY=
DEMO_PARTICIPANT_4_PRIVATE_KEY=
DEMO_PARTICIPANT_5_PRIVATE_KEY=
DEMO_PARTICIPANT_6_PRIVATE_KEY=
DEMO_MODE=false
KILN_MOCK_MODE=false
CHAIN_CONFIRMATIONS=
```

Keep all secret values empty in `.env.example`; the public `CHAIN_ID` is set to `11155111`. Deployment and demo participant keys are script-only and must not be loaded into the browser or unnecessarily deployed with the web server. The runtime executor uses a dedicated test key with only its intended role. Browser-facing chain metadata may be provided through a validated public configuration response; never expose the RPC credential if it is private.

### 17.2 Setup Sequence

The presentation machine is a MacBook. Shared scripts must work in macOS Terminal and must not depend on PowerShell, Windows paths, or copied Windows binaries. Install dependencies natively from the shared lockfile. Foundation CI covers macOS arm64 and Intel, Linux, and Windows. Add app build, contract, and demo checks as those implementations become available. Verify the full live workflow on the actual MacBook before submission; hosted foundation CI alone is insufficient.

1. Initialize the repository and select one package manager and lockfile.
2. Scaffold the web application and pin the dependency/tool versions used by the team.
3. Establish database migrations, shared schemas, and environment validation.
4. Install the chosen Solidity toolchain and verify it in the actual development environment.
5. Run contract tests locally and deploy mock token plus escrow to Ethereum Sepolia.
6. Export deployment addresses, ABI, chain ID, merchant map, and deployment transaction references.
7. Configure live Kiln credentials and confirm its actual response/usage format.
8. Start the application, run preflight, and complete the three acceptance scenarios.
9. Generate sanitized evidence and update README with actual values.

### 17.3 Command Contract to Implement

Currently available: `pnpm typecheck`, `pnpm test`, `pnpm format`, `pnpm format:check`, `pnpm check`, `pnpm contracts:build`, `pnpm contracts:test`, `pnpm contracts:abi`, `pnpm deploy:sepolia`, `pnpm mint:mock`, `pnpm demo:wallets`, and `pnpm demo:fund`. `pnpm check` combines type checking, formatting checks, and foundation tests. Install with `pnpm install --frozen-lockfile` using Node.js 24.19.0 and pnpm 11.19.0. Contract commands require Foundry v1.8.3; live deployment and minting require an RPC and funded deployer. The web app and live integrations are still pending.

The table below is the remaining target command contract. `test` and `typecheck` currently cover the foundation and deployment scripts; contract checks have separate implemented commands:

Additional implemented blockchain preparation and rehearsal commands are
`pnpm demo:roles`, `pnpm demo:fund-executor`, `pnpm demo:preflight`,
`pnpm demo:gas-topup`, and `pnpm demo:chain`. See `docs/CHAIN_REHEARSAL.md`
for the completed baseline, read-only verification, and exact resume behavior.

| Script | Intended behavior |
| --- | --- |
| `dev` | Start the web application |
| `build` | Produce the deployable application build |
| `lint` | Run configured lint rules |
| `typecheck` | Validate TypeScript contracts |
| `test` | Run decision and application tests |
| `test:e2e` | Run browser integration tests |
| `db:migrate` | Apply versioned migrations |
| `demo:preflight` | Validate configuration and external prerequisites |
| `demo:baseline` | Run the baseline with evidence |
| `demo:conditions` | Run baseline plus both changed-condition scenarios |

## 18. Implementation Sequence and Integration Gates

### Phase 0: Freeze the Shared Contract

Agree on the chain, database, toolchain, API schemas, policy fields, fixture table, and privacy rules. Produce validated shared types and hash test vectors. Keep all work unassigned until a contributor claims it.

Exit gate: another contributor can implement against the documented interfaces without guessing amounts, identity rules, or status meanings.

### Phase 1: Establish the Two External Paths

Build a minimal real Kiln extraction call with usage logging and a tested local contract lifecycle. Verify the API and chain prerequisites early.

Exit gate: real structured Kiln output is stored with truthful usage metadata; contracts pass core funding/payment/refund tests.

### Phase 2: Build the Deterministic Core

Implement fixtures, schema confirmation, filtering, scoring, immutable policy construction, and database records. Add the three scenario expectations and no-match behavior.

Exit gate: fixed confirmed inputs reproducibly select A/B/B, and changed policy fields invalidate the previous hash.

### Phase 3: Complete One Vertical Flow

Connect private input, proposal review, browser wallet contributions, agent execution, chain reconciliation, and refunds. Use shared modules in both UI and scripts.

Exit gate: baseline completes with real Kiln calls, a rejected invalid request, a successful payment transaction, and six refunds.

### Phase 4: Prove Changed Conditions and Failure Handling

Run the lower-budget and changed-merchant lifecycles. Add cancellation, expiry, authorization checks, and recovery from pending transactions or provider failures.

Exit gate: all three runs have correlated evidence, and private input access checks pass.

### Phase 5: Prepare the Submission

Finish `/evidence`, README, sanitized run exports, deployment instructions, and the short demo narrative. Rehearse against the exact deployed build and network.

Exit gate: a reviewer can inspect real usage, chain enforcement, condition changes, and refunds without relying on unsupported claims.

Prioritize real Kiln integration, chain enforcement, funding/refunds, and reproducible evidence over visual polish. Privacy access controls and fund recovery are baseline requirements, not optional polish.

## 19. Self-Assignment Task Register

No person was preassigned a role or task in the initial plan. Sage has since claimed the blockchain contract and deployment tasks below. The Owner cell records a person's name; the Status cell records progress. Reviewer cells remain blank until someone accepts a review. A contributor claims another task by writing their own name, updating the status, and linking the implementation artifact when available. Claiming a task does not assign that person every task in the same area.

Use `Unclaimed`, `Claimed`, `In progress`, `In review`, `Blocked`, or `Done`. If multiple people collaborate on one task, list their names only after they agree. A reviewer adds their own name when accepting the review. Keep dependencies visible and document blockers with the exact missing input or prerequisite.

| ID | Work item | Deliverable and completion criterion | Depends on | Owner | Reviewer | Status |
| --- | --- | --- | --- | --- | --- | --- |
| T01 | Project scaffold | Tooling, lockfile, CI, and env template ready; Next.js app scaffold and app lint/build remain | None | | | In progress |
| T02 | Shared schemas | Primitives, extraction, statuses, public participant, errors, and usage ready; full group/candidate/policy/execution/evidence schemas remain | T01 | | | In progress |
| T03 | Policy encoding | Final ABI field order and cross-language hash test vectors | T02 | Sage | | In review |
| T04 | Mock token | Six-decimal mock token and restricted demo deployment configuration | T01 | Sage | | In review |
| T05 | Escrow core | Creation, membership, funding, activation, and immutable policy | T03, T04 | Sage | | In review |
| T06 | Payment enforcement | Shared validation, custom errors, one-payment execution, events | T05 | Sage | | In review |
| T07 | Cancellation and refunds | Partial funding recovery, expiry, terminal entitlements, repeat-claim prevention | T05, T06 | Sage | | In review |
| T08 | Contract verification | Unit and invariant tests for the Section 16 contract matrix | T05-T07 | Sage | | In review |
| T09 | Database and migrations | Core entities, revisioning, unique event identities, integer amounts | T02 | | | Unclaimed |
| T10 | Identity and privacy | Wallet-bound sessions, invitations, scoped reads/writes, privacy tests | T09 | | | Unclaimed |
| T11 | Kiln adapter | Implemented server-side `qwen3-32b` adapter; two live synthetic extractions passed; app integration pending | T02 | | | In review |
| T12 | Usage and efficiency | Per-attempt usage implemented with null unknowns; persistent per-flow aggregation, cache accounting, and efficiency comparison pending | T09, T11 | | | In progress |
| T13 | Restaurant fixtures | Five versioned synthetic candidates implemented with merchant A-E mapping and explicit unknown safety metadata | T02 | | | In review |
| T14 | Decision engine | Offline A/B/B, no-match, confirmation gates, public projection, and deterministic ties tested; API integration pending | T13 | | | In review |
| T15 | Preference workflow | Revision transitions and stale-result/confirmation/privacy unit tests implemented; authenticated APIs and PostgreSQL integration pending | T10, T11 | | | In progress |
| T16 | Explanation flow | Privacy-safe Kiln explanation and labeled deterministic fallback | T12, T14 | | | Unclaimed |
| T17 | Proposal APIs | Frozen revision snapshot and immutable policy with stale-state protection | T03, T14, T15 | | | Unclaimed |
| T18 | Group and input UI | Group creation/lobby plus private preference confirmation | T10, T15 | | | Unclaimed |
| T19 | Results and policy UI | Candidate outcomes, no-match state, complete spending-policy review | T16, T17 | | | Unclaimed |
| T20 | Deployment | Real contract addresses, ABI export, chain config, receipt metadata | T08 | Sage | | In review |
| T21 | Wallet contribution UI | Account/network checks, allowance step, confirmed contribution progress | T19, T20 | | | Unclaimed |
| T22 | Agent execution | Bounded executor requests, idempotency, invalid/valid attempt records | T06, T12, T17, T20 | | | Unclaimed |
| T23 | Chain reconciliation | Receipt/event ingestion, restart recovery, no duplicate credit | T09, T20 | | | Unclaimed |
| T24 | Execution and refund UI | Policy enforcement display, transaction history, claims and settlement | T07, T21-T23 | | | Unclaimed |
| T25 | Evidence view/export | Run comparison, per-flow usage, real receipts, redacted artifacts | T12, T23, T24 | | | Unclaimed |
| T26 | Baseline demo script | Direct-contract payment/refund rehearsal verified in `docs/evidence/baseline-001.json`; real Kiln and full application workflow remain | T15, T17, T20, T22, T23 | | | Unclaimed |
| T27 | Changed-condition scripts | Complete lower-budget and changed-merchant runs with comparison | T26 | | | Unclaimed |
| T28 | Integration and privacy QA | Cross-session tests, failure recovery, access-control verification | T18-T27 | | | Unclaimed |
| T29 | README and submission | Accurate setup, architecture, evidence, limitations, prior-work disclosure | T25-T28 | | | Unclaimed |
| T30 | Final rehearsal | Reproducible deployed demo and recorded actual test outcomes | T29 | | | Unclaimed |

### 19.1 Task Handoff Template

```text
Task ID:
Owner:
Reviewer:
Status:
Implementation link:
Interfaces added or changed:
Verification performed:
Evidence location:
Known limitations:
Blocker and required input:
Next integration step:
```

### 19.2 Collaboration Rules

- Claim work before making substantial overlapping changes.
- Freeze shared schemas and ABI before connecting independently developed modules.
- Propose interface changes explicitly and update affected tests and consumers together.
- Keep PRs scoped to a reviewable outcome and describe actual verification.
- Never commit credentials, private participant inputs, or unsanitized provider logs.
- Do not mark a task done when it only works with unlabelled mocks.
- Keep ownership self-selected; an area heading does not assign a permanent lead.

## 20. README and Submission Checklist

The initial `README.md` is intentionally a draft. It describes planned behavior and now records verified deployment addresses and transaction hashes. Kiln usage, acceptance-run transactions, energy measurements, and final team contributions remain pending. Update the README throughout implementation and complete it after the three acceptance runs. Do not leave planned values presented as measured results. Keep its selected-function sentence unchanged unless the actual product function changes.

The final README should contain:

1. Converge and the exact selected-function sentence.
2. Intended users, problem, and one supported scenario.
3. Demo instructions and actual outcome screenshots or recording.
4. Architecture and AI/application/contract responsibility boundaries.
5. Kiln model, flows, usage by flow, and inference-efficiency decisions.
6. Energy disclosure and any clearly labeled estimate assumptions.
7. Chain/network, contract addresses, deployment metadata, real payment transactions.
8. Baseline and two changed-condition experiment results.
9. Privacy model, public chain data, and off-chain trust limitations.
10. Contract spending controls, cancellation, refunds, and one-payment restriction.
11. Setup, environment variables, exact runnable commands, and tested tool versions.
12. Actual test results and remaining blockers.
13. Pre-built versus hackathon-built work, supported by available records.
14. Team contributions based on actual self-assigned completed work.

No Git history was available during this review. Do not infer that every future file was written during the hackathon. Record starting assets, libraries, templates, and the actual development timeline when the repository is initialized.

## 21. Definition of Done

- [ ] A user can create a group and at least six participants can join through verified identities.
- [ ] Private input and structured constraints are inaccessible to other participants.
- [ ] Live Kiln `qwen3-32b` parses actual submitted preferences.
- [ ] Parsed output is schema-validated and participant-confirmed.
- [ ] Deterministic evaluation selects A/B/B for the defined fixture scenarios.
- [ ] No-match and unresolved-constraint cases cannot create a fundable policy.
- [ ] Shared explanations do not expose private restrictions by default.
- [ ] Every participant reviews the same complete immutable financial policy.
- [ ] Solidity and TypeScript produce matching policy hashes.
- [ ] Six unique approved contributions activate the decision on-chain.
- [ ] Invalid amounts, recipients, callers, states, and expired policies cannot move funds.
- [ ] The invalid baseline attempt records `MAX_DEPOSIT_EXCEEDED` accurately.
- [ ] A real valid payment succeeds with a receipt and matching event/history entry.
- [ ] A second payment cannot bypass the single-payment rule.
- [ ] Participants recover the correct unused balance without duplicate claims.
- [ ] Cancellation and expiry return funds even if only one or two people contributed.
- [ ] Concurrent decisions have isolated accounting.
- [ ] Usage is reported by flow with retries, cache hits, and unknown metrics distinguished.
- [ ] Baseline plus two changed-condition full runs produce correlated evidence.
- [ ] The changed-merchant run records `MERCHANT_NOT_ALLOWED` before its valid payment.
- [ ] `/evidence` contains sanitized real records and truthful completeness indicators.
- [ ] Contract, application, privacy, and appropriate end-to-end checks pass.
- [ ] Pending transactions and interrupted database writes can be reconciled safely.
- [ ] README has actual run instructions, actual deployment values, and accurate disclosure.
- [ ] All three complete acceptance runs have been rehearsed on the presentation MacBook, with OS/architecture, tool versions, browser/wallet, commit, network, and evidence recorded.
- [ ] No API keys, wallet secrets, fabricated transactions, or fabricated measurements are committed.

## 22. Open Prerequisites

These prerequisites are tracked separately from completed integration work. Resolve remaining items during setup and record the outcome; a configured RPC or contract deployment does not imply the application is complete.

| Prerequisite | Current status | Required resolution |
| --- | --- | --- |
| Kiln endpoint and authentication details | Official endpoint verified by two successful live extraction calls | Recheck credentials on the demo MacBook; see `docs/KILN.md` |
| Kiln API key and model availability | `qwen3-32b` verified; project owner reported updated model announcement on September 29, 2026 (KST) | Use this model throughout; original pasted competition brief is historical, not the current model requirement |
| Provider usage and NPU metrics | Token counts, cached/reasoning tokens, latency, and USD cost captured; energy unavailable | Keep unknown energy null; do not claim measured NPU efficiency without evidence |
| Selected chain and RPC | Ethereum Sepolia `11155111`; public PublicNode endpoint configured locally and genesis verified for deployment | Recheck RPC availability and chain identity on the demo MacBook |
| Funded deployer/executor/participant accounts | Deployer, dedicated executor, and six single-operator demo accounts funded; public manifests record allocations and the A-E merchant map | Run `pnpm demo:preflight --check-signers` on the MacBook before rehearsal |
| Runtime and persistent database | Neon Free project linked; no-change config plan verified; deploy blocked by CLI authentication rejection | Reauthenticate, finish `docs/DATABASE_SETUP.md`, configure server-only connection strings, and verify migrations and access controls |
| Solidity toolchain | Foundry v1.8.3 verified on Windows; presentation MacBook pending | Run the contract suite on the actual MacBook |
| Event date and demo expiry | Run-dependent | Use explicit future values and test expiry boundaries |
| Submission timing and prior-work records | Not supplied | Confirm organizer rules and document actual work history |

The verified contract addresses and deployment transaction hashes are recorded in `contracts/deployments/11155111.json`. A completed blockchain-only baseline, including decision/payment/refund transactions, is recorded in `docs/evidence/baseline-001.json`; it does not complete the full application acceptance runs. Keep missing acceptance evidence, inference token counts, and energy values explicitly marked as pending. Replace them only with captured evidence.
