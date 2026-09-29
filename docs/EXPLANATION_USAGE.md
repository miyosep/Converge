# Group Explanation and AI Usage

The ordinary-group Results page can request an explanation after six confirmed
preferences produce a frozen proposal. `POST /api/insights/:groupId` requires a
wallet-authenticated group member, a same-origin JSON request, and a saved current
evaluation. Repeated requests return the saved explanation and count an application
cache hit. `GET /api/insights/:groupId` returns the saved explanation, if any, and
group-level usage for authorized members.

The explanation model receives only four prewritten public facts: the selected
candidate's rank, synthetic meal estimate, MockUSDC deposit, and the count of
eligible synthetic candidates. It selects fact IDs using a strict schema; new
selections must include the ranking fact identifying the chosen restaurant. The
server renders the final sentences from those IDs. Raw preference text, parsed
constraints, participant identities, individual rejection reasons, and internal
evaluation snapshots are not sent to this model. A failed or unavailable Kiln
request produces a visibly labeled deterministic fallback using the same facts.
The explanation never authorizes a payment.

Each Kiln provider attempt is stored before a successful explanation can be
reported, including retries and failed attempts. The Results page aggregates
extraction and explanation attempts by flow. Calls, retries, failed attempts,
unreported token counts, and application cache hits are separate fields. Totals
are `null` when any contributing attempt lacks that measurement; zero calls are
shown as zero attempts with no measured token total. Provider-reported cost,
cached-input tokens, and reasoning tokens are retained in the API response when
complete. Energy use remains unknown. The existing `/evidence` page displays
only allowlisted published artifacts. Real group usage remains member-only;
three explicitly synthetic [acceptance exports](GROUP_ACCEPTANCE.md) now connect
provider attempts and cached explanations to their group policies and receipts.

Migration `0007_group_explanations.sql` creates the explanation and provider
attempt records. Apply reviewed migrations to the isolated `dev-preferences`
branch with `pnpm db:migrate:dev` before using the endpoint. No production
database migration is implied by the code change.

Run `node --env-file=.env --import tsx scripts/check-group-explanation.ts` for
a live Kiln call using only synthetic public facts. With the development web
server running, `node --env-file=.env --env-file=.env.development --import tsx
scripts/group-insights-rehearsal.ts` exercises member access, live explanation,
usage persistence, and a repeated cache hit. The sanitized [development
record](evidence/group-insights-dev.json) reports one successful explanation
attempt and no chain transactions. This is a single-operator synthetic check,
not a full six-person acceptance run. That HTTP record used prompt v2. The
current v4 prompt additionally requires ranking; its direct live synthetic
check passed with one attempt, 207 input and 639 output tokens. Earlier saved
explanations remain readable without rewriting historical evidence.
