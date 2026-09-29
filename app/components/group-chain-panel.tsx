"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import type { SigningPolicy } from "../../src/lib/group-policy";
import {
  groupChainTransaction,
  readGroupChain,
  type GroupChainAction,
  type GroupChainState,
} from "../../src/lib/group-chain";
import { groupPolicyConfig } from "../../src/lib/server/group-config";

const money = (value: string) => `${formatUnits(BigInt(value), 6)} MockUSDC`;
const labels: Record<GroupChainAction, string> = {
  register: "Register policy on Sepolia",
  allowance: "Allow contribution amount",
  contribute: "Approve policy and contribute",
  cancel: "Cancel decision",
  refund: "Claim your refund",
};
const messages: Record<string, string> = {
  WRONG_WALLET:
    "Select the wallet used to sign in. Reconnect from the workspace if you want to use another account.",
  WRONG_CHAIN: "Select Ethereum Sepolia in your wallet.",
  INSUFFICIENT_MOCKUSDC:
    "Your wallet needs enough MockUSDC for this contribution.",
  TRANSACTION_REVERTED:
    "The transaction reverted. Refresh the chain status before retrying.",
};

export function GroupChainPanel({
  groupId,
  saved,
}: {
  groupId: string;
  saved: SigningPolicy;
}) {
  const [state, setState] = useState<GroupChainState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Hex | null>(null);
  const [lastHash, setLastHash] = useState<Hex | null>(null);
  const working = useRef(false);
  const mounted = useRef(true);
  const storageKey = `converge:group-tx:${saved.policyHash}`;
  const refresh = useCallback(async () => {
    const response = await fetch(
      `/api/groups/${encodeURIComponent(groupId)}/chain`,
      { cache: "no-store" },
    );
    if (!response.ok)
      throw new Error(
        "Chain status could not be verified. Check your session and retry.",
      );
    const next = (await response.json()) as GroupChainState;
    if (next.policyHash !== saved.policyHash)
      throw new Error("The saved policy changed. Reload this page.");
    if (mounted.current) {
      setState(next);
      setError("");
    }
  }, [groupId, saved.policyHash]);

  useEffect(() => {
    mounted.current = true;
    let checking = false;
    const poll = async () => {
      if (checking) return;
      checking = true;
      try {
        await refresh();
      } catch {
        if (mounted.current) {
          setState(null);
          setError(
            "Chain status is unavailable. Transactions are disabled until verification succeeds.",
          );
        }
      } finally {
        checking = false;
      }
    };
    try {
      const hash = localStorage.getItem(storageKey);
      if (hash && /^0x[0-9a-fA-F]{64}$/.test(hash)) {
        setPending(hash as Hex);
        setLastHash(hash as Hex);
      }
    } catch {
      /* Storage may be disabled; current page state still tracks the transaction. */
    }
    void poll();
    const timer = setInterval(() => void poll(), 10000);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [refresh, storageKey]);

  // A saved hash survives reload; never resend a transaction merely because a receipt is slow.
  useEffect(() => {
    if (!pending || !window.ethereum) return;
    let stopped = false;
    let checking = false;
    const check = async () => {
      if (checking || !window.ethereum) return;
      checking = true;
      try {
        const reader = createPublicClient({
          chain: sepolia,
          transport: custom(window.ethereum),
        });
        if ((await reader.getChainId()) !== sepolia.id) return;
        const receipt = await reader.waitForTransactionReceipt({
          hash: pending,
          confirmations: 2,
          timeout: 15000,
          onReplaced: ({ transactionReceipt }) => {
            if (stopped) return;
            const replacement = transactionReceipt.transactionHash;
            setLastHash(replacement);
            setPending(replacement);
            try {
              localStorage.setItem(storageKey, replacement);
            } catch {
              /* Optional persistence. */
            }
          },
        });
        const height = await reader.getBlockNumber({ cacheTime: 0 });
        if (
          height < receipt.blockNumber + 1n ||
          (await reader.getBlock({ blockNumber: receipt.blockNumber })).hash !==
            receipt.blockHash
        )
          return;
        if (stopped) return;
        try {
          localStorage.removeItem(storageKey);
        } catch {
          /* Optional persistence. */
        }
        setPending(null);
        setNotice(
          receipt.status === "success"
            ? "Transaction confirmed in two blocks. Refreshing group state."
            : "Transaction reverted. No successful contribution is recorded from this transaction.",
        );
        await refresh();
      } catch {
        /* Keep the hash pending while the provider or receipt is unavailable. */
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pending, refresh, storageKey]);

  async function transact(action: GroupChainAction) {
    if (working.current || pending) return;
    working.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!window.ethereum)
        throw new Error("Open this page in a browser with a wallet extension.");
      const provider = window.ethereum;
      const session = await fetch("/api/auth/session", { cache: "no-store" });
      if (!session.ok)
        throw new Error(
          "Sign in again before requesting a wallet transaction.",
        );
      const actor = ((await session.json()) as { walletAddress: Address })
        .walletAddress;
      const checkAccount = async () => {
        const accounts = (await provider.request({
          method: "eth_accounts",
        })) as Address[];
        if (accounts[0]?.toLowerCase() !== actor.toLowerCase())
          throw new Error("WRONG_WALLET");
      };
      await checkAccount();
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }],
      });
      const reader = createPublicClient({
        chain: sepolia,
        transport: custom(provider),
      });
      const fresh = await readGroupChain(
        reader,
        saved,
        groupPolicyConfig,
        actor,
        1,
      );
      const tx = groupChainTransaction(
        saved,
        groupPolicyConfig,
        actor,
        fresh,
        action,
      );
      // Simulation catches concurrent registration/contribution and token failures before signing.
      await reader.call({ ...tx, account: actor });
      await checkAccount();
      if ((await reader.getChainId()) !== sepolia.id)
        throw new Error("WRONG_CHAIN");
      const wallet = createWalletClient({
        account: actor,
        chain: sepolia,
        transport: custom(provider),
      });
      const hash = await wallet.sendTransaction(tx);
      setLastHash(hash);
      setPending(hash);
      try {
        localStorage.setItem(storageKey, hash);
      } catch {
        /* Optional persistence. */
      }
      setNotice("Transaction submitted. Waiting for two block confirmations.");
    } catch (failure) {
      const code = failure instanceof Error ? failure.message : "";
      try {
        await refresh();
      } catch {
        setState(null);
      }
      setError(
        messages[code] ??
          "The wallet request was rejected or could not be verified. Check the selected account, network and refreshed group state before retrying.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const own = state?.members.find(
    (m) => m.address.toLowerCase() === state.actor.toLowerCase(),
  );
  const expired = state && state.timestamp >= saved.policy.expiry;
  const funding =
    state?.registered &&
    state.status === 0 &&
    !expired &&
    own?.contribution === "0";
  const actions: GroupChainAction[] = [];
  if (state && !state.registered && !expired) actions.push("register");
  if (funding)
    actions.push(
      BigInt(state.allowance) < BigInt(saved.policy.contributionPerParticipant)
        ? "allowance"
        : "contribute",
    );
  if (state?.registered && (state.status === 0 || state.status === 1))
    actions.push("cancel");
  if (state && BigInt(state.refund) > 0n) actions.push("refund");
  return (
    <div>
      <h3>On-chain approval and contributions</h3>
      <p>
        Each participant signs with their own wallet. Token allowance and
        contribution are separate transactions. You need Sepolia ETH for gas and{" "}
        {money(saved.policy.contributionPerParticipant)}.
      </p>
      {state ? (
        <>
          <p>
            <strong>
              {!state.registered
                ? "Not registered"
                : expired && (state.status === 0 || state.status === 1)
                  ? "Expired"
                  : [
                      "Collecting contributions",
                      "Active · all six contributed",
                      "Payment complete",
                      "Cancelled",
                      "Expired",
                    ][state.status!]}
            </strong>{" "}
            · {state.approvals}/6 approvals
          </p>
          <p>
            Total contributed: {money(state.contributed)} · Your contribution:{" "}
            {money(own?.contribution ?? "0")} · Your wallet balance:{" "}
            {money(state.balance)}
          </p>
          <ul>
            {state.members.map((member) => (
              <li key={member.address}>
                {member.address.slice(0, 6)}…{member.address.slice(-4)} —{" "}
                {money(member.contribution)}
              </li>
            ))}
          </ul>
          <small>
            Verified at Sepolia block {state.blockNumber}, with two
            confirmations.
          </small>
          {state.status === 1 && (
            <p>
              All six participants have funded this decision. The configured
              group executor can now pay the exact approved amount. See the
              execution page for its recorded progress. Participants can cancel
              and recover funds before payment.
            </p>
          )}
          {BigInt(state.refund) > 0n && (
            <p>Your available refund: {money(state.refund)}</p>
          )}
          <div className="group-chain-actions">
            {actions.map((action) => (
              <button
                key={action}
                className={action === "cancel" ? "text-button" : "primary"}
                disabled={
                  busy ||
                  !!pending ||
                  ((action === "allowance" || action === "contribute") &&
                    BigInt(state.balance) <
                      BigInt(saved.policy.contributionPerParticipant))
                }
                onClick={() => void transact(action)}
              >
                {labels[action]}
              </button>
            ))}
          </div>
          {funding &&
            BigInt(state.balance) <
              BigInt(saved.policy.contributionPerParticipant) && (
              <p>
                Your MockUSDC balance is insufficient. Ordinary groups do not
                receive automatic demo funds.
              </p>
            )}
        </>
      ) : (
        <p>Waiting for verified chain state.</p>
      )}
      <button
        className="text-button"
        disabled={busy}
        onClick={() =>
          void refresh().catch(() => {
            setState(null);
            setError("Chain verification failed.");
          })
        }
      >
        Refresh chain status
      </button>
      {pending && (
        <div>
          <p>
            A transaction is pending. Wallet replacements are tracked when
            detected.
          </p>
          <details>
            <summary>Recover a dropped or replaced transaction</summary>
            <p>
              First check the transaction in your wallet or explorer. If this
              hash was dropped or replaced before this page reopened, you can
              stop tracking it here. This does not cancel an on-chain
              transaction. Every subsequent action checks the current policy and
              contribution again.
            </p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                try {
                  localStorage.removeItem(storageKey);
                } catch {
                  /* Optional persistence. */
                }
                setPending(null);
                setState(null);
                void refresh().catch(() =>
                  setError("Chain verification failed."),
                );
              }}
            >
              Stop tracking this hash
            </button>
          </details>
        </div>
      )}
      {lastHash && (
        <p>
          <a
            href={`https://sepolia.etherscan.io/tx/${lastHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View last transaction
          </a>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
