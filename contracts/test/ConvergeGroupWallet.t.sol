// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConvergeGroupWallet} from "../src/ConvergeGroupWallet.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {Policy, PolicyHash} from "../src/PolicyHash.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface Vm {
    function prank(address sender) external;
    function warp(uint256 timestamp) external;
    function expectRevert() external;
    function expectRevert(bytes calldata revertData) external;
    function expectRevert(bytes4 selector) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);

    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }
}

contract FailingMockUSDC is MockUSDC {
    address public blockedSender;

    function blockSender(address sender) external {
        blockedSender = sender;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (blockedSender != address(0) && from == blockedSender) revert("TRANSFER_BLOCKED");
        super._update(from, to, amount);
    }
}

contract ReenteringMockUSDC is MockUSDC {
    address private callbackWallet;
    address private callbackMerchant;
    uint256 private callbackAmount;
    bool private callbackEnabled;
    bytes4 public callbackError;

    function configure(address walletAddress, address merchant, uint256 amount) external {
        callbackWallet = walletAddress;
        callbackMerchant = merchant;
        callbackAmount = amount;
        callbackEnabled = true;
    }

    function pay(ConvergeGroupWallet wallet, address merchant, uint256 amount) external {
        wallet.executePayment(bytes32(uint256(1)), merchant, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (callbackEnabled && from == callbackWallet) {
            callbackEnabled = false;
            (bool succeeded, bytes memory revertData) = callbackWallet.call(
                abi.encodeWithSelector(
                    ConvergeGroupWallet.executePayment.selector, bytes32(uint256(1)), callbackMerchant, callbackAmount
                )
            );
            if (!succeeded && revertData.length >= 4) {
                bytes4 selector;
                assembly {
                    selector := mload(add(revertData, 32))
                }
                callbackError = selector;
            }
        }
        super._update(from, to, amount);
    }
}

contract ConvergeGroupWalletTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant CONTRIBUTION = 10_000_000;
    uint256 private constant FUNDING = 60_000_000;
    bytes32 private constant ID = bytes32(uint256(1));
    address private constant MERCHANT = address(0x200);
    address private constant EXECUTOR = address(0x300);
    address private constant OUTSIDER = address(0x400);

    MockUSDC private token;
    ConvergeGroupWallet private wallet;
    address[6] private members;

    function setUp() public {
        vm.warp(1_000_000);
        token = new MockUSDC();
        wallet = new ConvergeGroupWallet(address(token));
        for (uint256 i; i < 6; ++i) {
            members[i] = address(uint160(0x100 + i));
            token.mint(members[i], 100_000_000);
            vm.prank(members[i]);
            token.approve(address(wallet), type(uint256).max);
        }
    }

    function testMockTokenOnlyDeployerCanMint() public {
        assert(token.decimals() == 6);
        assert(token.minter() == address(this));
        vm.expectRevert(MockUSDC.OnlyMinter.selector);
        vm.prank(OUTSIDER);
        token.mint(OUTSIDER, 1);
        assert(token.balanceOf(OUTSIDER) == 0);
    }

    function testCreationStoresImmutablePolicyHashAndRejectsDuplicateId() public {
        Policy memory policy = _policy(ID);
        bytes32 expected = PolicyHash.hash(policy);
        _create(policy);
        (bytes32 stored, ConvergeGroupWallet.Status status, uint256 approvals,,,) = wallet.getDecision(ID);
        assert(stored == expected);
        assert(status == ConvergeGroupWallet.Status.Funding);
        assert(approvals == 0);
        assert(wallet.getPolicy(ID).merchant == MERCHANT);
        vm.expectRevert(abi.encodeWithSelector(ConvergeGroupWallet.DecisionAlreadyExists.selector, ID));
        vm.prank(members[0]);
        wallet.createDecision(policy);
    }

    function testCreationRejectsInvalidDomainMembershipAndAmounts() public {
        Policy memory policy = _policy(ID);
        policy.policyVersion = 2;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.UnsupportedVersion);
        policy = _policy(ID);
        policy.chainId = block.chainid + 1;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.WrongChain);
        policy = _policy(ID);
        policy.verifyingContract = OUTSIDER;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.WrongContract);
        policy = _policy(ID);
        policy.token = OUTSIDER;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.WrongToken);
        policy = _policy(ID);
        policy.decisionId = bytes32(0);
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.InvalidDecisionId);
        policy = _policy(ID);
        policy.participants[1] = policy.participants[0];
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.DuplicateParticipant);
        policy = _policy(ID);
        policy.participants[1] = address(0);
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.InvalidParticipant);
        policy = _policy(ID);
        policy.participants[0] = OUTSIDER;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.CreatorNotParticipant);
        policy = _policy(ID);
        policy.approvalThreshold = 5;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.WrongThreshold);
        policy = _policy(ID);
        policy.contributionPerParticipant = 0;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.InvalidContribution);
        policy = _policy(ID);
        policy.contributionPerParticipant = type(uint256).max / 6 + 1;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.InvalidContribution);
        policy = _policy(ID);
        policy.merchant = address(wallet);
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.InvalidMerchant);
        policy = _policy(ID);
        policy.executor = address(0);
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.InvalidExecutor);
        policy = _policy(ID);
        policy.paymentAmount = FUNDING + 1;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.InvalidAmounts);
    }

    function testExpiryMustBeFutureAndAtMost24Hours() public {
        Policy memory policy = _policy(ID);
        policy.expiry = block.timestamp;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.InvalidExpiry);
        policy.expiry = block.timestamp + 1 days + 1;
        _expectInvalidPolicy(policy, ConvergeGroupWallet.PolicyError.InvalidExpiry);
        policy.expiry = block.timestamp + 1 days;
        _create(policy);
    }

    function testOnlyMembersCreateAndContributeWithMatchingHash() public {
        Policy memory policy = _policy(ID);
        vm.expectRevert(
            abi.encodeWithSelector(
                ConvergeGroupWallet.InvalidPolicy.selector, ConvergeGroupWallet.PolicyError.CreatorNotParticipant
            )
        );
        vm.prank(OUTSIDER);
        wallet.createDecision(policy);
        _create(policy);
        bytes32 hash = PolicyHash.hash(policy);
        vm.expectRevert(ConvergeGroupWallet.NotParticipant.selector);
        vm.prank(OUTSIDER);
        wallet.approveAndContribute(ID, hash);
        vm.expectRevert(abi.encodeWithSelector(ConvergeGroupWallet.ApprovalHashMismatch.selector, bytes32(0), hash));
        vm.prank(members[0]);
        wallet.approveAndContribute(ID, bytes32(0));
        assert(wallet.contributionOf(ID, members[0]) == 0);
        vm.prank(members[0]);
        wallet.approveAndContribute(ID, hash);
        vm.expectRevert(ConvergeGroupWallet.AlreadyApproved.selector);
        vm.prank(members[0]);
        wallet.approveAndContribute(ID, hash);
    }

    function testTransferFailureDoesNotRecordApproval() public {
        Policy memory policy = _policy(ID);
        _create(policy);
        token.mint(OUTSIDER, CONTRIBUTION);
        vm.prank(members[0]);
        token.approve(address(wallet), 0);
        vm.expectRevert();
        vm.prank(members[0]);
        wallet.approveAndContribute(ID, PolicyHash.hash(policy));
        (, ConvergeGroupWallet.Status status, uint256 approvals, uint256 contributed,,) = wallet.getDecision(ID);
        assert(status == ConvergeGroupWallet.Status.Funding);
        assert(approvals == 0 && contributed == 0);
        assert(wallet.contributionOf(ID, members[0]) == 0);
    }

    function testSixthContributionActivatesExactlyOnce() public {
        Policy memory policy = _policy(ID);
        _create(policy);
        bytes32 hash = PolicyHash.hash(policy);
        for (uint256 i; i < 5; ++i) {
            vm.prank(members[i]);
            wallet.approveAndContribute(ID, hash);
            (, ConvergeGroupWallet.Status currentStatus, uint256 currentApprovals, uint256 currentContributed,,) =
                wallet.getDecision(ID);
            assert(currentStatus == ConvergeGroupWallet.Status.Funding);
            assert(currentApprovals == i + 1);
            assert(currentContributed == (i + 1) * CONTRIBUTION);
        }
        vm.prank(members[5]);
        wallet.approveAndContribute(ID, hash);
        (, ConvergeGroupWallet.Status status, uint256 approvals, uint256 contributed,,) = wallet.getDecision(ID);
        assert(status == ConvergeGroupWallet.Status.Active);
        assert(approvals == 6 && contributed == FUNDING);
        vm.expectRevert(ConvergeGroupWallet.DecisionNotFunding.selector);
        vm.prank(members[5]);
        wallet.approveAndContribute(ID, hash);
    }

    function testPaymentValidationOrderAndEnforcement() public {
        Policy memory policy = _policy(ID);
        (bool allowed, ConvergeGroupWallet.RejectReason reason) =
            wallet.validatePayment(ID, EXECUTOR, MERCHANT, 45_000_000);
        assert(!allowed && reason == ConvergeGroupWallet.RejectReason.UnknownDecision);
        _create(policy);
        _assertRejected(ID, EXECUTOR, MERCHANT, 45_000_000, ConvergeGroupWallet.RejectReason.NotActive);
        _contributeAll(policy);
        _assertRejected(ID, OUTSIDER, MERCHANT, 45_000_000, ConvergeGroupWallet.RejectReason.WrongExecutor);
        _assertRejected(ID, EXECUTOR, OUTSIDER, 45_000_000, ConvergeGroupWallet.RejectReason.MerchantNotAllowed);
        _assertRejected(ID, EXECUTOR, MERCHANT, 0, ConvergeGroupWallet.RejectReason.ZeroAmount);
        _assertRejected(ID, EXECUTOR, MERCHANT, 80_000_000, ConvergeGroupWallet.RejectReason.MaxDepositExceeded);
        _assertRejected(ID, EXECUTOR, MERCHANT, 44_000_000, ConvergeGroupWallet.RejectReason.AmountNotApproved);
        (allowed, reason) = wallet.validatePayment(ID, EXECUTOR, MERCHANT, 45_000_000);
        assert(allowed && reason == ConvergeGroupWallet.RejectReason.None);
        vm.prank(EXECUTOR);
        wallet.executePayment(ID, MERCHANT, 45_000_000);
        vm.expectRevert(ConvergeGroupWallet.DecisionNotCancellable.selector);
        vm.prank(members[0]);
        wallet.cancelDecision(ID);
        assert(token.balanceOf(MERCHANT) == 45_000_000);
        (, ConvergeGroupWallet.Status status,, uint256 contributed, uint256 spent, uint256 refunded) =
            wallet.getDecision(ID);
        assert(status == ConvergeGroupWallet.Status.Completed);
        assert(contributed == FUNDING && spent == 45_000_000 && refunded == 0);
        _assertRejected(ID, EXECUTOR, MERCHANT, 45_000_000, ConvergeGroupWallet.RejectReason.NotActive);
    }

    function testPaymentEventsContainDecisionAndMerchant() public {
        Policy memory policy = _policy(ID);
        _create(policy);
        _contributeAll(policy);
        vm.recordLogs();
        vm.prank(EXECUTOR);
        wallet.executePayment(ID, MERCHANT, 45_000_000);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool paymentFound;
        bool completionFound;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(wallet)) continue;
            if (logs[i].topics[0] == keccak256("PaymentExecuted(bytes32,address,address,uint256)")) {
                paymentFound = true;
                assert(logs[i].topics[1] == ID);
                assert(logs[i].topics[2] == bytes32(uint256(uint160(EXECUTOR))));
                assert(logs[i].topics[3] == bytes32(uint256(uint160(MERCHANT))));
                assert(abi.decode(logs[i].data, (uint256)) == 45_000_000);
            }
            if (logs[i].topics[0] == keccak256("DecisionCompleted(bytes32,uint256)")) {
                completionFound = true;
                assert(abi.decode(logs[i].data, (uint256)) == 15_000_000);
            }
        }
        assert(paymentFound && completionFound);
    }

    function testCompletedRefundsAndRepeatClaimProtection() public {
        Policy memory policy = _policy(ID);
        _create(policy);
        _contributeAll(policy);
        vm.prank(EXECUTOR);
        wallet.executePayment(ID, MERCHANT, 45_000_000);
        for (uint256 i; i < 6; ++i) {
            uint256 beforeBalance = token.balanceOf(members[i]);
            assert(wallet.refundEntitlement(ID, members[i]) == 2_500_000);
            vm.prank(members[i]);
            wallet.claimRefund(ID);
            assert(token.balanceOf(members[i]) == beforeBalance + 2_500_000);
            assert(wallet.refundEntitlement(ID, members[i]) == 0);
        }
        assert(token.balanceOf(address(wallet)) == 0);
        (,,,,, uint256 refunded) = wallet.getDecision(ID);
        assert(refunded == 15_000_000);
        vm.expectRevert(ConvergeGroupWallet.RefundAlreadyClaimed.selector);
        vm.prank(members[0]);
        wallet.claimRefund(ID);
    }

    function testChangedMerchantRunPays36AndRefunds4Each() public {
        Policy memory policy = _policy(ID);
        policy.merchant = address(0x201);
        policy.paymentAmount = 36_000_000;
        _create(policy);
        _contributeAll(policy);
        _assertRejected(ID, EXECUTOR, MERCHANT, 36_000_000, ConvergeGroupWallet.RejectReason.MerchantNotAllowed);
        vm.prank(EXECUTOR);
        wallet.executePayment(ID, policy.merchant, policy.paymentAmount);
        for (uint256 i; i < 6; ++i) {
            assert(wallet.refundEntitlement(ID, members[i]) == 4_000_000);
            vm.prank(members[i]);
            wallet.claimRefund(ID);
        }
        assert(token.balanceOf(address(wallet)) == 0);
    }

    function testCancellationRefundsPartialFunding() public {
        Policy memory policy = _policy(ID);
        _create(policy);
        bytes32 hash = PolicyHash.hash(policy);
        for (uint256 i; i < 3; ++i) {
            vm.prank(members[i]);
            wallet.approveAndContribute(ID, hash);
        }
        vm.expectRevert(ConvergeGroupWallet.NotParticipant.selector);
        vm.prank(OUTSIDER);
        wallet.cancelDecision(ID);
        vm.prank(members[4]);
        wallet.cancelDecision(ID);
        (, ConvergeGroupWallet.Status status,,,,) = wallet.getDecision(ID);
        assert(status == ConvergeGroupWallet.Status.Cancelled);
        for (uint256 i; i < 3; ++i) {
            assert(wallet.refundEntitlement(ID, members[i]) == CONTRIBUTION);
            vm.prank(members[i]);
            wallet.claimRefund(ID);
        }
        assert(token.balanceOf(address(wallet)) == 0);
        vm.expectRevert(ConvergeGroupWallet.NoContribution.selector);
        vm.prank(members[5]);
        wallet.claimRefund(ID);
    }

    function testExpiredPartialFundingReturnsEachContribution() public {
        Policy memory policy = _policy(ID);
        _create(policy);
        vm.prank(members[0]);
        wallet.approveAndContribute(ID, PolicyHash.hash(policy));
        vm.warp(policy.expiry);
        vm.prank(members[0]);
        wallet.claimRefund(ID);
        (, ConvergeGroupWallet.Status status,,,, uint256 refunded) = wallet.getDecision(ID);
        assert(status == ConvergeGroupWallet.Status.Expired);
        assert(refunded == CONTRIBUTION);
        assert(token.balanceOf(address(wallet)) == 0);
    }

    function testZeroRemainderCanBeClaimedOnce() public {
        Policy memory policy = _policy(ID);
        policy.paymentAmount = FUNDING;
        _create(policy);
        _contributeAll(policy);
        vm.prank(EXECUTOR);
        wallet.executePayment(ID, MERCHANT, FUNDING);
        vm.prank(members[0]);
        wallet.claimRefund(ID);
        assert(wallet.refundClaimed(ID, members[0]));
        assert(wallet.refundEntitlement(ID, members[0]) == 0);
        vm.expectRevert(ConvergeGroupWallet.RefundAlreadyClaimed.selector);
        vm.prank(members[0]);
        wallet.claimRefund(ID);
    }

    function testExactlyAtExpiryPaymentFailsAndClaimFinalizesExpiry() public {
        Policy memory policy = _policy(ID);
        _create(policy);
        _contributeAll(policy);
        vm.warp(policy.expiry - 1);
        (bool allowed,) = wallet.validatePayment(ID, EXECUTOR, MERCHANT, policy.paymentAmount);
        assert(allowed);
        vm.warp(policy.expiry);
        _assertRejected(ID, EXECUTOR, MERCHANT, policy.paymentAmount, ConvergeGroupWallet.RejectReason.Expired);
        assert(wallet.refundEntitlement(ID, members[0]) == CONTRIBUTION);
        vm.prank(members[0]);
        wallet.claimRefund(ID);
        (, ConvergeGroupWallet.Status status,,,,) = wallet.getDecision(ID);
        assert(status == ConvergeGroupWallet.Status.Expired);
        vm.expectRevert(ConvergeGroupWallet.DecisionNotExpired.selector);
        wallet.expireDecision(ID);
    }

    function testTwoDecisionsAndDirectDonationStayIsolated() public {
        Policy memory first = _policy(ID);
        Policy memory second = _policy(bytes32(uint256(2)));
        second.paymentAmount = 36_000_000;
        _create(first);
        _create(second);
        _contributeAll(first);
        _contributeAll(second);
        token.mint(address(wallet), 5_000_000);
        vm.prank(EXECUTOR);
        wallet.executePayment(ID, MERCHANT, first.paymentAmount);
        (,,,, uint256 secondSpent,) = wallet.getDecision(second.decisionId);
        assert(secondSpent == 0);
        for (uint256 i; i < 6; ++i) {
            vm.prank(members[i]);
            wallet.claimRefund(ID);
        }
        assert(token.balanceOf(address(wallet)) == FUNDING + 5_000_000);
        vm.prank(EXECUTOR);
        wallet.executePayment(second.decisionId, MERCHANT, second.paymentAmount);
        for (uint256 i; i < 6; ++i) {
            vm.prank(members[i]);
            wallet.claimRefund(second.decisionId);
        }
        assert(token.balanceOf(address(wallet)) == 5_000_000);
    }

    function testTransferRevertsRollBackPaymentAndRefundAccounting() public {
        FailingMockUSDC failing = new FailingMockUSDC();
        ConvergeGroupWallet separate = new ConvergeGroupWallet(address(failing));
        Policy memory policy = _policyFor(ID, address(failing), address(separate));
        for (uint256 i; i < 6; ++i) {
            failing.mint(members[i], CONTRIBUTION);
            vm.prank(members[i]);
            failing.approve(address(separate), CONTRIBUTION);
        }
        vm.prank(members[0]);
        separate.createDecision(policy);
        for (uint256 i; i < 6; ++i) {
            vm.prank(members[i]);
            separate.approveAndContribute(ID, PolicyHash.hash(policy));
        }
        failing.blockSender(address(separate));
        vm.expectRevert();
        vm.prank(EXECUTOR);
        separate.executePayment(ID, MERCHANT, policy.paymentAmount);
        (, ConvergeGroupWallet.Status status,,, uint256 spent,) = separate.getDecision(ID);
        assert(status == ConvergeGroupWallet.Status.Active && spent == 0);
        vm.prank(members[0]);
        separate.cancelDecision(ID);
        vm.expectRevert();
        vm.prank(members[0]);
        separate.claimRefund(ID);
        (,,,,, uint256 refunded) = separate.getDecision(ID);
        assert(refunded == 0 && !separate.refundClaimed(ID, members[0]));
        failing.blockSender(address(0));
        vm.prank(members[0]);
        separate.claimRefund(ID);
    }

    function testTokenCallbackCannotReenterPayment() public {
        ReenteringMockUSDC callbackToken = new ReenteringMockUSDC();
        ConvergeGroupWallet separate = new ConvergeGroupWallet(address(callbackToken));
        Policy memory policy = _policyFor(ID, address(callbackToken), address(separate));
        policy.executor = address(callbackToken);
        for (uint256 i; i < 6; ++i) {
            callbackToken.mint(members[i], CONTRIBUTION);
            vm.prank(members[i]);
            callbackToken.approve(address(separate), CONTRIBUTION);
        }
        vm.prank(members[0]);
        separate.createDecision(policy);
        for (uint256 i; i < 6; ++i) {
            vm.prank(members[i]);
            separate.approveAndContribute(ID, PolicyHash.hash(policy));
        }
        callbackToken.configure(address(separate), MERCHANT, policy.paymentAmount);
        callbackToken.pay(separate, MERCHANT, policy.paymentAmount);
        assert(callbackToken.callbackError() == ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        (,,, uint256 contributed, uint256 spent,) = separate.getDecision(ID);
        assert(contributed == FUNDING && spent == policy.paymentAmount);
    }

    function testFuzzRefundRoundingAndAccounting(uint256 requestedPayment) public {
        uint256 payment = 1 + (requestedPayment % FUNDING);
        Policy memory policy = _policy(ID);
        policy.paymentAmount = payment;
        _create(policy);
        _contributeAll(policy);
        vm.prank(EXECUTOR);
        wallet.executePayment(ID, MERCHANT, payment);
        uint256 remaining = FUNDING - payment;
        uint256 sum;
        for (uint256 i; i < 6; ++i) {
            uint256 expected = remaining / 6 + (i < remaining % 6 ? 1 : 0);
            assert(wallet.refundEntitlement(ID, members[i]) == expected);
            vm.prank(members[i]);
            wallet.claimRefund(ID);
            sum += expected;
        }
        (,,, uint256 contributed, uint256 spent, uint256 refunded) = wallet.getDecision(ID);
        assert(sum == remaining && spent + refunded == contributed);
    }

    function _policy(bytes32 decisionId) private view returns (Policy memory) {
        return _policyFor(decisionId, address(token), address(wallet));
    }

    function _policyFor(bytes32 decisionId, address tokenAddress, address walletAddress)
        private
        view
        returns (Policy memory policy)
    {
        policy.policyVersion = 1;
        policy.chainId = block.chainid;
        policy.verifyingContract = walletAddress;
        policy.decisionId = decisionId;
        policy.token = tokenAddress;
        policy.merchant = MERCHANT;
        policy.executor = EXECUTOR;
        policy.participants = members;
        policy.approvalThreshold = 6;
        policy.contributionPerParticipant = CONTRIBUTION;
        policy.paymentAmount = 45_000_000;
        policy.maxDeposit = FUNDING;
        policy.maxTotalSpend = FUNDING;
        policy.expiry = block.timestamp + 1 hours;
        policy.reservationReference = bytes32(uint256(0xabc));
    }

    function _create(Policy memory policy) private {
        vm.prank(members[0]);
        wallet.createDecision(policy);
    }

    function _contributeAll(Policy memory policy) private {
        bytes32 hash = PolicyHash.hash(policy);
        for (uint256 i; i < 6; ++i) {
            vm.prank(members[i]);
            wallet.approveAndContribute(policy.decisionId, hash);
        }
    }

    function _expectInvalidPolicy(Policy memory policy, ConvergeGroupWallet.PolicyError reason) private {
        vm.expectRevert(abi.encodeWithSelector(ConvergeGroupWallet.InvalidPolicy.selector, reason));
        vm.prank(members[0]);
        wallet.createDecision(policy);
    }

    function _assertRejected(
        bytes32 decisionId,
        address caller,
        address merchant,
        uint256 amount,
        ConvergeGroupWallet.RejectReason expected
    ) private {
        (bool allowed, ConvergeGroupWallet.RejectReason reason) =
            wallet.validatePayment(decisionId, caller, merchant, amount);
        assert(!allowed && reason == expected);
        vm.expectRevert(abi.encodeWithSelector(ConvergeGroupWallet.PaymentNotAllowed.selector, expected));
        vm.prank(caller);
        wallet.executePayment(decisionId, merchant, amount);
    }
}
