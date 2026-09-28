# Managed PostgreSQL Setup

## Selected Service

The project owner selected Neon Free on September 29, 2026 (KST), following the
decision to use PostgreSQL for a multi-device web application. The owner has
since created project `rough-cake-92709912` (Converge). The local Neon context
is linked to its `production` branch (`br-empty-darkness-b5hw6tyq`). No paid
plan was selected and no additional project was created.

## CLI and Agent Setup

- Neon CLI 6.2.4 was installed in the Windows user npm prefix. npm was also
  installed there because the original runtime did not expose npm/npx.
- Eight official Neon skills were installed under `.agents/skills`, with
  `skills-lock.json` recording their sources. These are tooling instructions,
  not activation of Auth, Functions, Storage, or AI Gateway services.
- The user's Codex MCP configuration now includes Neon, pinned to this project
  with a project-scoped API key. Other existing configuration sections remain.
  The credential is outside this repository. The MCP key has write access within
  this project; it is not read-only. MCP tool availability in the current chat
  has not been verified and may require reloading the Codex client.
- `.neon` contains the local project/branch link and is git-ignored.
- `neon.ts` contains exactly `defineConfig({})` and its import. The packages
  `@neon/config` 1.8.2 and `@neon/env` 1.4.7 were added with pnpm.
- `neon config plan` reported no changes, utilizing Postgres only. The first
  `neon deploy` attempt failed when the CLI OAuth token was rejected. A subsequent
  deploy using the existing project-scoped MCP credential succeeded with no
  remote changes. No other Neon service was provisioned.
- The production branch's `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and
  `NEON_BRANCH` were pulled into the ignored `.env`. Existing non-Neon lines,
  including Kiln and wallet settings, were compared before and after and kept.
- A read-only `SELECT` through the CLI connected to database `neondb` as
  `neondb_owner` and returned `connection_ok = 1`. Application migrations and
  the preference workflow's database integration remain pending.

The overview skill was fetched from
https://neon.com/.well-known/agent-skills/neon/SKILL.md and the PostgreSQL child
skill was read before setup. Existing tooling is reused rather than reinstalled.
The application continues to use Kiln Qwen and the planned wallet-signature
authentication; installing Neon skills does not change those decisions.

The CLI OAuth login in a separate PowerShell session is not needed to finish
this setup. It may still require repair if a contributor wants to use the CLI
outside Codex. Use pooled `DATABASE_URL` for application queries and
`DATABASE_URL_UNPOOLED` for migration tooling. Future schema work should use an
isolated development branch; this setup linked `production` at the owner's
explicit request and did not apply application schema changes.

Neon provides PostgreSQL; it does not host the Converge web application. The
Next.js server will connect to the database using a server-only connection
string. Participant browsers must never receive database credentials. Wallet
signature login remains the intended authentication model, not Neon account
login for participants.

## Manual Connection Setup (Alternative)

1. Open [the Neon console](https://console.neon.tech) and sign in or create your
   account. Complete any account verification and terms acceptance yourself.
2. Stay on the Free plan. Create a dedicated project named `converge` so later
   migrations cannot affect an unrelated application's tables.
3. Choose the database region closest to the planned application server. If
   running the demo server on a MacBook in Korea, use a nearby available region;
   record the actual choice before later cloud deployment.
4. Open the project's connection details and select the intended branch,
   database, and role. Obtain the pooled PostgreSQL connection string for the
   application. Keep the generated TLS parameters intact. Do not weaken
   certificate verification to bypass a connection error.
5. Set `DATABASE_URL` in the repository's ignored root `.env`, then save the
   file. Do not put the value in chat, a screenshot, a commit, or a public issue.
6. Tell the implementer that the file is ready, without including its contents.
   Connectivity checks and reviewed migrations are the next steps; neither has
   been run against a managed database yet.

The expected variable is `DATABASE_URL`, not a public frontend environment
variable. The setup does not require sharing a Neon account password or API key.
Check the current [Neon Free plan information](https://neon.com/blog/how-to-make-the-most-of-neons-free-plan)
and [connection instructions](https://neon.com/docs/get-started-with-neon/connect-neon)
in the console before provisioning. Do not upgrade to a paid plan without an
explicit decision from the owner.

## Implementation and Demo Boundaries

Project linking and database connectivity are complete, but migration tooling,
tables, transaction isolation tests, wallet sessions, and HTTP APIs are pending.
The existing preference transition module is not a persistent repository.
No empty or unavailable database should cause the application to fall back to
in-memory production state or to fabricate confirmed preferences.

The MacBook will need internet connectivity for Neon, Kiln, and Ethereum Sepolia.
A managed database does not make a localhost web server reachable by friends on
other networks; application hosting and its public HTTPS origin are separate
decisions. Run a complete rehearsal on the actual presentation MacBook before
claiming demo readiness.
