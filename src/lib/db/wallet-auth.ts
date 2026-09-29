import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { verifyMessage } from "viem";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { z } from "zod";
import { addressSchema, idSchema } from "../schemas/primitives.js";

const CHAIN_ID = 11155111;
const CHALLENGE_MS = 5 * 60_000;
const SESSION_MS = 7 * 24 * 60 * 60_000;
const INVITE_MS = 24 * 60 * 60_000;

const normalizedWallet = (value: string) =>
  addressSchema.parse(value).toLowerCase();
const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const opaqueToken = () => randomBytes(32).toString("base64url");
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const signatureSchema = z.string().regex(/^0x[0-9a-fA-F]{130}$/);

export class WalletAuthError extends Error {
  constructor(
    public readonly code:
      | "INVALID_CHALLENGE"
      | "INVALID_SIGNATURE"
      | "INVALID_SESSION"
      | "INVALID_INVITE"
      | "NOT_CREATOR"
      | "GROUP_NOT_FOUND"
      | "GROUP_FULL"
      | "GROUP_LOCKED",
  ) {
    super(code);
    this.name = "WalletAuthError";
  }
}

async function transaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// SIWE signatures are verified for EOAs. Contract-wallet support needs an RPC-backed verifier.
export class WalletAuthRepository {
  private readonly origin: URL;

  constructor(
    private readonly pool: Pool,
    appOrigin: string,
  ) {
    this.origin = new URL(appOrigin);
    if (
      this.origin.pathname !== "/" ||
      this.origin.search ||
      this.origin.hash ||
      !["http:", "https:"].includes(this.origin.protocol) ||
      (this.origin.protocol === "http:" &&
        !["localhost", "127.0.0.1"].includes(this.origin.hostname))
    )
      throw new Error(
        "APP_ORIGIN must be an HTTPS origin or local development URL",
      );
  }

