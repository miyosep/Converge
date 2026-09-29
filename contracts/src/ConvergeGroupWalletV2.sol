// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PolicyV2 as Policy, PolicyHashV2 as PolicyHash} from "./PolicyHashV2.sol";

contract ConvergeGroupWalletV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant POLICY_VERSION = 2;
    uint256 public constant MIN_MEMBERS = 2;
    uint256 public constant MAX_MEMBERS = 100;
    uint256 public constant MAX_LIFETIME = 1 days;

    enum Status {
        Funding,
        Active,
        Completed,
        Cancelled,
        Expired
    }

    enum PolicyError {
        UnsupportedVersion,
        WrongChain,
        WrongContract,
        WrongToken,
        InvalidDecisionId,
        InvalidParticipant,
        DuplicateParticipant,
        CreatorNotParticipant,
        WrongThreshold,
        InvalidContribution,
        InvalidMerchant,
        InvalidExecutor,
        InvalidExpiry,
        InvalidAmounts
    }

    enum RejectReason {
        None,
        UnknownDecision,
        WrongExecutor,
        NotActive,
        InsufficientApprovals,
        Expired,
        MerchantNotAllowed,
        ZeroAmount,
        MaxDepositExceeded,
        MaxTotalSpendExceeded,
        AmountNotApproved,
        InsufficientDecisionBalance
    }

    struct Decision {
        Policy policy;
        bytes32 policyHash;
        Status status;
        uint256 approvalCount;
        uint256 totalContributed;
        uint256 totalSpent;
        uint256 totalRefunded;
        bool exists;
    }

    IERC20 public immutable token;
    mapping(bytes32 => Decision) private decisions;
    mapping(bytes32 => mapping(address => uint256)) public contributionOf;
    mapping(bytes32 => mapping(address => bool)) public refundClaimed;

    error InvalidToken();
    error InvalidPolicy(PolicyError reason);
    error DecisionAlreadyExists(bytes32 decisionId);
    error UnknownDecision(bytes32 decisionId);
    error NotParticipant();
    error AlreadyApproved();
    error ApprovalHashMismatch(bytes32 expected, bytes32 actual);
    error DecisionNotFunding();
    error PolicyExpired(bytes32 decisionId);
    error PaymentNotAllowed(RejectReason reason);
    error DecisionNotCancellable();
    error DecisionNotExpired();
    error RefundNotAvailable();
    error NoContribution();
    error RefundAlreadyClaimed();
    error InvalidTokenReceipt(uint256 expected, uint256 received);

    event DecisionCreated(bytes32 indexed decisionId, bytes32 indexed policyHash, address indexed creator);
    event ParticipantApproved(
        bytes32 indexed decisionId, address indexed participant, uint256 contribution, uint256 approvalCount
    );
    event WalletActivated(bytes32 indexed decisionId, uint256 totalContributed);
    event PaymentExecuted(
        bytes32 indexed decisionId, address indexed executor, address indexed merchant, uint256 amount
    );
    event DecisionCompleted(bytes32 indexed decisionId, uint256 remaining);
    event DecisionCancelled(bytes32 indexed decisionId, address indexed participant);
    event DecisionExpired(bytes32 indexed decisionId);
    event RefundClaimed(bytes32 indexed decisionId, address indexed participant, uint256 amount);

    constructor(address tokenAddress) {
        if (tokenAddress == address(0) || tokenAddress.code.length == 0) revert InvalidToken();
        if (IERC20Metadata(tokenAddress).decimals() != 6) revert InvalidToken();
        token = IERC20(tokenAddress);
    }

    function createDecision(Policy calldata policy) external returns (bytes32 decisionId) {
        decisionId = policy.decisionId;
        if (decisions[decisionId].exists) revert DecisionAlreadyExists(decisionId);
        _validatePolicy(policy);

        Decision storage decision = decisions[decisionId];
        decision.policy = policy;
        decision.policyHash = PolicyHash.hash(policy);
        decision.status = Status.Funding;
        decision.exists = true;
        emit DecisionCreated(decisionId, decision.policyHash, msg.sender);
    }

    function approveAndContribute(bytes32 decisionId, bytes32 expectedDecisionHash) external nonReentrant {
        Decision storage decision = _decision(decisionId);
        if (decision.status != Status.Funding) revert DecisionNotFunding();
        if (block.timestamp >= decision.policy.expiry) revert PolicyExpired(decisionId);
        if (expectedDecisionHash != decision.policyHash) {
            revert ApprovalHashMismatch(expectedDecisionHash, decision.policyHash);
        }
        if (!_isParticipant(decision.policy, msg.sender)) revert NotParticipant();
        if (contributionOf[decisionId][msg.sender] != 0) revert AlreadyApproved();

        uint256 amount = decision.policy.contributionPerParticipant;
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert InvalidTokenReceipt(amount, received);

        contributionOf[decisionId][msg.sender] = amount;
        decision.totalContributed += amount;
        decision.approvalCount += 1;
        emit ParticipantApproved(decisionId, msg.sender, amount, decision.approvalCount);

        if (decision.approvalCount == decision.policy.participants.length) {
            decision.status = Status.Active;
            emit WalletActivated(decisionId, decision.totalContributed);
        }
    }

    function validatePayment(bytes32 decisionId, address caller, address to, uint256 amount)
        external
        view
        returns (bool allowed, RejectReason reason)
    {
        reason = _paymentRejectReason(decisionId, caller, to, amount);
        allowed = reason == RejectReason.None;
    }

    function executePayment(bytes32 decisionId, address to, uint256 amount) external nonReentrant {
        RejectReason reason = _paymentRejectReason(decisionId, msg.sender, to, amount);
        if (reason != RejectReason.None) revert PaymentNotAllowed(reason);

        Decision storage decision = decisions[decisionId];
        decision.status = Status.Completed;
        decision.totalSpent = amount;
        token.safeTransfer(to, amount);
        emit PaymentExecuted(decisionId, msg.sender, to, amount);
        emit DecisionCompleted(decisionId, decision.totalContributed - amount);
    }

    function cancelDecision(bytes32 decisionId) external {
        Decision storage decision = _decision(decisionId);
        if (!_isParticipant(decision.policy, msg.sender)) revert NotParticipant();
        if (decision.status != Status.Funding && decision.status != Status.Active) {
            revert DecisionNotCancellable();
        }
        if (block.timestamp >= decision.policy.expiry) revert PolicyExpired(decisionId);
        decision.status = Status.Cancelled;
        emit DecisionCancelled(decisionId, msg.sender);
    }

    function expireDecision(bytes32 decisionId) external {
        Decision storage decision = _decision(decisionId);
        if (block.timestamp < decision.policy.expiry) revert DecisionNotExpired();
        if (decision.status != Status.Funding && decision.status != Status.Active) {
            revert DecisionNotExpired();
        }
        _expireDecision(decisionId, decision);
    }

    function claimRefund(bytes32 decisionId) external nonReentrant {
        Decision storage decision = _decision(decisionId);
        if (
            (decision.status == Status.Funding || decision.status == Status.Active)
                && block.timestamp >= decision.policy.expiry
        ) {
            _expireDecision(decisionId, decision);
        }
        if (!_isTerminal(decision.status)) revert RefundNotAvailable();
        uint256 contributed = contributionOf[decisionId][msg.sender];
        if (contributed == 0) revert NoContribution();
        if (refundClaimed[decisionId][msg.sender]) revert RefundAlreadyClaimed();

        uint256 amount = _refundEntitlement(decision, msg.sender, contributed);
        refundClaimed[decisionId][msg.sender] = true;
        decision.totalRefunded += amount;
        if (amount != 0) token.safeTransfer(msg.sender, amount);
        emit RefundClaimed(decisionId, msg.sender, amount);
    }

    function getPolicy(bytes32 decisionId) external view returns (Policy memory) {
        return _decision(decisionId).policy;
    }

    function getDecision(bytes32 decisionId)
        external
        view
        returns (
            bytes32 policyHash,
            Status status,
            uint256 approvalCount,
            uint256 totalContributed,
            uint256 totalSpent,
            uint256 totalRefunded
        )
    {
        Decision storage decision = _decision(decisionId);
        return (
            decision.policyHash,
            decision.status,
            decision.approvalCount,
            decision.totalContributed,
            decision.totalSpent,
            decision.totalRefunded
        );
    }

    function refundEntitlement(bytes32 decisionId, address participant) external view returns (uint256) {
        Decision storage decision = _decision(decisionId);
        if (!_isTerminal(decision.status) && block.timestamp < decision.policy.expiry) return 0;
        uint256 contributed = contributionOf[decisionId][participant];
        if (contributed == 0 || refundClaimed[decisionId][participant]) return 0;
        return _refundEntitlement(decision, participant, contributed);
    }

    function _validatePolicy(Policy calldata policy) private view {
        if (policy.policyVersion != POLICY_VERSION) revert InvalidPolicy(PolicyError.UnsupportedVersion);
        if (policy.chainId != block.chainid) revert InvalidPolicy(PolicyError.WrongChain);
        if (policy.verifyingContract != address(this)) revert InvalidPolicy(PolicyError.WrongContract);
        if (policy.token != address(token)) revert InvalidPolicy(PolicyError.WrongToken);
        if (policy.decisionId == bytes32(0)) revert InvalidPolicy(PolicyError.InvalidDecisionId);

        if (policy.participants.length < MIN_MEMBERS || policy.participants.length > MAX_MEMBERS) {
            revert InvalidPolicy(PolicyError.InvalidParticipant);
        }
        bool creatorFound = false;
        for (uint256 i; i < policy.participants.length; ++i) {
            address participant = policy.participants[i];
            if (participant == address(0)) revert InvalidPolicy(PolicyError.InvalidParticipant);
            if (participant == msg.sender) creatorFound = true;
            for (uint256 j; j < i; ++j) {
                if (participant == policy.participants[j]) revert InvalidPolicy(PolicyError.DuplicateParticipant);
            }
        }
        if (!creatorFound) revert InvalidPolicy(PolicyError.CreatorNotParticipant);
        if (policy.approvalThreshold != policy.participants.length) revert InvalidPolicy(PolicyError.WrongThreshold);
        if (
            policy.contributionPerParticipant == 0
                || policy.contributionPerParticipant > type(uint256).max / policy.participants.length
        ) {
            revert InvalidPolicy(PolicyError.InvalidContribution);
        }
        if (policy.merchant == address(0) || policy.merchant == address(this)) {
            revert InvalidPolicy(PolicyError.InvalidMerchant);
        }
        if (policy.executor == address(0)) revert InvalidPolicy(PolicyError.InvalidExecutor);
        if (policy.expiry <= block.timestamp || policy.expiry - block.timestamp > MAX_LIFETIME) {
            revert InvalidPolicy(PolicyError.InvalidExpiry);
        }
        uint256 funding = policy.contributionPerParticipant * policy.participants.length;
        if (
            policy.paymentAmount == 0 || policy.paymentAmount > policy.maxDeposit
                || policy.maxDeposit > policy.maxTotalSpend || policy.maxTotalSpend > funding
        ) {
            revert InvalidPolicy(PolicyError.InvalidAmounts);
        }
    }

    function _paymentRejectReason(bytes32 decisionId, address caller, address to, uint256 amount)
        private
        view
        returns (RejectReason)
    {
        Decision storage decision = decisions[decisionId];
        if (!decision.exists) return RejectReason.UnknownDecision;
        if (caller != decision.policy.executor) return RejectReason.WrongExecutor;
        if (decision.status != Status.Active) return RejectReason.NotActive;
        if (
            decision.approvalCount != decision.policy.participants.length
                || decision.totalContributed < decision.policy.paymentAmount
        ) {
            return RejectReason.InsufficientApprovals;
        }
        if (block.timestamp >= decision.policy.expiry) return RejectReason.Expired;
        if (to != decision.policy.merchant) return RejectReason.MerchantNotAllowed;
        if (amount == 0) return RejectReason.ZeroAmount;
        if (amount > decision.policy.maxDeposit) return RejectReason.MaxDepositExceeded;
        if (amount > decision.policy.maxTotalSpend - decision.totalSpent) return RejectReason.MaxTotalSpendExceeded;
        if (amount != decision.policy.paymentAmount) return RejectReason.AmountNotApproved;
        if (amount > decision.totalContributed - decision.totalSpent - decision.totalRefunded) {
            return RejectReason.InsufficientDecisionBalance;
        }
        return RejectReason.None;
    }

    function _refundEntitlement(Decision storage decision, address participant, uint256 contributed)
        private
        view
        returns (uint256)
    {
        if (decision.status != Status.Completed) return contributed;
        uint256 remaining = decision.totalContributed - decision.totalSpent;
        uint256 base = remaining / decision.policy.participants.length;
        uint256 extra = remaining % decision.policy.participants.length;
        for (uint256 i; i < decision.policy.participants.length; ++i) {
            if (decision.policy.participants[i] == participant) return base + (i < extra ? 1 : 0);
        }
        revert NotParticipant();
    }

    function _decision(bytes32 decisionId) private view returns (Decision storage decision) {
        decision = decisions[decisionId];
        if (!decision.exists) revert UnknownDecision(decisionId);
    }

    function _isParticipant(Policy storage policy, address participant) private view returns (bool) {
        for (uint256 i; i < policy.participants.length; ++i) {
            if (policy.participants[i] == participant) return true;
        }
        return false;
    }

    function _isTerminal(Status status) private pure returns (bool) {
        return status == Status.Completed || status == Status.Cancelled || status == Status.Expired;
    }

    function _expireDecision(bytes32 decisionId, Decision storage decision) private {
        decision.status = Status.Expired;
        emit DecisionExpired(decisionId);
    }
}
