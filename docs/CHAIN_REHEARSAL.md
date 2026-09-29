# Blockchain Baseline Rehearsal

This command exercises the deployed contracts directly on Ethereum Sepolia.
It uses the six generated demo accounts under one operator's control. It does
not run a browser, Kiln, the preference parser, restaurant selection, or wallet
authentication, and does not complete T26's full application acceptance run.

## Verified result

`baseline-001` completed on Ethereum Sepolia. All 20 transaction receipts and
expected events were checked. At final block `11801772`, the decision recorded
60 MockUSDC contributed, 45 spent, and 15 refunded. Each participant held
22.5 MockUSDC, Restaurant A held 45, and the escrow held zero. The 80 MockUSDC
rejection was verified by read-only contract simulation while the decision
was active. The [public run record](evidence/baseline-001.json) contains all
transaction hashes, policy fields, decoded logs, and block identities.

A completed read-only replay rechecked all 20 transactions and settlement.
All seven signing accounts had unchanged pending nonces before and after;
no additional transactions were submitted. See
[replay verification](evidence/baseline-001-replay.json).

## Run and resume

Configure the participant and executor test keys privately on the machine,
install dependencies, and retain the public deployment and role manifests.
The deployer key is not required for the baseline itself.

```sh
pnpm demo:preflight --check-signers
pnpm demo:chain baseline-001
```

The command uses Restaurant A from the role manifest, a fixed policy hash,
10 MockUSDC contributions, a 45 MockUSDC payment, 60 MockUSDC spending/deposit
caps, and an expiry initially set 24 hours after the observed chain timestamp.
The participant list and policy cannot change when resuming an existing run.

It performs these operations:

1. Alice creates the decision and the script compares the stored policy with
   the locally encoded policy.
2. Each participant approves exactly 10 MockUSDC allowance and contributes
   against the same policy hash. Six contribution events must be confirmed.
3. The script checks `validatePayment` and simulates an 80 MockUSDC payment
   against the active decision. It requires `PaymentNotAllowed` with reason
   `MaxDepositExceeded`. This is an `eth_call` rejection, not a mined reverted
   transaction, and it consumes no gas.
4. The executor submits the exact 45 MockUSDC payment to Restaurant A.
5. Each participant claims 2.5 MockUSDC. Receipt events, token transfers,
   decision accounting, and before/after balances are verified.

Twenty successful transactions are expected: one creation, six token
allowances, six contributions, one payment, and six refunds. No mock tokens
are minted during this flow. Each participant's net token cost is 7.5 MockUSDC.

## Evidence and recovery

The public record is `docs/evidence/baseline-001.json`. It contains the frozen
policy, hash, before/after balance snapshots with block identities, confirmed
transaction hashes, decoded events, and the explicitly labeled simulation.
Only a verified final state is marked `completed`.

Signed transactions are saved before broadcast in the ignored
`docs/evidence/private/baseline-001` directory. A retry uses the same signed
transaction and hash. Confirmed transactions can be checked from the public
record without retransmission. Unit tests cover uncertain broadcasts,
persistence failure, changed intent, and altered signed payloads.

To resume, run the same command with the same run ID. A new run ID creates a
new decision and spends tokens again. Keep both the public evidence and the
private journal when moving a pending run between machines. Do not run the
same ID concurrently on multiple machines. A local lock prevents concurrent
processes on one checkout. After a forced process termination, inspect whether
the original process is still running before manually removing its stale
`run.lock`; never delete the transaction journal to recover.

After completion, use `pnpm demo:chain baseline-001 --verify-only` to check
the stored receipts, the rejection at its original block, and settlement at
the final refund block. This mode refuses to prepare or broadcast transactions
and requires a completed public record. The RPC must serve those historical
blocks. Later account activity does not change the recorded run's snapshots.

If the policy expires before payment, do not replace its expiry in the saved
record. Eligible contributions remain recoverable through the contract's
refund flow. A fresh run requires a fresh decision and approvals.

## Gas funding

The original 0.001 Sepolia ETH allocation was insufficient for Alice's policy
creation at the observed gas price. The baseline stopped before sending a
transaction. A separately authorized top-up uses this command:

```sh
pnpm demo:gas-topup baseline-001 0.003 all
```

This transfers another 0.003 Sepolia ETH to each of the six participants, not
MockUSDC. Its public record is `docs/evidence/gas-topup-baseline-001.json`.
Reruns of that exact batch reuse recorded transactions. A different batch ID
would send another allocation. Run top-ups only when intended, and estimate
gas again before future rehearsals because current balances do not guarantee
future transaction affordability.