  async createChallenge(address: string) {
    const walletAddress = normalizedWallet(address);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + CHALLENGE_MS);
    const message = createSiweMessage({
      address: addressSchema.parse(address),
      chainId: CHAIN_ID,
      domain: this.origin.host,
      uri: this.origin.origin,
      version: "1",
      nonce: generateSiweNonce(),
      issuedAt: new Date(),
      expirationTime: expiresAt,
      statement: "Sign in to Converge. This does not authorize a payment.",
    });
    await this.pool.query(
      `INSERT INTO converge_auth_challenges
      (id, wallet_address, message, expires_at) VALUES ($1, $2, $3, $4)`,
      [id, walletAddress, message, expiresAt],
    );
    return { challengeId: id, message, expiresAt: expiresAt.toISOString() };
  }

  async verifyChallenge(challengeId: string, signature: string) {
    idSchema.parse(challengeId);
    const signed = signatureSchema.parse(signature) as `0x${string}`;
    const challenge = await this.pool.query<{
      wallet_address: string;
      message: string;
    }>(
      `SELECT wallet_address, message FROM converge_auth_challenges
      WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()`,
      [challengeId],
    );
    const row = challenge.rows[0];
    if (!row) throw new WalletAuthError("INVALID_CHALLENGE");
    const valid = await verifyMessage({
      address: row.wallet_address as `0x${string}`,
      message: row.message,
      signature: signed,
    });
    if (!valid) throw new WalletAuthError("INVALID_SIGNATURE");
    const token = opaqueToken();
    const expiresAt = new Date(Date.now() + SESSION_MS);
    await transaction(this.pool, async (client) => {
      const consumed = await client.query(
        `UPDATE converge_auth_challenges SET consumed_at = now()
        WHERE id = $1 AND consumed_at IS NULL AND expires_at > now()
        RETURNING id`,
        [challengeId],
      );
      if (!consumed.rows.length) throw new WalletAuthError("INVALID_CHALLENGE");
      await client.query(
        `INSERT INTO converge_auth_sessions(token_hash, wallet_address, expires_at)
        VALUES ($1, $2, $3)`,
        [tokenHash(token), row.wallet_address, expiresAt],
      );
    });
    return { token, walletAddress: row.wallet_address, expiresAt };
  }

  async sessionWallet(token: string) {
    const hash = tokenHash(tokenSchema.parse(token));
    const result = await this.pool.query<{ wallet_address: string }>(
      `SELECT wallet_address FROM converge_auth_sessions
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [hash],
    );
    if (!result.rows[0]) throw new WalletAuthError("INVALID_SESSION");
    return result.rows[0].wallet_address;
  }

  async revokeSession(token: string) {
    await this.pool.query(
      `UPDATE converge_auth_sessions SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash(tokenSchema.parse(token))],
    );
  }

  async createInvite(groupId: string, creator: string) {
    const group = idSchema.parse(groupId);
    const walletAddress = normalizedWallet(creator);
    const token = opaqueToken();
    const expiresAt = new Date(Date.now() + INVITE_MS);
    await transaction(this.pool, async (client) => {
      const groups = await client.query<{
        creator_wallet: string;
        preferences_locked: boolean;
        target_member_count: number;
      }>(
        `SELECT creator_wallet, preferences_locked, target_member_count FROM converge_groups
        WHERE id = $1 FOR UPDATE`,
        [group],
      );
      const record = groups.rows[0];
      if (!record) throw new WalletAuthError("GROUP_NOT_FOUND");
      if (record.creator_wallet !== walletAddress)
        throw new WalletAuthError("NOT_CREATOR");
      if (record.preferences_locked) throw new WalletAuthError("GROUP_LOCKED");
      const count = await client.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM converge_participants
        WHERE group_id = $1`,
        [group],
      );
      const remaining =
        record.target_member_count - Number(count.rows[0]!.total);
      if (remaining <= 0) throw new WalletAuthError("GROUP_FULL");
      await client.query(
        `INSERT INTO converge_group_invites
        (token_hash, group_id, created_by_wallet, max_uses, expires_at)
        VALUES ($1, $2, $3, $4, $5)`,
        [tokenHash(token), group, walletAddress, remaining, expiresAt],
      );
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  async joinWithInvite(
    groupId: string,
    address: string,
    displayName: string,
    inviteToken: string,
  ) {
    const group = idSchema.parse(groupId);
    const walletAddress = normalizedWallet(address);
    const name = z.string().trim().min(1).max(80).parse(displayName);
    const hash = tokenHash(tokenSchema.parse(inviteToken));
    return transaction(this.pool, async (client) => {
      const groups = await client.query<{
        preferences_locked: boolean;
        target_member_count: number;
      }>(
        "SELECT preferences_locked, target_member_count FROM converge_groups WHERE id = $1 FOR UPDATE",
        [group],
      );
      if (!groups.rows[0]) throw new WalletAuthError("GROUP_NOT_FOUND");
      if (groups.rows[0].preferences_locked)
        throw new WalletAuthError("GROUP_LOCKED");
      const invite = await client.query<{
        uses: number;
        max_uses: number;
      }>(
        `SELECT uses, max_uses FROM converge_group_invites
        WHERE token_hash = $1 AND group_id = $2
          AND revoked_at IS NULL AND expires_at > now() FOR UPDATE`,
        [hash, group],
      );
      const row = invite.rows[0];
      if (!row) throw new WalletAuthError("INVALID_INVITE");
      const existing = await client.query(
        `SELECT 1 FROM converge_participants
        WHERE group_id = $1 AND wallet_address = $2`,
        [group, walletAddress],
      );
      if (existing.rows.length) return { joined: false };
      if (row.uses >= row.max_uses) throw new WalletAuthError("INVALID_INVITE");
      const count = await client.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM converge_participants
        WHERE group_id = $1`,
        [group],
      );
      if (Number(count.rows[0]!.total) >= groups.rows[0].target_member_count)
        throw new WalletAuthError("GROUP_FULL");
      await client.query(
        `INSERT INTO converge_participants
        (group_id, wallet_address, display_name) VALUES ($1, $2, $3)`,
        [group, walletAddress, name],
      );
      await client.query(
        `UPDATE converge_group_invites SET uses = uses + 1 WHERE token_hash = $1`,
        [hash],
      );
      return { joined: true };
    });
  }
}
