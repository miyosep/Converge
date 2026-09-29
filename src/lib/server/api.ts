import { Pool } from "pg";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { verifiedPostgresUrl } from "../db/connection.js";
import {
  PreferenceRepository,
  PreferenceRepositoryError,
} from "../db/preferences.js";
import { WalletAuthError, WalletAuthRepository } from "../db/wallet-auth.js";
import { PreferenceError } from "../preferences.js";
import { GroupPolicyError } from "../group-policy.js";
import type { KilnAttempt } from "../kiln/client.js";

const SESSION_COOKIE = "converge_session";
const databaseUrl = process.env.DATABASE_URL;
const origin =
  process.env.APP_ORIGIN ||
  (process.env.NODE_ENV === "development" ? "http://localhost:3000" : "");

let pool: Pool | undefined;
export function services() {
  if (!databaseUrl || !origin)
    throw new Error("DATABASE_URL and APP_ORIGIN are required");
  pool ??= new Pool({
    connectionString: verifiedPostgresUrl(databaseUrl),
    max: 5,
    connectionTimeoutMillis: 15000,
  });
  return {
    auth: new WalletAuthRepository(pool, origin),
    preferences: new PreferenceRepository(pool),
  };
}

export async function recordKilnAttempt(
  groupId: string,
  actor: string,
  revisionId: string,
  attempt: KilnAttempt,
) {
  services();
  await pool!.query(
    `INSERT INTO converge_kiln_attempts
    (request_id, attempt, group_id, wallet_address, revision_id, usage,
      http_status, error_code, cost_usd, cached_input_tokens, reasoning_tokens)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
    [
      attempt.usage.requestId,
      attempt.usage.attempt,
      groupId,
      actor.toLowerCase(),
      revisionId,
      JSON.stringify(attempt.usage),
      attempt.httpStatus,
      attempt.errorCode,
      attempt.costUsd,
      attempt.cachedInputTokens,
      attempt.reasoningTokens,
    ],
  );
}

export function verifyOrigin(request: NextRequest) {
  if (!origin || request.headers.get("origin") !== new URL(origin).origin)
    throw new ApiError(403, "INVALID_ORIGIN");
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/json"))
    throw new ApiError(415, "JSON_REQUIRED");
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export async function sessionWallet(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new ApiError(401, "AUTH_REQUIRED");
  try {
    return await services().auth.sessionWallet(token);
  } catch (error) {
    if (error instanceof WalletAuthError)
      throw new ApiError(401, "AUTH_REQUIRED");
    throw error;
  }
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(origin).protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: new URL(origin).protocol === "https:",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function api(work: () => Promise<NextResponse>) {
  try {
    const result = await work();
    result.headers.set("Cache-Control", "no-store");
    return result;
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ error: error.code }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError)
      return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
    if (error instanceof WalletAuthError) {
      const status = [
        "INVALID_SIGNATURE",
        "INVALID_CHALLENGE",
        "INVALID_INVITE",
      ].includes(error.code)
        ? 400
        : error.code === "NOT_CREATOR"
          ? 403
          : 409;
      return NextResponse.json({ error: error.code }, { status });
    }
    if (error instanceof PreferenceRepositoryError)
      return NextResponse.json({ error: error.code }, { status: 409 });
    if (error instanceof PreferenceError)
      return NextResponse.json({ error: error.code }, { status: 409 });
    if (error instanceof GroupPolicyError)
      return NextResponse.json({ error: error.code }, { status: 409 });
    console.error("API request failed", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
