import { getAddress, stringToHex, type Address } from "viem";
import type { BrowserProvider } from "./browser-wallet.js";

const chainId = "0xaa36a7";
export function walletErrorCode(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as {
    code?: unknown;
    data?: { originalError?: unknown };
    cause?: unknown;
  };
  if (typeof value.code === "number") return value.code;
  return walletErrorCode(value.data?.originalError ?? value.cause);
}

export function walletConnectionError(error: unknown): string {
  switch (walletErrorCode(error)) {
    case -32002:
      return "A wallet request is already pending. Open MetaMask and approve or reject that request, then try again.";
    case 4001:
      return "The wallet request was cancelled. Connect again when you are ready.";
    case 4100:
      return "This site is not authorized in MetaMask. Open the wallet and reconnect this site.";
    case 4902:
      return "Sepolia is not available in MetaMask. Add or enable the Sepolia test network, then reconnect.";
    default:
      return error instanceof Error
        ? error.message
        : "MetaMask could not complete the request. Open its extension to check for a pending approval.";
  }
}

export async function ensureSepolia(provider: BrowserProvider) {
  if (Number(await provider.request({ method: "eth_chainId" })) === 11155111)
    return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  } catch (error) {
    if (walletErrorCode(error) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: "Sepolia",
          nativeCurrency: {
            name: "Sepolia Ether",
            symbol: "ETH",
            decimals: 18,
          },
          rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        },
      ],
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    });
  }
  if (Number(await provider.request({ method: "eth_chainId" })) !== 11155111) {
    throw new Error("Select Sepolia in your wallet before continuing.");
  }
}

export async function connectWalletAccount(
  provider: BrowserProvider,
): Promise<Address> {
  // Establish site permission before asking MetaMask to change the site's network.
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string")
    throw new Error("No wallet account selected");
  const address = getAddress(accounts[0]);
  await ensureSepolia(provider);
  const current = await provider.request({ method: "eth_accounts" });
  if (
    !Array.isArray(current) ||
    typeof current[0] !== "string" ||
    current[0].toLowerCase() !== address.toLowerCase()
  )
    throw new Error(
      "Wallet account changed. Connect again with the account you want to use.",
    );
  return address;
}

export async function signWalletLogin(
  provider: BrowserProvider,
  message: string,
  address: Address,
) {
  const signature = await provider.request({
    method: "personal_sign",
    params: [stringToHex(message), address],
  });
  if (typeof signature !== "string")
    throw new Error("The wallet did not return a sign-in signature");
  return signature;
}
