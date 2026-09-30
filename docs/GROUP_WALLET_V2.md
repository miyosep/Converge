# Variable-size ordinary groups

Ordinary groups choose a fixed target of 2–100 members when created. All members
must join and confirm preferences before evaluation. New policies use version 2;
the contract freezes the participant list and requires every member's equal
contribution and approval. Payment, cancellation, expiry and individual refunds
use the actual participant count. The UI defaults to four members.

The archived planner at `/demo/catalog` has 40 fictional restaurants (A–Z and AA–AN),
plus 40 examples in each of four other categories. Search covers name,
cuisine and area. The selected shortlist is saved with the group. Dietary,
availability and price metadata are synthetic; no real reservation is made.
In this archived fixture flow, each person contributes 10 MockUSDC.
Recommendation caps are the smaller of
actual group funding and the configured 60 MockUSDC cap. A small group can receive
NO_MATCH if every selected restaurant exceeds its funds or other requirements.

Current new-plan links open `/discover`. After every actual member confirms
preferences and chooses the same xAPI candidate, the organizer sets the total
MockUSDC test payment and recipient. A v2 policy divides that total equally
among the actual participants, rounding up to token base units, and requires
every member's independent wallet approval and contribution. Rounding remainders
are refundable. The hybrid processor can supply missing test tokens for each
share and top up eligible wallets toward 0.001 Sepolia ETH within the shared
group execution budget. The recipient is entered by the organizer, not inferred
from a listing. Availability and USDC acceptance remain hackathon assumptions;
these transactions do not book or pay a real venue. See [friends planning](LIVE_GROUP_PLANS.md).

## Compatibility and deployment

Explore Demo keeps six participants and policy version 1. Legacy sessions use five
fixtures; new sessions select live Gangnam Station candidates and a demo deposit,
payable to the configured demo recipient. See `LIVE_DEMO_BOOKING.md`.
Existing ordinary v1 policies keep their original contract, hash and history.
New ordinary policies use the deployment in
[`11155111-v2.json`](../contracts/deployments/11155111-v2.json):
`0xe06073db9ee37801f593a040cc1f8c1f11af16bb` on Ethereum Sepolia.
The manifest records the receipt, canonical block and deployed code hash.
Deployment was verified at two confirmations; its recorded verification does
not assert finality. This is a test-token deployment, not a production payment service.

Apply all checked-in migrations through `0018_group_before_search.sql` with
`pnpm db:migrate:dev`. Run `pnpm groups:worker-check` for read-only database,
signer and both contract-version checks. The ordinary worker dispatches saved
policies to their respective contract version.

The ordinary and Explore workers share an executor and exclusive signing lock.
Run one mode at a time: stop Explore before starting `pnpm groups:worker` with
`GROUP_EXECUTION_ENABLED=true`. All-member funding alone does not start the
ordinary executor. Refunds are signed by each participant's own wallet.

## Verification

- TypeScript schema and ABI tests cover 2, 4, 6, 8 and 100 participants, exact
  funding, unanimous approval and matching Solidity/TypeScript policy hashes.
- Optimized Solidity tests cover payment conservation, invalid participants,
  unauthorized payments, cancellation, expiry, duplicate payments/refunds and
  fuzzed group sizes from 2 through 100. Existing v1 tests remain intact.
- The four-member Anvil rehearsal covers registration, all contributions,
  payment, all refunds and recovery of a lost broadcast response without paying
  twice. This is local-chain evidence, not a four-member Sepolia payment record.
- The development database rehearsal checks the expanded shortlist, invitations,
  concurrent capacity enforcement, private access, confirmations, recommendation
  and persisted v2 policy hash. It cleans up its temporary rows and sends no
  blockchain transactions or Kiln requests.

Build/test optimized artifacts in PowerShell:

```powershell
$env:FOUNDRY_PROFILE = 'v2'
forge test --root contracts
node --import tsx scripts/group-chain-rehearsal.ts --v2 --members 4
node --env-file=.env.development --import tsx scripts/group-size-rehearsal.ts --quick
```

On macOS, prefix the Forge command with `FOUNDRY_PROFILE=v2` instead. The
deployment script reads `contracts/out-v2`. Re-running it without `--execute`
only verifies the existing deployment or reports preflight requirements:

```text
node --env-file=.env --env-file=.env.development --import tsx scripts/deploy-group-wallet-v2.ts
```

The historical six-account live acceptance records remain separate evidence.
Independent browser-wallet operation and a live four-member Sepolia lifecycle
have not been claimed by these automated checks.
