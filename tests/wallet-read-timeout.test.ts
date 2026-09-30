import assert from "node:assert/strict";
import test from "node:test";
import { withWalletReadTimeout } from "../src/lib/wallet-read-timeout";

test("stalled wallet reads time out without retrying the provider", async () => {
  let calls = 0;
  const provider = withWalletReadTimeout(
    {
      request: () => {
        calls++;
        return new Promise(() => {});
      },
    },
    10,
  );
  await assert.rejects(
    provider.request({ method: "eth_estimateGas" }),
    /WALLET_READ_TIMEOUT/,
  );
  assert.equal(calls, 1);
});

test("wallet signing and network prompts remain pending until the wallet resolves", async () => {
  for (const method of [
    "eth_sendTransaction",
    "wallet_switchEthereumChain",
    "wallet_addEthereumChain",
  ]) {
    let resolve!: (value: unknown) => void;
    const provider = withWalletReadTimeout(
      {
        request: () =>
          new Promise((done) => {
            resolve = done;
          }),
      },
      1,
    );
    let settled = false;
    const pending = provider.request({ method }).then((value) => {
      settled = true;
      return value;
    });
    await new Promise((done) => setTimeout(done, 10));
    assert.equal(settled, false);
    resolve("wallet-result");
    assert.equal(await pending, "wallet-result");
  }
});

test("read results and provider errors are preserved", async () => {
  assert.equal(
    await withWalletReadTimeout({ request: async () => "0xaa36a7" }).request({
      method: "eth_chainId",
    }),
    "0xaa36a7",
  );
  const denied = Object.assign(new Error("denied"), { code: 4001 });
  await assert.rejects(
    withWalletReadTimeout({
      request: async () => {
        throw denied;
      },
    }).request({ method: "eth_accounts" }),
    (error) => error === denied,
  );
});
