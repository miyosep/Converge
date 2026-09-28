# Managed PostgreSQL Setup

## Selected Service

The project owner selected Neon Free on September 29, 2026 (KST), following the
decision to use PostgreSQL for a multi-device web application. No paid plan or
database project has been provisioned by this repository. Browser access to the
Neon console was declined; account and project creation require the owner.

Neon provides PostgreSQL; it does not host the Converge web application. The
Next.js server will connect to the database using a server-only connection
string. Participant browsers must never receive database credentials. Wallet
signature login remains the intended authentication model, not Neon account
login for participants.

## Owner Setup

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

Database selection is complete, but connection validation, migration tooling,
tables, transaction isolation tests, wallet sessions, and HTTP APIs are pending.
The existing preference transition module is not a persistent repository.
No empty or unavailable database should cause the application to fall back to
in-memory production state or to fabricate confirmed preferences.

The MacBook will need internet connectivity for Neon, Kiln, and Ethereum Sepolia.
A managed database does not make a localhost web server reachable by friends on
other networks; application hosting and its public HTTPS origin are separate
decisions. Run a complete rehearsal on the actual presentation MacBook before
claiming demo readiness.
