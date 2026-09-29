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
import "../components/plans-overview.css";
import "./styles.css";
import "./redesign.css";
import { DemoCandidateResults } from "./candidate-results";
import { DemoTransactionHistory } from "./transaction-history";
import { LiveDemoSearch } from "./live-search";
import { canRestartDemo } from "../../src/lib/explore/sessions";

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
  const [sessionLoading, setSessionLoading] = useState(true);
  const [entered, setEntered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [code, setCode] = useState("");
  const [lastTx, setLastTx] = useState<string | null>(null);
  const selectedRun = useRef("");
  const refreshSequence = useRef(0);
  const refreshing = useRef(false);
  const refresh = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    refreshing.current = true;
    const requestedRun = selectedRun.current;
    const result = await api<ExploreView>(
      `/api/demo${selectedRun.current ? `?runId=${selectedRun.current}` : ""}`,
    )
      .catch((error: unknown) => {
        if (
          sequence === refreshSequence.current &&
          requestedRun === selectedRun.current
        )
          setRefreshError(true);
        throw error;
      })
      .finally(() => {
        if (sequence === refreshSequence.current) refreshing.current = false;
      });
    if (
      sequence !== refreshSequence.current ||
      requestedRun !== selectedRun.current
    )
      return;
    setRefreshError(false);
    setView(result);
  }, []);
  useEffect(() => {
    void refresh().catch((error) => setNotice(error.message));
    void api<{ walletAddress: string }>("/api/auth/session")
      .then((session) => setWallet(session.walletAddress))
      .catch(() => {})
      .finally(() => setSessionLoading(false));
    const timer = setInterval(() => {
      if (!refreshing.current) void refresh().catch(() => {});
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
    selectedRun.current = "";
  }
  async function command(body: unknown) {
    const result = await api<{ run: NonNullable<ExploreView["run"]> }>(
      `/api/demo${view?.run ? `?runId=${view.run.id}` : ""}`,
      body,
    );
    selectedRun.current = result.run.id;
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
  const historical =
    !!state && !!view?.currentRunId && state.id !== view.currentRunId;
  const pending = busy || !!state?.command;
  const terminal =
    !!state && ["completed", "cancelled", "expired"].includes(state.phase);
  const demoReady = !!view?.enabled && view.workerOnline && !refreshError;
  const journeyIndex =
    !entered || !state || ["cancelled", "expired"].includes(state.phase)
      ? -1
      : state.command?.action === "search" ||
          (state.discovery && ["preferences", "review"].includes(state.phase))
        ? 1
        : ["preferences", "review"].includes(state.phase)
          ? 0
          : ["proposal", "preparing"].includes(state.phase)
            ? 1
            : ["approval", "contributing"].includes(state.phase)
              ? 2
              : 3;
  return (
    <div
      className={`shell plans-shell explore-shell demo-redesign ${entered ? "demo-in-session" : ""}`}
    >
      <AppHeader
        active="demo"
        action={
          <button
            className="wallet-button"
            disabled={busy || sessionLoading}
            onClick={() => void run(connect)}
          >
            <Wallet size={16} aria-hidden="true" />
            {sessionLoading
              ? "Connecting…"
              : busy
                ? "Please wait…"
                : wallet
                  ? short(wallet)
                  : "Connect wallet"}
          </button>
        }
      />
      <main className="explore-body" id="main-content" tabIndex={-1}>
        <Link href="/" className="explore-back">
          <ArrowLeft size={16} />
          Home
        </Link>
        <div className="explore-heading">
          <div>
            <h1>
              Explore <em>demo</em>
            </h1>
          </div>
          <div className="demo-heading-aside">
            <p>
              One table.
              <br />
              Six perspectives.
            </p>
            <button
              className="icon-button"
              title="Refresh status"
              aria-label="Refresh status"
              disabled={busy}
              onClick={() => void run(refresh)}
            >
              <RefreshCw size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="demo-disclosures">
          <span>
            <Users size={14} aria-hidden="true" /> You + 5 automated
            participants
          </span>
          <span>
            <ShieldCheck size={14} aria-hidden="true" /> Test tokens · Simulated
            booking
          </span>
          <span>Gangnam Station, Seoul</span>
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
                ? entered && state
                  ? state.command?.action === "search"
                    ? "Finding places for your group…"
                    : state.discovery &&
                        ["preferences", "review"].includes(state.phase)
                      ? "Review your search results"
                      : phaseNames[state.phase]
                  : "Ready when you are"
                : "The live demo is currently paused"}
        </div>
        {notice && (
          <p className="explore-notice" role="alert">
            {notice}
          </p>
        )}
        {entered && state?.error && (
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
            {entered && (!view || sessionLoading) ? (
              !refreshError && (
                <section
                  className="explore-section demo-loading"
                  role="status"
                  aria-busy="true"
                >
                  <div className="demo-loading-shapes" aria-hidden="true">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p>Loading your demo…</p>
                </section>
              )
            ) : !entered || !state ? (
              <section className="explore-section demo-start">
                <div className="demo-start-top">
                  <span className="eyebrow">A LITTLE TASTE OF CONVERGE</span>
                  <span className="demo-test-label">GUIDED DEMO</span>
                </div>
                <div
                  className="demo-seat-line"
                  aria-label="One seat for you and five automated participants"
                >
                  <span className="demo-seat-you">
                    <Wallet size={23} aria-hidden="true" />
                  </span>
                  {[1, 2, 3, 4, 5].map((number) => (
                    <span
                      className="demo-seat-bot"
                      key={number}
                      aria-hidden="true"
                    >
                      {String(number).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                <h2>
                  Take a seat, <em>see it come together</em>
                </h2>
                <p>
                  <strong>Try Converge on your own.</strong> Five automated
                  participants join you to find a place, agree together, and try
                  a shared test payment.
                </p>
                {!state && view?.accessCodeRequired && (
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
                    disabled={busy || sessionLoading || !view || !demoReady}
                    onClick={() => void run(connect)}
                  >
                    <Wallet size={17} />
                    {busy ? "Connecting…" : "Connect wallet to begin"}
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={
                      busy || sessionLoading || !view || (!state && !demoReady)
                    }
                    onClick={() => {
                      if (state) {
                        setEntered(true);
                      } else {
                        void run(async () => {
                          await command({ action: "start", accessCode: code });
                          await refresh();
                          setEntered(true);
                        });
                      }
                    }}
                  >
                    {busy
                      ? "Starting…"
                      : state
                        ? "Continue my demo"
                        : "Start my demo"}
                    <ArrowRight size={17} />
                  </button>
                )}
                {!demoReady && !state && (
                  <p className="start-hint">
                    {view
                      ? "Starting a session will be available when the live demo returns."
                      : "Checking the live demo before starting your session."}
                  </p>
                )}
                <p className="start-hint">
                  <LockKeyhole size={14} />
                  Sign in with a wallet message. No funds move when you connect.
                </p>
              </section>
            ) : (
              <>
                <details
                  className="explore-section demo-sessions"
                  aria-label="Your demo sessions"
                >
                  <summary>
                    Demo sessions <span>History &amp; start again</span>
                  </summary>
                  <label>
                    Current and previous sessions
                    <select
                      value={state.id}
                      disabled={busy}
                      onChange={(event) => {
                        selectedRun.current = event.target.value;
                        setLastTx(null);
                        void run(refresh);
                      }}
                    >
                      {(view?.history ?? [state]).map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.id === view?.currentRunId ? "Current · " : ""}
                          {new Date(item.createdAt).toLocaleString()} ·{" "}
                          {item.restaurant ?? phaseNames[item.phase]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {historical ? (
                    <p>
                      Previous session. Its payment records and available
                      refunds remain accessible here.
                    </p>
                  ) : (
                    <>
                      <p>
                        Start again with the same wallet. Previous payment and
                        refund records are kept.
                      </p>
                      <button
                        className="secondary"
                        disabled={busy || !demoReady || !canRestartDemo(state)}
                        onClick={() =>
                          void run(() =>
                            command({
                              action: "restart",
                              previousRunId: state.id,
                            }),
                          )
                        }
                      >
                        Start a new demo
                      </button>
                      {!canRestartDemo(state) && (
                        <p>
                          Finish or cancel the current decision and wait for
                          pending transactions before starting again.
                        </p>
                      )}
                    </>
                  )}
                </details>
                <div className="explore-members" aria-label="Six participants">
                  {["You", "Bob", "Charlie", "Dana", "Erin", "Farah"].map(
                    (name, index) => (
                      <div
                        key={name}
                        title={
                          index === 0
                            ? `You · ${short(state.judge)}`
                            : `${name} · Automated participant`
                        }
                      >
                        <span
                          className={`explore-avatar ${index === 0 ? "judge" : ""}`}
                        >
                          {state.contributions[index] === "10000000" ? (
                            <Check
                              size={19}
                              aria-label="Contribution received"
                            />
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
                {!historical &&
                  ["preferences", "review"].includes(state.phase) && (
                    <LiveDemoSearch
                      key={`search:${state.id}`}
                      run={state}
                      disabled={pending || !view?.workerOnline}
                      configured={Boolean(view?.searchConfigured)}
                      onCommand={(body) => void run(() => command(body))}
                    />
                  )}
                {state.evaluation &&
                  !["preferences", "review"].includes(state.phase) && (
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
                    {!historical && state.phase === "proposal" && (
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
                  key={`history:${state.id}`}
                  transactions={state.transactions}
                />
              </>
            )}
          </div>
          {entered ? (
            <details className="demo-help">
              <summary>
                How this demo works <span>Test tokens · Simulated booking</span>
              </summary>
              <div>
                <p>
                  Your preferences stay private. Five automated participants
                  join the decision. You review the restaurant and payment terms
                  before approving.
                </p>
                <p>
                  Search covers Gangnam Station. Venue conditions and
                  availability are unverified. Booking is simulated; Sepolia
                  test tokens go to a demo recipient, not the restaurant. Unused
                  funds can be claimed back.
                </p>
                <p>
                  You’ll need a browser wallet on Sepolia. Test funds are
                  prepared during the flow.
                </p>
                <Link href="/evidence">
                  View recorded runs <ExternalLink size={14} />
                </Link>
              </div>
            </details>
          ) : (
            <aside className="demo-aside">
              <div className="demo-guide">
                <span className="eyebrow">YOUR CALL, AT EVERY STEP</span>
                <h2>
                  You stay <em>in control</em>
                </h2>
                <div>
                  <LockKeyhole size={20} />
                  <section>
                    <h3>Your preferences are private</h3>
                    <p>
                      Tell us what matters. Your original preferences stay
                      private.
                    </p>
                  </section>
                </div>
                <div>
                  <Users size={20} />
                  <section>
                    <h3>One shared set of terms</h3>
                    <p>
                      See the restaurant, contribution, and spending limit
                      before you approve.
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
                <details className="demo-scope">
                  <summary>About this demo</summary>
                  <p>
                    Live restaurant search around Gangnam Station. Describe your
                    preferences in English. Venue conditions and availability
                    are unverified.
                  </p>
                  <p>
                    Booking and the reservation time are simulated. Sepolia test
                    tokens go to a demo recipient, not the real restaurant.
                  </p>
                </details>
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
          )}
        </div>
      </main>
    </div>
  );
}
