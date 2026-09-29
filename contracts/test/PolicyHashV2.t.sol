// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {PolicyV2, PolicyHashV2} from "../src/PolicyHashV2.sol";
contract PolicyHashV2Test {
    function testDynamicPolicyMatchesTypeScript() public pure {
        PolicyV2 memory p;
        p.policyVersion = 2; p.chainId = 11155111; p.verifyingContract = address(0x40);
        p.decisionId = bytes32(uint256(0xa1)); p.token = address(0x10); p.merchant = address(0x20); p.executor = address(0x30);
        p.participants = new address[](4);
        for (uint256 i; i < 4; i++) p.participants[i] = address(uint160(i + 1));
        p.approvalThreshold = 4; p.contributionPerParticipant = 10000000; p.paymentAmount = 36000000;
        p.maxDeposit = 40000000; p.maxTotalSpend = 40000000; p.expiry = 2000000000; p.reservationReference = bytes32(uint256(0xb2));
        assert(PolicyHashV2.hash(p) == 0xa9c8275283b0c6c73b34f016e76ec581def91cdb789e79dfa80f57503ac83a84);
    }
}
