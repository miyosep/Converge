# First Web Workflow

The initial Next.js app supports wallet-signature login, group creation, capped invite links, six-person progress, private preference submission through Kiln `qwen3-32b`, correction, and explicit confirmation. It does not yet create the spending proposal, send contract transactions, or claim refunds. The screen is an early working interface, not the acceptance demo.

## Local Development

Use Node.js 24.19.0 and pnpm 11.19.0 on Windows or macOS. Install with `pnpm install --frozen-lockfile`. Place the **development branch** pooled Neon URL in ignored `.env.development` as `DATABASE_URL`, its direct URL as `DATABASE_URL_UNPOOLED`, and set `NEON_BRANCH=dev-preferences`. Keep `KILN_API_KEY` server-side in ignored `.env`; do not prefix it with `NEXT_PUBLIC_`. Set `APP_ORIGIN=http://localhost:3000` for local use. No secrets belong in Git, screenshots, or chat.

Run `pnpm db:migrate:dev` and `pnpm dev`, then open `http://localhost:3000` in a browser with an EIP-1193 wallet such as MetaMask. The wallet must support Ethereum Sepolia. The login signature is not a transaction. This version verifies signatures from externally owned accounts only. Six independently controlled wallets are required to verify the actual user flow. Dedicated demo keys should never be imported into an everyday wallet profile.

For local checks, run `pnpm db:auth-rehearse:dev` to validate DB replay/invite behavior and `pnpm http:rehearse:dev` while the dev server is running. `pnpm http:kiln-rehearse:dev` additionally spends a live Kiln request, submits and confirms a synthetic preference, and verifies usage persistence. These scripts generate ephemeral accounts and write synthetic records only to the development branch. They do not submit transactions. `pnpm check` and `pnpm build` validate code; the actual presentation MacBook still needs a manual browser-wallet check.

## Boundaries

The production Neon branch remains unmigrated. A production deployment must set an HTTPS `APP_ORIGIN`, apply reviewed migrations to the intended branch, configure Kiln privately, and pass a multi-device access review. A localhost invite link is usable only by browsers on that machine; it is not a public invitation for friends on other devices. The Next.js server, not a browser, owns Neon and Kiln credentials. POST routes require a matching `Origin`, JSON content type, and a valid HttpOnly SameSite session cookie after login. Group APIs derive the actor from that session. The other members' progress response includes only display names, wallet addresses, and submitted/confirmed flags; individual raw text and extracted constraints are not shared.

Challenge messages bind the address, Ethereum Sepolia chain ID, expected origin, nonce, and five-minute expiry. Challenges are consumed atomically; sessions use random hashed tokens and can be revoked. Invite tokens are random, stored only as hashes, expire after 24 hours, and cannot exceed the six-person capacity. These are application controls, not blockchain payment authorization. Rate limiting, contract-wallet signatures, production deployment, and independent security review remain open.
