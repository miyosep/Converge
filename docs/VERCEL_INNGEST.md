# Vercel, Neon and Inngest

This branch adds an opt-in serverless execution mode. The existing local workers
remain available with `BACKGROUND_DRIVER=local`. Hosted mode uses Neon for Explore
state, private signed transactions, fenced execution leases and service health.
There is no `.demo` read/write on the hosted execution path.

## Components

- Vercel hosts Next.js, authenticated APIs and `/api/inngest`.
- Inngest calls bounded job steps, retries failures and sleeps between checks.
  SDK checkpoint batching is disabled so each step has its own Vercel invocation.
- Neon is the durable source of truth. Events carry only opaque run/group IDs;
  preference text, signing keys and signed payloads do not enter event payloads
  or step results.
- Kiln and Sepolia remain the existing remote dependencies. User-owned wallet
  approvals, contributions and refund signatures remain in the browser.
- Google Calendar jobs use the same hosted scheduler when Google is configured.

Explore and ordinary groups share a database execution lease and a transaction
registry. The partial unique index permits only one unresolved transaction per
signer. Journals are saved before broadcast and are reused after timeout or a
lost RPC response. Ordinary-group history and its registry entry change in the
same transaction. Expired lease owners cannot persist new signatures or state.
Inngest concurrency is an additional scheduling control, not the payment lock.

## Prepare the database

Use a separate Neon branch for rehearsal. Apply the checked-in migrations using
the **direct** connection and the existing migration runner:

```sh
node --env-file=.env.inngest-test --import tsx scripts/db-migrate.ts dev-vercel-inngest
node --env-file=.env.inngest-test --import tsx scripts/serverless-db-rehearsal.ts
```

The test branch was created from `dev-preferences`; production was not migrated.
The rehearsal creates and removes only synthetic records and sends no blockchain
transactions, AI requests or calendar messages. Existing group journals are
copied into the shared registry by migration `0013`.

Do not run a local signer against the same accounts while hosted jobs are enabled.
Separate databases and Inngest environments do **not** isolate blockchain nonces.

## Preserve existing Explore sessions

Before switching a live session, stop the local app and workers. Keep `.demo` and its
private journal. Verify/import with the pooled URL of the intended target branch:

```sh
node --env-file=.env.inngest-test --import tsx scripts/import-explore-state.ts
node --env-file=.env.inngest-test --import tsx scripts/import-explore-state.ts --execute dev-vercel-inngest
```

The tool locks the source, validates signed payloads, copies all runs, reserved
budgets and audit attempts atomically, and requires an empty Explore destination.
It preserves the source files. Do not reset the gas budget by importing only runs.
If a pending signature conflicts with a group signature, the import fails instead
of enabling two competing transactions.

## Vercel deployment

1. Import the repository/branch as a Next.js project. Use Node 24.x, the pinned
   pnpm version, `pnpm install --frozen-lockfile` and `pnpm build`.
2. Set `DATABASE_URL` to the intended pooled Neon connection, `APP_ORIGIN` to the
   exact HTTPS origin, and retain the existing session/Kiln/RPC configuration.
   For the default five-category search, set server-only `KILN_API_KEY`,
   `XAPI_KEY` and `RESTAURANT_SEARCH_PROVIDER=xapi`. The ignored local `.env.local`
   is not deployed. See `LIVE_RESTAURANT_SEARCH.md` for search setup and limitations.
3. Set `BACKGROUND_DRIVER=inngest`, `BACKGROUND_JOBS_ENABLED=true`,
   `GROUP_EXECUTION_ENABLED=true` and `EXPLORE_DEMO_ENABLED=true` on the intended
   production deployment. Configure a private `EXPLORE_DEMO_ACCESS_CODE`.
4. Connect the Inngest application to `https://<host>/api/inngest` through its
   Vercel integration or endpoint sync. Set `INNGEST_EVENT_KEY` and
   `INNGEST_SIGNING_KEY` from that same Inngest environment. Hosted mode forces
   signature verification, regardless of `INNGEST_DEV`.
5. Supply the existing test-only executor, deployer and automated participant
   credentials to this production environment. Keep them out of preview
   environments, client bundles, repository files and Inngest event data.
6. For Calendar, configure Google credentials and the HTTPS callback documented
   in `GOOGLE_CALENDAR.md`. Retain the same token encryption key when moving data.
7. Sync the Inngest functions and confirm its recovery run succeeds. The demo's
   availability reflects a recent successful dispatch scan, not just env flags.

The Inngest route uses `maxDuration=300`. Confirm the project's Vercel function
settings support that duration. Each blockchain tick is bounded by the invocation
and fenced lease; receipt waits return immediately and later steps check again.
Preview deployments deliberately do not run jobs, even if enable flags are copied.
Use separate accounts for any preview that must execute live transactions.

## Local serverless rehearsal

Use a separate port/build directory to avoid disturbing an existing demo server.
Load an isolated DB and set `BACKGROUND_DRIVER=inngest`,
`BACKGROUND_JOBS_ENABLED=true`, `INNGEST_DEV=true`. Run Next.js and the Inngest dev
server pointed at its `/api/inngest` endpoint. The Inngest dev server is only for
development; the hosted Inngest service handles scheduling after deployment.

Do not copy real signing keys into an isolated DB rehearsal: the chain is shared.

## Scheduling and free-tier usage

Authenticated commands wake jobs immediately. Authenticated progress reads can
wake them at most once per ten seconds per entity. DB state survives a failed
event send, and a five-minute Inngest recovery schedule discovers saved work.
An active workflow advances at most 30 ticks with ten-second durable sleeps.
Waiting for user approval stops the fast loop. Terminal automated refunds stop
after confirmation; later user wallet activity is refreshed when they return.
Calendar runs every five minutes and after a group finishes refreshing its chain
state. The latter trigger supplies the fresh verified payment snapshot required
before creating an event.

Even an idle cron consumes executions. The recovery function's empty scan,
health update and invocation total roughly 25,920 monthly executions at 30 days;
an unconfigured calendar function adds roughly 8,640 invocations. Active jobs,
retries and additional pages add usage. Measure actual Inngest usage before the
event; the free quota is not a promise of unlimited demos.

## Cutover and rollback

Deploy with jobs disabled first, finish the source import, then enable only the
hosted signer. Verify Explore and ordinary-group flows from separate browsers,
close/reopen a browser during processing, and test an interrupted invocation.
Check exactly one approved payment per decision and independently verify receipts.

The baseline Git commit preserves the local implementation. After hosted writes,
switching code back alone is **not** a safe data rollback: local files would be
stale. Keep hosted signing disabled until all pending journals are reconciled and
the chosen runtime has the latest durable state. Do not delete a pending journal.

Implementation and synthetic DB tests do not establish a completed public Vercel
deployment, live Inngest account integration or a new end-to-end Sepolia run.
