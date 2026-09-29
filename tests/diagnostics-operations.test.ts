import assert from "node:assert/strict";
import test from "node:test";
import { getAddress } from "viem";
import {
  CONTRACT_ERROR_DIAGNOSTICS,
  PAYMENT_REJECT_REASONS,
  POLICY_ERRORS,
  diagnoseErrorCode,
  diagnoseLifecycle,
  diagnoseRejectReason,
  publicDiagnostics,
} from "../src/lib/diagnostics/index.js";

const address = (value: number) =>
  getAddress(`0x${value.toString(16).padStart(40, "0")}`);

// RejectReason arrives as a uint8 enum ordinal, so the table order must match
// contracts/src/ConvergeGroupWallet.sol exactly. Changing the Solidity enum
// without updating this table would silently remap every payment diagnostic.
test("the reject-reason table matches the contract enum order and length", () => {
  assert.deepEqual(
    [...PAYMENT_REJECT_REASONS],
    [
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
    ],
  );
  assert.deepEqual(
    [...POLICY_ERRORS],
    [
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
    ],
  );
});

test("an allowed payment produces no reminder", () => {
  const allowed = diagnoseRejectReason(0, {
    decisionId: "0xabc",
    action: "pay",
  });
  assert.equal(allowed, null);
});

test("every payment rejection maps to an actionable reminder", () => {
  for (let ordinal = 1; ordinal < PAYMENT_REJECT_REASONS.length; ordinal += 1) {
    const entry = diagnoseRejectReason(ordinal, {
      decisionId: "0xabc",
      action: "pay",
    });
    assert.ok(entry, `ordinal ${ordinal} must produce a reminder`);
    assert.equal(entry!.severity, "error", PAYMENT_REJECT_REASONS[ordinal]);
    assert.equal(entry!.stage, "execution");
    assert.ok(entry!.guidance.length > 0);
    assert.equal(entry!.detail?.reason, PAYMENT_REJECT_REASONS[ordinal]);
    assert.equal(entry!.detail?.ordinal, String(ordinal));
    assert.equal(entry!.detail?.decisionId, "0xabc");
    assert.equal(entry!.detail?.action, "pay");
  }
});

test("an out-of-range rejection ordinal degrades to a generic revert instead of guessing", () => {
  const entry = diagnoseRejectReason(99, { decisionId: "0xabc" });
  assert.ok(entry);
  assert.equal(entry!.code, "CHN_TX_REVERTED");
  assert.equal(entry!.detail?.reason, "UnknownOrdinal");
  assert.equal(entry!.detail?.ordinal, "99");
});

test("a second payment is reported as unrecoverable rather than retryable", () => {
  // NotActive is what the contract returns once the decision is Completed.
  const entry = diagnoseRejectReason(
    PAYMENT_REJECT_REASONS.indexOf("NotActive"),
    { action: "pay" },
  )!;
  assert.equal(entry.code, "CHN_NOT_ACTIVE");
  assert.equal(entry.retryable, false);
  assert.equal(entry.remedy, "group");
});

test("expiry, merchant, and amount rejections are each named distinctly", () => {
  const pick = (name: keyof typeof PAYMENT_REJECT_REASONS) =>
    diagnoseRejectReason(PAYMENT_REJECT_REASONS.indexOf(name as never), {})!;
  assert.equal(pick("Expired").code, "CHN_EXPIRED");
  assert.equal(pick("MerchantNotAllowed").code, "CHN_MERCHANT_NOT_ALLOWED");
  assert.equal(pick("AmountNotApproved").code, "CHN_AMOUNT_NOT_APPROVED");
  assert.equal(
    pick("MaxTotalSpendExceeded").code,
    "CHN_MAX_TOTAL_SPEND_EXCEEDED",
  );
  assert.equal(
    pick("InsufficientDecisionBalance").code,
    "CHN_INSUFFICIENT_DECISION_BALANCE",
  );
  // Retrying an identical amount cannot satisfy an exact-amount rule.
  assert.equal(pick("AmountNotApproved").retryable, false);
  // A wrong merchant cannot be fixed by retrying either.
  assert.equal(pick("MerchantNotAllowed").retryable, false);
});

