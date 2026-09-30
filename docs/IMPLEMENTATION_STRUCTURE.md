# Converge implementation structure

Last updated: 2026-09-30.

## Authority and maintenance

Read [PRODUCT_RULES.md](PRODUCT_RULES.md) and [AGENTS.md](../AGENTS.md) first. This document records implementation structure and decisions; it is not evidence of a successful production payment. Update it in the same change as any design or structure change. Preserve technical privacy, authentication and contract invariants in project_guideline.md.

### Owner-confirmed requirements

- Collect all group opinions before searching; Qwen selects one shared proposal from internal xAPI candidates.
- My plans serves actual friends. Explore demo serves one human and five automated participants.
- Only indispensable safety/access needs are Required; ordinary preferences and budgets are Preferred. A confirmed allergy blocks automated planning under the latest owner decision.
- Each real participant separately agrees and authorizes payment.
- No manual payment amount or recipient forms. Preserve the My plans photo welcome even when saved plans exist.
- Friends use Sepolia test payments with a server-configured test recipient. Derive the amount from restaurant pricing or confirmed budgets; collect a 30% partial deposit. Never automatically collect the remaining 70%.

### Agent implementation choices

Price-source precedence, supported parsing formats, range upper bounds, lowest-budget selection, FX provider/freshness and rounding below are implementation choices. They are documented for review, not attributed to the owner as separately requested requirements. Change them explicitly when needed and update code, tests and documents together.

## Runtime responsibilities

| Component           | Responsibility                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Vercel web/API      | UI, wallet authentication, authorized group actions, interactive friends interpretation/search and payment preparation |
| Neon Postgres       | Durable groups, private preferences, revisions, agreements, policies, jobs and transaction state                       |
| Always-on PC worker | Demo orchestration, test funding, permitted execution and transaction reconciliation                                   |
| Qwen through Kiln   | Interpret preferences, combine all opinions and choose one supplied candidate                                          |
| xAPI                | Search real places and provide source evidence                                                                         |
| Sepolia contracts   | Enforce immutable policy terms, contributions, bounded payment and claimable refunds                                   |

Users never manage the worker. Credentials and signing keys remain server/worker-side. Follow PRODUCT_RULES checkout boundaries; the Desktop checkout is not the editing or deployment checkout.

## Friends: state and selection

The groups action API, `src/lib/db/live-plans.ts` and `app/components/live-group-panel.tsx` coordinate the flow:

1. Authenticate membership and store private preferences with revisions.
2. Each member confirms their own interpretation. Wait for all expected members.
3. Aggregate all confirmed opinions, search internal candidates and ask Qwen for one choice.
4. Validate member coverage and the chosen place ID against supplied candidates. Do not use the first result as a fallback.
5. Publish one proposal and collect individual agreement for the current recommendation revision.
6. Prepare immutable payment terms only after unanimous agreement; each wallet approves separately.

Membership, preference and search changes invalidate stale agreements. Legacy multi-candidate results require a fresh single-proposal search, not a radio list or CSS hiding. Ready/payment paths require exactly one proposal.

### Evidence, privacy and failure states

- `choicePlaceIdSchema` permits a null choice only when every candidate has explicit conflicting evidence. Unknown evidence cannot itself justify rejecting every place. Invalid model output fails validation rather than becoming a fabricated safety conflict.
- An explicit allergy now blocks the whole group before search; unknown menu/access facts for other groups remain verification items. A provisional proposal is not a claim of verified safety.
- `publicReasonsSchema` and `publicChoiceExplanation` map allowlisted reason codes to neutral public text. Raw model rationale must not expose an individual's private preferences or health information.
- Recommendation states distinguish idle, searching, ready, empty, blocked and failed. Persisted search token/start time drive the active-search projection, with a 240-second window. Hide stale no-result/conflict messages while searching.
- Provider failure, no search results and genuine indispensable incompatibility are different outcomes. Do not label them all as conflicting preferences.

