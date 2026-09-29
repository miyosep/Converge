import { walletConnectionError } from "../wallet-connection";

// Bounds for the deployed six-person demo contracts, exercised by the local
// payment/cancellation/refund rehearsal. Supplying gas prevents the browser
// wallet from substituting a block-sized limit for these small transactions.
export const demoTransactionGas = {
  approve: 100_000n,
  approveAndContribute: 300_000n,
  claimRefund: 150_000n,
  cancelDecision: 100_000n,
} as const;

export function demoWalletError(error: unknown) {
  const message = walletConnectionError(error);
  if (/gas limit too high|exceeds.*gas.*cap/i.test(message))
    return "The wallet used a gas limit that Sepolia rejected. Refresh this page and try the transaction again.";
  return message;
}
