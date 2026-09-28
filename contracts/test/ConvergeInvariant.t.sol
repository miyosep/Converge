// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConvergeGroupWallet} from "../src/ConvergeGroupWallet.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Policy, PolicyHash} from "../src/PolicyHash.sol";

interface InvariantVm {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
}

contract WalletHandler {
    InvariantVm private constant vm = InvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    ConvergeGroupWallet private immutable wallet;
    bytes32 private immutable decisionId;
    bytes32 private immutable policyHash;
    address private immutable executor;
    address private immutable merchant;
    address[6] private members;

    constructor(
        ConvergeGroupWallet wallet_,
        bytes32 decisionId_,
        bytes32 policyHash_,
        address executor_,
        address merchant_,
        address[6] memory members_
    ) {
        wallet = wallet_;
        decisionId = decisionId_;
        policyHash = policyHash_;
        executor = executor_;
        merchant = merchant_;
        members = members_;
    }

    function contribute(uint8 memberIndex) external {
        vm.prank(members[memberIndex % 6]);
        try wallet.approveAndContribute(decisionId, policyHash) {} catch {}
    }

    function pay(uint8 choice) external {
        address destination = choice % 3 == 0 ? address(0xBAD) : merchant;
        uint256 amount = choice % 3 == 1 ? 80_000_000 : 45_000_000;
        vm.prank(executor);
        try wallet.executePayment(decisionId, destination, amount) {} catch {}
    }

    function cancel(uint8 memberIndex) external {
        vm.prank(members[memberIndex % 6]);
        try wallet.cancelDecision(decisionId) {} catch {}
    }

    function expire(uint32 secondsForward) external {
        vm.warp(block.timestamp + (uint256(secondsForward) % 2 days));
        try wallet.expireDecision(decisionId) {} catch {}
    }

    function claim(uint8 memberIndex) external {
        vm.prank(members[memberIndex % 6]);
        try wallet.claimRefund(decisionId) {} catch {}
    }
}

contract ConvergeInvariantTest {
    struct FuzzSelector {
        address addr;
        bytes4[] selectors;
    }

    struct FuzzArtifactSelector {
        string artifact;
        bytes4[] selectors;
    }

    struct FuzzInterface {
        address addr;
        string[] artifacts;
    }

    InvariantVm private constant vm = InvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    bytes32 private constant ID = bytes32(uint256(1));
    MockUSDC private token;
    ConvergeGroupWallet private wallet;
    WalletHandler private handler;
    Policy private policy;
    address[6] private members;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockUSDC();
        wallet = new ConvergeGroupWallet(address(token));
        for (uint256 i; i < 6; ++i) {
            members[i] = address(uint160(0x100 + i));
            token.mint(members[i], 10_000_000);
            vm.prank(members[i]);
            token.approve(address(wallet), 10_000_000);
        }
        policy.policyVersion = 1;
        policy.chainId = block.chainid;
        policy.verifyingContract = address(wallet);
        policy.decisionId = ID;
        policy.token = address(token);
        policy.merchant = address(0x200);
        policy.executor = address(0x300);
        policy.participants = members;
        policy.approvalThreshold = 6;
        policy.contributionPerParticipant = 10_000_000;
        policy.paymentAmount = 45_000_000;
        policy.maxDeposit = 60_000_000;
        policy.maxTotalSpend = 60_000_000;
        policy.expiry = block.timestamp + 1 hours;
        policy.reservationReference = bytes32(uint256(0xabc));
        vm.prank(members[0]);
        wallet.createDecision(policy);
        bytes32 hash = PolicyHash.hash(policy);
        for (uint256 i; i < 4; ++i) {
            vm.prank(members[i]);
            wallet.approveAndContribute(ID, hash);
        }
        handler = new WalletHandler(wallet, ID, hash, policy.executor, policy.merchant, members);
    }

    function targetContracts() public view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(handler);
    }

    function targetSelectors() public view returns (FuzzSelector[] memory targets) {
        targets = new FuzzSelector[](1);
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = WalletHandler.contribute.selector;
        selectors[1] = WalletHandler.pay.selector;
        selectors[2] = WalletHandler.cancel.selector;
        selectors[3] = WalletHandler.expire.selector;
        selectors[4] = WalletHandler.claim.selector;
        targets[0] = FuzzSelector({addr: address(handler), selectors: selectors});
    }

    function targetArtifactSelectors() public pure returns (FuzzArtifactSelector[] memory) {
        return new FuzzArtifactSelector[](0);
    }

    function targetArtifacts() public pure returns (string[] memory) {
        return new string[](0);
    }

    function excludeArtifacts() public pure returns (string[] memory) {
        return new string[](0);
    }

    function targetSenders() public pure returns (address[] memory) {
        return new address[](0);
    }

    function excludeSenders() public pure returns (address[] memory) {
        return new address[](0);
    }

    function excludeContracts() public pure returns (address[] memory) {
        return new address[](0);
    }

    function targetInterfaces() public pure returns (FuzzInterface[] memory) {
        return new FuzzInterface[](0);
    }

    function excludeSelectors() public pure returns (FuzzSelector[] memory) {
        return new FuzzSelector[](0);
    }

    function invariant_PerDecisionAccountingAndPolicyStayValid() public view {
        (
            bytes32 storedHash,
            ConvergeGroupWallet.Status status,
            uint256 approvals,
            uint256 contributed,
            uint256 spent,
            uint256 refunded
        ) = wallet.getDecision(ID);
        assert(storedHash == PolicyHash.hash(policy));
        assert(wallet.getPolicy(ID).merchant == policy.merchant);
        assert(approvals <= 6 && contributed == approvals * 10_000_000);
        assert(spent <= policy.maxDeposit && spent <= policy.maxTotalSpend);
        assert(spent + refunded <= contributed);
        assert(token.balanceOf(address(wallet)) == contributed - spent - refunded);
        if (status == ConvergeGroupWallet.Status.Active) assert(approvals == 6 && spent == 0);
        if (status == ConvergeGroupWallet.Status.Completed) assert(approvals == 6 && spent == policy.paymentAmount);
        if (status == ConvergeGroupWallet.Status.Funding) assert(approvals < 6 && spent == 0);
        if (status == ConvergeGroupWallet.Status.Cancelled || status == ConvergeGroupWallet.Status.Expired) {
            assert(spent == 0);
        }
        if (
            status == ConvergeGroupWallet.Status.Completed || status == ConvergeGroupWallet.Status.Cancelled
                || status == ConvergeGroupWallet.Status.Expired
        ) {
            uint256 remainingEntitlements;
            for (uint256 i; i < 6; ++i) {
                remainingEntitlements += wallet.refundEntitlement(ID, members[i]);
            }
            assert(remainingEntitlements + refunded == contributed - spent);
        }
    }
}
