// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Policy, PolicyHash} from "../src/PolicyHash.sol";

contract PolicyHashTest {
    function testPolicyV1HashMatchesTypeScript() public pure {
        Policy memory policy = _baseline();
        assert(PolicyHash.hash(policy) == 0x27249362b6aa82ae82b8965184ed2a770fa09293dc4cdc6ff7fbd6552bb1fdda);
    }

    function testMerchantChangesHash() public pure {
        Policy memory policy = _baseline();
        bytes32 original = PolicyHash.hash(policy);
        policy.merchant = address(0x21);
        assert(PolicyHash.hash(policy) != original);
    }

    function _baseline() private pure returns (Policy memory policy) {
        policy.policyVersion = 1;
        policy.chainId = 11155111;
        policy.verifyingContract = address(0x40);
        policy.decisionId = bytes32(uint256(0xa1));
        policy.token = address(0x10);
        policy.merchant = address(0x20);
        policy.executor = address(0x30);
        policy.participants = [address(1), address(2), address(3), address(4), address(5), address(6)];
        policy.approvalThreshold = 6;
        policy.contributionPerParticipant = 10000000;
        policy.paymentAmount = 45000000;
        policy.maxDeposit = 60000000;
        policy.maxTotalSpend = 60000000;
        policy.expiry = 2000000000;
        policy.reservationReference = bytes32(uint256(0xb2));
    }
}
