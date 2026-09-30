# Converge product rules

Status: mandatory product contract, confirmed by the owner on 2026-09-30.

## Authority

Read this document before project work. Root AGENTS.md establishes it as a standing instruction for coding agents. The owner's latest explicit decisions supersede this document; update the contract and affected implementation together when decisions change.

This is the source of truth for current product behavior, not evidence that everything has been verified in production. Historical specifications, fixtures, screenshots and acceptance records do not override it. project_guideline.md remains the technical specification for privacy, authentication, contracts and execution. Identify unresolved conflicts instead of inventing a new product flow.

## 1. Core flow: one group, one shared proposal

1. Collect every participant's private preferences.
2. Qwen interprets them; each participant reviews and confirms their own interpretation.
3. After all expected members join and confirm, Qwen combines everyone's opinions.
4. xAPI searches real places.
5. Qwen compares the internal candidates and selects exactly ONE shared place, with a concise rationale and unverified facts.
6. Show that one proposal. Each member agrees separately.
7. Present exact payment terms. Each member separately authorizes and contributes with their wallet.
8. Execute only the contract-permitted payment; show the outcome and provide refund actions for claimable funds.

Candidates are internal inputs, not a list for users to browse, rank or vote among. Never implement this by taking the first result or hiding other results with CSS. Consider every member and validate that the Qwen-selected ID belongs to the supplied candidates. On failure, show a recoverable error rather than an arbitrary restaurant. Legacy shortlists need a fresh single-proposal search before new agreement/payment terms.

A group plans to eat together at one restaurant. Ordinary taste differences require compromise, not separate restaurants or a blocked search. Agreement with the proposal is separate from authorization to spend.

## 2. Required versus Preferred

| Required: indispensable safety or access                          | Preferred: negotiable wishes                                            |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Allergies and medically necessary dietary restrictions            | Cuisine, ordinary food likes/dislikes and non-medical diet preferences  |
| Accessibility essential for a member to use the venue             | Atmosphere, quietness, parking, location wishes and seating preferences |
| Other explicitly established needs of the same indispensable kind | Budget targets AND ceilings, even when expressed strongly               |

Words such as must, only, never or need do not make an ordinary wish Required. Do not infer an allergy from a dislike, or a medical restriction from liking vegetables. Preserve amounts, units and currencies without conversion. A preferred meal budget is not authorization to charge any amount.

An allergy alone does not prevent dining together: seek an alternative that accommodates it. For example, a milk allergy means looking for dairy-free options, not abandoning the outing. Missing menu/allergen evidence must remain an explicit confirmation item on a provisional proposal, not be treated as proof that every venue is incompatible. If indispensable conditions genuinely cannot coexist, stop the proposal rather than silently relaxing them. Unknown venue evidence proves neither safety nor incompatibility. Do not claim verified allergy safety, accessibility, price or availability from incomplete listings.

Apply this rule to friends, demo interpretation, search and final selection, including older saved preference labels. Never silently rewrite approved financial policies. Actual payment terms always need explicit approval.

## 3. My plans: actual friends

- My plans is not the demo. Start a plan, save the group and invite friends before searching.
- Friends open the invitation on their own computers and connect their own wallets. Authenticate membership and keep raw preferences and interpretations private.
- Wait for all expected members to join and confirm. Never add automated participants to fill missing places.
- Search, select one proposal, collect each member's agreement, then set and review exact payment terms.
- Current payments use Sepolia MockUSDC. Do not show manual amount/deposit or test-recipient inputs, or a Set payment terms form. Prepare terms from an owner-authorized server configuration or verified quote; the policy determines shares for the actual group size. Never invent a venue price or silently copy demo fixed amounts/wallets into friends. The owner authorized Sepolia test payments with a server-configured recipient, but rejected a fixed per-person amount. Derive each new decision's amount from supported selected-restaurant pricing/quotes or confirmed participant budgets. Fixed 10 MockUSDC defaults and GROUP_TEST_PAYMENT_PER_PERSON_USDC are not valid product pricing rules. Preserve currency, units and source; do not fabricate exact prices from ranges or silently convert currencies. Display the calculated total and shares, clearly distinguishing an estimate/budget-based test payment from a venue quote. The owner confirmed that only a PARTIAL reservation deposit is collected, not the full meal price or budget. Calculate that partial amount from the supported restaurant price or confirmed budget. The deposit percentage remains pending owner clarification; do not invent it or charge the remainder automatically. The organizer continues to approval without entering amounts or addresses.
- Each real member signs their own approval/contribution. Funding assistance does not grant consent.
- Membership, preference or search changes invalidate earlier proposal agreements. Changed payment terms require a new immutable decision and fresh approvals.

