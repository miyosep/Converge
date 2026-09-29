import assert from "node:assert/strict";
import test from "node:test";
import { hexToString, type Hex } from "viem";
import type { BrowserProvider } from "../src/lib/browser-wallet.js";
import {
  connectWalletAccount,
  ensureSepolia,
  signWalletLogin,
  walletConnectionError,
} from "../src/lib/wallet-connection.js";

const address = "0x0000000000000000000000000000000000000001";
test("First connection adds unknown Sepolia and reconnect still requests a sign-in signature", async () => {
  let authorized = false,
    added = false,
    chain = "0x1";
  const calls: string[] = [];
  const provider: BrowserProvider = {
    request: async ({ method, params }) => {
      calls.push(method);
      if (method === "eth_requestAccounts") {
        authorized = true;
        return [address];
      }
      assert.ok(authorized, "authorize the site before changing its network");
      if (method === "eth_chainId") return chain;
      if (method === "wallet_switchEthereumChain") {
        if (!added) throw { code: 4902 };
        chain = "0xaa36a7";
        return null;
      }
      if (method === "wallet_addEthereumChain") {
        added = true;
        return null;
      }
      if (method === "eth_accounts") return [address];
      if (method === "personal_sign") {
        assert.equal(hexToString(params![0] as Hex), "Sign in to Converge");
        assert.equal(params![1], address);
        return "0xsignature";
      }
      throw new Error(`Unexpected ${method}`);
    },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const selected = await connectWalletAccount(provider);
    await signWalletLogin(provider, "Sign in to Converge", selected);
  }
  assert.equal(calls[0], "eth_requestAccounts");
  assert.equal(calls.filter((method) => method === "personal_sign").length, 2);
  assert.equal(
    calls.filter((method) => method === "wallet_addEthereumChain").length,
    1,
  );
  assert.equal(
    calls.filter((method) => method === "wallet_switchEthereumChain").length,
    2,
  );
});

test("pending and rejected wallet prompts are surfaced without repeated network requests", async () => {
  for (const code of [-32002, 4001]) {
    let requests = 0;
    const provider: BrowserProvider = {
      request: async ({ method }) => {
        requests++;
        if (method === "eth_chainId") return "0x1";
        throw { code };
      },
    };
    await assert.rejects(ensureSepolia(provider), (error) => {
      assert.match(
        walletConnectionError(error),
        code === -32002 ? /already pending/ : /cancelled/,
      );
      return true;
    });
    assert.equal(requests, 2);
  }
});

test("a changed account or unchanged chain cannot proceed to login", async () => {
  await assert.rejects(
    connectWalletAccount({
      request: async ({ method }) => {
        if (method === "eth_requestAccounts") return [address];
        if (method === "eth_chainId") return "0xaa36a7";
        return ["0x0000000000000000000000000000000000000002"];
      },
    }),
    /account changed/,
  );
  await assert.rejects(
    ensureSepolia({
      request: async ({ method }) => (method === "eth_chainId" ? "0x1" : null),
    }),
    /Select Sepolia/,
  );
});
