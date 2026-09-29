# Preference Revision Workflow

## Implemented Scope

`src/lib/preferences.ts` implements validated, immutable preference transitions.
`src/lib/db/preferences.ts` now persists these transitions on Neon PostgreSQL.
It locks the group row before each mutation, checks the current revision in the
same transaction, and stores immutable revision history. The shared progress
query returns participant names, addresses, and submitted/confirmed flags only.
This repository is server-side code for a future authenticated API. It does not
verify wallet signatures or invitations by itself; never pass an unverified
browser-supplied address as the actor.

## Transitions

| Operation | Preconditions | Result |
| --- | --- | --- |
| Submit | Correct owner/group, unlocked preferences, expected current revision | New revision in `PARSING`; no extracted data or confirmation |
| Complete extraction | Current revision matches the captured worker revision and is `PARSING` | Validated output in `AWAITING_CONFIRMATION` or `NEEDS_CLARIFICATION` |
| Fail extraction | Current worker revision is still `PARSING` | `PARSE_FAILED` with the safe `EXTRACTION_FAILED` code |
| Correct | Existing parsed output, correct expected revision, unlocked preferences | New revision; old confirmation cleared; ambiguity rechecked |
| Confirm | Current revision is awaiting confirmation with no unresolved requirements | `CONFIRMED`, with a server timestamp |
| Confirm again | The same revision is already confirmed | Idempotent response retaining the original timestamp |

A retry after provider failure is a fresh submission and revision, not an
opportunity for the failed worker to overwrite current state. A late completion,
late failure, stale correction, or stale confirmation is rejected. Corrections
and submissions return new objects; retain previous revisions in private audit
storage rather than mutating their historical contents.

`preferenceProgress` exposes only submitted/confirmed booleans. Raw text,
extracted constraints, errors, and revision identifiers belong only in the
owner's authorized response. `toEvaluationRevision` requires confirmed output
and feeds the existing evaluator; it does not create financial approval.

## Required PostgreSQL Integration

1. Authenticate the wallet session and resolve membership on the server.
2. Start a transaction and lock the group before its participant/preference row.
3. Load the actual current revision and proposal-lock flag. Never accept these
   values from a browser as authoritative context.
4. Apply a transition and persist it before committing. Compare the client's
   expected revision to detect stale views, including competing browser tabs.
5. For extraction, commit the submitted revision before calling Kiln. Do not
   hold a database lock throughout a network inference request.
6. Re-enter a transaction when extraction finishes. Reload the group and current
   revision, then apply the completion only if it is still current and writable.
   Record provider usage even if the result has become stale.
7. `evaluateAndFreeze` locks the group, checks all six current confirmed
   revisions, evaluates the server-supplied catalog and merchant allowlist, and
   persists the private input snapshot and internal result when a proposal is
   ready. A `NO_MATCH` result does not freeze the group. The same transaction
   prevents concurrent preference edits from changing the accepted snapshot.

The database repository supplies concurrency protection for these transitions.
Group membership is checked for reads and writes, but membership admission
still needs a verified invitation and wallet session. The stored private
evaluation is never a group response; return its allowlisted public projection.
The fixture catalog, caps, and merchant list passed to `evaluateAndFreeze` must
come from trusted server configuration and authorized group state, not client
JSON. The web routes now provide expiring wallet sessions, same-origin POST
checks, and immutable proposal policy construction. Execution reconciliation
has an opt-in worker implementation; its full live ordinary-group run remains
to be verified.

## Verification

`pnpm check` covers explicit confirmation, late worker responses, stale writes,
correction reset, unresolved requirements, owner/group mismatch, proposal freeze,
safe failure/retry, shared progress privacy, and invalid state/input rejection.
The first two migrations were applied to the `dev-preferences` Neon branch.
`pnpm db:rehearse:dev` exercised six synthetic participants, concurrent writes,
late extraction rejection, correction, group progress, incomplete/no-match
evaluation, snapshot persistence, and post-freeze refusal against the real
database. The sanitized outcome is in
`docs/evidence/db-preferences-dev.json`. This test does not call Kiln or prove
browser authentication. The production branch still has no application tables.