## Friends: automatic payment preparation

`LivePaymentSetup` is a continuation to approval, not a configuration form. The browser submits the place ID, recommendation revision and acknowledgement. `automaticGroupPaymentTerms` in `src/lib/server/group-config.ts` rejects client-supplied amounts/recipients and supplies the configured test recipient (`GROUP_TEST_PAYMENT_RECIPIENT`, with the configured Sepolia merchant A fallback).

The repository checks organizer authority, membership, confirmed revisions, the single current proposal and unanimous agreement transactionally. Existing immutable policy terms are returned unchanged; a new calculation rule does not rewrite them. The server recipient is a test recipient, not proof of a restaurant wallet or real reservation.

### Price basis and 30% calculation

`src/lib/discovery/deposit-estimate.ts` implements:

1. Prefer a usable selected restaurant price. If unavailable, parse confirmed budget requirements and choose the lowest group-equivalent USD budget.
2. Preserve currency and per-person/group units. A price range uses its upper bound and is explicitly labelled an estimate, not an exact quote.
3. Recognize USD, KRW, EUR, GBP and JPY and their supported symbols/aliases. Require one currency and an unambiguous positive amount or numeric range. Reject ambiguous extra numbers, abbreviated amounts and hourly/nightly/monthly/annual pricing. Explicit total/group/altogether means group; otherwise a supported price is treated as per-person.
4. Multiply a per-person basis by actual group size; do not multiply a group total again.
5. USD uses rate 1. Other currencies use a dated Frankfurter currency-to-USD rate, with an 8-second timeout. Validate currency pair, positive rate and date: no older than seven days and no more than one day ahead. Only public currency identifiers go to the rate service.
6. Calculate the group deposit as 30% of the USD-equivalent group basis. Use integer arithmetic, six-decimal token precision and a twelve-decimal exchange rate; round the group deposit upward to a token base unit. Existing exact-share splitting preserves the group total.
7. Map USD-equivalent values to MockUSDC for this test only. Do not collect the remaining 70% automatically.

Missing/ambiguous basis returns `PAYMENT_BASIS_MISSING`; unavailable or stale FX returns `PAYMENT_RATE_UNAVAILABLE`. Do not invent an amount/rate or restore a payment configuration form. A missing budget can be corrected through the existing preference review flow.

Examples: $30 per person for two people produces an $18 group deposit and $9 each. A KRW range is an estimate and requires a verified conversion rate, not a 1:1 KRW-to-MockUSDC mapping.

### Stored calculation snapshot and review

`DepositEstimate` records `percent`, `source`, `currency`, `basisAmount`, `unit`, `rangeUpperBound`, `usdRate`, `rateDate` and calculated group `amount`. New payment snapshots preserve this alongside the immutable policy. Sources are `restaurant_price` or `confirmed_budget`.

`app/components/group-policy-panel.tsx` shows the prepared individual share, group total, basis/source, estimate status, 30%, applicable exchange rate/date and test-payment status before wallet approval. Old policies without this optional snapshot remain readable; never backfill them with newly calculated monetary terms.

The worker funds actual policy shares where applicable. Funding assistance never signs a human's consent. Journal transactions and reconcile retries so a pending transaction cannot create duplicate payment.

### Wallet progress and bounded reads

`GroupChainPanel` distinguishes sign-in/account checks, network switching, policy/gas checks and the final wallet confirmation request. Show the current stage beside the action, with additional guidance after 30 seconds in a stage. Do not assume a disabled registration button means a wallet popup is open: preflight reads happen before signing.

`withWalletReadTimeout` bounds allowlisted read-only wallet RPC calls to 20 seconds; auth/chain HTTP reads also have a 20-second limit. Disable automatic transport retries in this panel. A timed-out read cannot submit a transaction, and a subsequent action rechecks current policy/account/network state. Signing, transaction submission and network-change prompts are never abandoned by this timeout or automatically retried. Persist submitted hashes and reconcile receipts as before; waiting for a receipt is not permission to resend.

