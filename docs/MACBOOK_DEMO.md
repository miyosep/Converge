# MacBook Setup and Demo Readiness

The final live demo will run from a MacBook. macOS is a required target for every feature branch. The foundation CI covers macOS 15 on both Apple Silicon (arm64) and Intel (x64), as well as Linux and Windows. A successful foundation check does not establish that the unimplemented full demo works.

## Install the Foundation

1. In Terminal, run `uname -m` to identify Apple Silicon (`arm64`) or Intel (`x86_64`).
2. Install Node.js 24.19.0 using the matching macOS download from the [official Node.js distribution](https://nodejs.org/download/release/v24.19.0/), or a version manager that installs the version in `.node-version`. Use a native arm64 Node installation on Apple Silicon. Check `node --version` and `node -p process.arch`.
3. Ensure `git --version` works. If macOS prompts for Command Line Tools, complete that installation.
4. Install the pinned package manager: `npm install --global pnpm@11.19.0`. If a system-wide Node install causes permission problems, use a user-owned Node version manager instead of running project commands with sudo.
5. Clone the repository and install from the shared lockfile:

```sh
git clone https://github.com/miyosep/Converge.git
cd Converge
pnpm install --frozen-lockfile
pnpm check
```

An existing checkout should use `git pull --ff-only` from a clean main branch before installation. Reuse the same lockfile on all platforms. Never copy `node_modules`, Windows executables, or another machine's `.env` into the Mac checkout. pnpm installs the appropriate native dependency binaries on each machine.

The current foundation needs no database, RPC, API key, Docker, wallet extension, or Foundry installation. It has no web server or runnable purchasing demo yet. Follow the README for available commands rather than assuming that `pnpm dev` or `pnpm demo:baseline` exists.

## Install Foundry for Contract Work

The contract suite uses Foundry v1.8.3 and Solc 0.8.24. On the MacBook, install
Foundryup using the [official installer](https://getfoundry.sh/getting-started/installation),
then select the same Foundry version and verify it:

```sh
curl -L https://getfoundry.sh/install | bash
export PATH="$HOME/.foundry/bin:$PATH"
foundryup --install v1.8.3
forge --version
forge test --root contracts -vv
```

The installer configures the user's shell startup file for future terminals;
the explicit `PATH` line enables the current terminal. Foundry v1.8.3 and
the tests have passed on a Windows x64 development machine;
they still need to be run on the actual presentation MacBook. No RPC or wallet
key is needed for the local policy-hash tests.

## Connect the existing blockchain deployment

The blockchain changes are on `feat/sage-policy-encoding` until reviewed and
merged. Check out that branch to rehearse this work before the merge. Create
the MacBook's own ignored `.env` from `.env.example`, then use the public RPC
and contract addresses from [DEPLOYMENT.md](DEPLOYMENT.md). Transfer the six
demo participant keys and the executor test key privately into that file.
The deployer and merchant keys are not required for the payment/refund rehearsal.
Keep the public deployment, role, and funding manifests from Git.

```sh
pnpm demo:preflight
pnpm demo:preflight --check-signers
```

The first command checks public blockchain configuration and balances. The
second also checks that the local signing accounts match the funded addresses.
Both are read-only. Do not generate replacement accounts for the existing
manifest or repeat the one-off funding commands during routine setup.

## Feature Implementation Requirements

- Write setup and demo orchestration in portable TypeScript/Node code or the chosen contract toolchain. Do not require PowerShell, drive-letter paths, Windows-only executables, or shell-specific environment assignments inside package scripts.
- Use `node:path` for filesystem paths, match filename casing exactly, and keep external paths/configuration in environment variables.
- Add dependencies supporting native macOS arm64 and x64, and keep optional platform packages in the shared lockfile. Do not hard-code a Windows esbuild or compiler package.
- Sage must verify Foundry v1.8.3 on the presentation MacBook. Contract tests are configured for macOS arm64 and Intel CI; confirm the first CI results before treating that coverage as verified.
- The application implementation must add real dev/build/start commands and verify the chosen browser and wallet extension on the demo MacBook.
- Select persistence that is reachable from the MacBook. If a local database or container is chosen, document its macOS installation and architecture support; it is not an existing prerequisite of the foundation.
- Kiln inference runs through the remote API; the MacBook does not need a local Furiosa NPU or model download. The selected demo chain is Ethereum Sepolia (`11155111`). Confirm Kiln and Sepolia RPC connectivity from the demo venue, and fund the six participant accounts plus the executor/deployer with Sepolia ETH for gas.

## Final Rehearsal Gate

Once the application and contracts exist, run the following on the actual presentation MacBook before marking the demo ready:

1. Record hardware architecture, macOS version, Node/pnpm versions, contract toolchain version, browser/wallet version, commit SHA, and the Ethereum Sepolia RPC/chain ID.
2. Install with `pnpm install --frozen-lockfile`, run `pnpm check`, then run the implemented app build and contract checks.
3. Create an ignored `.env` from `.env.example` and configure live Kiln, persistence, RPC, deployed addresses, and test-only credentials. Verify configuration without printing secrets.
4. Prepare six independent authenticated participant sessions/test accounts and test gas/mock-token balances. The UI must not depend on Windows browser profiles.
5. Complete the baseline, lower-budget, and changed-merchant workflows from the MacBook. Check real usage logs, approvals, invalid requests, successful payments, and six refunds per run.
6. Export sanitized evidence and rehearse reload/restart recovery. Ensure date/expiry settings are still valid at presentation time.

Keep this rehearsal pending until it has actually happened. CI validates hosted macOS machines; the presentation machine, browser wallet, venue network, and live integrations still require a rehearsal.

## CI Coverage

GitHub labels `macos-15` as arm64 and `macos-15-intel` as Intel in its [runner documentation](https://docs.github.com/en/actions/reference/runners/github-hosted-runners). Each job logs its actual platform, CPU architecture, and Node version before installing dependencies and running the same checks.
