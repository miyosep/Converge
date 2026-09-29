import assert from "node:assert/strict";
import test from "node:test";
import {
  BrowserWalletStore,
  type BrowserProvider,
} from "../src/lib/browser-wallet.js";
function host(ethereum?: BrowserProvider) {
  return Object.assign(new EventTarget(), ethereum ? { ethereum } : {});
}
function announce(
  target: EventTarget,
  provider: BrowserProvider,
  rdns: string,
) {
  target.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", {
      detail: { info: { rdns }, provider },
    }),
  );
}
test("MetaMask handles requests even when another wallet is the default injector", async () => {
  const requests: string[] = [];
  const other = {
    isMetaMask: true,
    isRabby: true,
    request: async () => {
      requests.push("other");
    },
  };
  const metamask = {
    isMetaMask: true,
    request: async () => {
      requests.push("metamask");
    },
  };
  const target = host(other);
  const store = new BrowserWalletStore(target);
  announce(target, other, "io.rabby");
  assert.equal(store.current(), null);
  announce(target, metamask, "io.metamask");
  await store.current()!.request({ method: "eth_requestAccounts" });
  assert.deepEqual(requests, ["metamask"]);
});
test("MetaMask-only legacy detection excludes compatibility providers", () => {
  const other = { isMetaMask: true, isRabby: true, request: async () => [] };
  const metamask = { isMetaMask: true, request: async () => [] };
  assert.equal(new BrowserWalletStore(host(other)).current(), null);
  assert.equal(
    new BrowserWalletStore(
      host({ request: async () => [], providers: [other, metamask] }),
    ).current(),
    metamask,
  );
  assert.equal(new BrowserWalletStore(host()).current(), null);
});
test("an announcement from a different wallet cannot replace MetaMask", () => {
  const metamask = { isMetaMask: true, request: async () => [] };
  const target = host();
  const store = new BrowserWalletStore(target);
  announce(target, metamask, "io.metamask");
  announce(
    target,
    { isMetaMask: true, request: async () => [] },
    "com.other.wallet",
  );
  store.refresh();
  assert.equal(store.current(), metamask);
});
