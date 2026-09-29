# Blockchain Contracts

Converge uses a six-decimal `MockUSDC` and one `ConvergeGroupWallet` on Ethereum
Sepolia (`11155111`). The contract code lives in `contracts/src`. Foundry v1.8.3
and Solc 0.8.24 are pinned for the current contract suite. Token transfers use
OpenZeppelin Contracts v5.4.0 `SafeERC20`; the wallet uses `ReentrancyGuard`.

## Token and authority

`MockUSDC` starts with zero supply. Its immutable `minter` is the account that
deploys it. Only that account can call `mint(recipient, baseUnits)`; there is no
ownership-transfer, public faucet, or wallet-admin mint path. A normal token
transfer or allowance does not count as a group contribution. The token is
synthetic testnet currency and has no claim on real USDC.

## Policy and states

Each decision stores the entire immutable v1 `Policy` and its Solidity
`keccak256(abi.encode(policy))` hash. The field order, types, and reference
vector are frozen in [POLICY_ENCODING.md](POLICY_ENCODING.md). Creation requires
the correct chain and escrow addresses, the configured token, a new nonzero
decision ID, six unique nonzero participant addresses, and the creator's
membership. The merchant cannot be zero or the escrow itself; the executor
cannot be zero. The approval threshold is exactly six.

The expiry must be in the future and no more than 24 hours after the creation
transaction. It controls payment authority, not the date of the meal or a
deadline for claiming an already eligible refund. A policy can authorize one
payment, with `0 < paymentAmount <= maxDeposit <= maxTotalSpend <= six exact
contributions`.

The normal path is `Funding -> Active -> Completed`. The sixth distinct
participant contribution activates the decision. A participant can cancel a
funding or active decision before its expiry and payment, moving it to
`Cancelled`. After expiry, anyone can finalize an unpaid decision as `Expired`,
and a contributor's `claimRefund` can do that finalization automatically.
`Completed`, `Cancelled`, and `Expired` are terminal states.

## Calls

| Call | Who may act | Effect |
| --- | --- | --- |
| `createDecision(policy)` | A listed participant | Stores an immutable policy without approving it |
| `approveAndContribute(id, expectedHash)` | Each listed participant, once | Checks the policy hash and transfers the exact contribution atomically |
| `validatePayment(id, caller, to, amount)` | Anyone, read-only | Previews the enforcing checks in a stable reason order |
| `executePayment(id, to, amount)` | The bound executor | Pays the bound merchant exactly once and completes the decision |
| `cancelDecision(id)` | Any listed participant | Vetoes an unpaid decision before expiry |
| `expireDecision(id)` | Anyone | Finalizes an unpaid decision at or after expiry |
| `claimRefund(id)` | A contributor | Sends only that contributor's entitlement to their bound address |

`executePayment` checks its actual transaction sender. A preview caller passed
to `validatePayment` does not grant authority. It rejects the wrong executor,
inactive state, missing approvals or funds, expiry, wrong merchant, zero or
excessive amount, non-exact amount, and insufficient decision balance. The
80 MockUSDC demo request is rejected as `MaxDepositExceeded` before the exact
amount check. Reverted calls emit no persistent rejection event; the app must
label read-only validation, simulation, and mined reverts accurately.

The wallet accounts for each decision independently. Direct token transfers to
the escrow do not create contribution credit. There is no admin withdrawal,
policy edit, upgrade, arbitrary recipient, or executor refund function. The
configured token is the six-decimal mock; a fee-on-transfer contribution is
rejected if the received amount differs from the policy amount.

## Refunds

Before payment, cancellation or expiry returns each contributor's full
credited amount, including partially funded decisions. After payment, the
terminal remainder is split among the six equal contributors. If token base
units do not divide evenly, earlier addresses in the fixed policy order get
one additional unit. Each participant claims once, and the claim is marked
before the transfer. A failed transfer reverts the mark and accounting change.

The baseline collects 60 MockUSDC, pays 45, and makes 2.5 claimable for each
participant. The 36 MockUSDC changed-merchant scenario makes 4 claimable for
each. `refundEntitlement` previews an eligible unclaimed amount, including
an unpaid decision whose expiry has passed but has not yet been finalized.

## Verification

Run `pnpm contracts:build`, `pnpm contracts:test`, and `pnpm contracts:abi`
after `pnpm install --frozen-lockfile`. Contract tests cover creation,
authorization, six-person activation, payment rejection order, events,
cancellation, expiry, partial and completed refunds, decision isolation,
failed token transfers, reentrancy, fuzzed rounding, and randomized state
sequences. The separate TypeScript test verifies the same policy hash vector.
The hosted Apple Silicon and Intel macOS contract jobs passed for commit
`ec4feb3` in [CI run 36450489300](https://github.com/miyosep/Converge/actions/runs/36450489300).
The presentation MacBook still needs its own rehearsal. See
[CHAIN_REHEARSAL.md](CHAIN_REHEARSAL.md) for the direct-contract baseline command,
which is separate from the full application acceptance workflow.
