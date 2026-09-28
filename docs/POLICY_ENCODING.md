# Financial Policy Encoding v1

This document freezes the T03 policy shape. The canonical Solidity definition is
`contracts/src/PolicyHash.sol`; `src/lib/policy.ts` is its TypeScript mirror.
Changing a field's name, type, or order requires a new `policyVersion`, new test
vectors, and coordinated changes to every consumer. No live decision may be
silently reinterpreted using a new encoding.

## Fields

| Order | Name | Solidity type | JSON/API representation | Meaning |
| --- | --- | --- | --- | --- |
| 1 | `policyVersion` | `uint256` | integer `1` | Encoding version |
| 2 | `chainId` | `uint256` | safe positive integer | EVM chain; `11155111` for the Sepolia demo |
| 3 | `verifyingContract` | `address` | checksummed address | Decision escrow contract |
| 4 | `decisionId` | `bytes32` | 32-byte hex | Unique public decision identifier |
| 5 | `token` | `address` | checksummed address | Configured MockUSDC |
| 6 | `merchant` | `address` | checksummed address | Sole permitted payment destination |
| 7 | `executor` | `address` | checksummed address | Sole permitted payment caller |
| 8 | `participants` | `address[6]` | six ordered, unique addresses | Members and refund rounding order |
| 9 | `approvalThreshold` | `uint256` | integer `6` | Unanimous approval count |
| 10 | `contributionPerParticipant` | `uint256` | base-unit decimal string | Exact contribution from each member |
| 11 | `paymentAmount` | `uint256` | base-unit decimal string | Exact authorized payment |
| 12 | `maxDeposit` | `uint256` | base-unit decimal string | Deposit ceiling, checked separately |
| 13 | `maxTotalSpend` | `uint256` | base-unit decimal string | Cumulative spending ceiling |
| 14 | `expiry` | `uint256` | UTC Unix seconds | Payment expires at this instant |
| 15 | `reservationReference` | `bytes32` | 32-byte hex | Public opaque fixture/reference ID |

All monetary amounts are integer units of the six-decimal mock token. The
baseline contribution is `10000000` per member, payment is `45000000`, and
both ceilings are `60000000`. The reservation reference must not contain or
be derived from private preferences. Participant order is fixed at creation;
reordering changes the hash and the refund rounding order.

## Hash and validation

The hash is `keccak256(abi.encode(policy))`, where `policy` is the static
Solidity `Policy` struct above. The TypeScript mirror encodes one ABI tuple
with exactly the same components and order. Do not use `abi.encodePacked`,
JSON serialization, a personal-sign prefix, or an EIP-712 domain separator.
This is a policy fingerprint, not a signature scheme. Each participant's
on-chain transaction must compare its expected hash with the stored hash.

The contract must validate version 1, current `block.chainid`, its own address,
configured token, fresh decision ID, six unique nonzero participants, creator
membership, threshold 6, future expiry and maximum lifetime, positive
contribution, nonzero merchant/executor, and
`paymentAmount <= maxDeposit <= maxTotalSpend <= 6 * contributionPerParticipant`.
The maximum lifetime is fixed at 24 hours after the creation transaction.
The TypeScript schema performs matching static checks but cannot establish
chain state or time; contract validation remains authoritative.

`tests/policy.test.ts` records a fixed vector and field-mutation checks.
`contracts/test/PolicyHash.t.sol` records the same vector for a Solidity test
runner. Foundry v1.8.3 with Solc 0.8.24 passed both Solidity tests on Windows
on 2026-09-28 using `forge test --root contracts -vv`. Run the same command on
the presentation MacBook. macOS arm64 and Intel CI jobs run the contract tests,
but their results and the presentation MacBook are not yet verified. The
Solidity suite is separate from `pnpm check`.

The v1 baseline vector is
`0x27249362b6aa82ae82b8965184ed2a770fa09293dc4cdc6ff7fbd6552bb1fdda`.
