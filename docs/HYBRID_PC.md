# Vercel web + a continuously running PC

The web app writes authenticated commands to Neon. A local process scans the same
database every five seconds after completing a pass, executes saved work and
writes results back. No inbound connection, public PC address, tunnel, or Inngest
account/key is needed. Larger queues take longer than five seconds. Closing the
browser does not stop processing; losing power, sleep or internet pauses it.

## Configure the shared database and web

Use the same pooled `DATABASE_URL` on the PC and Vercel. Apply all checked-in
migrations through `0018_group_before_search.sql` before deploying the updated
web app and processor. The preflight checks acknowledgements and live preference tables. Use the direct URL
with the migration runner. Test in a Neon branch first.

Set these on the Vercel production deployment:

```dotenv
BACKGROUND_DRIVER=hybrid
BACKGROUND_JOBS_ENABLED=true
EXPLORE_DEMO_ENABLED=true
GROUP_EXECUTION_ENABLED=true
```

Retain `APP_ORIGIN`, database, session, RPC, Kiln and demo access-code configuration.
For live place search, configure `XAPI_KEY` and `KILN_API_KEY` on both the web
deployment (general `/discover` search and friends’ confirmed-preference search) and the PC's `.env.hybrid` (queued Explore
Demo searches). Keep `RESTAURANT_SEARCH_PROVIDER=xapi`. The PC does not inherit
the web deployment's credentials; see `LIVE_DEMO_BOOKING.md` for the booking flow.
Google connection/callback flows still require the Google settings on Vercel.
**Do not put operator private keys on Vercel in hybrid mode.** Inngest functions
are disabled in this mode, and hybrid execution is rejected inside Vercel.
Preview deployments do not dispatch jobs or report an active processor.
Give previews a separate Neon branch: the PC scans its database regardless of
which deployment originally wrote a command. Never share production DB credentials
with a preview intended to be isolated from execution.

## Configure this PC once

1. Install the pinned Node and pnpm versions from `CONTRIBUTING.md`; run
   `pnpm install --frozen-lockfile`.
2. Copy `docs/hybrid.env.example` to `.env.hybrid`. It is ignored by Git. Populate
   the same database URL and the existing test-only RPC, Kiln and operator keys.
   The service loads **only this file**, not `.env.development` or `.env`. Application
   settings in the parent terminal cannot override it; omitted application settings
   listed in `.env.example` are cleared from the child environment.
3. Stop the old Explore/group/calendar workers and disable hosted Inngest jobs
   using these same signers. To preserve existing file-based Explore sessions,
   stop the source web app and use `scripts/import-explore-state.ts` as documented
   in `VERCEL_INNGEST.md`. Do not discard pending signed journals or reset budgets.
4. Set the desired `EXPLORE_DEMO_ENABLED` and `GROUP_EXECUTION_ENABLED` flags to
   `true` in `.env.hybrid`. Enable Calendar by supplying the same Google settings
   and token encryption key used by the web app.
5. Run `pnpm hybrid:check` to check DB connectivity and migrated tables without
   processing transactions. This does not validate live RPC/AI/Google credentials.
6. Run `pnpm hybrid:start` for foreground operation. It restarts the child process
   five seconds after a crash. Stop it with Ctrl+C.

The default `.demo/worker.lock` prevents overlap with legacy signers on this PC.
A stale lock is recovered only after verifying its recorded process no longer
exists. DB leases and the shared journal prevent overlapping database-backed
workers from preparing conflicting signatures. Never run a legacy signer on
another computer against the same accounts; its file locks are not shared.

## Windows automatic start

After configuration and cutover, run from PowerShell in this repository:

```powershell
pnpm hybrid:install -StartNow
```

This checks the DB, registers `Converge Hybrid Processor` in Task Scheduler under
the current user, starts it now, and starts it again at that user's next login.
No administrator account or stored Windows password is required. It runs without
a terminal window and uses the absolute Node path found during installation.
Keep this directory and Node installation in place, and reinstall the task if
they move. Logs are in `.hybrid/processor.log`; one previous log is retained after
a restart when the current file exceeds 10 MB. These files are ignored by Git.

```powershell
Get-ScheduledTaskInfo -TaskName 'Converge Hybrid Processor'
Stop-ScheduledTask -TaskName 'Converge Hybrid Processor'
# Disable automatic start, or remove it entirely:
Disable-ScheduledTask -TaskName 'Converge Hybrid Processor'
Unregister-ScheduledTask -TaskName 'Converge Hybrid Processor' -Confirm:$false
```

Set Windows sleep/hibernate to Never while plugged in. Screen-off and screen lock
are fine; logging out stops the interactive user's task. After reboot, sign into
this Windows account. Power/sleep settings are not changed by the installer.

## Recovery and availability

Commands, signed transactions, gas budgets and run state live in Neon. A failed
notification remains pending until acknowledged; it does not expire while the PC
is offline. A completion acknowledges only the dispatch version it processed,
leaving newer requests queued and preserving the ten-second dispatch cooldown. A failed
job does not stop other jobs in the scan. Connection failures retry; a stalled
process is restarted by the supervisor. The next scan resumes saved work using
the same transaction journal. Group history is checkpointed in bounded batches.
Calendar runs after group state refresh so it can use a recent payment snapshot.

