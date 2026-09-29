// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConvergeGroupWalletV2} from "../src/ConvergeGroupWalletV2.sol";
import {PolicyV2, PolicyHashV2} from "../src/PolicyHashV2.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

interface VmV2 {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert() external;
}

contract ConvergeGroupWalletV2Test {
    VmV2 constant vm = VmV2(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockUSDC token;
    ConvergeGroupWalletV2 wallet;
    address constant MERCHANT = address(0x2000);
    address constant EXECUTOR = address(0x3000);

    function setUp() public {
        vm.warp(1000000);
        token = new MockUSDC();
        wallet = new ConvergeGroupWalletV2(address(token));
    }

    function _policy(uint256 count, uint256 payment) internal view returns (PolicyV2 memory p) {
        p.policyVersion = 2;
        p.chainId = block.chainid;
        p.verifyingContract = address(wallet);
        p.decisionId = bytes32(uint256(1));
        p.token = address(token);
        p.merchant = MERCHANT;
        p.executor = EXECUTOR;
        p.participants = new address[](count);
        for (uint256 i; i < count; i++) {
            p.participants[i] = address(uint160(i + 1));
        }
        p.approvalThreshold = count;
        p.contributionPerParticipant = 10_000_000;
        p.paymentAmount = payment;
        p.maxDeposit = count * 10_000_000;
        p.maxTotalSpend = p.maxDeposit;
        p.expiry = block.timestamp + 3600;
    }

    function _create(PolicyV2 memory p) internal {
        vm.prank(p.participants[0]);
        wallet.createDecision(p);
    }

    function _contribute(PolicyV2 memory p, uint256 index) internal {
        address member = p.participants[index];
        token.mint(member, p.contributionPerParticipant);
        vm.prank(member);
        token.approve(address(wallet), p.contributionPerParticipant);
        vm.prank(member);
        wallet.approveAndContribute(p.decisionId, PolicyHashV2.hash(p));
    }

    function _lifecycle(uint256 count, uint256 payment) internal {
        PolicyV2 memory p = _policy(count, payment);
        _create(p);
        for (uint256 i; i < count; i++) {
            _contribute(p, i);
            (, ConvergeGroupWalletV2.Status status, uint256 approvals,,,) = wallet.getDecision(p.decisionId);
            assert(approvals == i + 1);
            assert(
                status == (i + 1 == count ? ConvergeGroupWalletV2.Status.Active : ConvergeGroupWalletV2.Status.Funding)
            );
            if (i + 1 < count) {
                vm.expectRevert();
                vm.prank(EXECUTOR);
                wallet.executePayment(p.decisionId, MERCHANT, payment);
            }
        }
        vm.expectRevert();
        vm.prank(address(0x4000));
        wallet.executePayment(p.decisionId, MERCHANT, payment);
        vm.expectRevert();
        vm.prank(EXECUTOR);
        wallet.executePayment(p.decisionId, address(0x4000), payment);
        vm.expectRevert();
        vm.prank(EXECUTOR);
        wallet.executePayment(p.decisionId, MERCHANT, payment + 1);
        vm.prank(EXECUTOR);
        wallet.executePayment(p.decisionId, MERCHANT, payment);
        vm.expectRevert();
        vm.prank(EXECUTOR);
        wallet.executePayment(p.decisionId, MERCHANT, payment);
        uint256 remaining = count * 10_000_000 - payment;
        for (uint256 i; i < count; i++) {
            uint256 expected = remaining / count + (i < remaining % count ? 1 : 0);
            assert(wallet.refundEntitlement(p.decisionId, p.participants[i]) == expected);
            vm.prank(p.participants[i]);
            wallet.claimRefund(p.decisionId);
            assert(token.balanceOf(p.participants[i]) == expected);
            vm.expectRevert();
            vm.prank(p.participants[i]);
            wallet.claimRefund(p.decisionId);
        }
        (,,, uint256 contributed, uint256 spent, uint256 refunded) = wallet.getDecision(p.decisionId);
        assert(spent + refunded == contributed && refunded == remaining);
        assert(token.balanceOf(address(wallet)) == 0);
    }

    function testTwoPeople() public {
        _lifecycle(2, 12_000_001);
    }

    function testFourPeople() public {
        _lifecycle(4, 36_000_003);
    }

    function testSixPeople() public {
        _lifecycle(6, 45_000_000);
    }

    function testEightPeople() public {
        _lifecycle(8, 45_000_003);
    }

    function testOneHundredPeople() public {
        _lifecycle(100, 60_000_007);
    }

    function testFuzzConservation(uint8 rawCount, uint64 rawPayment) public {
        uint256 count = uint256(rawCount) % 99 + 2;
        _lifecycle(count, uint256(rawPayment) % (count * 10_000_000) + 1);
    }

    function testCancelAndExpiryRecoverPartialContributions() public {
        PolicyV2 memory p = _policy(4, 36_000_000);
        _create(p);
        _contribute(p, 0);
        vm.prank(p.participants[1]);
        wallet.cancelDecision(p.decisionId);
        vm.prank(p.participants[0]);
        wallet.claimRefund(p.decisionId);
        assert(token.balanceOf(p.participants[0]) == 10_000_000);
        p.decisionId = bytes32(uint256(2));
        _create(p);
        _contribute(p, 2);
        vm.warp(p.expiry);
        vm.prank(p.participants[2]);
        wallet.claimRefund(p.decisionId);
        assert(token.balanceOf(p.participants[2]) == 10_000_000);
    }

    function testRejectInvalidMembershipThresholdAndVersion() public {
        PolicyV2 memory p = _policy(1, 1);
        vm.expectRevert();
        _create(p);
        p = _policy(101, 1);
        vm.expectRevert();
        _create(p);
        p = _policy(4, 1);
        p.approvalThreshold = 3;
        vm.expectRevert();
        _create(p);
        p = _policy(4, 1);
        p.participants[3] = p.participants[0];
        vm.expectRevert();
        _create(p);
        p = _policy(4, 1);
        p.policyVersion = 1;
        vm.expectRevert();
        _create(p);
        p = _policy(4, 1);
        p.participants = new address[](0);
        vm.expectRevert();
        wallet.createDecision(p);
    }
}