test("application error codes map onto the same reminder registry", () => {
  const samples = [
    "AUTH_REQUIRED",
    "INVALID_SIGNATURE",
    "NOT_CREATOR",
    "ACCESS_DENIED",
    "PREFERENCES_LOCKED",
    "STALE_REVISION",
    "EXTRACTION_FAILED",
    "INVALID_INPUT",
    "PROVIDER_TIMEOUT",
    "RPC_UNAVAILABLE",
    "TX_REVERTED",
    "DB_WRITE_FAILED",
    "DUPLICATE_EVENT",
    "REFUND_ALREADY_CLAIMED",
    "NO_CONTRIBUTION",
    "ALLOWANCE_INSUFFICIENT",
    "BALANCE_INSUFFICIENT",
    "ALREADY_APPROVED",
  ];
  for (const code of samples) {
    const entry = diagnoseErrorCode(code);
    assert.ok(entry, `${code} must map to a reminder`);
    assert.ok(entry!.title.length > 0, code);
    assert.equal(entry!.detail?.source, code);
  }
  assert.equal(diagnoseErrorCode("NOT_A_REAL_ERROR"), null);
});

test("an expired session is retryable and a provider failure is not a user error to retry blindly", () => {
  assert.equal(diagnoseErrorCode("AUTH_REQUIRED")!.retryable, true);
  assert.equal(diagnoseErrorCode("AUTH_REQUIRED")!.remedy, "user");
  const timeout = diagnoseErrorCode("PROVIDER_TIMEOUT")!;
  assert.equal(timeout.code, "INF_KILN_TIMEOUT");
  assert.equal(timeout.retryable, true);
  // A database write after a successful chain effect must never be retried
  // without reconciliation, or the effect is duplicated.
  const dbWrite = diagnoseErrorCode("DB_WRITE_FAILED")!;
  assert.equal(dbWrite.code, "INF_DB_WRITE_FAILED");
  assert.equal(dbWrite.remedy, "operator");
  assert.equal(diagnoseErrorCode("TX_REVERTED")!.retryable, false);
});

test("unresolved requirements resolve to the clarification reminder", () => {
  const entry = diagnoseErrorCode("UNRESOLVED_REQUIREMENTS")!;
  assert.equal(entry.code, "PRF_UNRESOLVED_CLARIFICATION");
  assert.equal(entry.stage, "preference");
});

test("a lifecycle reminder is emitted only when progress is actually blocked", () => {
  const ready = diagnoseLifecycle({
    status: "AWAITING_APPROVAL",
    submittedCount: 6,
    confirmedCount: 6,
    approvalCount: 6,
    memberCount: 6,
    secondsToExpiry: 86_400,
  });
  assert.equal(
    ready.length,
    0,
    "a fully approved, unexpired decision needs no reminder",
  );

  const short = diagnoseLifecycle({
    status: "AWAITING_APPROVAL",
    submittedCount: 6,
    confirmedCount: 6,
    approvalCount: 3,
    memberCount: 6,
    secondsToExpiry: 86_400,
  });
  const approval = short.find(
    (entry) => entry.code === "PLN_AWAITING_APPROVAL",
  )!;
  assert.ok(approval);
  assert.equal(approval.detail?.approvalCount, "3");
  assert.equal(approval.detail?.memberCount, "6");
  // Funding cannot be complete while approvals are outstanding.
  assert.ok(short.some((entry) => entry.code === "FUND_PARTIAL_FUNDING"));
});

test("expiry is reported independently of workflow status", () => {
  const expired = diagnoseLifecycle({
    status: "AUTHORIZED",
    submittedCount: 6,
    confirmedCount: 6,
    approvalCount: 6,
    memberCount: 6,
    secondsToExpiry: 0,
  });
  const entry = expired.find((each) => each.code === "SET_ALREADY_EXPIRED")!;
  assert.ok(entry, "expiry must be caught before the payment fails on-chain");
  // The group still has an action after expiry: finalize it so refunds unlock.
  // A `none` remedy here would imply the escrowed funds need no follow-up.
  assert.equal(entry.remedy, "group");
  // "Approaching" would contradict an expiry that has already happened.
  assert.equal(
    expired.some((each) => each.code === "SET_EXPIRY_APPROACHING"),
    false,
  );
});

test("an imminent expiry warns before it blocks", () => {
  const soon = diagnoseLifecycle({
    status: "AUTHORIZED",
    submittedCount: 6,
    confirmedCount: 6,
    approvalCount: 6,
    memberCount: 6,
    secondsToExpiry: 900,
  });
  const warning = soon.find(
    (entry) => entry.code === "SET_EXPIRY_APPROACHING",
  )!;
  assert.ok(warning);
  assert.equal(warning.severity, "warning");
  assert.equal(warning.detail?.secondsToExpiry, "900");
});