The web checks a hybrid-specific heartbeat with a 90-second freshness window.
Old Inngest heartbeats cannot make a stopped PC appear online. During outages the
website remains available, but automatic work waits for the PC to reconnect.
Continuous polling keeps Neon compute active; monitor the database plan's usage.

Code and local rehearsals do not constitute a public deployment. The Vercel project,
shared database selection, credentials, source-state import and enabling the local
service must be completed together before a live demonstration.

## Verification recorded on 2026-09-30

- Shared-worktree `pnpm check`: 124 tests, TypeScript and formatting passed.
- Production build with `VERCEL=1` and `BACKGROUND_DRIVER=hybrid` passed; the
  existing viem/ox dynamic dependency warning remains.
- `scripts/hybrid-db-rehearsal.ts` on the isolated `dev-vercel-inngest` branch
  passed durable wakeups, recovery without a wakeup, polling, zero Inngest sends
  and independent PC health expiry. No real signer, AI or Google calls were made.
- The supervisor restarted a deliberately terminated test child after five
  seconds. The production HTTP app then read `workerOnline=true` from Neon.
- Windows task scripts passed PowerShell syntax checks. The persistent Windows
  task has not been registered and live processing has not been enabled.

Release review against `origin/main` (`8f5ede4`) used a clean isolated checkout:
138 tests, the hybrid production build, ordinary-group and Explore Anvil payment,
cancellation, expiry and refund rehearsals all passed. Additional Neon checks cover
two-day-old notifications, concurrent newer wakeups and preserved dispatch throttling.
The PC preflight passed despite deliberately incorrect inherited driver/DB values.
The migration runner now accepts legacy LF/CRLF checksum differences while still
rejecting SQL content changes. Migration `0015` was applied only to the isolated
test branch; deploying this release still requires applying it to the chosen live DB.

## Production cutover completed on 2026-09-30

The historical verification notes above describe earlier rehearsals. The live
production setup is now https://converge-iota-seven.vercel.app (Vercel project
`converge`, scope `juhyeong5627-4846s-projects`). Production Neon migrations
through `0017` are applied. Seven existing Explore runs and all 108 signed
journal entries were imported atomically; source files remain preserved.

The Windows task `Converge Hybrid Processor` is installed and running from
`C:/Users/kimsi/.codex/worktrees/hybrid-release-review/gwdc_furiosa`. Keep this
checkout and its ignored `.env.hybrid` in place. Its lock directory is the
original desktop checkout's `.demo`, preventing an old local signer from
running concurrently. Do not restart the legacy worker. The original localhost
development app is separate from the production site; use the public site for
the shared demo. AC idle sleep was changed from ten minutes to Never; battery
settings were left unchanged. Sign back into Windows after a reboot.

The public home, demo, discovery and evidence pages return HTTP 200. The public
`/api/demo` reports `enabled=true`, `searchConfigured=true`,
`accessCodeRequired=false` and `workerOnline=true`. Live Sepolia read-only
checks verified RPC, deployed contract bytecode, minter and bot identities.
No new human-wallet production payment was submitted during deployment.

Operator signing keys stay on the PC. Only web configuration is provisioned
in Vercel's production environment. The demo access code is stored in the
ignored PC `.env.hybrid` and Vercel; it is intentionally absent here. Google
Calendar credentials are not configured. GitHub-to-Vercel linking requires
repository authorization; the current deployment was uploaded using the CLI,
and pushing main alone does not currently deploy it.

Release validation: 151 application tests and production build passed before
cutover. GitHub's four OS foundation jobs passed. The contract format check
identified V2 formatting issues, which were corrected without ABI changes;
all 31 local contract tests, including fuzz and invariant tests, then passed.


## Shared test payments and readiness

After all real members confirm their preferences and vote for one place, the organizer can set a total Sepolia MockUSDC amount and test recipient. Each member's share is the total divided by the actual participant count, rounded up to the token's smallest unit; any rounding remainder is refundable. The saved policy freezes those terms; every member must review, approve and contribute using their own wallet. No venue booking or real payment is implied. The hybrid worker prepares missing test tokens up to each member's required share and tops up eligible wallets toward a 0.001 Sepolia ETH balance, recording signed grants separately under `funding:` in the group journal. Grants share the existing `GROUP_EXECUTION_MAX_ETH` lifetime budget with group execution; no automated demo participant joins a real group.

The worker sends a heartbeat every 20 seconds during long jobs. Idle demo sessions without transactions or queued/in-flight work (including an unfunded draft policy) stop consuming admission capacity after 30 minutes. Their history remains available, and resumed work must reacquire capacity under the admission lock.


### Automatic friends test-payment terms

Friends never enter a payment amount or recipient. After unanimous place agreement,
the organizer selects Continue to approval. The API prepares immutable Sepolia terms
from GROUP_TEST_PAYMENT_PER_PERSON_USDC (default 10 MockUSDC per actual member)
and GROUP_TEST_PAYMENT_RECIPIENT (default the existing public Sepolia merchant A test wallet).
These optional settings belong on the Vercel server. They are test configuration, not
restaurant prices or verified restaurant wallets. Exact terms appear in the policy
review; every real member must separately approve and contribute. Request bodies
cannot override either amount or recipient. Existing fixed policies remain unchanged.
