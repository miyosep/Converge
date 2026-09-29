# UI direction

Use the existing root `app/` and light workspace styling. PR #3 is a reference for information layout only; do not merge its `src/app/`, framework configuration, global theme, or mock results wholesale.

## Group workspace and Explore Demo

- `/group/new` redirects to `/discover`: English requests and a category drive Qwen tool calling and xAPI search for all five venue categories. Display source links, unknown conditions and up to five comparison selections. Sign-in stays on this page without losing the request.
- `/demo/catalog` retains the 200 fictional examples and the existing group creation flow. Live search never substitutes these examples when a provider fails.
- The hackathon assumes live candidates can be reserved with USDC; omit availability checks and label the assumption. Discovery currently does not create payment policies or merchant registrations.

- `/` and `/api/groups` serve ordinary groups with independently controlled participant wallets and private persisted preferences.
- `/demo` and `/api/demo` serve the guided session with one user and five automated participants, synthetic restaurants, and bounded test funding. Keep the demo disclosure visible.
- Share presentation components where useful, but do not share group IDs, demo session state, automated participation, or funding actions between these flows.
- Only display results supplied by the relevant flow. Ordinary group results, approval, execution, and evidence views require their own authorized APIs before they can show data. Do not substitute demo outcomes for missing group functionality.
- Candidate comparisons must use public evaluation projections. Do not expose private rejection reasons or participant constraints in a shared result table.
- Evidence views must distinguish synthetic data, simulation/read-only checks, pending transactions, reverted transactions, and confirmed receipts. Missing records remain missing.

## Adopted references

PR #3 informed the structured condition review, submitted/confirmed progress, candidate comparison table, and explicit policy/allowance explanation. Current values come from existing preference, evaluation, and policy responses; PR sample values are not used.

## Implemented ordinary-group routes

| Route                     | UI and data                                                                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                       | Authenticated group list, empty/loading/retry states, and create-group navigation                                                                                                                  |
| `/group/new`              | Redirect to `/discover` |
| `/discover`               | Live five-category search, wallet sign-in, clarification, source evidence and comparison; provider failures remain visible |
| `/demo/catalog`           | Archived wallet-authenticated group creation using fictional examples |
| `/group/[id]`             | Member lobby, confirmation progress, and workflow navigation                                                                                                                                       |
| `/group/[id]/preferences` | Existing private input, extraction review, correction, confirmation, and invitations                                                                                                               |
| `/group/[id]/results`     | Run evaluation after six confirmations; saved candidate comparison and no-match correction                                                                                                         |
| `/group/[id]/approve`     | Prepare/retrieve an immutable policy; inspect addresses, amounts, wallets, expiry and hash                                                                                                         |
| `/group/[id]/execution`   | Member-only saved chain snapshot, receipt-backed event history, payment status, and refund actions when the worker has synchronized the policy                                                     |
| `/evidence`               | Three correlated synthetic live group records with finality labels, Kiln usage, access/recovery facts and Sepolia receipts; older smoke, blockchain-only and deterministic records remain separate |

`GET /api/groups` lists only groups belonging to the authenticated wallet. `GET /api/groups/:id/overview` requires membership and returns group metadata, participant progress, and an allowlisted saved evaluation. It never returns raw preferences, participant-specific failure reasons, or the private evaluation snapshot.

Ordinary-group evaluation and immutable policy preparation are now connected. `POST /api/groups/:id/evaluate` accepts an empty body and evaluates six confirmed revisions using server-owned catalog and limits. A proposal freezes preferences; no match allows correction and reconfirmation. Changed revisions hide stale results. `POST /api/groups/:id/decisions` saves one immutable policy from the frozen snapshot. Both operations require same-origin requests and authenticated membership; repeated requests return saved results. The approval page displays the policy addresses, amounts, six wallets, expiry, and hash.

The approval page connects on-chain registration, participant token allowances and contributions, cancellation, and refund claims. `GET /api/groups/:id/chain` requires membership and verifies state at one canonical block with two confirmations. Policy preparation itself sends no transactions. An opt-in worker can execute an eligible payment and persist receipt-checked events; `GET /api/groups/:id/history` and the execution page show the saved result to members. A missing worker snapshot remains visibly incomplete. The catalog and Sepolia MockUSDC deployment remain test infrastructure; ordinary groups use their own wallets without demo sessions or automated funding. The published evidence screen is not a live group or Explore Demo record. See [the wallet workflow](WEB_APP.md#ordinary-group-wallet-actions).

Apply `pnpm db:migrate:dev` on the isolated `dev-preferences` branch before using policy, execution, explanation, and group merchant conditions (migrations 0005-0008). With the local server running, `node --env-file=.env.development --import tsx scripts/group-workflow-rehearsal.ts` verifies synthetic ordinary groups, no-match correction, policy idempotency/immutability, privacy, and authorization. Its sanitized report is `docs/evidence/group-workflow-dev.json`; it makes no AI calls or chain transactions.

Verification: production build; UI projection/render regressions for privacy, score scaling, group-specific links, and unavailable records; read-only queries against the existing development database; browser checks at desktop and 390px mobile width. Authenticated layouts were also rendered with isolated synthetic fixtures for visual review, without a production mock mode.
