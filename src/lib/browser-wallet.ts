export type BrowserProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  isMetaMask?: boolean;
  isRabby?: boolean;
  providers?: BrowserProvider[];
};
declare global {
  interface Window {
    ethereum?: BrowserProvider;
  }
}
type WalletHost = EventTarget & { ethereum?: BrowserProvider };
export class BrowserWalletStore {
  private metamask: BrowserProvider | null = null;
  private otherProviders = new Set<BrowserProvider>();
  constructor(private host: WalletHost) {
    host.addEventListener("eip6963:announceProvider", (event) => {
      const detail = (event as CustomEvent).detail;
      if (typeof detail?.provider?.request !== "function") return;
      if (detail.info?.rdns === "io.metamask" && !detail.provider.isRabby)
        this.metamask = detail.provider;
      else this.otherProviders.add(detail.provider);
    });
    this.refresh();
  }
  refresh() {
    this.host.dispatchEvent(new Event("eip6963:requestProvider"));
  }
  current(): BrowserProvider | null {
    if (this.metamask) return this.metamask;
    const injected = this.host.ethereum;
    const providers = injected?.providers?.length
      ? injected.providers
      : injected
        ? [injected]
        : [];
    // Exclude other extensions that expose a MetaMask compatibility flag.
    return (
      providers.find(
        (provider) =>
          provider.isMetaMask &&
          !provider.isRabby &&
          !this.otherProviders.has(provider) &&
          typeof provider.request === "function",
      ) ?? null
    );
  }
}
let store: BrowserWalletStore | undefined;
export function browserWallets() {
  if (typeof window === "undefined")
    throw new Error("MetaMask is available only in the browser.");
  return (store ??= new BrowserWalletStore(window));
}
export async function getMetaMaskProvider(): Promise<BrowserProvider> {
  const wallets = browserWallets();
  wallets.refresh();
  if (!wallets.current())
    await new Promise((resolve) => setTimeout(resolve, 300));
  const provider = wallets.current();
  if (!provider)
    throw new Error(
      "MetaMask was not detected. Install or enable the MetaMask extension, then refresh this page.",
    );
  return provider;
}
