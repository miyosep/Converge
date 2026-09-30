import type { BrowserProvider } from "./browser-wallet";

// Bound only reads: a signing/network prompt may still be open in the wallet.
// Timing out a write and enabling a retry could submit a duplicate transaction.
const reads = new Set([
  "eth_accounts",
  "eth_chainId",
  "eth_blockNumber",
  "eth_call",
  "eth_estimateGas",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getLogs",
]);

export function withWalletReadTimeout(
  provider: BrowserProvider,
  timeoutMs = 20_000,
): BrowserProvider {
  return {
    async request(args) {
      if (!reads.has(args.method)) return provider.request(args);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          provider.request(args),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("WALLET_READ_TIMEOUT")),
              timeoutMs,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
