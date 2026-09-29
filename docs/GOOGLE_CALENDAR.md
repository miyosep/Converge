# Google Calendar setup

## Current product choice

Google account connection is deferred. The public site describes optional
automatic calendar addition, clearly marked as not enabled in this preview.
The plan review screen provides readable event details and a copy button instead
of OAuth connection controls. This UI makes no calendar API requests and enables
no automatic jobs. The backend below is retained for a later integration; the
live-verification steps require restoring connection controls first.

Copying includes only the plan name, time with time zone, sample venue and group
size. It does not claim a confirmed reservation or invent an end time. Users paste
the details into Google Calendar and review/save the event themselves.

Wallet authentication remains the Converge identity. Google OAuth grants a
separate calendar permission; connecting Google does not replace wallet login.
Each member connects their own Google account and explicitly enables each plan.

## What is implemented

- Server-side authorization code flow with PKCE, a short-lived browser state
  cookie, one-use database state and binding to the initiating wallet session.
- Refresh tokens encrypted with AES-256-GCM and authenticated to the wallet.
- A private event in the connected account's primary calendar after the ordinary
  group's verified test payment. The payment worker must have a fresh matching
  completed snapshot and confirmed transaction record. This is the existing
  two-confirmation policy, not Ethereum finality.
- Explicit duration selection. No inferred end time, guest invitations, preference
  text, participant identities, wallet addresses or payment details sent to Google.
- Deterministic event IDs across retries, recovery after an uncertain response,
  retryable provider failures and reconnect prompts for expired permissions.
- Per-plan opt-out and account disconnect. Disconnect removes stored credentials
  and disables future additions. Existing calendar events are retained. Google
  authorization can also be removed in the user's Google account permissions.

The prototype has sample venues and simulated reservations. Events are labeled
`[Converge prototype]`, tentative and free (transparent), with no reminders. Do
not promote them to confirmed restaurant bookings until a real reservation
provider returns a verified confirmation. Explore's separate demo storage is not
connected; this integration targets ordinary groups created in the workspace.

## 1. Create the Google application

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or
   select a project. Enable **Google Calendar API** in APIs & Services.
2. Configure Google Auth Platform branding, audience and contact information.
   For development, choose External / Testing and add the Google accounts that
   will test the integration as test users.
3. Create an OAuth client with application type **Web application**.
4. Add the exact authorized redirect URI:
   `http://localhost:3000/api/calendar/callback` for local development.
   Add `https://YOUR-DOMAIN/api/calendar/callback` for your hosted environment.
5. Configure requested scopes `openid`, `email`, and
   `https://www.googleapis.com/auth/calendar.events.owned`.
   This scope permits event management on calendars the user owns. The application
   uses it only to insert and recover its own primary-calendar events.
6. Store the client ID and client secret in server environment variables.
   Do not put secrets in chat, source control or `NEXT_PUBLIC_` variables.

Google may require verification before a public launch. Testing-mode refresh
tokens can expire after seven days for this scope; reconnect during development.

## 2. Configure Converge

Set these in the web server and calendar worker environments:

```dotenv
APP_ORIGIN=http://localhost:3000
GOOGLE_CLIENT_ID=your-web-client-id
GOOGLE_CLIENT_SECRET=your-web-client-secret
GOOGLE_TOKEN_ENCRYPTION_KEY=64-hex-characters-from-32-random-bytes
```

Generate a key locally with Node's `crypto.randomBytes(32).toString('hex')` and
store it in the secret environment file. Keep it stable: changing it requires
users to reconnect. Back up the key separately from the database. Ensure
`.env.development` does not override production values when deploying.

Migration `0012_google_calendar.sql` must be applied to the selected environment.
It has been tested on the existing `dev-preferences` branch. Never copy connected
Google credentials from production to a test environment without disabling jobs.

```powershell
pnpm db:migrate:dev
pnpm calendar:check
pnpm calendar:worker
```

Keep the existing `pnpm groups:worker` running too. Calendar processing is a
separate service, so Google outages do not block payment processing. Host the
calendar worker as a supervised background process, or invoke it with `--once`
on a recurring server schedule. A request-only web deployment will not run it.

## 3. Verify the live connection

1. Sign in with the wallet and open a group's **Split & approve** screen after a
   recommendation exists.
2. Choose **Connect Google Calendar**, consent using a Google test account and
   return to Converge. The page displays the connected email only to its owner.
3. Choose a duration and **Automatically add this plan**.
4. Complete the existing test-payment flow. After the payment worker verifies it,
   the calendar worker inserts the event and the UI shows **View event**.
5. Restart the calendar worker and confirm there is still one event. Verify that
   disconnect stops new additions and that revoked permission requests reconnect.

## Verification performed without Google credentials

Unit tests cover encryption ownership and tampering, event privacy and times,
PKCE/scope construction, stable IDs, duplicate recovery and revoked grants.
`scripts/calendar-db-rehearsal.ts` exercises real development database queries,
session binding and state replay rejection, eligibility gating, opt-out,
insertion, retry deduplication and disconnect, with mocked Google responses.
It removes only its own generated fixtures. Live Google consent and event creation
remain unverified until the OAuth client is configured.

References: [OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server),
[Calendar scopes](https://developers.google.com/workspace/calendar/api/auth),
[Create events](https://developers.google.com/workspace/calendar/api/guides/create-events).