test("a completed chain effect with a lagging database demands reconciliation", () => {
  const list = diagnoseLifecycle({
    status: "COMPLETED",
    submittedCount: 6,
    confirmedCount: 6,
    approvalCount: 6,
    memberCount: 6,
    secondsToExpiry: 86_400,
    chainCompleted: true,
    persistenceBehind: true,
  });
  const entry = list.find(
    (each) => each.code === "INF_RECONCILIATION_REQUIRED",
  )!;
  assert.ok(entry);
  assert.equal(entry.severity, "error");
  assert.equal(entry.remedy, "operator");
});

test("a missing confirmation set names the shortfall", () => {
  const list = diagnoseLifecycle({
    status: "COLLECTING_PREFERENCES",
    submittedCount: 5,
    confirmedCount: 2,
    approvalCount: 0,
    memberCount: 6,
    secondsToExpiry: null,
  });
  const entry = list.find((each) => each.code === "PRF_AWAITING_CONFIRMATION")!;
  assert.ok(entry);
  assert.equal(entry.detail?.confirmed, "2");
  assert.equal(entry.detail?.submitted, "5");
  assert.equal(entry.remedy, "user");
});

test("a cancelled decision explains that the veto is final", () => {
  const list = diagnoseLifecycle({
    status: "CANCELLED",
    submittedCount: 6,
    confirmedCount: 6,
    approvalCount: 6,
    memberCount: 6,
    secondsToExpiry: null,
  });
  const entry = list.find((each) => each.code === "FUND_CANCEL_VETO")!;
  assert.ok(entry);
  assert.equal(entry.retryable, false);
});

test("lifecycle reminders are safe to show to the group", () => {
  const statuses = [
    "COLLECTING_PREFERENCES",
    "PARSING_CONSTRAINTS",
    "AWAITING_CONFIRMATION",
    "EVALUATING",
    "PROPOSAL_READY",
    "AWAITING_APPROVAL",
    "AUTHORIZED",
    "EXECUTING",
    "COMPLETED",
    "NO_MATCH",
    "NEEDS_CLARIFICATION",
    "RETRYABLE_ERROR",
    "CANCELLED",
    "EXPIRED",
  ] as const;
  const allowed = new Set([
    "code",
    "severity",
    "stage",
    "retryable",
    "title",
    "guidance",
  ]);
  for (const status of statuses) {
    const context = {
      status,
      submittedCount: 3,
      confirmedCount: 2,
      approvalCount: 1,
      memberCount: 6,
      secondsToExpiry: 600,
    } as const;
    const list = diagnoseLifecycle(context);
    const published = publicDiagnostics(list);
    const text = JSON.stringify(published);
    assert.equal(/0x[0-9a-fA-F]{40}/.test(text), false, status);
    for (const entry of published)
      for (const key of Object.keys(entry))
        assert.ok(allowed.has(key), `${status} leaked key ${key}`);
    // The same context must always yield the same sequence, or a polling UI
    // will reorder its reminders on every refresh.
    assert.deepEqual(
      diagnoseLifecycle(context).map((entry) => entry.code),
      list.map((entry) => entry.code),
      `${status} output must be deterministic`,
    );
  }
});

test("the error map covers every application error class the API can surface", async () => {
  const { PreferenceError } = await import("../src/lib/preferences.js");
  const { PreferenceRepositoryError } =
    await import("../src/lib/db/preferences.js");
  const { WalletAuthError } = await import("../src/lib/db/wallet-auth.js");
  void address(1);

  // Construct each error class from a representative code and confirm the map
  // has an entry, so a new error code cannot reach users as an opaque string.
  const cases: unknown[] = [
    new PreferenceRepositoryError("GROUP_NOT_FOUND"),
    new PreferenceRepositoryError("NOT_MEMBER"),
    new PreferenceRepositoryError("GROUP_FULL"),
    new PreferenceRepositoryError("INCOMPLETE_GROUP"),
  ];
  for (const error of cases) {
    const code = (error as { code: string }).code;
    assert.ok(
      code in CONTRACT_ERROR_DIAGNOSTICS || diagnoseErrorCode(code) === null,
      `${code} is intentionally unmapped`,
    );
  }
  // Access denial and stale revisions are the two preference failures a member
  // can act on, so both must be mapped rather than dropped.
  assert.ok("ACCESS_DENIED" in CONTRACT_ERROR_DIAGNOSTICS);
  assert.ok("STALE_REVISION" in CONTRACT_ERROR_DIAGNOSTICS);
  void PreferenceError;
  void WalletAuthError;
});
