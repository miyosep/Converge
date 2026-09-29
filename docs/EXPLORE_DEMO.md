# Wallet-Connected Explore Demo

Explore Demo is available at `/demo`. It uses one judge-controlled wallet and five operator-controlled test wallets. The judge's public address is obtained after wallet connection; it does not need to be known beforehand. Every run freezes a new six-address policy. The UI labels the five automated participants and the synthetic restaurant catalog.

## Judge Journey

1. Open **Explore Demo** and connect a browser wallet on Ethereum Sepolia. Sign the existing SIWE login challenge. This login signature does not authorize spending.
2. Start a session. On a shared deployment, enter the event access code. Refreshing or reconnecting the same wallet resumes its existing session.
3. Enter dinner preferences. The worker calls live Kiln `qwen3-32b`; inspect and confirm the extracted conditions. A session permits at most three extraction requests. The other five participants use disclosed synthetic preferences.
4. Review the restaurant, merchant address, deposit, spending cap, contribution, expiry, token, and policy hash. Unsupported or conflicting conditions do not create a payable proposal.
5. Select **Prepare my test funds**. The deployer-controlled minter supplies only the shortfall needed to reach 10 MockUSDC. If necessary, the worker supplies the shortfall to 0.001 Sepolia ETH. It then creates the on-chain policy through a participating demo account. These transfers are not payment approval.
6. Select **Approve & contribute 10 MockUSDC**. When necessary, approve exactly 10 tokens in the wallet, wait for that receipt, then sign the separate contribution transaction. The application never holds the judge's key or signs on their behalf.
7. After the judge's contribution has two block confirmations, the five automated accounts approve and contribute to the same policy. The UI shows the actual on-chain count. No automated contribution is initiated before the judge contributes.
8. The executor performs a read-only 80 MockUSDC validation check, records the rejection, and submits the exact approved deposit. Baseline Restaurant A uses 45 MockUSDC; a lower-budget recommendation can use a different deposit, such as 36 for Restaurant B.
9. Claim the remaining share from the connected wallet. The baseline refund is 2.5 MockUSDC. Before payment, a participant may cancel; after cancellation or expiry, contributors can recover their full contribution. The worker refunds automated participants and never claims for the judge.

This demonstrates six distinct signing addresses, with one independent human and five automated demo participants. It does not replace the required full multi-user acceptance evidence or the actual MacBook rehearsal.

## Runtime and Configuration

Run the web app and worker from the same checkout and OS user on one persistent host. The private `.demo/` directory is their durable queue and transaction journal. It is ignored by Git. This implementation is not designed for ephemeral serverless filesystems or several independent hosts.

Keep existing `.env` and `.env.development` files. The worker loads `.env` first, then `.env.development`; later values take precedence. Existing wallet-auth database configuration is reused without a migration. Configure the following in `.env.development`:

```dotenv
EXPLORE_DEMO_ENABLED=true
EXPLORE_DEMO_DIRECTORY=.demo
EXPLORE_DEMO_MAX_RUNS=5
EXPLORE_DEMO_MAX_ETH=0.05
EXPLORE_DEMO_ACCESS_CODE=
```

The code is optional for localhost. A non-local `APP_ORIGIN` requires a nonempty access code. Use HTTPS and a private event code for a shared deployment. The code is checked only when admitting a session; existing sessions remain bound to their SIWE-authenticated wallet. Browser state never selects an arbitrary participant identity.

The worker uses the existing `RPC_URL`, `KILN_API_KEY`, `DEPLOYER_PRIVATE_KEY`, `AGENT_EXECUTOR_PRIVATE_KEY`, and participant keys 2 through 6. It checks their addresses against the checked-in manifests. It does not use participant 1's private key: that seat belongs to the judge. Merchant keys are not needed. The worker verifies Sepolia's chain ID and genesis, deployed bytecode hashes, and MockUSDC minter before running.

```sh
pnpm demo:explore-check
pnpm dev
```

In a second terminal, from the same directory:

```sh
pnpm demo:explore
```

The `--check` command is read-only. The running worker does not send transactions merely because it starts: an authenticated run must reach **Prepare my test funds** first. Keep the worker running to collect contributions and observe cancellations/refunds. Open `http://localhost:3000/demo` in a browser with a wallet extension. MacBook setup uses the same commands after the existing Node/pnpm setup; no Windows-specific paths are required.

## Limits and Recovery

- A wallet gets one resumable run per persistent directory. The default directory admits five runs total. Do not delete it to reset a run: it holds grant limits and signed transaction recovery data.
- The default 0.05 ETH limit is a lifetime upper bound across the worker's signed transactions in this directory. It reserves `value + gas limit * maximum gas price` before broadcast, including bot/executor costs and ETH grants. Actual costs can be lower. Raising this limit is an explicit operator configuration change.
- Each wallet gets at most one gas top-up and one token top-up per run and funding purpose. A judge who transfers their grant elsewhere does not receive an unlimited refill. Five automated participants are funded only as needed. The creator's gas target is 0.004 ETH; other automated signers target 0.001 ETH.
- Signed transactions are saved before broadcast and reused on retry. One worker lock serializes shared signer nonces. Do not run other funding, deployment, or blockchain rehearsal scripts with these same keys while this worker is active.
- The UI uses two block confirmations for interactive progress. These are not finalized-chain evidence. After a final acceptance run, independently verify finalized receipts and decoded events using the existing evidence workflow.
- `DEMO_BUSY` means another command owns the run briefly; retry after it finishes. `DEMO_ETH_BUDGET_EXCEEDED` requires the operator to inspect the budget. Generic runner failures retain the journal and do not expose provider URLs or credentials.
- Stop the worker with Ctrl+C before maintenance. A forced process termination can leave `.demo/worker.lock` or a run's `.json.lock`. Check the PID stored in the lock and verify the process is no longer alive before removing only that stale lock. Preserve run JSON and `.demo/private/transactions.json`.
- Expired policies cannot be edited or revived. The judge can recover contributed funds using the refund action. A new event needs a deliberately prepared new session configuration, not deletion of a pending journal.

## Verification and Remaining Rehearsal

`pnpm check` covers request admission, per-wallet limits, access codes, stale revisions, policy locks, and transaction-journal recovery alongside the existing tests. `pnpm demo:explore-test` starts a disposable local Anvil instance and exercises funding, dynamic judge membership, five scripted contributions, payment, refunds, cancellation, expiry, and repeated worker recovery. Run `pnpm contracts:build` first if contract artifacts are absent. This harness uses synthetic confirmed preferences and never loads `.env`, sends Sepolia transactions, or calls Kiln.

The actual browser-wallet flow, live Kiln input for a judge, and complete Explore session on Sepolia still need a supervised run. No actual MacBook rehearsal is claimed by local automated tests. Keep the draft README updated when that evidence is available.
