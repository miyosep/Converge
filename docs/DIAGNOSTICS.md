# Diagnostics and Reminders

## Purpose

The decision engine answers one question: which candidate wins, or that nothing
does. It deliberately reports that as a terse status plus a per-candidate
violation list. That is the right shape for a pure evaluator and the wrong shape
for a person who needs to know **what to do next**.

`src/lib/diagnostics/` adds a second, orthogonal output over the same inputs: a
list of _diagnostics_. A diagnostic is a condition to act on, not a log line.
Each one carries a stable code, a severity, the lifecycle stage it blocks, who can
resolve it, whether retrying the same request could ever succeed, a title, and a
sentence of guidance.

```
src/lib/diagnostics/
  codes.ts        the registry: every code with its fixed classification
  types.ts        the diagnostic shape, sorting, dedup, and the shareable projection
  evaluation.ts   explain an Evaluation: eligibility, ranking, and input conditions
  chain.ts        translate contract reverts and rejection enums
  operations.ts   translate application error codes and workflow status
  index.ts        the public surface
app/components/diagnostics.tsx   the web client renderer
```

## Why classification lives in a registry

The same physical condition is reachable from several layers. "The policy
expired" can arrive as a pre-flight `validatePayment` enum, a `PolicyExpired`
revert, a lifecycle status, or a stale `secondsToExpiry`. If each call site
decided its own severity and wording, the same problem would appear as a warning
in one place and an error in another, and the client could not rely on either.

So call sites choose only _which_ condition occurred, plus optional attribution
(participant, revision, field, and non-sensitive detail). Severity, stage,
retryability, and the human-readable text come from the registry. `diagnostic()`
re-validates through the schema, so a caller cannot override a classification.

## The codes

Codes are a permanent public contract: they appear in API responses, in evidence
files, and as client display keys. Never rename or reuse one. Add a new code and
retire the old one.

| Prefix  | Stage                       | Covers                                                                        |
| ------- | --------------------------- | ----------------------------------------------------------------------------- |
| `DEC_`  | input, eligibility, ranking | malformed input, candidate filtering, ranking outcomes                        |
| `PRF_`  | preference                  | clarification, unsupported requirements, confirmation, stale revisions        |
| `PLN_`  | approval                    | policy validity, hash agreement, expiry window, approval progress             |
| `FUND_` | funding                     | contributions, allowance and balance, duplicate approval, veto                |
| `CHN_`  | execution                   | executor, active state, expiry, merchant, amount, caps, balance, reverts      |
| `SET_`  | settlement                  | expiry, refund eligibility, duplicate claims, remainder distribution          |
| `INF_`  | infrastructure              | database, Kiln, RPC, replay, reconciliation, session                          |
| `SHR_`  | every stage                 | group-visible stand-ins; never emitted by an analyzer, only by the projection |

`tests/diagnostics.test.ts` asserts that every code has a complete specification,
that the prefix agrees with the declared stage, and that no guidance string
contains an address, a revision identifier, or a dollar amount. `DEC_` covers
three stages because input validation, eligibility, and ranking share a prefix
and a producer. `SHR_` is exempt from the prefix-to-stage rule because there is
one stand-in per stage by design.

Two classification rules are easy to get wrong and are worth stating outright:

- **A stage describes where progress is blocked, not which module produced the
  condition.** `DEC_PARTICIPANT_ONESIDED` is an eligibility outcome because it
  falls out of candidate filtering, even though the conflict is really about the
  participants' constraints. Filing it under `input` would make the projection
  tell the group "this step could not start" instead of "no candidate satisfies
  every requirement".
- **`remedy` names who can clear the condition.** A mutually unsatisfiable
  constraint set is a `group` remedy because the group relaxes a requirement;
  `operator` would imply the group cannot act and must wait.

## Severity and retryability are separate axes

Severity says how bad the condition is. Retryability says whether resending the
identical request could ever work.

- `CHN_AMOUNT_NOT_APPROVED` is an error and **not** retryable. The MVP permits one
  payment, and the amount must equal the approved policy exactly, so retrying the
  same amount fails identically. The UI must not offer "Try again".
- `CHN_EXPIRED` is an error and not retryable. Expiry is permanent.
- `INF_RPC_FAILURE` is an error and **is** retryable, because the on-chain state is
  unchanged and the endpoint may recover.
