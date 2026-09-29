import { BaseError, ContractFunctionRevertedError } from "viem";
import { diagnostic, type Diagnostic, type DiagnosticInput } from "./types.js";
import type { DiagnosticCode } from "./codes.js";

// ConvergeGroupWallet.RejectReason, in declaration order. The order is load
// bearing: these arrive as uint8 enum ordinals, so a reordered enum in the
// contract silently remaps every diagnostic. Keep this list in sync with
// contracts/src/ConvergeGroupWallet.sol and assert the length in tests.
export const PAYMENT_REJECT_REASONS = [
  "None",
  "UnknownDecision",
  "WrongExecutor",
  "NotActive",
  "InsufficientApprovals",
  "Expired",
  "MerchantNotAllowed",
  "ZeroAmount",
  "MaxDepositExceeded",
  "MaxTotalSpendExceeded",
  "AmountNotApproved",
  "InsufficientDecisionBalance",
] as const;
export type PaymentRejectReason = (typeof PAYMENT_REJECT_REASONS)[number];

// ConvergeGroupWallet.PolicyError, in declaration order.
export const POLICY_ERRORS = [
  "UnsupportedVersion",
  "WrongChain",
  "WrongContract",
  "WrongToken",
  "InvalidDecisionId",
  "InvalidParticipant",
  "DuplicateParticipant",
  "CreatorNotParticipant",
  "WrongThreshold",
  "InvalidContribution",
  "InvalidMerchant",
  "InvalidExecutor",
  "InvalidExpiry",
  "InvalidAmounts",
] as const;
export type PolicyErrorName = (typeof POLICY_ERRORS)[number];

// "None" is a success sentinel, not a rejection.
const PAYMENT_REJECT_CODE: Record<PaymentRejectReason, DiagnosticCode | null> =
  {
    None: null,
    UnknownDecision: "CHN_NOT_ACTIVE",
    WrongExecutor: "CHN_NOT_EXECUTOR",
    NotActive: "CHN_NOT_ACTIVE",
    InsufficientApprovals: "CHN_INSUFFICIENT_APPROVALS",
    Expired: "CHN_EXPIRED",
    MerchantNotAllowed: "CHN_MERCHANT_NOT_ALLOWED",
    ZeroAmount: "CHN_ZERO_AMOUNT",
    MaxDepositExceeded: "CHN_MAX_DEPOSIT_EXCEEDED",
    MaxTotalSpendExceeded: "CHN_MAX_TOTAL_SPEND_EXCEEDED",
    AmountNotApproved: "CHN_AMOUNT_NOT_APPROVED",
    InsufficientDecisionBalance: "CHN_INSUFFICIENT_DECISION_BALANCE",
  };

const POLICY_ERROR_CODE: Record<PolicyErrorName, DiagnosticCode> = {
  UnsupportedVersion: "PLN_POLICY_INVALID",
  WrongChain: "PLN_POLICY_INVALID",
  WrongContract: "PLN_POLICY_INVALID",
  WrongToken: "PLN_POLICY_INVALID",
  InvalidDecisionId: "PLN_POLICY_INVALID",
  InvalidParticipant: "PLN_POLICY_INVALID",
  DuplicateParticipant: "PLN_POLICY_INVALID",
  CreatorNotParticipant: "PLN_POLICY_INVALID",
  WrongThreshold: "PLN_POLICY_INVALID",
  InvalidContribution: "PLN_POLICY_INVALID",
  InvalidMerchant: "PLN_POLICY_INVALID",
  InvalidExecutor: "PLN_POLICY_INVALID",
  InvalidExpiry: "PLN_POLICY_EXPIRY_OUT_OF_WINDOW",
  InvalidAmounts: "PLN_POLICY_INVALID",
};

// Contract custom errors that are not enum-carrying. Mapped by name so a
// renamed Solidity error degrades to CHN_TX_REVERTED instead of throwing here.
const CONTRACT_ERROR_CODE: Record<string, DiagnosticCode> = {
  InvalidToken: "PLN_POLICY_INVALID",
  DecisionAlreadyExists: "CHN_DUPLICATE_PAYMENT",
  UnknownDecision: "CHN_NOT_ACTIVE",
  NotParticipant: "PLN_PARTICIPANT_ONESHIDED",
  AlreadyApproved: "FUND_DUPLICATE_APPROVAL",
  ApprovalHashMismatch: "PLN_APPROVAL_HASH_MISMATCH",
  DecisionNotFunding: "FUND_ALREADY_ACTIVE",
  PolicyExpired: "CHN_EXPIRED",
  DecisionNotCancellable: "CHN_NOT_ACTIVE",
  DecisionNotExpired: "SET_REFUND_NOT_AVAILABLE",
  RefundNotAvailable: "SET_REFUND_NOT_AVAILABLE",
  NoContribution: "SET_NO_CONTRIBUTION",
  RefundAlreadyClaimed: "SET_REFUND_ALREADY_CLAIMED",
  InvalidTokenReceipt: "FUND_TRANSFER_AMOUNT_MISMATCH",
  ReentrancyGuardReentrantCall: "CHN_REENTRANCY_BLOCKED",
  SafeERC20FailedOperation: "CHN_TX_REVERTED",
  // Insufficient ERC-20 allowance or balance surfaces as a plain revert from the
  // token, so the caller supplies the intended action to disambiguate.
};

export type ChainDiagnosticContext = {
  decisionId?: string | null;
  action?: "contribute" | "pay" | "cancel" | "expire" | "refund" | "create";
};

