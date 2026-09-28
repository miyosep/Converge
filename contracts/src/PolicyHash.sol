// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct Policy {
    uint256 policyVersion;
    uint256 chainId;
    address verifyingContract;
    bytes32 decisionId;
    address token;
    address merchant;
    address executor;
    address[6] participants;
    uint256 approvalThreshold;
    uint256 contributionPerParticipant;
    uint256 paymentAmount;
    uint256 maxDeposit;
    uint256 maxTotalSpend;
    uint256 expiry;
    bytes32 reservationReference;
}

library PolicyHash {
    function hash(Policy memory policy) internal pure returns (bytes32) {
        return keccak256(abi.encode(policy));
    }
}