## 4. Explore demo: experience the product alone

- One real user plus five disclosed automated participants with preset wallets and distinct opinions.
- Use all six opinions: Qwen aggregation -> xAPI search -> Qwen selects one -> approvals/contributions -> test payment -> outcome/refunds.
- The user signs for themselves; automation handles only the five demo accounts.
- The same wallet can repeat the demo after eligible completion/cancellation or draft reset. Preserve transaction history and refund rights; never bypass pending transactions.
- Keep the Take a seat welcome until an explicit start/continue action. Explain that someone can try Converge alone; emphasize "Try Converge on your own".
- No demo access-code field or deposit-configuration form in the welcome/preference flow. Internal demo defaults are not venue quotes. Disclose actual test payment terms before wallet approval.
- Funding and execution need truthful progress, recoverable errors and idempotent processing. Pending or failed work is not complete.

## 5. Architecture

| Component           | Responsibility                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Vercel web/API      | UI, wallet authentication, authorized requests, interactive friends AI/search operations |
| Neon Postgres       | Durable groups, private preferences, revisions, agreements, jobs and transaction state   |
| Always-on PC worker | Long-running demo jobs, test funding, permitted chain execution and reconciliation       |
| Qwen through Kiln   | Interpretation, combining opinions, selecting one place and explaining the proposal      |
| xAPI                | Real place search and source data                                                        |
| Sepolia contracts   | Membership, immutable approved terms, contributions, bounded payment and refunds         |

Users must not operate or understand the worker. Keep provider credentials and signing keys on the appropriate server/worker, never in browser code or documentation. Durable jobs, leases and transaction journals must prevent duplicate payment on retry.

Current scope is simulated booking with test tokens and a test recipient. A listing does not establish real availability, booking confirmation or USDC acceptance. Never imply that a real venue has been booked or paid. Report chain success only after required confirmation/reconciliation.

## 6. Navigation and design

- Brand: Converge. Connecting a wallet leaves the user on Home; Start a plan explicitly enters planning.
- Home and My plans are the visual references: warm cream surfaces, rounded cards, dark typography, serif italic accents and brick-red primary actions. Avoid a predominantly green experience.
- Short copy without duplicate explanations. Keep infrastructure details out of normal user flows.
- Keep the connected-wallet control on Discover.
- My plans: no sidebar, rounded top navigation, title "My plans" without a period. Keep "Your people, Your next good memory." in its established right-hand position, green serif italic with a thin vertical divider.
- Persistent welcome card title: "Something good starts with a plan", with "a plan" italic. CTA: "Start a plan". Preserve the approved photo, layout and restrained pointer interaction even when saved groups exist. Show the saved plans below the welcome card, never instead of it.
- No background photo in the demo. Never turn single-place agreement into a multiple-choice interface.
- No manual payment configuration form in ANY user flow, including My plans/friend groups. Show prepared payment amounts for review at the approval stage; preserve each user's separate consent.

## 7. Checkout and deployment boundaries

- Edit: `C:/Users/kimsi/.codex/worktrees/hybrid-release-review/gwdc_furiosa`, branch `codex/repeatable-demo`.
- Deploy main checkout: `C:/Users/kimsi/.codex/worktrees/live-restaurant-search/gwdc_furiosa`.
- Preserve `C:/Users/kimsi/Desktop/gwdc_furiosa`: separate old checkout with uncommitted work. Do not reset, overwrite or consolidate it without a new explicit request.
- Preserve worker configuration and environment files. Restart only the verified relevant worker when needed, after checking active financial jobs.
- Verify changes, commit the work branch, integrate remote updates without discarding others' work, fast-forward the main checkout, push origin main, and verify Vercel success before saying deployed.
- Production: https://converge-iota-seven.vercel.app/ ; repository: miyosep/Converge.

## 8. Completion checks for affected paths

Use focused checks; do not initiate real user payments simply to test a UI change.

- [ ] Identify affected friends, demo and shared server/worker paths.
- [ ] Include all expected opinions before search; preserve privacy.
- [ ] Apply Section 2 in interpretation AND downstream selection.
- [ ] Keep candidates internal; return one validated AI-selected proposal.
- [ ] Compromise on tastes; never silently waive indispensable safety constraints.
- [ ] Require each real member's agreement and payment authorization.
- [ ] Invalidate stale agreements; preserve immutable policies and refunds.
- [ ] Handle errors, retries and legacy records without restoring obsolete flows.
- [ ] Preserve approved Home/My plans design and navigation.
- [ ] Verify relevant behavior; distinguish mocked/local/provider tests from production wallet verification.
- [ ] Update this contract and conflicting active documentation when the owner changes behavior.

A focused fix is not complete if another affected route still implements the opposite product rule.
