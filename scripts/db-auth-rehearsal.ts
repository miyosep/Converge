import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { privateKeyToAccount } from "viem/accounts";
import {
  WalletAuthError,
  WalletAuthRepository,
} from "../src/lib/db/wallet-auth.js";
import { verifiedPostgresUrl } from "../src/lib/db/connection.js";
import { PreferenceRepository } from "../src/lib/db/preferences.js";

if (process.env.NEON_BRANCH !== "dev-preferences")
  throw new Error("Auth rehearsal must run on the dev-preferences branch");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const pool = new Pool({
  connectionString: verifiedPostgresUrl(connectionString),
  max: 4,
});
const origin = "http://localhost:3000";
const auth = new WalletAuthRepository(pool, origin);
const preferences = new PreferenceRepository(pool);
const accounts = Array.from({ length: 7 }, () =>
  privateKeyToAccount(`0x${randomBytes(32).toString("hex")}`),
);

try {
  const owner = accounts[0]!;
  const groupId = await preferences.createGroup({
    name: "Auth rehearsal",
    slot: { startsAt: "2026-10-03T18:00:00Z", timeZone: "Asia/Seoul" },
    creator: owner.address,
    displayName: "Alice",
  });
  const challenge = await auth.createChallenge(owner.address);
  const wrongSignature = await accounts[1]!.signMessage({
    message: challenge.message,
  });
  await assert.rejects(
    auth.verifyChallenge(challenge.challengeId, wrongSignature),
    (error: unknown) =>
      error instanceof WalletAuthError && error.code === "INVALID_SIGNATURE",
  );
  const signature = await owner.signMessage({ message: challenge.message });
  const session = await auth.verifyChallenge(challenge.challengeId, signature);
  assert.equal(
    await auth.sessionWallet(session.token),
    owner.address.toLowerCase(),
  );
  await assert.rejects(
    auth.verifyChallenge(challenge.challengeId, signature),
    (error: unknown) =>
      error instanceof WalletAuthError && error.code === "INVALID_CHALLENGE",
  );
  await assert.rejects(
    auth.createInvite(groupId, accounts[1]!.address),
    (error: unknown) =>
      error instanceof WalletAuthError && error.code === "NOT_CREATOR",
  );
  const invite = await auth.createInvite(groupId, session.walletAddress);
  await assert.rejects(
    auth.joinWithInvite(groupId, accounts[1]!.address, "Bob", "x".repeat(43)),
    (error: unknown) =>
      error instanceof WalletAuthError && error.code === "INVALID_INVITE",
  );
  for (const [index, account] of accounts.slice(1, 6).entries()) {
    const joined = await auth.joinWithInvite(
      groupId,
      account.address,
      `Participant ${index + 2}`,
      invite.token,
    );
    assert.equal(joined.joined, true);
  }
  assert.equal(
    (
      await auth.joinWithInvite(
        groupId,
        accounts[1]!.address,
        "Bob",
        invite.token,
      )
    ).joined,
    false,
  );
  await assert.rejects(
    auth.joinWithInvite(groupId, accounts[6]!.address, "Seventh", invite.token),
    (error: unknown) =>
      error instanceof WalletAuthError && error.code === "INVALID_INVITE",
  );
  assert.equal(
    (await preferences.getProgress(groupId, owner.address)).length,
    6,
  );
  await auth.revokeSession(session.token);
  await assert.rejects(
    auth.sessionWallet(session.token),
    (error: unknown) =>
      error instanceof WalletAuthError && error.code === "INVALID_SESSION",
  );
  console.log(
    JSON.stringify({
      groupId,
      checks: [
        "wrong signature rejected",
        "challenge replay rejected",
        "non-creator invite rejected",
        "invalid invite rejected",
        "six-person cap enforced",
        "session revocation enforced",
      ],
    }),
  );
} finally {
  await pool.end();
}