- `DEC_NO_ELIGIBLE_CANDIDATE` is an error and retryable, because the group can
  legitimately relax a requirement. No-match is a valid outcome, not a fault.

The client component reads `retryable` per entry and only renders a retry control
when at least one entry allows it. A reminder that invites a guaranteed failure is
worse than no reminder.

## Internal diagnostics versus the shareable projection

Internal diagnostics carry attribution: which participant's revision caused a
failure, which revision identifier, which field, and bounded detail values. That
is what an operator needs to reproduce a report.

It is also exactly what must not reach the group. `publicDiagnostic` keeps only
`code`, `severity`, `stage`, `retryable`, `title`, and `guidance`, and replaces
any code the registry marks `shareable: false` with a stage-level stand-in.

The stand-in matters more than it looks. If a private code were merely dropped,
the group would learn nothing. If it were passed through unchanged, the group
would learn _which condition occurred_ — and in a group of six, "the clarification
came from someone requiring vegan support" narrows the author to a single person.
Replacing the code with a stage-level reminder keeps the group informed that a
preference is unresolved while revealing nothing about whose it is. This is the
same reasoning as `publicEvaluation` in `docs/DECISION_ENGINE.md`, applied to
errors rather than results.

`INF_KILN_USAGE_UNKNOWN` and `PLN_APPROVAL_HASH_MISMATCH` are not shareable,
because both identify a specific actor's attempt. `DEC_MERCHANT_NOT_PERMITTED` and
`FUND_PARTIAL_FUNDING` are shareable, because they describe the whole group's
situation.

**The stand-ins are a dedicated `SHR_` family, not reused condition codes.** An
earlier revision pointed each stage at an existing code — `input` at
`DEC_INPUT_INVALID`, `preference` at `PRF_AWAITING_CONFIRMATION`, and so on. That
was wrong twice over:

1. **Those codes are themselves `shareable: false`,** so the projection swapped
   one private code for another and the group still received a code the registry
   forbids showing.
2. **A reused code states the wrong thing.** Mapping an unresolved clarification
   onto `PRF_AWAITING_CONFIRMATION` tells the group that someone has not
   confirmed their revision. Nobody was awaiting a confirmation, so the reminder
   was both a leak of which condition occurred and a false report.

Each `SHR_` code therefore describes only its stage — "A preference is still
open", "Ranking was not decisive" — and never the condition. Because two private
codes in one stage now collapse onto one stand-in, the substitution is genuinely
lossy in exactly the direction that protects the participants.
`tests/diagnostics.test.ts` asserts that every non-shareable code has a registered
`SHR_` stand-in, that each stand-in is itself shareable, and that no analyzer
module emits a `SHR_` code directly.

Two private codes in the same stage collapse to the same stand-in, so
`publicDiagnostics` deduplicates _after_ projecting, not before. Deduplicating
first would emit the same stand-in twice.

## Evaluation reminders

`analyzeEvaluation(result, input)` is a pure function of the engine result plus
the validated input. It performs no I/O, so tests and the evidence runner can use
it directly.

It groups the engine's per-candidate violations into three shapes, because each
needs a different response:

1. **A general condition that excluded every candidate.** An empty merchant
   allowlist, a slot no candidate offers, or a deposit cap below every deposit.
   Reported with the affected and total candidate counts.
2. **A participant constraint that failed for every candidate.** This is the
   group's real conflict, and the reminder names the participant and revision so
   an operator can follow up. A constraint that failed for only some candidates is
   not emitted: it is the normal consequence of ranking, not a blocked decision.
3. **Every candidate ineligible with no single dominant constraint.** The group's
   requirements are mutually unsatisfiable even though no one constraint is
   individually impossible. Reported as `DEC_PARTICIPANT_ONESIDED`, which is a
   different problem with a different fix.

Non-negotiable safety and dietary constraints fail closed on missing metadata, and
`restaurants-v1` deliberately reports `unknown` wheelchair and dietary support. A
group requiring one therefore always reaches no-match, and the reminder is
`DEC_NONNEGOTIABLE_UNKNOWN` with `remedy: "operator"` and `retryable: false` — the
catalog needs an explicit value, and re-running the evaluation cannot help. Without
this code the condition would look like a group disagreement and the group would
waste a cycle rewording its preferences.

