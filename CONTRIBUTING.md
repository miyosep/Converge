# Contributing to Converge

Read [project_guideline.md](project_guideline.md) and [the shared foundation](docs/FOUNDATION.md) before claiming a task. All project documentation and code comments are in English. Owners claim their own work; reviewers volunteer separately.

## Local Setup

The final demo machine is a MacBook. Follow [MacBook setup and rehearsal requirements](docs/MACBOOK_DEMO.md). New feature scripts and dependencies must support macOS; CI checks the foundation on Apple Silicon, Intel Mac, Linux, and Windows.

Install Node.js 24.19.0 and pnpm 11.19.0. With a normal Node/npm installation, install pnpm using `npm install --global pnpm@11.19.0`.

```sh
git clone https://github.com/miyosep/Converge.git
cd Converge
pnpm install --frozen-lockfile
pnpm check
```

No API key, database, wallet, or RPC is required for these foundation checks. The web application is not scaffolded yet, so there is no `dev` command. Create a local `.env` from `.env.example` when implementing external integrations; never commit populated credentials.

## Start a Branch

Start with a clean working tree. Commit or otherwise preserve unfinished changes before switching branches.

```sh
git switch main
git pull --ff-only origin main
git switch -c feat/your-name-short-description
```

For example, Sage can use `feat/sage-blockchain`. The branch name is a convention, not an assignment. Verify `git config user.name` and `git config user.email` show your own identity. HTTPS login and commit identity are separate settings; each contributor uses their own account.

## Before a Pull Request

1. Add your name to the relevant task's Owner cell and update its Status.
2. Use the shared schemas and constants instead of duplicating their definitions.
3. Run `pnpm format` and `pnpm check`; add checks relevant to your behavior change.
4. Update the lockfile with pnpm when dependencies change. Commit the lockfile with `package.json`.
5. Include any schema/ABI/configuration change and its downstream impact in the PR.
6. Update README when actual run commands or evidence become available.

Push your branch and open a PR against `main`. Merge reviewed changes into `main`; do not force-push shared branches. This workflow is a team convention; repository branch-protection settings have not been configured by this scaffold.

## Shared Changes

Discuss modifications to monetary units, privacy boundaries, schema versions, approval semantics, and ABI field order before merging. Update affected consumers in the same change. In particular, the Solidity policy encoding is still T03 under Sage; TypeScript must not independently invent its own final policy hash.