Keep wallet errors visible across background status polling, distinguish cancellation and an already-open wallet request, and explain automatic test funding consistently. These limits/progress stages are implementation choices, not changes to authorization or contract terms.

### Server preflight before browser signing

Friends actions POST to `/api/groups/:groupId/chain-transaction` with only the action and expected policy hash. Require the same-origin JSON request, authenticated membership and the current saved hash. `prepareGroupChainAction` uses the configured server RPC to read canonical state, validate action eligibility, estimate gas and simulate the transaction. Return state and the bounded gas estimate; never sign, broadcast or mutate payment terms. RPC details/credentials are not returned. The browser allows 60 seconds for this read-only preparation.

The browser independently encodes transaction destination/calldata from its saved immutable policy and the verified actor/state. It validates the gas bound, rechecks wallet account and Sepolia, then requests MetaMask approval. Do not perform the full contract-reading preflight through an injected wallet provider: server RPC success does not imply the extension's RPC handles contract errors identically. Browser submission/receipt tracking and separate human approval remain mandatory. Tests of server simulation do not establish that a user's wallet popup or transaction succeeded.

## Demo separation

Explore demo retains one real user plus five distinct automated wallets/opinions. All six opinions feed the shared decision. The user signs only for themselves; automation handles the five disclosed demo accounts. Keep the explicit Take a seat start screen and repeat-session history/refund rights.

Preference importance, unknown-evidence handling and public rationale privacy apply to both flows. The new 30% calculation described here is implemented for My plans/friends; it does not silently change demo fixture terms. Demo terms must still be disclosed as test terms before approval, without manual setup forms. Never claim both paths were changed when only one was verified.

## UI responsibilities

| Surface          | Responsibility                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Home             | Keep wallet connection on Home; Start a plan enters planning                                            |
| PlansOverview    | Persistent photo welcome, original copy/CTA and pointer interaction; saved plans below it               |
| LiveGroupPanel   | Private preference editor, group readiness, one proposal, individual agreement and payment continuation |
| LivePaymentSetup | Continue to automatically prepared terms; no amount/address fields                                      |
| GroupPolicyPanel | Exact terms, individual wallet actions, truthful transaction progress and refund actions                |
| Explore demo     | Explicit welcome, guided six-participant decision, approval and outcome/refund                          |

Use Home/My plans styling, concise copy and existing approved visuals. Keep implementation details out of normal user flows unless they affect an informed decision.

## Change and verification checklist

- Record the changed flow, data/API structure, invariants, errors, retries, privacy and compatibility here.
- Separate owner decisions from implementation assumptions; identify unresolved choices.
- Check all affected friends, demo, server and worker paths; preserve immutable financial state.
- Update focused tests for meaningful behavior and run relevant type/format checks.
- State whether verification was local, mocked, provider-backed or an actual production wallet transaction. A successful build/deployment is not payment verification.
- Commit and deploy using the prescribed worktrees; preserve Desktop files, worker configuration and unrelated changes.

## Reported-allergy stop rule (supersedes alternative-venue behavior)

Friends and demo interpretation request a private `hasAllergy` boolean and preserve the reported allergy as a Required condition. The field is optional for compatibility with old saved extractions. `hasReportedAllergy` accepts a positive flag and also detects explicit allergy text in older confirmed requirements, excluding absence statements. Do not infer an allergy from a dislike or non-allergic intolerance.

`recommendForGroup` returns no places and a neutral blocking message before calling the search planner or xAPI. Both friends and demo use this gate. `chooseDemoPlace` also rejects allergy-bearing input before selection for previously obtained candidates. Friends repository `prepare` rejects new payment terms with `ALLERGY_REPORTED`, so a historical proposal cannot bypass the rule. Previously saved immutable policies are returned unchanged; do not rewrite approvals, completed payments or refund rights. No private member/allergen details are returned in the group message.
