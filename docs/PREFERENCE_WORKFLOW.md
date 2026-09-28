# Preference Revision Workflow

## Implemented Scope

`src/lib/preferences.ts` implements validated, immutable preference transitions.
It does not implement wallet authentication, HTTP routes, database persistence,
or cross-process locking. PostgreSQL was selected by the project owner on
September 29, 2026 (KST); the managed provider and connection are being prepared.
Do not expose these functions as an unauthenticated API.

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
7. Freeze a proposal under the same group lock after validating all six current
   confirmed revisions. Freeze membership and the full revision snapshot
   atomically so concurrent edits cannot invalidate the approved proposal.

Calling these functions against an old in-memory record does not implement
concurrency protection. PostgreSQL locking or equivalent compare-and-swap is
mandatory in the future repository implementation. Group membership, CSRF,
invitation validation, session expiry, and replay prevention remain separate
security requirements and are not claimed by the transition tests.

## Verification

`pnpm check` covers explicit confirmation, late worker responses, stale writes,
correction reset, unresolved requirements, owner/group mismatch, proposal freeze,
safe failure/retry, shared progress privacy, and invalid state/input rejection.
These are local unit tests; managed PostgreSQL and browser integration remain
pending until implemented and separately tested.