Ranking outcomes are reminders too. A tie, a winner chosen by a tie-break, and a
margin under one percent all produce informational entries
(`DEC_SCORE_TIE`, `DEC_WINNER_BY_TIEBREAK`, `DEC_NARROW_MARGIN`). A proposal decided
by an undocumented tie-break must not be presented to the group as a clear
preference.

Clarifications and unsupported requirements suppress candidate evaluation
entirely, so `analyzeEvaluation` reports them and emits no eligibility reminders.
Reporting "no candidate matched" when the engine never looked at candidates would
be misleading.

## Chain reminders

`diagnoseChainError(error, context)` walks a viem error chain to the
`ContractFunctionRevertedError` and maps it.

`RejectReason` and `PolicyError` arrive as `uint8` enum ordinals, so the tables in
`chain.ts` must match the Solidity declaration order exactly. Changing the enum in
`contracts/src/ConvergeGroupWallet.sol` without updating the table would silently
remap every payment diagnostic to the wrong reminder — a far worse outcome than an
unmapped error. Both tables are asserted element-by-element in
`tests/diagnostics-operations.test.ts`.

An ordinal outside the table is **not** guessed. It degrades to `CHN_TX_REVERTED`
with `reason: "UnknownOrdinal"`, so a contract/table divergence is visible instead
of being silently misreported.

Bare reverts from a token transfer are ambiguous — an ERC-20 revert carries no
Converge error name. The mapper inspects the message for allowance and balance
phrasing, and uses the caller-supplied `action` to disambiguate. A contribution
that fails on balance is `FUND_BALANCE_INSUFFICIENT` (retryable, user-fixable); a
refund that fails on balance is `CHN_TX_REVERTED` (not retryable, operator
territory), because a refund payout failing means the accounting is already wrong.

## API integration

`src/lib/server/api.ts` attaches diagnostics to every error response through
`failure()`, and exposes `withDiagnostics()` for success responses that describe a
qualified state. Responses carry `diagnostics` and `summary` alongside `error`.

Responses use the shareable projection, because an API response is group-visible.
Internal attribution stays in the server log via `console.error`. The client reads
`diagnostics` from both success and failure bodies, so a 200 that reports "proposal
decided by tie-break" surfaces the note without a second request.

## Web client

`app/components/diagnostics.tsx` exports `DiagnosticList` and `DiagnosticBadge`.

The full list groups by severity, shows the stage, the code, and the guidance, and
offers Retry only when at least one entry is retryable and Dismiss when the caller
provides a handler. The badge is the compact form for a sidebar: the highest
severity counts.

Severity is carried by a left rule, an icon, and a text label — never by colour
alone. `Blocked`, `Needs attention`, and `Note` appear as text so the meaning
survives greyscale and colour-blind reading.

## Adding a code

1. Add the entry to `DIAGNOSTIC_CODES` in `codes.ts` with all nine fields.
2. Decide `shareable` deliberately. If the code identifies a participant, an
   attempt, or a constraint field, set it to `false`. Every stage already has an
   `SHR_` stand-in, so a non-shareable code needs no new fallback — confirm the
   stage's existing stand-in still reads correctly for the new condition.
3. Decide `retryable` by asking whether resending the identical request could
   ever succeed.
4. Decide `stage` by asking where progress is blocked, and `remedy` by asking who
   can clear it. Neither should follow from which module happens to emit the code.
5. Emit it from the layer that observes the condition: `evaluation.ts` for
   engine output, `chain.ts` for a revert, `operations.ts` for an error code or a
   workflow status. Never emit an `SHR_` code from an analyzer; those belong to
   the projection alone.
6. Add a test asserting the code is emitted for the condition and that its
   severity, stage, and retryability match the intent.

`tests/diagnostics-evaluation.test.ts` includes a sorted snapshot of the codes
emitted for a merchant-exclusion case, so a rename is caught rather than shipped.

## What this does not do

These reminders are derived from a single evaluation or a single error. They do not
observe the system over time, so they cannot detect a condition that is only
visible across attempts — repeated `INF_KILN_TIMEOUT` on one revision, or a group
that has run the same failing evaluation three times.

They also do not replace the verification plan. A reminder that says a payment was
rejected is not evidence that the rejection was correct; the contract tests and
the live-run receipts remain the acceptance evidence, per the completion gates.
Whether a given diagnostic _should_ have fired is a property of the contract and
the engine, and is established by their tests, not by this layer.
