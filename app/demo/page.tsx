"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AppHeader } from "../components/product-ui";
import { getMetaMaskProvider } from "../../src/lib/browser-wallet";
import {
  connectWalletAccount,
  ensureSepolia,
  signWalletLogin,
  walletConnectionError,
} from "../../src/lib/wallet-connection";
import {
  ArrowLeft,
  ArrowRight,
  CirclePause,
  LockKeyhole,
  Users,
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
import { DemoTransactionHistory } from "./transaction-history";
import { LiveDemoSearch } from "./live-search";

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
  const [refreshError, setRefreshError] = useState(false);
  const [wallet, setWallet] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [text, setText] = useState("Under $35 per person, somewhere quiet.");
  const [correction, setCorrection] = useState("");
  const [code, setCode] = useState("");
  const [lastTx, setLastTx] = useState<string | null>(null);
  const revision = useRef("");
  const refresh = useCallback(async () => {
    const result = await api<ExploreView>("/api/demo").catch(
      (error: unknown) => {
        setRefreshError(true);
        throw error;
      },
    );
    setRefreshError(false);
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
      setNotice(walletConnectionError(error));
    } finally {
      setBusy(false);
    }
  }
  async function connect() {
    const provider = await getMetaMaskProvider();
    if (!provider) return;
    setNotice("Open MetaMask to approve the connection and Sepolia network.");
    const address = await connectWalletAccount(provider);
    const challenge = await api<{ challengeId: string; message: string }>(
      "/api/auth/challenge",
      { address },
    );
    setNotice(
      "Confirm the sign-in message in MetaMask. If no popup appears, open MetaMask.",
    );
    const signature = await signWalletLogin(
      provider,
      challenge.message,
      address,
    );
    const session = await api<{ walletAddress: string }>("/api/auth/verify", {
      challengeId: challenge.challengeId,
      signature,
    });
    setWallet(session.walletAddress);
    setNotice("");
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
    if (!current?.policy) throw new Error("Connect your wallet first");
    const provider = await getMetaMaskProvider();
    if (!provider) return;
    const policy = policySchema.parse(current.policy);
    if (
      hashPolicy(policy) !== current.policyHash ||
      policy.chainId !== sepolia.id
    )
      throw new Error("Policy verification failed");
    const accounts = (await provider.request({
      method: "eth_accounts",
    })) as Address[];
    if (accounts[0]?.toLowerCase() !== current.judge.toLowerCase())
      throw new Error("Reconnect the wallet used to start this demo.");
    await ensureSepolia(provider);
    const client = createWalletClient({
      chain: sepolia,
      transport: custom(provider),
      account: accounts[0],
    });
    const reader = createPublicClient({
      chain: sepolia,
      transport: custom(provider),
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
        const selected = (await provider.request({
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
  const demoReady = !!view?.enabled && view.workerOnline && !refreshError;
  const journeyIndex =
    !state || ["cancelled", "expired"].includes(state.phase)
      ? -1
      : ["preferences", "review"].includes(state.phase)
        ? 0
        : ["proposal", "preparing"].includes(state.phase)
          ? 1
          : ["approval", "contributing"].includes(state.phase)
            ? 2
            : 3;
  return (
    <div className="shell explore-shell">
      <AppHeader
        active="demo"
        action={
          <button
            className="wallet-button"
            disabled={busy}
            onClick={() => void run(connect)}
          >
            <Wallet size={16} aria-hidden="true" />
            {busy ? "Please wait…" : wallet ? short(wallet) : "Connect wallet"}
          </button>
        }
      />
      <main className="explore-body" id="main-content" tabIndex={-1}>
        <Link href="/" className="explore-back">
          <ArrowLeft size={16} />
          Your workspace
        </Link>
        <div className="explore-heading">
          <div>
            <p className="eyebrow">
              <span className="accent-dot" />
              THE GUIDED EXPERIENCE
            </p>
            <h1>
              One table. <em>Six perspectives.</em>
            </h1>
          </div>
          <button
            className="icon-button"
            title="Refresh status"
            aria-label="Refresh status"
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            <RefreshCw size={18} />
          </button>
        </div>
        <p className="explore-disclosure">
          Try a shared dinner decision with your wallet and five automated
          participants. From private preferences to a payment you approve.
        </p>
        <div className="demo-disclosures">
          <span>
            <ShieldCheck size={14} />
            Test tokens only
          </span>
          <span>
            <Users size={14} />
            You + 5 automated participants
          </span>
          <span>Live places · Demo USDC reservations</span>
        </div>
        <div className="flow-note">
          <h2>Dinner around Gangnam Station</h2>
          <p>
            The area is fixed. After signing in, describe your dinner
            requirements in English, select a live search candidate and review
            its demo booking policy. USDC booking availability is assumed; venue
            conditions remain unverified. Payments use test tokens and the demo
            booking recipient.
          </p>
        </div>
        <ol className="demo-journey" aria-label="Demo progress">
          {[
            "Your preferences",
            "Find a match",
            "Approve together",
            "Outcome & refund",
          ].map((label, index) => (
            <li
              key={label}
              className={
                journeyIndex === index
                  ? "current"
                  : journeyIndex > index
                    ? "past"
                    : ""
              }
              aria-current={journeyIndex === index ? "step" : undefined}
            >
              <span className="journey-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>{label}</span>
            </li>
          ))}
        </ol>
        <div
          className={`explore-status ${demoReady ? "is-ready" : "is-waiting"}`}
          role="status"
        >
          <span className="status-dot" />
          {refreshError
            ? "Couldn't refresh the demo. Check your connection and try again."
            : !view
              ? "Checking demo availability…"
              : demoReady
                ? state
                  ? phaseNames[state.phase]
                  : "Ready when you are"
                : "The live demo is currently paused"}
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
              : state.error === "LIVE_SEARCH_FAILED"
                ? "Live search failed. No sample results were substituted. Try another search if your session has searches remaining."
                : state.error === "SEARCH_INTERRUPTED_RETRY_EXPLICITLY"
                  ? "The search was interrupted and was not automatically repeated. Search again if your session has searches remaining."
                  : "Processing is temporarily delayed. Your progress is saved."}
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
        <div className="demo-layout">
          <div className="demo-main">
            {(refreshError || (view && !demoReady)) && (
              <section className="demo-offline">
                <CirclePause size={24} aria-hidden="true" />
                <div>
                  <h2>Come back to a ready table.</h2>
                  <p>
                    {refreshError
                      ? "We couldn't check the current demo status. Try again to reconnect, or browse the saved evidence while you wait."
                      : state
                        ? "Your progress is saved. The automated participants are unavailable right now; check again in a moment. You can still review your policy and any available refund actions below."
                        : "The automated participants are unavailable right now. Check again in a moment, or explore recorded test runs to see how Converge works."}
                  </p>
                  <div className="flow-actions">
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void run(refresh)}
                    >
                      <RefreshCw size={16} />
                      {busy ? "Checking…" : "Check again"}
                    </button>
                    <Link className="text-button" href="/evidence">
                      View recorded runs
                      <ArrowRight size={16} />
                    </Link>
                  </div>
                </div>
              </section>
            )}
            {!state ? (
              <section className="explore-section demo-start">
                <span className="section-icon">
                  <Wallet size={23} />
                </span>
                <p className="eyebrow">YOUR FIRST STEP</p>
                <h2>
                  {wallet ? "Your seat is ready." : "Take a seat at the table."}
                </h2>
                <p>
                  {wallet
                    ? "Start a new session to share your preferences. We'll guide you through the recommendation and spending terms."
                    : "Connect your browser wallet and sign a message to get started. You'll review the terms before approving any test payment."}
                </p>
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
                {!wallet ? (
                  <button
                    className="primary"
                    disabled={busy || !demoReady}
                    onClick={() => void run(connect)}
                  >
                    <Wallet size={17} />
                    {busy ? "Connecting…" : "Connect wallet to begin"}
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={pending || !wallet || !demoReady}
                    onClick={() =>
                      void run(() =>
                        command({ action: "start", accessCode: code }),
                      )
                    }
                  >
                    {pending ? "Starting…" : "Start my demo"}
                    <ArrowRight size={17} />
                  </button>
                )}
                {!demoReady && (
                  <p className="start-hint">
                    {view
                      ? "Starting a session will be available when the live demo returns."
                      : "Checking the live demo before starting your session."}
                  </p>
                )}
                <p className="start-hint">
                  <LockKeyhole size={14} />
                  Signing in does not move funds.
                </p>
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
                {["preferences", "review"].includes(state.phase) &&
                  !state.extraction && (
                    <LiveDemoSearch
                      key={state.id}
                      run={state}
                      disabled={pending || !view?.workerOnline}
                      configured={Boolean(view?.searchConfigured)}
                      onCommand={(body) => void run(() => command(body))}
                    />
                  )}
                {["preferences", "review"].includes(state.phase) &&
                  state.extraction && (
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
                          pending ||
                          !view?.workerOnline ||
                          state.extractionCalls >= 3
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
                            {state.extraction.constraints.map(
                              (condition, index) => (
                                <li key={index}>
                                  {condition.field.replaceAll("_", " ")}:{" "}
                                  {"value" in condition
                                    ? typeof condition.value === "object"
                                      ? condition.value.startsAt
                                      : String(condition.value)
                                    : `preference weight ${condition.weight}`}
                                </li>
                              ),
                            )}
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
                            <summary>
                              Advanced: edit extracted conditions
                            </summary>
                            <textarea
                              aria-label="Extracted conditions JSON"
                              rows={12}
                              value={correction}
                              onChange={(event) =>
                                setCorrection(event.target.value)
                              }
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
                    {state.selectedPlace && (
                      <div className="flow-note">
                        <p>{state.selectedPlace.address}</p>
                        <a
                          href={state.selectedPlace.mapsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          View selected venue ↗
                        </a>
                        <p>
                          This place and the chosen demo deposit are locked into
                          the policy. The recipient is a demo booking wallet,
                          not the venue. Venue requirements remain unverified.
                          Five automated participants accept the demo terms.
                        </p>
                      </div>
                    )}
                    <p>
                      {state.phase === "proposal" || state.phase === "preparing"
                        ? state.selectedPlace
                          ? "You selected this AI-searched candidate. Review the exact terms before preparing the policy on-chain."
                          : "AI recommendation based on confirmed preferences. The group policy and payment are not yet confirmed on-chain."
                        : state.phase === "completed"
                          ? "The approved group payment is confirmed on-chain."
                          : "The group policy is on-chain; payment is not yet confirmed."}
                    </p>
                    {!state.selectedPlace && state.restaurant === "KAGAMI" && (
                      <p>
                        <a href="/restaurant">
                          View the KAGAMI demo storefront
                        </a>
                        . Its menu and story are fictional; this policy uses
                        synthetic restaurant metadata.
                      </p>
                    )}
                    <dl className="explore-policy">
                      <div>
                        <dt>Your contribution</dt>
                        <dd>
                          {money(state.policy.contributionPerParticipant)} USDC
                        </dd>
                      </div>
                      <div>
                        <dt>Reservation deposit</dt>
                        <dd>{money(state.policy.paymentAmount)} USDC</dd>
                      </div>
                      <div>
                        <dt>Total spending cap</dt>
                        <dd>{money(state.policy.maxTotalSpend)} USDC</dd>
                      </div>
                      <div>
                        <dt>Expires</dt>
                        <dd>
                          {new Date(
                            state.policy.expiry * 1000,
                          ).toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt>Merchant</dt>
                        <dd className="explore-address">
                          {state.policy.merchant}
                        </dd>
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
                                    : "Demo reservation request recorded. No real booking has been submitted."}
                          </p>
                          <p>
                            {state.reservation.guests} guests ·{" "}
                            {new Date(
                              state.reservation.startsAt,
                            ).toLocaleString()}
                          </p>
                          <p className="explore-address">
                            Reservation reference: {state.reservation.reference}
                          </p>
                        </>
                      ) : (
                        <p>
                          No demo reservation request is recorded for this run.
                        </p>
                      )}
                    </div>
                    <details className="explore-policy-details">
                      <summary>Policy details</summary>
                      <p>Policy hash: {state.policyHash}</p>
                      <p>Escrow: {state.policy.verifyingContract}</p>
                      <p>Token: {state.policy.token}</p>
                      <p>Network: Ethereum Sepolia (11155111)</p>
                      <p>
                        Maximum deposit: {money(state.policy.maxDeposit)} USDC
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
                        Preparing your USDC, gas allowance, and group policy...
                      </p>
                    )}
                    {state.phase === "approval" && (
                      <div className="explore-actions">
                        <p>
                          Review the policy before signing. Your wallet may
                          request two confirmations: token allowance, then
                          contribution. Changing policy terms requires a new
                          decision and fresh approvals.
                        </p>
                        <button
                          className="primary"
                          disabled={pending}
                          onClick={() =>
                            void run(() => transaction("contribute"))
                          }
                        >
                          Approve &amp; contribute{" "}
                          {money(state.policy.contributionPerParticipant)} USDC
                        </button>
                      </div>
                    )}
                    {state.phase === "contributing" && (
                      <p>
                        Automated participants are contributing to the same
                        policy.
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
                            onClick={() =>
                              void run(() => transaction("refund"))
                            }
                          >
                            Claim {money(state.refund)} USDC refund
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
                        80 USDC request rejected by the contract's read-only
                        check. No rejection transaction was submitted.
                      </p>
                    )}
                  </section>
                )}
                <DemoTransactionHistory
                  key={state.id}
                  transactions={state.transactions}
                />
              </>
            )}
          </div>
          <aside className="demo-aside">
            <div className="demo-guide">
              <span className="eyebrow">GOOD TO KNOW</span>
              <h2>You stay in control.</h2>
              <div>
                <LockKeyhole size={20} />
                <section>
                  <h3>Your preferences are private</h3>
                  <p>
                    Share what matters to you, then review the AI's
                    interpretation.
                  </p>
                </section>
              </div>
              <div>
                <Users size={20} />
                <section>
                  <h3>One shared set of terms</h3>
                  <p>
                    See the restaurant, contribution, and spending limit before
                    you approve.
                  </p>
                </section>
              </div>
              <div>
                <ShieldCheck size={20} />
                <section>
                  <h3>Only the approved payment</h3>
                  <p>
                    The contract enforces the policy. Any unused funds can be
                    claimed back.
                  </p>
                </section>
              </div>
              <Link href="/evidence">
                Explore the recorded evidence
                <ExternalLink size={15} aria-hidden="true" />
              </Link>
            </div>
            <p className="demo-aside-note">
              You'll need a browser wallet on Ethereum Sepolia. Test funds are
              prepared during the guided flow.
            </p>
          </aside>
        </div>
      </main>
    </div>
  );
}
