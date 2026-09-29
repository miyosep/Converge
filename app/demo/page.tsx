"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  type Abi,
  type Address,
} from "viem";
import { sepolia } from "viem/chains";
import tokenAbi from "../../src/lib/abi/mockUSDC.json";
import walletAbi from "../../src/lib/abi/convergeGroupWallet.json";
import { hashPolicy, policySchema } from "../../src/lib/policy.js";
import type { ExploreView } from "../../src/lib/explore/types.js";
import "./styles.css";
import { DemoCandidateResults } from "./candidate-results";

async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data as T;
}
const short = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;
const money = (value: string) => formatUnits(BigInt(value), 6);
const phaseNames = {
  preferences: "Your preferences",
  review: "Confirm your preferences",
  proposal: "Review the proposal",
  preparing: "Preparing test funds",
  approval: "Your approval",
  contributing: "Collecting contributions",
  completed: "Payment complete",
  cancelled: "Decision cancelled",
  expired: "Decision expired",
};

export default function ExploreDemo() {
  const [view, setView] = useState<ExploreView | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [text, setText] = useState("Under $35 per person, somewhere quiet.");
  const [correction, setCorrection] = useState("");
  const [code, setCode] = useState("");
  const [lastTx, setLastTx] = useState<string | null>(null);
  const revision = useRef("");
  const refresh = useCallback(async () => {
    const result = await api<ExploreView>("/api/demo");
    setView(result);
    const key = `${result.run?.id}:${result.run?.revision}`;
    if (result.run?.extraction && revision.current !== key) {
      setCorrection(JSON.stringify(result.run.extraction, null, 2));
      revision.current = key;
    }
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setNotice(error.message));
    void api<{ walletAddress: string }>("/api/auth/session")
      .then((session) => setWallet(session.walletAddress))
      .catch(() => {});
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    if (!window.ethereum)
      throw new Error("Open this page in a browser with a wallet extension.");
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xaa36a7" }],
    });
    const accounts = (await window.ethereum.request({
      method: "eth_requestAccounts",
    })) as Address[];
    if (!accounts[0]) throw new Error("No account selected");
    const challenge = await api<{ challengeId: string; message: string }>(
      "/api/auth/challenge",
      { address: accounts[0] },
    );
    const signature = await window.ethereum.request({
      method: "personal_sign",
      params: [challenge.message, accounts[0]],
    });
    const session = await api<{ walletAddress: string }>("/api/auth/verify", {
      challengeId: challenge.challengeId,
      signature,
    });
    setWallet(session.walletAddress);
    setLastTx(null);
    revision.current = "";
  }
  async function command(body: unknown) {
    await api("/api/demo", body);
  }
  async function transaction(
    action: "allowance" | "contribute" | "refund" | "cancel",
  ) {
    const current = view?.run;
    if (!current?.policy || !window.ethereum)
      throw new Error("Connect your wallet first");
    const policy = policySchema.parse(current.policy);
    if (
      hashPolicy(policy) !== current.policyHash ||
      policy.chainId !== sepolia.id
    )
      throw new Error("Policy verification failed");
    const accounts = (await window.ethereum.request({
      method: "eth_accounts",
    })) as Address[];
    if (accounts[0]?.toLowerCase() !== current.judge.toLowerCase())
      throw new Error("Reconnect the wallet used to start this demo.");
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xaa36a7" }],
    });
    const client = createWalletClient({
      chain: sepolia,
      transport: custom(window.ethereum),
      account: accounts[0],
    });
    const reader = createPublicClient({
      chain: sepolia,
      transport: custom(window.ethereum),
    });
    if (action === "contribute") {
      const allowance = (await reader.readContract({
        address: policy.token,
        abi: tokenAbi as Abi,
        functionName: "allowance",
        args: [accounts[0], policy.verifyingContract],
      })) as bigint;
      if (allowance < BigInt(policy.contributionPerParticipant)) {
        const approval = await client.sendTransaction({
          to: policy.token,
          data: encodeFunctionData({
            abi: tokenAbi as Abi,
            functionName: "approve",
            args: [
              policy.verifyingContract,
              BigInt(policy.contributionPerParticipant),
            ],
          }),
        });
        setLastTx(approval);
        setNotice(
          "Token allowance submitted. The contribution needs a second wallet confirmation.",
        );
        const receipt = await reader.waitForTransactionReceipt({
          hash: approval,
          timeout: 120000,
        });
        if (receipt.status !== "success")
          throw new Error("Token allowance failed");
        const selected = (await window.ethereum.request({
          method: "eth_accounts",
        })) as string[];
        if (selected[0]?.toLowerCase() !== current.judge.toLowerCase())
          throw new Error("Wallet changed. Reconnect your judge account.");
      }
    }
    const functionName =
      action === "allowance"
        ? "approve"
        : action === "contribute"
          ? "approveAndContribute"
          : action === "refund"
            ? "claimRefund"
            : "cancelDecision";
    const args =
      action === "allowance"
        ? [policy.verifyingContract, BigInt(policy.contributionPerParticipant)]
        : action === "contribute"
          ? [policy.decisionId, current.policyHash]
          : [policy.decisionId];
    const hash = await client.sendTransaction({
      to: action === "allowance" ? policy.token : policy.verifyingContract,
      data: encodeFunctionData({
        abi: (action === "allowance" ? tokenAbi : walletAbi) as Abi,
        functionName,
        args,
      }),
    });
    setLastTx(hash);
    setNotice("Transaction submitted. Waiting for on-chain confirmation.");
  }
  const state = view?.run;
  const pending = busy || !!state?.command;
  const terminal =
    !!state && ["completed", "cancelled", "expired"].includes(state.phase);
  return (
    <main className="shell explore-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">C</span>Converge
        </a>
        <div className="top-actions">
          <span className="network">Ethereum Sepolia</span>
          <button
            className="wallet-button"
            disabled={busy}
            onClick={() => void run(connect)}
          >
            <Wallet size={16} />
            {wallet ? short(wallet) : "Connect wallet"}
          </button>
        </div>
      </header>
      <div className="explore-body">
        <a href="/" className="explore-back">
          <ArrowLeft size={16} />
          Workspace
        </a>
        <div className="explore-heading">
          <div>
            <p className="eyebrow">LIVE TESTNET DEMO</p>
            <h1>Explore Converge</h1>
          </div>
          <button
            className="icon-button"
            title="Refresh status"
            aria-label="Refresh status"
            onClick={() => void run(refresh)}
          >
            <RefreshCw size={18} />
          </button>
        </div>
        <p className="explore-disclosure">
          You and five automated demo participants. Test tokens only. Restaurant
          availability is sample data.
        </p>
        <div className="explore-status" role="status">
          {view?.enabled
            ? view.workerOnline
              ? "Demo available"
              : "Demo runner offline"
            : "Demo unavailable"}
          {state ? ` · ${phaseNames[state.phase]}` : ""}
        </div>
        {notice && (
          <p className="explore-notice" role="alert">
            {notice}
          </p>
        )}
        {state?.error && (
          <p className="explore-notice" role="status">
            {state.error.startsWith("WAITING")
              ? "Waiting for transaction confirmations."
              : "The demo runner needs attention. Your progress is saved."}
          </p>
        )}
        {lastTx && (
          <a
            className="explore-tx"
            href={`https://sepolia.etherscan.io/tx/${lastTx}`}
            target="_blank"
            rel="noreferrer"
          >
            Your latest transaction <ExternalLink size={14} />
          </a>
        )}
        {!state ? (
          <section className="explore-section">
            <h2>Your seat at the table</h2>
            {view?.accessCodeRequired && (
              <label>
                Demo access code
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoComplete="off"
                  type="password"
                />
              </label>
            )}
            <button
              className="primary"
              disabled={
                pending || !wallet || !view?.enabled || !view.workerOnline
              }
              onClick={() =>
                void run(() => command({ action: "start", accessCode: code }))
              }
            >
              Start demo
            </button>
          </section>
        ) : (
          <>
            <div className="explore-members" aria-label="Six participants">
              {["You", "Bob", "Charlie", "Dana", "Erin", "Farah"].map(
                (name, index) => (
                  <div key={name}>
                    <span
                      className={`explore-avatar ${index === 0 ? "judge" : ""}`}
                    >
                      {state.contributions[index] === "10000000" ? (
                        <Check size={19} />
                      ) : (
                        name[0]
                      )}
                    </span>
                    <strong>{name}</strong>
                    <small>
                      {index === 0 ? short(state.judge) : "Automated"}
                    </small>
                  </div>
                ),
              )}
            </div>
            {["preferences", "review"].includes(state.phase) && (
              <section className="explore-section">
                <h2>Your dinner preferences</h2>
                <label>
                  Preferences
                  <textarea
                    value={text}
                    maxLength={4000}
                    onChange={(event) => setText(event.target.value)}
                    rows={3}
                  />
                </label>
                <button
                  className="primary"
                  disabled={
                    pending || !view?.workerOnline || state.extractionCalls >= 3
                  }
                  onClick={() =>
                    void run(() => command({ action: "extract", text }))
                  }
                >
                  {state.command?.action === "extract"
                    ? "Reading preferences..."
                    : "Review preferences"}
                </button>
                {state.extraction && (
                  <div className="explore-review">
                    <h3>Confirm your conditions</h3>
                    <ul>
                      {state.extraction.constraints.map((condition, index) => (
                        <li key={index}>
                          {condition.field.replaceAll("_", " ")}:{" "}
                          {"value" in condition
                            ? typeof condition.value === "object"
                              ? condition.value.startsAt
                              : String(condition.value)
                            : `preference weight ${condition.weight}`}
                        </li>
                      ))}
                    </ul>
                    {[
                      ...state.extraction.clarifications,
                      ...state.extraction.unsupportedRequirements,
                    ].map((message, index) => (
                      <p key={index} className="explore-notice">
                        {message}
                      </p>
                    ))}
                    <details>
                      <summary>Edit extracted conditions</summary>
                      <textarea
                        aria-label="Extracted conditions JSON"
                        rows={12}
                        value={correction}
                        onChange={(event) => setCorrection(event.target.value)}
                      />
                    </details>
                    <button
                      className="primary"
                      disabled={pending}
                      onClick={() =>
                        void run(() =>
                          command({
                            action: "confirm",
                            revision: state.revision,
                            extraction: JSON.parse(correction),
                          }),
                        )
                      }
                    >
                      Confirm conditions
                    </button>
                  </div>
                )}
                {state.evaluation &&
                  state.evaluation.status !== "PROPOSAL_READY" && (
                    <p className="explore-notice">
                      {state.evaluation.status === "NO_MATCH"
                        ? "No restaurant satisfies all conditions. Revise your preferences to try again."
                        : "Some conditions need clarification before a proposal can be made."}
                    </p>
                  )}
              </section>
            )}
            {state.evaluation && (
              <DemoCandidateResults result={state.evaluation} />
            )}
            {state.policy && (
              <section className="explore-section">
                <h2>{state.restaurant}</h2>
                <p>Eligible under the confirmed group conditions.</p>
                {state.restaurant === "KAGAMI" && (
                  <p>
                    <a href="/restaurant">View the KAGAMI demo storefront</a>.
                    Its menu and story are fictional; this policy uses synthetic
                    restaurant metadata.
                  </p>
                )}
                <dl className="explore-policy">
                  <div>
                    <dt>Your contribution</dt>
                    <dd>
                      {money(state.policy.contributionPerParticipant)} MockUSDC
                    </dd>
                  </div>
                  <div>
                    <dt>Reservation deposit</dt>
                    <dd>{money(state.policy.paymentAmount)} MockUSDC</dd>
                  </div>
                  <div>
                    <dt>Total spending cap</dt>
                    <dd>{money(state.policy.maxTotalSpend)} MockUSDC</dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>
                      {new Date(state.policy.expiry * 1000).toLocaleString()}
                    </dd>
                  </div>
                  <div>
                    <dt>Merchant</dt>
                    <dd className="explore-address">{state.policy.merchant}</dd>
                  </div>
                  <div>
                    <dt>Approvals</dt>
                    <dd>
                      {state.approvals} / {state.policy.approvalThreshold}
                    </dd>
                  </div>
                </dl>
                <div className="explore-reservation">
                  <h3>Demo reservation request</h3>
                  {state.reservation ? (
                    <>
                      <p>
                        {state.reservation.status === "DEMO_CONFIRMED"
                          ? "The demo restaurant service recorded a booking confirmation after checking the test payment. No real table was booked."
                          : state.reservation.status === "DEPOSIT_OBSERVED"
                            ? "Test deposit observed on Sepolia. No restaurant has accepted a booking."
                            : state.reservation.status === "CANCELLED"
                              ? "The decision was cancelled. This demo request is closed."
                              : state.reservation.status === "EXPIRED"
                                ? "The policy expired. This demo request is closed."
                                : "Request recorded for the synthetic restaurant. Booking is not confirmed."}
                      </p>
                      <p>
                        {state.reservation.guests} guests ·{" "}
                        {new Date(state.reservation.startsAt).toLocaleString()}
                      </p>
                      <p className="explore-address">
                        Reservation reference: {state.reservation.reference}
                      </p>
                    </>
                  ) : (
                    <p>No demo reservation request is recorded for this run.</p>
                  )}
                </div>
                <details>
                  <summary>Policy details</summary>
                  <p className="explore-address">
                    Policy hash: {state.policyHash}
                  </p>
                  <p className="explore-address">
                    Escrow: {state.policy.verifyingContract}
                  </p>
                  <p className="explore-address">Token: {state.policy.token}</p>
                  <p>Network: Ethereum Sepolia (11155111)</p>
                  <p>
                    Maximum deposit: {money(state.policy.maxDeposit)} MockUSDC
                  </p>
                </details>
                {state.phase === "proposal" && (
                  <button
                    className="primary"
                    disabled={pending || !view?.workerOnline}
                    onClick={() =>
                      void run(() => command({ action: "prepare" }))
                    }
                  >
                    Prepare my test funds
                  </button>
                )}
                {state.phase === "preparing" && (
                  <p>
                    Preparing your MockUSDC, gas allowance, and group policy...
                  </p>
                )}
                {state.phase === "approval" && (
                  <div className="explore-actions">
                    <p>
                      Review the policy before signing. Your wallet may request
                      two confirmations: token allowance, then contribution.
                      Changing policy terms requires a new decision and fresh
                      approvals.
                    </p>
                    <button
                      className="primary"
                      disabled={pending}
                      onClick={() => void run(() => transaction("contribute"))}
                    >
                      Approve &amp; contribute{" "}
                      {money(state.policy.contributionPerParticipant)} MockUSDC
                    </button>
                  </div>
                )}
                {state.phase === "contributing" && (
                  <p>
                    Automated participants are contributing to the same policy.
                  </p>
                )}
                {["approval", "contributing"].includes(state.phase) && (
                  <button
                    className="text-button"
                    disabled={pending}
                    onClick={() => void run(() => transaction("cancel"))}
                  >
                    Cancel decision
                  </button>
                )}
                {terminal && (
                  <div className="explore-actions">
                    <ShieldCheck size={20} />
                    <strong>{phaseNames[state.phase]}</strong>
                    {BigInt(state.refund) > 0n && !state.refunded && (
                      <button
                        className="primary"
                        disabled={pending}
                        onClick={() => void run(() => transaction("refund"))}
                      >
                        Claim {money(state.refund)} MockUSDC refund
                      </button>
                    )}
                    {state.refunded && (
                      <span>Your refund has been claimed.</span>
                    )}
                  </div>
                )}
                {state.rejection && (
                  <p className="explore-check">
                    <ShieldCheck size={18} />
                    80 MockUSDC request rejected by the contract's read-only
                    check. No rejection transaction was submitted.
                  </p>
                )}
              </section>
            )}
            {state.transactions.length > 0 && (
              <section className="explore-section">
                <h2>Transaction history</h2>
                <p className="explore-disclosure">
                  Progress uses two block confirmations. Finality follows
                  Ethereum consensus.
                </p>
                <ul className="explore-history">
                  {state.transactions.map((tx) => (
                    <li key={tx.hash}>
                      <span>
                        {tx.label.startsWith("Contribution ")
                          ? "Automated contribution"
                          : tx.label.startsWith("Allowance ")
                            ? "Automated token allowance"
                            : tx.label.startsWith("Refund ")
                              ? "Automated refund"
                              : tx.label}
                        <small>
                          {tx.failed
                            ? "Reverted"
                            : tx.confirmed
                              ? "Confirmed"
                              : "Pending"}
                        </small>
                      </span>
                      <a
                        href={`https://sepolia.etherscan.io/tx/${tx.hash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(tx.hash)}
                        <ExternalLink size={14} />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
