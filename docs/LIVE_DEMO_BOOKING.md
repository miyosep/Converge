# Live candidate to demo booking policy

Implemented on September 30, 2026 (KST). New `/demo` sessions search restaurants
around Gangnam Station through Kiln Qwen and xAPI, then let the judge select a
saved candidate and a whole-token demo deposit from 1 to 60 MockUSDC. The fixed
demo slot is January 5, 2030, 19:00 Asia/Seoul, for six participants.

The participant acknowledges that venue conditions are unverified and booking
availability/USDC acceptance are demo assumptions. The payment recipient is the
existing configured merchant A, acting as a demo booking wallet. No real venue
address is generated or inferred. Each participant contributes 10 MockUSDC.

The worker creates the existing v1 policy. Its reservation reference hashes the
saved place snapshot, interpretation, search revision/time, demo slot, deposit and
recipient. The normal policy hash binds the exact amount, participants, recipient,
executor, expiry and limits. Searches and reselection are rejected after proposal
creation. The existing approval, payment, cancellation and refund machinery is reused.

Search results and usage are stored in the session JSON for file and database
stores; no database or Solidity migration is required. Three searches are allowed
per session. A lost in-flight search is not automatically billed again. Search
failure removes stale candidates and does not substitute fixtures. Legacy sessions
with extracted synthetic preferences retain their original flow.

## Verification

- `tests/live-demo-proposal.test.ts` covers changed amount/place/requirements hashes,
  arbitrary recipients, stale IDs/revisions, unresolved clarifications, missing
  acknowledgement, invalid amounts, locked policies, interrupted third-search
  recovery, and the worker's mocked Qwen/xAPI-to-policy sequence.
- `pnpm contracts:build` compiled the unchanged contracts.
- `node --import tsx scripts/explore-local-rehearsal.ts --live-place` passed on
  disposable Anvil with fixture search data and a **48 MockUSDC** deposit. It
  exercised six contributions, payment, simulator confirmation, 2 MockUSDC judge
  refund, automated refunds, cancellation, expiry and restart idempotency. The
  first run caught an old 2.5-token assertion in the harness; it was corrected to
  the expected 2-token refund for this scenario and the full run passed.

This run used local test accounts and fixture provider results. It did not call
live search services or send Sepolia transactions. Earlier real xAPI search and
legacy Sepolia payment evidence are separate. The newly combined browser-wallet
flow still needs a live Sepolia/presentation-machine rehearsal.
