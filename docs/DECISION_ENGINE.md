# Decision Engine

## Scope and Entry Points

`src/lib/decision-engine.ts` is a pure evaluator over validated structured inputs.
It does not call Kiln, write a database, create a policy, sign, or send transactions.
`pnpm demo:decision` is a credential-free, cross-platform fixture check; it writes
`docs/evidence/decision-engine-fixtures.json`. The reservation timestamp in that
record is explicitly synthetic, not a real booking or policy expiry.

## Input Contract

The input contains exactly six distinct members, one preference revision for each
member, the common UTC reservation slot and IANA time zone, an explicit merchant
allowlist, contribution per participant, deposit/spending caps, and catalog.
Token quantities are base-unit strings; meal prices are integer USD cents.
Spending caps cannot exceed the six contributions. Duplicate member, restaurant,
or merchant identities and missing/outsider revisions fail schema validation.

Unresolved clarifications or unsupported requirements return `NEEDS_CLARIFICATION`.
A missing or stale confirmed revision returns `AWAITING_CONFIRMATION`. Both block
candidate evaluation. Revision equality is not authentication: the future API
must load revisions and confirmations from authorized, persisted server state,
never trust browser-supplied confirmation flags, and freeze the accepted snapshot.

## Eligibility and Ranking

Unavailable candidates, unapproved merchants, unmatched slots, and unaffordable
deposits are excluded before ranking. Every hard constraint must pass. Safety,
accessibility, and dietary requirements require affirmative support; `unknown`
and `unsupported` both fail. No-match is a valid outcome, not permission to relax
requirements. Fixture safety claims are synthetic and not real allergy advice.

Quiet and atmosphere are divided by 100. Subway satisfaction is
`max(0, 1 - subwayDistanceMeters / 1000)`. Each participant's positive soft weights
are normalized before averaging; a participant with no positive weights does not
affect that average but retains all mandatory constraints. Weights are rescaled
by their maximum to preserve tiny positive weights without numerical underflow.
The average is rounded to millionths using `Math.round`, and that stored integer
is the ranking key. Ties use lower meal price, then ordinal candidate ID.

The five `restaurants-v2` entries use the public merchant role manifest. Restaurant A is displayed as KAGAMI, the fictional demo storefront at `/restaurant`. Its $32 table meal estimate and deposit remain synthetic catalog assumptions; the separate KAGAMI concept page lists a $148 omakase. KAGAMI's shellfish-safety field is unknown, so it cannot satisfy a shellfish-safety requirement. Version 1 evidence retains the original Restaurant A label and constraints. Unknown
wheelchair and dietary metadata is deliberate: the brief does not supply it.
Do not silently turn missing metadata into support. A changed catalog needs a new
version and updated evidence. Expected results are A for the baseline, B for a
$25 budget, and B when A is excluded from the permitted set.

## Privacy and Remaining Work

Internal results contain participant-level violations and revision identifiers.
Never return them to the group or send them to an explanation model. Use
`publicEvaluation` for the explicit group allowlist: versions, status, winner,
ranking, candidate eligibility, and aggregate scores only. This reduces explicit
disclosure but cannot prevent inference in a small group. Access control and
privacy-safe explanation generation are separate application responsibilities.

The offline fixture runner preconfirms synthetic revisions solely for testing.
Separate development-branch rehearsals cover wallet authentication, user
confirmation, persistence, stale-result handling, and immutable policy
preparation with synthetic inputs. Neither rehearsal proves a full live Kiln and
on-chain application run. The separate explanation flow selects only public fact
IDs and renders server-owned sentences; see [explanation and usage](EXPLANATION_USAGE.md).
End-to-end payment remains open in the task register.
