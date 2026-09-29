# Group diagnostics

Selected ideas adapted from [Converge PR #6](https://github.com/miyosep/Converge/pull/6): a typed diagnostic registry, public projection, deterministic analysis, and accessible recovery guidance.

The current integration uses the existing authenticated group overview in the group screens and adds diagnostics to API error responses. Existing error codes and HTTP statuses remain compatible. It adds no AI requests, database queries, automatic transaction retries, or background polling.

- Membership readiness uses the group's target size, not the number already joined.
- Preference confirmation does not imply payment approval.
- Missing evaluation means evaluation is pending; only a saved NO_MATCH result reports no eligible candidate.
- Ties require equal top eligible scores. The existing engine breaks ties by meal price, then candidate ID.
- Payment-window guidance uses the saved policy expiry. It never infers execution, failure, balances, or refund success from time alone. Refresh loads the latest snapshot; chain status remains authoritative.
- Private diagnostics are projected to generic guidance before deduplication and summary calculation. Attribution, private counts, and private severity never enter the public payload.
- Empty diagnostics do not claim that all system or chain checks passed.

The broad unused lifecycle and chain inference helpers from the PR were not imported. Scenario coverage lives in `tests/diagnostics.test.ts`.