// Both entry points build the same attribution map, so a diagnostic from
// pre-flight validation is byte-identical to one from a thrown revert.
function contextDetail(
  context: ChainDiagnosticContext,
): Record<string, string> {
  const detail: Record<string, string> = {};
  if (context.decisionId) detail.decisionId = context.decisionId;
  if (context.action) detail.action = context.action;
  return detail;
}

function argsOf(error: unknown): readonly unknown[] {
  const cause = (error as BaseError | undefined)?.walk?.(
    (item: unknown) => item instanceof ContractFunctionRevertedError,
  );
  if (cause instanceof ContractFunctionRevertedError)
    return cause.data?.args ?? [];
  return [];
}

function nameOf(error: unknown): string | null {
  const cause = (error as BaseError | undefined)?.walk?.(
    (item: unknown) => item instanceof ContractFunctionRevertedError,
  );
  if (cause instanceof ContractFunctionRevertedError)
    return cause.data?.errorName ?? null;
  return null;
}

// Translate a thrown viem error into an operator-facing diagnostic. Unknown
// reverts degrade to CHN_TX_REVERTED rather than being swallowed, so a new
// contract error is visible instead of silent.
export function diagnoseChainError(
  error: unknown,
  context: ChainDiagnosticContext = {},
): Diagnostic {
  const name = nameOf(error);
  const args = argsOf(error);
  const detail = contextDetail(context);
  if (name) detail.errorName = name;

  if (name === "PaymentNotAllowed" && args.length) {
    const ordinal = Number(args[0]);
    const reason = PAYMENT_REJECT_REASONS[ordinal];
    if (reason === "None")
      return diagnostic({
        code: "CHN_TX_REVERTED",
        detail: { ...detail, reason: "None" },
      });
    if (reason !== undefined) {
      const code = PAYMENT_REJECT_CODE[reason];
      if (code)
        return diagnostic({
          code,
          detail: { ...detail, reason, ordinal: String(ordinal) },
        });
    }
    // An out-of-range ordinal means the contract enum and this table disagree.
    // Refuse to guess.
    return diagnostic({
      code: "CHN_TX_REVERTED",
      detail: { ...detail, reason: "UnknownOrdinal", ordinal: String(ordinal) },
    });
  }

  if (name === "InvalidPolicy" && args.length) {
    const ordinal = Number(args[0]);
    const reason = POLICY_ERRORS[ordinal];
    if (reason !== undefined)
      return diagnostic({
        code: POLICY_ERROR_CODE[reason],
        detail: { ...detail, reason, ordinal: String(ordinal) },
      });
    return diagnostic({
      code: "PLN_POLICY_INVALID",
      detail: { ...detail, reason: "UnknownOrdinal", ordinal: String(ordinal) },
    });
  }

  if (name === "ApprovalHashMismatch") {
    const [expected, actual] = args as [string?, string?];
    return diagnostic({
      code: "PLN_POLICY_HASH_MISMATCH",
      detail: {
        ...detail,
        ...(expected ? { expected } : {}),
        ...(actual ? { actual } : {}),
      },
    });
  }

  if (name === "InvalidTokenReceipt") {
    const [expected, received] = args as [bigint?, bigint?];
    return diagnostic({
      code: "FUND_TRANSFER_AMOUNT_MISMATCH",
      detail: {
        ...detail,
        ...(expected !== undefined ? { expected: expected.toString() } : {}),
        ...(received !== undefined ? { received: received.toString() } : {}),
      },
    });
  }

  if (name && CONTRACT_ERROR_CODE[name])
    return diagnostic({ code: CONTRACT_ERROR_CODE[name]!, detail });

  // A bare revert from a token transfer during a contribution is far more often
  // an allowance or balance problem than a contract logic failure, so map it to
  // the actionable funding diagnostic when the caller told us the action.
  const message = error instanceof Error ? error.message : "";
  if (/insufficient allowance/i.test(message))
    return diagnostic({ code: "FUND_ALLOWANCE_INSUFFICIENT", detail });
  if (/insufficient balance|exceeds balance/i.test(message))
    return diagnostic({
      code:
        context.action === "refund"
          ? "CHN_TX_REVERTED"
          : "FUND_BALANCE_INSUFFICIENT",
      detail,
    });
  if (/user rejected|denied transaction/i.test(message))
    return diagnostic({
      code: "CHN_TX_REVERTED",
      detail: { ...detail, reason: "UserRejected" },
    });

  return diagnostic({ code: "CHN_TX_REVERTED", detail });
}

// Pre-flight rejection from `validatePayment`, which returns the enum instead of
// reverting. `None` means allowed, so there is no diagnostic to report.
export function diagnoseRejectReason(
  ordinal: number,
  context: ChainDiagnosticContext = {},
): Diagnostic | null {
  const reason = PAYMENT_REJECT_REASONS[ordinal];
  const detail = contextDetail(context);
  if (reason === undefined)
    return diagnostic({
      code: "CHN_TX_REVERTED",
      detail: { ...detail, reason: "UnknownOrdinal", ordinal: String(ordinal) },
    });
  if (reason === "None") return null;
  const code = PAYMENT_REJECT_CODE[reason];
  if (!code) return diagnostic({ code: "CHN_TX_REVERTED", detail });
  return diagnostic({
    code,
    detail: { ...detail, reason, ordinal: String(ordinal) },
  });
}

export type { Diagnostic, DiagnosticInput };
